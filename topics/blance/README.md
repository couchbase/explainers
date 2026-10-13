# blance: planning and moving partitions

Explainers of [blance](https://github.com/couchbase/blance), the
partition-assignment library under
[cbgt](https://github.com/couchbase/cbgt) and so under Couchbase's
full-text search: how it decides which node holds each index
partition's primary and replicas, and how a rebalance then moves them
there. (See the [repo's README](../../README.md) for the engine,
building and publishing, and [../cbft](../cbft/README.md) for the
search side.)

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
same maps, warnings and moves for each. After changing the port or
moving to a newer blance, `npm run golden -- blance` and `npm test`.

## 01-planning

"Inside blance: how a plan places partitions". Its diagram is the
partition map as a board (a row per partition, a column per node, a P
or R chip per primary and replica, and each node's tallies), beside a
panel: the scores for the decision at hand, the moves a plan takes,
the server groups' tree, or a stickiness table.

`scenarios.js` runs its scenarios through the port, with traces: a new
index on nodes a, b and c; node d joining; node b leaving; all four
without and then with server groups. Each scenario is cut into frames,
the map after each of the planner's decisions, and a step's `at`
names one (`fresh.12`: after the 12th decision of the first). A step
whose `at` is several decisions on plays them one after another over
its scroll. `story.js` has the view keys (`at`, `panel`), and the
facts that `expect: ["fact:..."]` checks the text's numbers against:
every candidate's score at every decision (`add.1.a`), each frame's
tallies (`add.16.counts`), each scenario's moves.

## Planned

- **02-moving**: from a plan to a rebalance: each partition's moves
  (`CalcPartitionMoves`), then `OrchestrateMoves`: a mover per node,
  the controller that picks each node's next move (promote first),
  concurrency per node, pause and stop. A small simulation over time,
  in the code's own airport analogy.
