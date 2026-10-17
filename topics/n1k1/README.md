# The n1k1 topic

n1k1 is a SQL++ engine for local files: point it at a directory of
JSON (or CSV, Parquet, ...) files, and query them, with no server. It
reuses cbq's (Couchbase's query service's) parser and planner, and
runs the plan in its own engine, which keeps values as raw JSON bytes.

- `01-query/`: the life of one query, `SELECT id, customer, total FROM
  orders WHERE total > 200 ORDER BY total DESC`, on n1k1's own
  `examples/shop` data: the files as keyspaces, cbq's plan and n1k1's
  rewiring of it, rows pushed up through the operators, and where the
  bytes are copied. (Draft.)
- `02-compile/`: how n1k1 compiles a plan into Go with a compiler
  generated from its interpreter's own source: the filter's lines,
  early-bound (`// !lz`) and late-bound (`lz…`); intermed_build turning
  the late-bound ones into Emit calls; and the Go the compiler prints
  for 01-query's filter and project, fused. (Draft.)
- `03-boxed/`: 01-query's filter on one row, run two ways: cbq's boxed
  lane (Convert, Evaluate, WriteJSON) beside n1k1's byte lane, stage by
  stage, each allocation landing on the Go heap as a block as wide as
  its bytes; then the 20 rows' tallies; then what boxing does to the
  totals (210.00 comes back as 210). (Draft.)
- `lib/`: the example data, plan, stats and rows, from the real n1k1
  binary (`lib/tools/query-golden`, `npm run golden -- n1k1`, which
  builds n1k1 from the checkout in `sources.yaml` with `-tags n1ql`),
  and `query.js`, the query worked through in JS on the same files,
  which the tests check against n1k1's rows and stats. And for
  02-compile, n1k1's compiler run for real (`lib/tools/compile-golden`):
  the interpreter's source, intermed_build's version of it (run afresh),
  the Go the compiler emits, and the rows from both engines, in
  `compile.json`; `compile.js` pairs and tags its lines for the page.
  And for 03-boxed, both expression lanes measured for real
  (`lib/tools/boxed-golden`): each row's answers, allocations (Go's
  `testing.AllocsPerRun`) and, for the boxed lane, each allocation by
  where it happened (Go's heap profiler, at a rate of 1), in
  `boxed.json`; `boxed.js` reads it for the page.

## Color and icon rules

| Mark | Means |
|---|---|
| teal | bytes in the record buffer, the scan's recycled buffer for the doc it read last: a value that's a slice of it (a chip, with a dashed line to its bytes), and those bytes, marked |
| amber | bytes copied somewhere else: a quoted id or string, a row on the sort's heap, decoded values pointing into the heap's copy |
| violet | cbq's planner: its plan's operators, before n1k1 converts them |
| red | only a row the filter drops (✕) |
| a box, stacked | an operator; the data goes up, from the scan at the bottom |
| a grey chip in a box | a register: one of an operator's labels |
| black pill | `yieldErr(nil)`, the end of input, going up |
| numbered amber circle | the summary's copies, in order |

In 02-compile, a source line's tint is its kind: blue, early-bound
(run once, at setup); teal, late-bound (per row); grey, the
interpreter's only; violet, a seam (and, in the emitted Go, the hole it
leaves). In the compiling chapters, each operator has a color and a
glyph: the project amber ◇, the filter green ▽, the scan slate ≡,
and the filter's expression violet ƒ (the seam's color: its code fills
the seam's hole). A plan box has its operator's stripe down its left
side, and fills with a tint of its color while the compiler's at it; an
emitted line's stripe is the operator that printed it, and each block
of lines starts with its glyph. In the summary, blue marks what's baked in, amber the
calls left per row.

The red ball is the pen: the line intermed_build
is turning, or the compiler is printing. Changes play one line at a
time: a line's replacement appears way over on the right, beside it
(or, if the two don't fit, on the blank line above), and the two wait
there side by side, to compare; then the old line slides out left as it
fades, and the new one moves into its place; when code goes into a hole, the hole goes first, then
the code below moves down to make room, then the new lines are printed,
one by one.

In 03-boxed, amber is the Go heap: a boxed value, and the block it
leaves there (as wide as its bytes); teal is the record buffer's bytes,
and a slice of them; grey is a value with no heap cost (on the stack, a
constant made at setup, or a reused buffer).

## Motion rules

The scroll is the timeline: each step's state is one of `01-query`'s
states (`states.js`), and between neighbors one field changes. The rows'
journey is one event per state (a file read, tested, projected, pushed
onto the heap), so a step that sweeps many files plays each file's
events in turn. A row's values move up as an operator passes them on;
values the project makes fade in where they land; a dropped row fades
before the next file's arrives.
