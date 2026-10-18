# explainers

A project to build standalone, self-contained "explainer" HTML pages,
such as for how software algorithms and systems work.

This repo has a generic engine (`engine/`) and domain specific content
grouped by topic in (`topics/`).

## Quick start

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm ci               # install the pinned dependencies
npm run build        # -> dist/<topic>/<name>.html, and index pages
open dist/index.html # open it in a browser
```

Each page is a **self-contained HTML file**, with no server and no
external scripts, so it can be easily emailed or slacked around.

`npm run dev` rebuilds on every change under `engine/` and `topics/`.

Scrolling drives the story. The style is inspired by
[r2d3.us](https://r2d3.us/visual-intro-to-machine-learning-part-1/).

You can also navigate the diagram like a google map:
- drag to pan;
- ⌘, Ctrl or ⌥ + scroll, or pinch, to zoom at the cursor;
- double-click to zoom in, ⌥/Shift + double-click to zoom out;
- two fingers to pinch and pan on touchscreens / touchpads;

The Code drawer shows related source code, if any, for each step
with links to GitHub at pinned commits.

## Tests

```sh
npm test             # unit tests (fast; no browser needed)
npm run build
npm run test:e2e     # browser tests, in headless Chrome / playwright
npm run check        # all three, in order; stops at the first failure
```

Run `npm run check` before each commit. Each e2e test times out after 3
minutes. If e2e runs slowly, look for stray browser or helper
processes left from earlier runs, and stop them.

The engine's tests are in `engine/test/`; each explainer's are in its
own `test/` and `test-e2e/`. `engine/test/narratives.test.mjs` checks
every explainer's narrative: its schema, its code refs, and each
step's `expect`.

Where an explainer models real code in JS (e.g., a planner, a merge policy,
etc.), and checks the JS model against the real thing via a **golden
tool**, `tools/<name>-golden/` that runs the real code (e.g., in Go)
and compares the explainer's data. `npm run golden` to rerun (`npm run golden -- blance`
just those whose path matches); see each tool's `golden.yaml`.
The go on your PATH must be new enough for the code it runs.

Append `?debug=1` to a page's URL for each explainer's debug checks.

**Reviewing by eye.** `npm run shoot` takes screenshots of a built page:

```sh
npm run shoot -- blance/01-planning join--wrap               # settled, as a deep link lands
npm run shoot -- blance/01-planning join--detour@0.3,0.6     # partway through its transition
npm run shoot -- blance/01-planning --strip 8 join--wrap     # 8 moments of the step, on one sheet
npm run shoot -- blance/01-planning --dark --phone --end     # dark, phone-sized, the page's end
```

Files go to `tmp/shots/`. A strip is the quickest way to check a long
step: it shows everything the step plays, in order.

**Showcase pictures.** A narrative can list a few scenes that show
off the explainer at a glance; the index pages show their pictures,
each linking to its step:

```yaml
showcase:
  - step: fst--outputs            # a step's chapter--step id
    rect: [438, 809, 904, 474]    # optional: [x, y, width, height], in the diagram's units
    caption: "A field's terms, as a vellum FST"   # optional
```

`npm run showcase [-- <filter>]` shoots them from the built pages
(light and dark, with the story column and toolbar hidden; without a
`rect`, the diagram's view) into the explainer's `showcase/`, to
commit. Rerun it when a showcased scene changes; the build warns about
a scene with no pictures yet.

**Stale pages.** Each page shows its build stamp in its header. If a
page doesn't show a change, compare its stamp with `git log`: GitHub
Pages shows only what was pushed, and an old `npm run dev` may still
be running.

CI is via `.github/workflows/ci.yml`.

## Publishing

Each built page carries a version stamp from `git describe --long`,
plus `-dirty` if they had uncommitted
changes (changes under `dist/` don't count).

To publish a new version:

```sh
git commit ...        # commit your changes first, for a clean stamp
npm run build
git add dist && git commit -m "Build dist"
git push
```

Tag a release (`git tag v0.2.0`) before building to get a friendlier git describe.

**GitHub Pages.** `.github/workflows/pages.yml` publishes the committed
`dist/` (but not draft pages) whenever `dist/` changes on `main`
or `master`, or when run by hand from the github's Actions tab. To enable,
in the GitHub repo: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. The pages are then at
`https://<owner>.github.io/<repo>/`, e.g.
`https://<owner>.github.io/<repo>/cbft/01-indexing.html`.

