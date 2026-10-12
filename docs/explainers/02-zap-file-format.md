# Explainer 2 (draft outline): inside a zap segment

Status: outline for review, before any engine work. Facts here come
from `docs/research/zap-format.md` (zapx v17 and friends, at the
versions cbft pins); see it for file:line references.

**Working title:** "Inside a zap segment: how scorch stores and finds
your docs"

**Audience:** the same as the first explainer (Couchbase engineers and
support). It picks up where that one leaves off: a *file segment* in a
root snapshot is one immutable, mmapped zap file. This one opens that
file.

**The one question it answers:** when a query asks for `quick`, what
bytes does scorch read, in what order, and why is it fast?

## The running example

One small, real segment, used throughout: about 8 docs, with fields
`_id`, `title`, `body` and `date`, built by **the real zapx code**.
`tools/zap-golden/` (a Go program, like `tools/mergeplan-golden/`)
would build the segment with zapx v17 and dump JSON describing it:

- the region offsets and sizes, the footer's fields, the sections
  index and each field's record;
- each field's FST, as states and transitions with their outputs;
- each term's postings: the offsets, the roaring containers, the
  freq/norm and location chunks;
- the stored-fields index and records, and the doc-value chunks.

The page draws from that JSON, so the byte offsets, FST outputs and
bitmaps it shows are the real ones, and tests can check the narrative
against them, as `expect` does against the simulation in the first
explainer. A second, merged segment would come from the same tool,
for the last chapter.

The terms are chosen so the interesting cases show up: `quick`,
`quiet` and `quilt` share a prefix; `run`, `ran` and `rung` share
a suffix; one term appears in a single doc, to show the 1-hit encoding
(which only merges produce, so the merged segment has it); and one doc
is deleted, in the root snapshot.

## Chapters (one change per step, as before)

1. **One file.** Start from the first explainer's picture: a root
   snapshot listing file segments. Zoom into one bar; it becomes a
   long horizontal strip, the zap file, mmapped: all of it addressable
   at once, but nothing read yet.
2. **Front to back.** The strip's regions appear one at a time, each
   labeled with its size: stored-field records, the stored-fields
   index, the nested-doc edges (empty here), the section bodies
   (inverted text, plus empty vector, synonym and geo sections), the
   sections index, and the footer. (Section bodies have no fixed
   order in a real file; the page says so.)
3. **Opening it.** The reader goes straight to the **end**: the
   footer's fields peel off, right to left (CRC, version 17, chunk
   mode, the two offsets, numDocs, the ID length, the writer ID). The
   `sectionsIndexOffset` arrow jumps back to the sections index, which
   fans out to each field's record. A note: the CRC is read but not
   checked on open.
4. **A term's address.** Picking `body`: its record holds three
   varints, the doc-values start and end and the dictionary offset.
   Following that offset lands on the field's **vellum FST**.
5. **What an FST is.** Built up one change at a time from the field's
   terms: a trie first, then shared prefixes merge, then shared
   suffixes merge, which is why it's compact. Each transition carries
   an output.
6. **Looking up `quick`.** The marker walks the FST byte by byte, and
   the outputs along the way add up to the term's value. The value's
   top bits say what it is: an offset to the postings (here), or, for
   a 1-hit term, the doc number and field length packed right in.
