# bleve-explainer

Scrollytelling explainers of how [bleve](https://github.com/blevesearch/bleve)
works under the hood, as used by Couchbase's
[cbft](https://github.com/couchbase/cbft) (Full Text Search). The style
is inspired by
[r2d3.us](https://r2d3.us/visual-intro-to-machine-learning-part-1/).

The first explainer, **"Inside bleve / scorch: introducer, persister,
merger"**, follows one batch of DCP mutations from KV through cbft's
DCP goroutine, batch workers and app herder, into bleve's analysis
queue and scorch, then through scorch's introducer, persister and
merger goroutines, down to the zap files and `root.bolt` on disk.
Along the way it shows root snapshots, epochs, refcounts, the
in-memory merge, the tiered merge policy and epoch watchers.

The published page ends after the merger chapter. Later chapters
(ingest resuming, a slow disk, a huge ingest, a slow query, and a
sandbox with knobs) are drafts, still under review; see
[Drafts](#drafts).

## Quick start

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm ci               # install the pinned dependencies
npm run build        # -> dist/scorch-goroutines.html (and dist/index.html)
open dist/index.html # or xdg-open, or just open the file in a browser
```

The output is **one self-contained HTML file**, with no server and no
external scripts, so you can email it or post it in Slack. Its only
external reference is to Google Fonts, and it falls back to system
fonts when offline.

`npm run dev` rebuilds on every change under `src/` and `content/`;
reload the page to see the changes.

**Reading it.** Scrolling drives the story. You can also navigate the
diagram like a map:
- drag to pan;
- ⌘, Ctrl or ⌥ + scroll, or pinch, to zoom at the cursor;
- double-click to zoom in, ⌥/Shift + double-click to zoom out;
- two fingers to pinch and pan on touchscreens;
- ⟲ to return to the story's view (the next step also eases back to it).

Each step has a deep link (`#chapter--step`), and the ☰ Contents
button in the top-left corner jumps between chapters. The Code drawer
shows the Go source each step is about, with links to GitHub at the
pinned commits.

## Tests

```sh
npm test             # unit tests (fast; no browser needed)
npm run build
npm run test:e2e     # browser tests, in headless Chrome
```

`npm test` covers:
- the discrete-event kernel;
- the merge planner, against golden plans from the real Go code;
- simulator invariants and scenarios;
- the narratives: schema, cross-step rules, and each step's
  `expect`ations against the simulated state;
- that `content/snippets.json` matches the pinned Go sources (skipped
  when they aren't available locally, as in CI);
- the build output.

`npm run test:e2e` drives the built page with
[`playwright-core`](https://playwright.dev/) and your installed Google
Chrome. It checks every step, the drawers, deep links, phone-width
layout, light and dark themes, and that there are no page errors. Set
`CHROME_PATH` to use another Chromium. It tests the drafts page when
there is one, so the draft chapters are covered too.

Append `?debug=1` to the page URL to check simulator invariants on
every frame (violations are logged to the console).

CI (`.github/workflows/ci.yml`) runs the build and both test suites
on every push and pull request.

## Publishing

`dist/` is committed: it's the page as reviewed. The first panel of
the page carries a version stamp, `git describe --long` of the sources
it was built from, plus `-dirty` if they had uncommitted changes
(changes under `dist/` don't count). To publish a new version:

```sh
git commit ...        # commit your changes first, for a clean stamp
npm run build
git add dist && git commit -m "Rebuild dist"
git push
```

Tag a release (`git tag v0.2.0`) before building to get a friendlier
stamp.

**GitHub Pages.** `.github/workflows/pages.yml` publishes the committed
`dist/*.html` (but not the drafts page) whenever `dist/` changes on
`main` or `master`, or when run by hand from the Actions tab. To turn
it on, once, in the GitHub repo: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. The page is then at
`https://<owner>.github.io/<repo>/`.

## How it works

The visuals are driven by a **live simulation**, not by canned
animations. The diagram (`src/js/ui/diagram.js`, geometry in
`layout.js`) is one large SVG canvas that the story's camera zooms
around. Sections start covered by lids and open as the story reaches
them.

- `src/js/sim/des.js` is a small deterministic discrete-event kernel.
  Goroutines are JS generator functions that `yield` Go-like ops:
  channel send/recv, `select` (with Go's random choice among ready
  cases), timers, condition variables and semaphores. Every run is
  seeded and reproducible.
- `src/js/sim/model.js` models one cbft pindex:
  - KV's DCP producer, with flow control;
  - the DCP goroutine;
  - cbft's 4 batch workers, with capacity-1 channels;
  - the app herder;
  - `Scorch.Batch()` and bleve's analysis queue;
  - the introducer, persister (nap, in-memory merge workers, slow-merger
    pause, `root.bolt` commits, `removeOldData`) and merger;
  - epoch watchers between them;
  - queries that pin snapshots.

  Comments name the Go functions being mirrored. Control flow, channel
  capacities, refcounting and default settings follow the real code.
  Costs (CPU per doc, disk bandwidth, fsync latency) are modeled
  assumptions; see `src/js/sim/config.js`.
- `src/js/sim/mergeplan.js` is a port of bleve's `mergeplan.Plan`,
  tested against golden plans generated by the real Go code
  (`tools/mergeplan-golden`).

A few things are simplified for the story, and the narrative says so
where it matters: it follows one batch, and pauses KV mutations so
that batch travels alone; some steps that are instant in the real code
(cutting flushables, opening a new zap file, planning) get a step of
their own; and long animations, like a root swap, are told one phase
per step.

Research notes with file:line references live in `docs/research/`.

## Design principles

These came out of reviewing early drafts, and they guide both the
narratives and the code:

- **The reader's scroll is the timeline.** Anything that changes
  between steps is driven by scroll position, not by a clock, so
  scrolling halfway leaves a change halfway done, and scrolling back
  reverses it. The only exception is when the reader presses Play and
  the simulation runs on its own clock.
- **Change one thing at a time.** Each step changes one of camera,
  lids, bubbles, UI or simulation (the build enforces this). Within a
  step, changes are spread out in order across the step's scroll, so
  the reader's eye has one thing to follow.
- **Nothing teleports.** Markers travel along the drawn arrows and the
  corridors between boxes; destinations wait for them to arrive.
- **Keep the subject in view.** The camera follows the marker, and the
  charts and controls stay out of the way until they're needed.

## Writing narratives

Narratives are YAML files in `content/narratives/`. Each one builds to
its own HTML file. Chapters have a `color` (`kv`, `cbft`, `scorch`,
`disk` or `neutral`), which ties the story's headings to the diagram
section they're about. A step looks like this:

```yaml
- id: persisting                    # slug, unique within the chapter
  sim: { until: persisting }        # simulation directives (see below)
  view: { target: ourBatch }        # what the callout points at, etc.
  expect: ["reached:persisting"]    # checked by `npm test`
  code: [persister.maybeMerge]      # ids from content/coderefs.yaml
  text: |
    Markdown. [[A persister worker]] is merging our flushable into one
    new zap file.
```

**The callout.** `[[phrase]]` marks the one phrase per step that the
callout line starts from. `view.target` names what it points at: a
fixed anchor (`dcp`, `workers`, `gate`, `introducer`, `root`,
`persister`, `bolt`, ... see `ANCHORS` in `src/js/ui/layout.js`) or a
live one that follows the simulation (`ourBatch`, `ourSeg`, `ourFile`,
`deletedFile`, `mergedSeg`).

**View directives** say only what changes; the state carries over from
step to step:

| key | meaning |
|---|---|
| `camera` | a named region (`overview`, `top`, `cbft`, `scorchTop`, `introducer`, `root`, `swap`, `persister`, `merger`, `lower`, `disk`, ... see `CAMERAS`) or `[x0, y0, x1, y1]` |
| `open` / `close` | lids to open or close: `kv`, `cbft`, `bleve` (inside cbft), `scorch` (inside bleve), `disk`, and inside scorch `introducer`, `persister`, `merger` |
| `bubble` / `unbubble` | pop a detail bubble out of a panel: `analysis`, `persister`, `merger` |
| `plan` | what the merger bubble's tier staircase shows: an example index's `budget`, `files`, `over`, `pick`, `merged`; or `live`, the simulation's own files (the default) |
| `token` | the marker: `auto` (follows our batch), `file` (on our zap file on disk), or `hide` |
| `swap` | tell a root swap one phase per step: `cover`, `peel`, `copy`, `add`, `drop`, `epoch`, `solid`, `settle` (see `SWAP_PHASES` in `src/js/ui/snapstack.js`). The run's first step has the `sim.until` that swaps the root. Swaps that aren't told this way play every phase within one step's scroll |
| `commit` | tell the persister's commit one phase per step: `bolt` (a new `root.bolt` record), `listed` (our zap file turns solid), `release` (the persister lets go of its root), `wake` (the new epoch wakes the merger). A phase may repeat over several steps to hold it |
| `flow` | an animation over the step's whole scroll: `analysis` (our batch's docs go to the analysis queue and back), `write` / `mergeWrite` (our zap file goes down the persister's / merger's write arrow to disk), `watcher` (the persister's epoch watcher goes up to the introducer) |
| `chart` | emphasize one chart: `dcpBuf`, `memUsed`, `segments`, `files` |

**Simulation directives:**

| key | meaning |
|---|---|
| `reset: true` or `reset: { seed, config }` | start a fresh simulation |
| `minTimeMs` | fast-forward to this sim time (since the last reset) |
| `set: { ... }` | change config (keys from `src/js/sim/config.js`) |
| `query: { durationMs, timeoutMs, label }` | start a query that pins a snapshot |
| `follow: true` or `follow: alone` | tag the next batch, to follow it through the system; `alone` first lets batches in flight drain, has KV send just that batch's snapshot, then pauses KV |
| `until: <stage>` | run event by event until the followed batch reaches a stage (see `TRACE_STAGES` in `src/js/story/timeline.js`): `dcp`, `channel`, `worker`, `herder`, `analysis`, `built`, `introducing`, `introduced`, `flushables`, `persisting`, `written`, `fileIntroducing`, `file`, `committed`, `caughtUp`, `persisterWaits`, `persisterNudged`, `watcherClosed`, `planning`, `merging`, `mergeWritten`, `mergeIntroducing`, `merged`, `oldFileDeleted` |
| `speed` | playback speed (sim ms per wall ms; `0` means paused) |

To build the state for step N, the explainer starts from the most
recent `reset` at or before N. For each step from there through N, it
fast-forwards to that step's `minTimeMs`, then applies its directives.
So a step looks the same however the reader got there, including by
scrolling back up or following a deep link. See
`src/js/story/timeline.js`.

**One change per step.** The build rejects a step that changes more
than one of camera, lids, bubbles, UI and simulation. If you really
need to, add `multi: true` to the step. To move from one section to
another, use three steps: zoom out, open the next lid, then zoom in.

The build also checks that:
- every camera, lid, anchor and chart name exists;
- a callout's target isn't hidden under a closed lid;
- nested lids only open inside open parents;
- a told swap's phases come in order.

`expect` names predicates from `EXPECTATIONS` in `timeline.js`, plus
`reached:<stage>` and `rootEpoch:<n>`. The tests check them, so the
prose and the simulation can't silently drift apart.

### Drafts

A `- stop: <note>` entry in the chapter list ends the published page
there, so unreviewed chapters can stay in the YAML after it. They're
still validated and simulated by `npm test`, and the build also writes
`dist/<id>-drafts.html` with every chapter, for reviewing them.

### Code references

Code links are defined in `content/coderefs.yaml` by **anchor text**,
not line numbers. Each one names the source repo, a file, and a unique
line to start from:

```yaml
persister.pause:
  repo: bleve
  path: index/scorch/persister.go
  anchor: "func (s *Scorch) pausePersisterForMergerCatchUp(lastPersistedEpoch uint64,"
  extent: func            # or `block`, or a line count
  highlight: ["time.After(", "TotPersisterSlowMergerPause"]
```

`content/sources.yaml` pins each repo to the commit cbft uses, and
lists where to find a local copy: the Go module cache, and a sibling
`../couchbase-server.master` repo-sync tree (override that with
`BLEVE_EXPLAINER_CB_SRC`).

`npm run snippets` resolves the anchors and writes
`content/snippets.json`: highlighted lines plus GitHub permalinks at
the pinned commits. That file is committed, so building doesn't need
the sources; only refreshing the snippets does.

To move to newer versions, bump the commits/versions in
`sources.yaml`, run `npm run snippets`, and fix any anchors it
reports. Then run `npm run golden:mergeplan` (it needs a Go toolchain
new enough for bleve's `go.mod`), and `npm test`.

## Layout

```
content/                 narratives (YAML), code refs, pinned sources, snippets.json
docs/research/           how scorch and cbft work, with file:line refs
dist/                    the built pages (committed; published by GitHub Pages)

src/js/sim/              the simulator (no DOM; runs in Node and the browser)
  des.js                 discrete-event kernel: generator "goroutines", channels, select
  model.js               a cbft pindex: state, memory/disk accounting, wiring
  procs/*.js             its goroutines, by group: cbft (DCP, batch workers, herder),
                         batch (Scorch.Batch), introducer, persister, merger, and
                         merging (shared by the persister and merger)
  segments.js            Segment and Snapshot, with refcounting
  mergeplan.js           port of bleve's mergeplan (tested against Go)
  config.js, fmt.js, invariants.js
src/js/story/timeline.js narrative semantics: sim directives, views, expectations
src/js/ui/               the page
  main.js                wires it together: per-step state, the frame loop, controls
  page.js                story, toolbar and charts DOM
  layout.js              diagram geometry: frames, lids, cameras, anchors, stations
  diagram.js             the diagram canvas (with gnode.js and slots.js)
  transitions.js         what's shown partway between steps (marker routes, boxes)
  snapstack.js           the stack of live root snapshots; swap and commit phases
  stairs-scene.js        the merger bubble's tier staircase, as data (staircase.js draws it)
  camera.js, gestures.js the camera, the reader's pan/zoom, map-style gestures
  scroll.js              scroll position -> (step, progress)
  overlay.js, charts.js  callout and leader lines; the charts column
  code.js, knobs.js      the drawers
  util/                  DOM and interpolation helpers
build/                   build.mjs, snippets.mjs, schema.mjs
test/, test-e2e/         unit tests; browser tests
tools/mergeplan-golden/  Go program emitting golden merge plans
.github/workflows/       CI, and GitHub Pages publishing
```

## License

Apache License 2.0; see [LICENSE](LICENSE).