## Engine and explainers

A content specific explainer lives in a directory like `topics/<topic>/<name>/`, and
builds to `dist/<topic>/<name>.html`:

| file | what it is |
|---|---|
| `narrative.yaml` | the story: chapters of steps, each with its text and what it changes |
| `coderefs.yaml`, `snippets.json` | the source code it shows, and those snippets resolved (`npm run snippets`) |
| `domain.js` | everything the engine reads from it (below) |
| `entry.js`, `use.js` | the page's entry point, which picks the explainer before anything else runs |
| `main.js` | its page: the engine's story runner (`runStory()`, in `engine/js/ui/story.js`) with its diagram, and what moves in it per step and per scroll position |
| `style.css` | its styles, appended to the engine's |
| `test/`, `test-e2e/` | its tests |

Anything else it needs (its diagram, a simulator, example data, tools
that generate it) goes beside the above. A topic's directory might
share: `topic.yaml` (its `title`; a short `label`, shown
atop each explainer page as a link up to the topic level index; and a
`subtitle` for that index page; optionally, `fonts`, as Google
Fonts families), `style.css` (palette, section colors, and
the engine's `--font-*`, which come after the engine's styles,
and before each explainer's), `sources.yaml` (the pinned source repos,
if any), and any shared notes or code. With no fonts or
`style.css`, a topic uses the engine's default style. An explainer's
`style.css` can start with `@import "../<other>/style.css";` to use
another explainer's styles; the build inlines it. The build gives each
topic an index page, `dist/<topic>/index.html`, listing its explainers
with their subtitles. Those nav links work only when served
or opened from folder with topic's directory (as in `dist/`), but not from a HTML
that was emailed or slacked around.

The engine's entry point to a specific explainer is via
`engine/js/domain.js`: the explainer's entry point calls `useDomain()`.

The domain may provide to the engine:

- **geometry:** `CANVAS`, `CAMERAS`, `LIDS`, `BUBBLES`, `ANCHORS`,
  `DYNAMIC_ANCHORS` (anchors whose place the page works out) and
  `SECTION_COLORS`;
- **its own view directives:** `VIEW_KEYS`: their values, whether they
  carry over, how they count as a step's change, and whether they're
  told over steps;
- **expectations:** `EXPECTATIONS` and `EXPECTATION_PARAMS`
  (`<name>:<arg>`);
- **a simulation, if any:** `makeModel`, `makeConfig` and
  `applyConfig`, and `SIM`: the step directives besides `reset`, how
  they're checked, and how they drive the model; and optionally
  `checkInvariants`, which the tests run at every step.

`useDomain()` has defaults for what a specific explainer leaves out.
With no `makeModel`, a narrative has no `sim` directives, and the page
builds no simulation controls (`buildPage(..., { simulation: true })`
asks for them).

The engine provides driving the narrative schema
(`engine/build/schema.mjs`), the step/view folding and change counting
(`engine/js/story/timeline.js`), and the page's parts (`engine/js/ui/`):
story column, camera and gestures, scroll position, callout lines,
contents, code drawer -- the reusable generic stuff.

## Design principles

These guide both the narratives and the code:

- **The reader's scroll is the timeline.** Anything that changes
  between steps is driven by scroll position, not by a clock, so
  scrolling halfway leaves a change halfway done, and scrolling back
  reverses it. The only exception is when the reader presses Play and
  the simulation runs on its own clock.
- **Change one thing at a time.** Each step changes one of camera,
  lids, bubbles, UI or simulation (the build enforces this). Within a
  step, changes are spread out in order across the step's scroll, so
  the reader's eye has just one thing to follow for easier understanding.
- **Give each change room.** A step's changes play over its
  transition, a fixed stretch of scrolling. A step with more to play
  (many things, one at a time) gets the class `step-scrub`: its
  transition then runs over its whole length, and the explainer makes
  it as tall as what it plays needs (blance's 01-planning gives each
  arrow its own share). Its transition progress `p` reaches 1 at 90%
  of the step. The last 10% is for what follows the sweep, such as a
  focus box moving; the render hook gets `u`, the position in the
  whole step, for that. A deep link lands at 94.5% of the step, so it
  shows the step finished.
- **Nothing teleports.** Markers travel along the drawn arrows and the
  corridor lanes between boxes; destinations wait for them to arrive.
- **Keep the subject in view.** The camera follows the marker, and the
  charts and controls stay out of the way until they're needed.

## Directing rules

