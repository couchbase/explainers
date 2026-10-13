# explainers

Scrollytelling explainers of how software works inside: a story column
you scroll, beside one large diagram that the story zooms around and
opens up section by section, and the real source code each step is
about. The style is inspired by
[r2d3.us](https://r2d3.us/visual-intro-to-machine-learning-part-1/).

This repo has a generic engine (`engine/`) and explainers grouped by
topic (`topics/`):

- **[cbft](topics/cbft/README.md):** how Couchbase's full-text search
  service, [cbft](https://github.com/couchbase/cbft), works under the
  hood, with the [bleve](https://github.com/blevesearch/bleve) library:
  - **01-indexing**, "Inside bleve / scorch: introducer, persister,
    merger": one batch of mutations, from KV through cbft and onto disk;
  - **02-zap-format**, "Inside a zap segment": one query, followed byte
    by byte through a real segment file.
- **[blance](topics/blance/README.md):** how
  [blance](https://github.com/couchbase/blance), a small, reusable
  library for partitioned systems (cbgt, under Couchbase's search, is
  one user), plans which nodes hold each partition's primary and
  replicas, and moves them in a rebalance:
  - **01-planning**, "Inside blance: how a plan places partitions":
    the planner's real decisions, score by score, as nodes join and
    leave, and stickiness;
  - **02-groups**, "Inside blance: server groups": racks or zones as
    a tree, and a rule that keeps a partition's replica out of its
    primary's group;
  - **03-moving**, "Inside blance: how a rebalance moves partitions":
    each partition's moves, a mover per node and the controller's
    rounds, over time, one move at a time, four at a time, and deletes
    first.

## Quick start

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm ci               # install the pinned dependencies
npm run build        # -> dist/<topic>/<name>.html, and index pages
open dist/index.html # open it in a browser
```

Each page is a **self-contained HTML file**, with no server and no
external scripts, so it can be emailed or Slacked.

`npm run dev` rebuilds on every change under `engine/` and `topics/`.

Scrolling drives the story. You can also navigate the diagram like a google map:
- drag to pan;
- ⌘, Ctrl or ⌥ + scroll, or pinch, to zoom at the cursor;
- double-click to zoom in, ⌥/Shift + double-click to zoom out;
- two fingers to pinch and pan on touchscreens;
- ⟲ to return to the story's view (the next step also eases back to it).

The Code drawer shows the Go source each step is about, with
links to GitHub at pinned commits.

## Tests

```sh
npm test             # unit tests (fast; no browser needed)
npm run build
npm run test:e2e     # browser tests, in headless Chrome / playwright
```

The engine's tests are in `engine/test/`; each explainer's are in its
own `test/` and `test-e2e/`. `engine/test/narratives.test.mjs` checks
every explainer's narrative: its schema, its code refs, and each
step's `expect`.

Where an explainer models real code in JS (a planner, a merge policy,
a file format), it checks the model against the real thing: a **golden
tool**, `tools/<name>-golden/` beside it, runs the real code (in Go)
on many cases and writes what it did, and the explainer's tests
compare. `npm run golden` reruns them all (`npm run golden -- blance`
just those whose path matches); each tool's `golden.yaml` says how to
run it. The go on your PATH must be new enough for the code it runs.

Append `?debug=1` to a page's URL for its explainer's debug checks
(the cbft simulation's invariants, on every frame).

CI (`.github/workflows/ci.yml`) runs the build and both test suites
on every push and pull request.

## Publishing

Each built page carries a version stamp from `git describe --long` of
the sources it was built from, plus `-dirty` if they had uncommitted
changes (changes under `dist/` don't count).

To publish a new version:

```sh
git commit ...        # commit your changes first, for a clean stamp
npm run build
git add dist && git commit -m "Build dist"
git push
```

Tag a release (`git tag v0.2.0`) before building to get a friendlier
stamp.

**GitHub Pages.** `.github/workflows/pages.yml` publishes the committed
`dist/` (but not the drafts pages) whenever `dist/` changes on `main`
or `master`, or when run by hand from the Actions tab. To turn it on,
once, in the GitHub repo: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. The pages are then at
`https://<owner>.github.io/<repo>/`, e.g.
`https://<owner>.github.io/<repo>/cbft/01-indexing.html`.

## Engine and explainers

An explainer lives in one directory, `topics/<topic>/<name>/`, and
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
that generate it) goes beside these. A topic's directory holds what its
explainers share: `topic.yaml` (its `title`; a short `label`, shown
atop each explainer page as a link up to the topic's index; and a
`subtitle` for that index page; and optionally its `fonts`, as Google
Fonts families), `style.css` (its look: palette, section colors, and
the engine's `--font-*` set to its fonts; after the engine's styles,
before each explainer's), `sources.yaml` (the source repos they link
into, pinned), and any shared notes or code. With no fonts or
`style.css`, a topic looks like the engine: neutral, in IBM Plex. The build gives each
topic an index page, `dist/<topic>/index.html`, listing its explainers
with their subtitles; each explainer links back up to it, from its
header and from its last card. Those links, the one to the next
explainer, and links in a step's text to sibling pages, work only where
they'd lead somewhere: when the page is served, or opened from disk
still in its topic's directory (as in `dist/`), but not from a copy
that was emailed or Slacked around (they're left out, or plain text). Code
shared across topics goes in the engine.

The engine reaches an explainer only through one seam,
`engine/js/domain.js`: the explainer's entry point calls `useDomain()`
with its `domain.js`, and the engine reads that as `D`. The build and
the tests do the same for each explainer. The engine reads:

- **geometry:** `CANVAS`, `CAMERAS`, `LIDS`, `BUBBLES`, `ANCHORS`,
  `DYNAMIC_ANCHORS` (anchors whose place the page works out) and
  `SECTION_COLORS`;
- **its own view directives:** `VIEW_KEYS`: their values, whether they
  carry over, how they count as a step's change, and whether they're
  told over steps;
- **expectations:** `EXPECTATIONS` and `EXPECTATION_PARAMS`
  (`<name>:<arg>`);
- **a simulation, if it has one:** `makeModel`, `makeConfig` and
  `applyConfig`, and `SIM`: the step directives besides `reset`, how
  they're checked, and how they drive the model; and optionally
  `checkInvariants`, which the tests run at every step.

`useDomain()` fills in empty defaults for what an explainer leaves out.
With no `makeModel`, a narrative has no `sim` directives, and the page
builds no simulation controls (`buildPage(..., { simulation: true })`
asks for them).

The engine provides the rest: the narrative schema
(`engine/build/schema.mjs`), the step/view folding and change counting
(`engine/js/story/timeline.js`), and the page's parts (`engine/js/ui/`):
story column, camera and gestures, scroll position, callout lines,
contents, code drawer.

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
  arrow its own share). It still settles before the next step, so deep
  links land on it finished.
- **Nothing teleports.** Markers travel along the drawn arrows and the
  corridor lanes between boxes; destinations wait for them to arrive.
- **Keep the subject in view.** The camera follows the marker, and the
  charts and controls stay out of the way until they're needed.

## Writing narratives

A narrative (`narrative.yaml`) names, at the top, its `title`,
`subtitle` and `audience`; the pinned `sources` it's modeled on (keys
in its topic's `sources.yaml`, listed in the page's header); and
optionally the explainer to read `next` (another in the same topic).
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
- every camera, lid, anchor and chart name exists;
- a callout's target isn't hidden under a closed lid;
- nested lids only open inside open parents;
- a told swap's phases come in order.

`expect` names predicates from the explainer's `EXPECTATIONS` and its
parameterized `EXPECTATION_PARAMS` (`<name>:<arg>`). The tests check
them, so the prose and the model (or the real data) can't silently
drift apart.

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
    01-planning/         the planner, decision by decision (scenarios.js)
    02-groups/           server groups: 01-planning's page (its domain and main), its own story
    03-moving/           a rebalance over time, from the orchestrator's simulation
dist/                    the built pages (committed; published by GitHub Pages)
.github/workflows/       CI, and GitHub Pages publishing
```

## License

Copyright 2026 Couchbase, Inc. Licensed under the Apache License,
Version 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
