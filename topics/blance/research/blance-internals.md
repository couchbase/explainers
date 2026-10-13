# blance internals

Notes on how blance v0.1.6 (commit a63f0a3c43ed, what cbgt pins) works,
with file:line references, and how cbgt uses it. Results quoted below
come from running the real library (a throwaway Go program against the
module cache; the explainers' `tools/` will make that repeatable).

blance is three pieces, each usable on its own:

1. **Plan** (`plan.go`): given the current partition map and the
   nodes (some joining, some leaving), compute the next map: which
   node holds each partition in each state (primary, replica, ...).
2. **Moves** (`moves.go`): for one partition, the ordered steps from
   its old nodes-by-state to its new one (add, del, promote, demote).
3. **Orchestrate** (`orchestrate.go`): run all partitions' moves
   concurrently, one mover per node, choosing which partition goes
   next on each node, with pause/resume/stop and progress.

## Vocabulary (api.go)

- `PartitionMap`: partition name → `Partition{Name, NodesByState}`,
  where `NodesByState` is state → node names, e.g.
  `{"primary": ["a"], "replica": ["b"]}` (api.go:22-34).
- `PartitionModel`: state → `{Priority, Constraints}`. Priority 0 is
  highest; Constraints is how many nodes should hold the partition in
  that state (api.go:36-63). cbgt's model: primary {0, 1}, replica
  {1, NumReplicas} (cbgt manager_planner.go:1016-1032).
- `HierarchyRules`: state → rules of `{IncludeLevel, ExcludeLevel}`
  over a node containment tree (node → parent), for rack/zone/server
  group awareness (api.go:65-108).
- `PlanNextMapOptions`: ModelStateConstraints (override the model's),
  PartitionWeights (default 1), StateStickiness (default 1.5),
  NodeWeights (default 1), NodeHierarchy, HierarchyRules
  (api.go:160-190).

## Planning: PlanNextMapEx (plan.go)

**Convergence loop** (plan.go:23-58): run the inner planner up to
`MaxIterationsPerPlan` (10) times, feeding each result back in as the
previous map (with no nodes to add or remove), until a pass changes
nothing. "Usually only 1 or 2 iterations."

**Inner planner** (plan.go:60-331), greedy, one state at a time:

1. Copy the partitions, dropping the leaving nodes from them
   (plan.go:83-89).
2. Count, per state, how many partitions (weighted) each node holds,
   from the *previous* map: `stateNodeCounts` (plan.go:94,
   countStateNodes plan.go:374-399). These counts are updated as each
   assignment is made, so later decisions see earlier ones.
3. For each state in priority order (primary, then replica;
   sortStateNames plan.go:437-474) with constraints > 0
   (plan.go:307-324): `assignStateToPartitions`.
4. `assignStateToPartitions` (plan.go:253-303) sorts the partitions
   (partitionSorter, below), then for each partition asks
   `findBestNodes` for its nodes in this state, removes the partition's
   old nodes in this state and the chosen nodes from any other state,
   and assigns.

**Which partitions go first** (partitionSorter.Score,
plan.go:519-562): those on leaving nodes; then those not yet on any
newly added node; then the rest. Within each, heavier partitions
first, then by name (numeric names zero-padded so "10" sorts after
"9").

**Which nodes are best for a partition** (findBestNodes,
plan.go:98-248): candidates are the remaining nodes, minus those
already holding the partition in a higher-priority state (a replica
never lands on its own primary's node, plan.go:144-156). They're
sorted by score, lowest first (nodeSorter.Score, plan.go:634-689):

    score = count of this state already on the node
          + (times this node already backs the same primary node) / #partitions
          + 0.001 × (all partitions on the node) / #partitions
    score = score / nodeWeight                     (if weight > 0)
    score = score − stickiness                     (if the node holds it now)

Ties go to the node's position in the node list (plan.go:627). The
first `constraints` candidates win; too few gives a warning, "could not
meet constraints" (plan.go:228-235).

- The second term spreads a primary's replicas: if node a's primaries
  have mostly had replicas on b, the next one prefers another node.
- The third term is a tie-breaker towards emptier nodes overall.
- Stickiness (default 1.5) makes staying put worth 1.5 partitions'
  worth of imbalance: blance moves a partition only when that buys
  more balance than that.

**Hierarchy rules** (plan.go:174-226, includeExcludeNodes
plan.go:723-734): for each rule, the candidates are the leaves under
the ancestor `IncludeLevel` levels up from the partition's primary
node, minus the leaves under the ancestor `ExcludeLevel` levels up.
With tree dc → {g1: a, b; g2: c, d}, `{IncludeLevel: 2, ExcludeLevel:
1}` from a gives {a, b, c, d} − {a, b} = {c, d}: "a different group".
cbgt uses exactly that rule for replicas whenever server groups exist
and the index sets no rules (manager_planner.go:899-916).

**cbgt's other tweaks** (manager_planner.go):

- the node list is rotated per index, starting at the crc32 of the
  index name, so different indexes' ties favour different nodes, yet
  repeatably (manager_planner.go:880-897);
- a `NodeScoreBooster` for negative node weights, for single-partition
  indexes (manager_planner.go:29-38, used at plan.go:680-682);
- failover mode sets primary stickiness to 100000
  (manager_planner.go:875-878), but see the finding below.

## Moves: CalcPartitionMoves (moves.go)

For one partition, from begin to end nodes-by-state (moves.go:41-119):
for each state, most important first, promotions into it, then
demotions into it, then clean adds, then clean deletes. Each node
appears in at most one move. With `favorMinNodes` the order flips:
deletes and demotions first, from the least important state up, so
the partition sits on as few nodes as possible at any time (at the
risk of a moment with no primary). cbgt passes FavorMinNodes from its
ctl options (rebalance.go:56, 631-641).

Example (real): partition 0 going from P=a R=c to P=d R=c is
`add d:primary, del a`.

## Orchestration: OrchestrateMoves (orchestrate.go)

The code's own analogy (orchestrate.go:267-334): each partition's
moves are a multi-leg flight plan; each node is an airport with a
runway (a mover goroutine, `runMover`/`moverLoop`,
orchestrate.go:403-480); and one supreme controller
(`runSupplyMoves`, orchestrate.go:509-618) decides which plane takes
off next at each airport.

- Each round, the controller collects every partition's next move,
  grouped by the node it's on (findAvailableMovesUnlocked,
  orchestrate.go:747-763).
- Per node, the app's `FindMoveFunc` picks the best move;
  `MaxConcurrentPartitionMovesPerNode` of them are batched into one
  request (filterNextPlausibleMovesForNode, orchestrate.go:482-504).
  cbgt uses `LowestWeightPartitionMoveForNode`: promote (1) before
  demote (2) before add (3) before del (4) (orchestrate.go:174-194).
- A helper per node offers that batch to the node's mover
  (runSupplyMove, orchestrate.go:622-696). As soon as *any* node
  finishes a batch, the round is interrupted and recomputed, so the
  freed node gets new work right away; moves already handed to a
  mover keep going.
- The app's `AssignPartitionsFunc` does the real work (cbgt:
  rebalance.go:929, create/promote/delete pindexes and wait for them
  to catch up).
- Pause stops new rounds; in-flight moves finish
  (orchestrate.go:362-388, 531-544). Progress counters stream on a
  channel the caller must drain (orchestrate.go:117-141, 733-745).

## Findings from running it

Scenario: 8 partitions, 1 replica, cbgt's model.

- **Fresh, nodes a, b, c:** a 3P 3R, b 3P 2R, c 2P 3R (8 doesn't
  divide by 3). No warnings.
- **Add d:** every node ends at exactly 2P 2R, but in **10 moves**
  over 5 partitions, where 8 would do (d needs 2 primaries and 2
  replicas: 4 adds, 4 deletes). The extra two: partition 5's replica
  goes a → b while partition 2's goes b → d. Greedy, not optimal.
- **Remove b (from that map):** 8 moves; a 3P 3R, c 3P 2R, d 2P 3R.
  For partition 4 (P=b, R=d), blance adds a *new* primary on a rather
  than promoting d's replica: stickiness only rewards a node already
  in the same state. (cbgt's failover doesn't rely on blance here: it
  promotes a surviving replica itself, cbgt cmd/planner.go:144-178,
  and uses blance's plan only when there's none.)
- **Server groups g1 = {a, b}, g2 = {c, d}** with cbgt's default
  rule: every replica is in the other group from its primary, still
  2P 2R per node. Without groups, partition 0 is P=a R=b, the same
  group.

**A likely bug: StateStickiness is ignored unless PartitionWeights is
non-nil.** findBestNodes only looks at StateStickiness inside `if
opts.PartitionWeights != nil` (plan.go:104-115); and when a partition
*has* a weight, that weight is used as its stickiness. Adding d to the
3-node map above:

| options | moves |
|---|---|
| defaults | 10 |
| StateStickiness 100000 (primary and replica), PartitionWeights nil | 10 |
| same, PartitionWeights `{}` (empty, non-nil) | 0 |
| StateStickiness 0, PartitionWeights `{}` | 13 |

cbgt's failover-mode stickiness (manager_planner.go:875-878) is
therefore ignored for indexes without pindex weights, but as above its
failover promotes replicas outside blance, so the effect there is
small. Worth raising with blance's maintainers before an explainer
states it as fact.

**Another, smaller one: the state sort's Less isn't a strict order.**
stateNameSorter.Less (plan.go:459-470) returns true when i's priority
is lower *or* i's name sorts first, so for a model where the names
sort against the priorities (say "a" with priority 1 and "b" with 0)
both Less(a, b) and Less(b, a) are true, and the order depends on Go's
map iteration. cbgt's "primary"/"replica" sort the same both ways, so
it's never bitten.

## Explainer material, in order of payoff

1. **Planning** (plan.go): the greedy loop, the score, stickiness,
   replica spreading, hierarchy rules, the convergence loop. Very
   visual: partitions × nodes, chips for P and R, a score table per
   decision. A JS port checked against the real Go (as 01-indexing
   does for mergeplan) would let the reader add and remove nodes,
   change replicas and weights, and watch the plan and the moves.
2. **Moving** (moves.go, orchestrate.go): from a plan to a running
   rebalance: per-partition move lists, then the airport/controller
   orchestration over time, with MaxConcurrentPartitionMovesPerNode,
   the promote-first heuristic and pause. A small discrete-event
   simulation, like 01-indexing's.
3. Possibly, a short one on **server groups** (hierarchy rules on a
   containment tree), if it outgrows a chapter of 1.