Lessons from reviewing blance's 01-planning, step by step. Check each
new explainer against them.

- **Text and diagram move together.** What plays while a step scrolls
  is what its text talks about. If a step would play more than its
  text covers, add a step, or make the text cover it ("the rest go
  the same way").
- **Explain a surprising order first.** If the algorithm skips ahead
  or wraps around, say so before the diagram does it.
- **Summarize on a clean frame.** A step that sums up lands on a
  state with nothing left over from the last action: no outline, no
  arrows, no score bars.
- **Content first, then reading aids.** In a long step, the main
  change plays first; the focus box moves after it. When something
  leaves, it fades out first; then the rest slides over.
- **End calmly.** In the summary, the diagram stops changing. Remove
  what has left, hide labels that no longer apply, and drop the focus
  box. The end card stands alone, mid-screen.
- **Keep the "before" in view.** Show removed or deleted things as
  ghosts, with their labels, so the reader doesn't have to remember
  them.
- **One visual language.** Pick a meaning for each color, line weight
  and fill, and use it everywhere. In blance: color is the state being
  assigned (teal primary, amber replica); a thick solid arrow is a
  decision, a thin one an input; grey is "not a candidate"; red is for
  callouts and deletions.
- **Point at what the sentence is about.** A claim about the whole
  diagram points at the whole diagram, not one part of it.
- **Show it, don't just say it.** When the text makes a claim (say,
  "8 moves would do"), draw the evidence (the moves that weren't
  needed).

## Writing narratives

A narrative (`narrative.yaml`) names, at the top, its `title`,
`subtitle` and `audience`; the pinned `sources` it's modeled on (keys
in its topic's `sources.yaml`, listed in the page's header); and
optionally the explainer to read `next` (another in the same topic),
and the `showcase` scenes for the index pages (see Tests, above).

`draft: true` marks a whole explainer as a work in progress. Its page
and its entries in the index pages get a red DRAFT band, and no other
explainer links to it as `next`, so the one before it ends with the
thanks card. (This differs from a `stop` entry, below, which hides
unfinished chapters of a published explainer.)
Then its `chapters`, each with an `id`, a `title`, a `color` (one of
the explainer's `SECTION_COLORS`, tying the story's headings to the
diagram section they're about) and its `steps`. A step looks like
this (from cbft's 01-indexing):

```yaml
- id: persisting                    # slug, unique within the chapter
  sim: { until: persisting }        # simulation directives (if it has a simulation)
  view: { target: ourBatch }        # what the callout points at, etc.
  expect: ["reached:persisting"]    # checked by `npm test`
  code: [persister.maybeMerge]      # ids from its coderefs.yaml
  text: |
    Markdown. [[A persister worker]] is merging our flushable into one
    new zap file.
```

**The callout.** `[[phrase]]` marks the one phrase per step that the
callout line starts from. `view.target` is what it points at: one of
the explainer's `ANCHORS` or `DYNAMIC_ANCHORS`.

**View directives** say only what changes; the state carries over from
step to step. The engine's are `camera` (a named region from `CAMERAS`,
or `[x0, y0, x1, y1]`), `open`/`close` (lids), `bubble`/`unbubble`
(detail bubbles), `ui` (`minimal` or `full` chrome) and `target`. The
rest are the explainer's `VIEW_KEYS`.

**Reading aids.** A `VIEW_KEYS` entry that isn't `sticky` (or a
`run`) is a reading aid: it holds for its step only, and it isn't the
step's one change. blance uses two: `focus` (a box around a region) and
`trace` (arrows for one partition's moves). Use reading aids to guide
the eye without breaking the one-change rule.

**Simulation.** For an explainer with one, `sim: { reset: true }` (or
`reset: { seed, config }`) starts a fresh model; the explainer's `SIM`
says what else a step's `sim` may say. To build the state for step N,
the engine starts from the most recent `reset` at or before N and
applies each step's directives through N, so a step looks the same
however the reader got there, including by scrolling back up or
following a deep link.

**One change per step.** The build rejects a step that changes more
than one of camera, lids, bubbles, UI and simulation. If you really
need to, add `multi: true` to the step. To move from one section to
another, use three steps: zoom out, open the next lid, then zoom in.

The build also checks that:
- no wrapped line of a step's text starts like a list item (`1. `,
  `- `) mid-paragraph, which Markdown would turn into a list;
- every camera, lid, anchor and chart name exists;
- a callout's target isn't hidden under a closed lid;
- nested lids only open inside open parents;
- a told swap's phases come in order.

