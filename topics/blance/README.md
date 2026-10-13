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
or R chip per primary and replica, and each node's tallies); under it,
the score strip: for the decision at hand (the outlined row), each
node's score as a bar in its own column, its terms stacked, lowest
wins; and beside it, a panel: the moves a plan takes, the server
groups' tree, or a stickiness table.

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

## 02-moving

"Inside blance: how a rebalance moves partitions". The same board, at
a moment of a rebalance (copies being built fill in place, deletes
fade, a partition with no primary is marked), each node's mover under
its column, and a panel: each partition's moves, or the movers'
timeline, a lane per node, with the controller's rounds.

`scenarios.js` runs node d joining (01-planning's second plan) through
`lib/orchestrate.js` three ways: one move at a time per node, up to
four, and deletes first (`FavorMinNodes`), with partitions of
different sizes, timed as `lib/tools/orchestrate-golden`'s story cases
are, so the real orchestrator's runs of them are checked to match. A
step's `at` names a run and a moment in it (`one@270`); the scroll
moves time from one step's moment to the next's.