7. **The postings.** Following the offset: a small header, then the
   **roaring bitmap** of doc numbers. A zoom into roaring: a doc
   number splits into a 16-bit container key and a 16-bit value; a
   container is a sorted array or a 65,536-bit bitmap, by density.
   (Run containers exist, but zapx doesn't produce them.)
8. **Minus the deleted.** The segment's deletion bitmap isn't in the
   file at all: it comes from `root.bolt`, through the root snapshot
   (a callback to the first explainer). `postings ANDNOT deleted`, and
   a deleted doc fades out of the results.
9. **Scoring.** The freq/norm stream, in chunks of doc numbers: going
   to a doc reads only its chunk. Decode `freq<<1 | hasLocations`, and
   the "norm", which is really the field length; `1/sqrt(fieldLen)`
   is computed only at query time. Locations, in their own chunks, are
   read only when needed (phrases, highlighting).
10. **Two terms.** `quick AND fox`: two bitmaps, each minus the deleted
    one, ANDed, per segment. With `score: none` the searchers are
    skipped and the bitmap itself is iterated.
11. **Getting a hit back.** `storedIndex[docNum]` points to its record:
    the `_id` up front, uncompressed (so looking up an ID decompresses
    nothing), then a snappy-compressed blob of the other stored fields,
    decompressed only when they're asked for.
12. **Sorting by `date`.** Doc values: the field's indexed terms per
    doc, in chunks of 1,024 docs, snappy-compressed. Sorting reads the
    chunk for each hit, binary-searches its header, and splits on
    `0xff`.
13. **Fuzzy `quikc~1`.** A Levenshtein automaton walks the FST in
    step with it. Whole branches are skipped when they can no longer
    match, and the terms that survive light up.
14. **Merging, revisited.** Two segments' FSTs zip together into one
    sorted stream of terms; deleted docs drop out; doc numbers are
    renumbered 0..n-1; a new file, with a new footer. (A callback to
    the merger in the first explainer.)

Out of scope for now: vector (faiss), synonym and geo sections beyond
"they're there", nested docs, and the writer-ID/encryption callbacks.
Each could be its own later explainer or a sandbox chapter.

## The diagram

A different kind of picture from the first explainer's. There it was
goroutines and channels over time; here it's one file and the
structures inside it. The idea:

- **The strip**, across the top: the file's bytes, left to right,
  regions sized on a log scale (so the footer is visible) with their
  real offsets. It stays on screen as the map of "where in the file
  we are".
- **Lenses** below it, each opened from a region of the strip, like
  the first explainer's detail bubbles: the sections index and field
  records, the FST graph, the postings (header plus roaring
  containers), the freq/norm chunks, a stored record, a doc-value
  chunk. A lens connects to its byte range in the strip, so every
  structure is anchored to where it lives in the file.
- **The marker** is the query (or the reader's position): it moves
  along the strip and into the lenses, through the same
  nothing-teleports routing. Each read lights up the byte range it
  touches, so by the end the strip shows how little of the file a
  query reads.
- The callouts, contents, code drawer and deep links work as before.

## What the engine needs for this

What can be reused as-is: scroll as the timeline, the camera,
lids/bubbles (as lenses), callouts, the marker's routing, the code
drawer and snippets, the schema's one-change rule, drafts, the build.

What must become pluggable (the "second step" from the first
explainer's refactor):

- **No simulation.** A step's state is a declared scene (which
  region, lens, term, doc, chunk), not a model run. The engine should
  treat the simulation as optional: an explainer provides either
  `makeModel` plus `sim` directives, or a function that turns the
  steps' directives into scene state.
- **The diagram as a component.** Each explainer provides its own
  drawing (`Diagram` with `update`, `blend`, `anchor`, `tokenTarget`,
  `setToken`), and the engine only orchestrates it.
- **Told phases in general.** The FST build and walk, and the roaring
  split, are "told over steps" like the first explainer's root swap,
  so `VIEW_KEYS` runs (and their per-frame drawing hooks) need to be
  something an explainer provides, not code in `main.js`.
- **Per-explainer build.** Each narrative names its explainer; the
  build bundles the engine with that one.

## Decisions to make

1. Generate the example segment with real zapx (a Go tool and a
   committed golden JSON), as proposed? It keeps the page truthful
   and testable, at the cost of a Go step when versions change (like
   the merge-plan goldens).
2. The running example's docs: a handful of short sentences about
   foxes and runners, or something Couchbase-flavored, like
   travel-sample hotel docs?
3. Scope: stop after "Getting a hit back" (chapter 11) for a first
   version, and add sorting, fuzzy and merging after review?
4. One page per explainer (as now), with the first explainer linking
   to the second at its end?