`expect` names predicates from the explainer's `EXPECTATIONS` and its
parameterized `EXPECTATION_PARAMS` (`<name>:<arg>`). The tests check
them, so the prose and the model (or the real data) can't silently
drift apart. Give every number in the text an `expect`.

An explainer can add its own checks that text and diagram match. For
example, blance's `01-planning/test/lockstep.test.mjs` fails when a
step plays several decisions but its text doesn't name each partition.

### Drafts

A `- stop: <note>` entry in the chapter list ends the published page
there, so unreviewed chapters can stay in the YAML after it. They're
still validated (and simulated) by `npm test`, and the build also
writes `dist/<topic>/<name>-drafts.html` with every chapter, for
reviewing them.

### Code references

Code links are defined in an explainer's `coderefs.yaml` by **anchor
text**, not line numbers. Each one names a source repo (a key in the
topic's `sources.yaml`), a file, and a unique line to start from:

```yaml
persister.pause:
  repo: bleve
  path: index/scorch/persister.go
  anchor: "func (s *Scorch) pausePersisterForMergerCatchUp(lastPersistedEpoch uint64,"
  extent: func            # or `block`, or a line count
  highlight: ["time.After(", "TotPersisterSlowMergerPause"]
```

A topic's `sources.yaml` pins each repo to a commit, and lists where to
find a local copy (relative paths are from the repo root).

`npm run snippets` resolves the anchors and writes each explainer's
`snippets.json`: highlighted lines plus GitHub permalinks at the pinned
commits. Those files are committed, so building doesn't need the
sources; only refreshing the snippets does.

## Layout

```
engine/                  the engine
  js/domain.js           the seam: useDomain(), and D, the explainer the engine reads
  js/story/timeline.js   narrative semantics: steps, views, change counting, expectations
  js/ui/                 the page's parts: story.js (runStory: the page, run), page.js (story, toolbar DOM), camera.js and
                         gestures.js, scroll.js, overlay.js (callout lines), anchors.js,
                         code.js and toc.js (the drawers), util/
  css/style.css          the engine's styles: neutral palette, default fonts, layout, story, toolbar, drawers
  page.html              the page template
  build/                 build.mjs, explainers.mjs (finding them), look.mjs (topic styles and fonts), indexes.mjs (the index pages), schema.mjs, snippets.mjs, golden.mjs
  tools/shoot.mjs        screenshots of a built page (npm run shoot)
  tools/showcase.mjs     the index pages' showcase pictures (npm run showcase)
  test/, test-e2e/       its tests; helpers for explainers' browser tests
topics/
  cbft/                  Couchbase full-text search (see its README.md)
    topic.yaml, style.css, sources.yaml, research/
    01-indexing/         goroutines and backpressure, with a simulator (sim/)
    02-zap-format/       inside a zap segment, with tools/zap-golden
  blance/                partition planning and moves (see its README.md)
    topic.yaml, style.css (its own palette and fonts), sources.yaml, research/
    lib/                 a JS port of blance's planner and moves, checked against the
                         real Go by tools/plan-golden; shared by its explainers
    01-planning/         the planner, decision by decision (scenarios.js); its diagram
                         is diagram.js plus parts, diagram-{board,strip,moves,arrows,shared}.js
    02-moving/           a rebalance over time, from the orchestrator's simulation
    03-groups/           server groups: 01-planning's page (its domain and main), its own story
  n1k1/                  a SQL++ engine for local files (see its README.md)
    lib/                 the real n1k1's run of the story's query (tools/query-golden), and
                         the query worked in JS (query.js), checked against it
    01-query/            the life of a query: plan, rows pushed up, where bytes are copied
    02-compile/          the compiler made from the interpreter's source (tools/compile-golden)
    03-boxed/            one filter, two lanes: cbq's boxed values vs n1k1's bytes (tools/boxed-golden)
  transactions/          multi-doc transactions, run by the client (see its README.md)
    lib/                 one real transaction, gocbcore against the CAVES mock, snapshotted
                         at each test hook (tools/txn-golden; the mock is downloaded to tmp/)
    01-life/             the life of a transaction: staging, the ATR's commit point, unstaging
dist/                    the built pages (committed; published by GitHub Pages)
.github/workflows/       CI, and GitHub Pages publishing
```

## License

Copyright 2026 Couchbase, Inc. Licensed under the Apache License,
Version 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
