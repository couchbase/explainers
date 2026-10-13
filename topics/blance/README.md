# blance: planning and moving partitions

Explainers of [blance](https://github.com/couchbase/blance), the
partition-assignment library under
[cbgt](https://github.com/couchbase/cbgt) and so under Couchbase's
full-text search: how it decides which node holds each index
partition's primary and replicas, and how a rebalance then moves them
there. (See the [repo's README](../../README.md) for the engine,
building and publishing, and [../cbft](../cbft/README.md) for the
search side.)

Shared by its explainers: `sources.yaml` (blance v0.1.6, as cbgt pins
it, and cbgt), and `research/blance-internals.md`, notes on how
blance's planner, moves and orchestrator work, with file:line
references and results from running the real library.

## Planned explainers

None are built yet. In order:

- **01-planning**: the planner, `PlanNextMapEx`. Partitions × nodes,
  with primary and replica chips; the greedy loop, one state at a
  time; which partitions go first; the node score and what each term
  is for; stickiness; spreading a primary's replicas; server groups
  as hierarchy rules; the convergence loop. Then the cluster changes:
  add a node (balanced, but in 10 moves where 8 would do), remove one,
  fail one over. The planner would be a JS port checked against the
  real Go by golden cases (`tools/plan-golden`), so the reader can
  change the cluster and watch.
- **02-moving**: from a plan to a rebalance: each partition's moves
  (`CalcPartitionMoves`), then `OrchestrateMoves`: a mover per node,
  the controller that picks each node's next move (promote first),
  concurrency per node, pause and stop. A small simulation over time,
  in the code's own airport analogy.
