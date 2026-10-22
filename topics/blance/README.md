# blance: planning and moving partitions

Explainers of [blance](https://github.com/couchbase/blance), a small
library for any partitioned distributed system: it decides which nodes
hold each partition's primary and replicas (or whatever states the app
defines), and how a rebalance then moves them there. Couchbase's cbgt
(and so its full-text search) is one user, and the explainers take
their examples from it. (See the [repo's README](../../README.md) for
the engine, building and publishing.)

Shared by its explainers: `topic.yaml` and `style.css` (the topic's
own look: warm paper, teal primaries, amber replicas, and Space
Grotesk, Source Serif and JetBrains Mono), `sources.yaml` (blance
v0.1.6, as cbgt pins it, and cbgt), `research/blance-internals.md`
(notes on blance's planner, moves and orchestrator, with file:line
references and results from running the real library), and `lib/`.

## lib: blance, in JS

`lib/plan.js` and `lib/moves.js` port blance's `PlanNextMapEx` and
`CalcPartitionMoves` line for line, and `plan.js` can record a trace
of every decision it makes (the partition, the state, each candidate's
score and its terms, the winner). `lib/tools/plan-golden` runs the
real blance on 169 cases (the explainers' scenarios, and seeded random
clusters with weights, stickiness, server groups, nodes joining and
leaving), and `lib/test/plan.test.mjs` checks that the port gives the
same maps, warnings and moves for each.

`lib/orchestrate.js` simulates `OrchestrateMoves` in simulated time:
the same logic as its goroutines (a mover per node, the controller's
rounds, each node's best moves offered by a helper, moves in flight),
made deterministic. `lib/tools/orchestrate-golden` runs the real
orchestrator with an assign callback that takes each batch a known
time, several times per case; two moves finishing together are a race
in the real thing (which the controller hears of first), so cases with
one, or whose runs differ, are marked unstable, and
`lib/test/orchestrate.test.mjs` checks that the simulation gives every
node the same batches, in the same order, at about the same times, on
the stable ones.

After changing the ports or moving to a newer blance, `npm run golden
-- blance orchestrate` and `npm test`.

## 01-planning

"Inside blance: how a plan places partitions". Its diagram is the
partition map as a board (a row per partition, a column per node, a P
or R chip per primary and replica, and each node's tallies), and one
area under it, which shows, as the story needs: the score strip (for
the decision at hand, the outlined row, each node's score as a bar in
its own column, built up as blance computes it: one node at a time,
and each node's terms in turn, then the pick; arrows fly, one at a
time, from the chips each term counts down to the top of the bar,
which grows only once each lands (`sourcesOf` in scenarios.js, which
`test/sources.test.mjs` checks against blance's own terms, and
`test/arrows.test.mjs` the timing); the moves a plan takes (each
node's copies built and deleted, with the copies marked on the board);
the server groups' rule; or a stickiness table, as bars. There's no
panel beside the board.

`scenarios.js` runs its scenarios through the port, with traces: a new
index on nodes a, b and c; node d joining; node b leaving; all four
without and then with server groups. Each scenario is cut into frames,
the map after each of the planner's decisions, and a step's `at`
names one (`fresh.12`: after the 12th decision of the first), or a
stage of one (`fresh.12~a.count`: node a's count). A step whose `at` is several
decisions on plays them, stage by stage, one after another over its
scroll. A node not in the cluster has no column until it joins. An arrow's
thickness goes with what it adds to the score (by its square root, so
the tie-breaker's still show). A step's `focus` (the board, the
tallies, the strip, the panel, or one node's column, `col.a`) puts a
soft box around what to look at; it glides from one step's region to
the next's, and as a reading aid it doesn't count as the step's one
change. `story.js` has the view keys (`at`, `panel`), and the
facts that `expect: ["fact:..."]` checks the text's numbers against:
every candidate's score at every decision (`add.1.a`), each frame's
tallies (`add.16.counts`), each scenario's moves.

## 02-moving

"Inside blance: how a rebalance moves partitions". A triangle of
panels. Top left, the map now: the same board, at a moment of a
rebalance (copies being built fill in place, deletes fade, a partition
with no primary is marked), each node's mover under its column. Top
right, the map after: the cluster's wanted partition map, blance's next
partition map, which slides out of the map now (the `split` view key)
and turns into it. The two maps are labelled alike, "the cluster's
current partition map" and "the cluster's wanted partition map", so
they differ as little as they can. Bottom, centered,
a panel: each partition's moves, or the movers' timeline, a lane per
node, with the controller's rounds.

The map after has its own look, in indigo (`--after`): its frame, its
nodes, and a ring around each copy. As the moves land, the map now
takes it on: a copy in its final place gets the ring, and a node whose
column matches the map after gets its color (node d's "joining"
becomes "joined"), so the map now comes to look like the map after.

`scenarios.js` runs node d joining (01-planning's second plan) through
`lib/orchestrate.js` three ways: one move at a time per node, up to
four, and deletes first (`FavorMinNodes`), with partitions of
different sizes, timed as `lib/tools/orchestrate-golden`'s story cases
are, so the real orchestrator's runs of them are checked to match. A
step's `at` names a run and a moment in it (`one@270`); the scroll
moves time from one step's moment to the next's.

## 03-groups

"Inside blance: server groups". The same page as 01-planning (its
`domain.js` and `entry.js` re-use 01-planning's, and its `style.css` is
a copy, which a test keeps the same), told with the scenarios planned
from scratch on four nodes without and then with server groups: the
tree and the rule for replicas, then one replica placed by the rule,
where a node outside it (in the primary's own group) is scored but
dimmed, marked "same group", and left out of the pick, however low it
scores.
