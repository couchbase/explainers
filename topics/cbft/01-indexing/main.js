// The page: the engine's story runner (see engine/js/ui/story.js), with
// this explainer's diagram, simulation, charts and knobs.
//
// The design rule: the reader's scroll is the timeline. Each step has a
// transition zone at the start of its scroll range, where everything
// visual interpolates from the previous step's view to this one's: the
// camera, lids, bubbles, the UI chrome, the callout lines, the marker
// for "our batch", the goroutine boxes, and the slot grids. Scrolling
// back plays it all in reverse; nothing teleports. Only when the reader
// presses Play does the simulation's own clock drive things.

import { Diagram } from './diagram.js';
import { LIDS, BUBBLES, ANCHORS, SWAP_PHASES, COMMIT_PHASES, swapShift, swapTravel, swapPart } from './domain.js';
import { isAnchorVisible } from '../../../engine/js/ui/anchors.js';
import { runStory } from '../../../engine/js/ui/story.js';
import { KnobsDrawer } from './knobs.js';
import { ChartsPanel } from './charts.js';
import { markerFrame, boxFrames, route } from './transitions.js';
import { swapMarker } from './swapmarker.js';
import { clamp01, lerp, along, toggleAt } from '../../../engine/js/ui/util/anim.js';
import { modelAtStep, enterStep } from '../../../engine/js/story/timeline.js';
import { speedAt } from './directives.js';
import { checkInvariants } from './sim/invariants.js';

const debug = /[?&]debug=1/.test(location.search);

runStory({ simulation: true, setup });

// The explainer's part of the page, for runStory: its hooks.
function setup({ narrative, steps, views, page, ui, stepEls, camera, reduceMotion, ctl, enter }) {
  const diagram = new Diagram(page.svg);
  const charts = new ChartsPanel(page.chartsCol);

  // ---------------------------------------------------------------
  // Simulation state, per step

  Object.assign(ctl, {
    model: null, speed: 0, playing: false,
    lastTs: null, lastSim: 0, dirty: true, autoKnobs: false, blending: false,
    // What the diagram showed at each visited step, for transitions:
    tokenAt: new Map(), // the batch marker's place
    chipAt: new Map(), // the merger's result, while it's on its own
    stateAt: new Map(), // the goroutine boxes' states
    slotsAt: new Map(), // the slot grids' contents
  });

  // A step with a flow plays it over its whole length: give it room.
  views.forEach((v, i) => { if (v.flow) stepEls[i].classList.add('step-long'); });

  const knobs = new KnobsDrawer(document.body, { onReset: () => enter(ctl.current, { rebuild: true }) });

  // Step i becomes current (the engine does the rest: see runStory).
  function enterStepAt(i, { rebuild = false } = {}) {
    const st = steps[i], view = views[i];
    const forward = !rebuild && ctl.model && i === ctl.current + 1 && !(st.sim && st.sim.reset);
    if (forward) enterStep(ctl.model, st);
    else ctl.model = modelAtStep(narrative, steps, i);
    ctl.current = i;
    ctl.speed = speedAt(steps, i);
    ctl.playing = ctl.speed > 0 && !reduceMotion;

    diagram.setView(view.open, view.bubbles);
    diagram.live = ctl.playing;
    // A root swap told over several steps starts from the step before
    // it, so that one's needed too (e.g. after a deep link).
    const base = swapBase(i) ?? commitBase(i);
    if (base !== null && !ctl.slotsAt.has(base)) record(base, modelAtStep(narrative, steps, base));
    record(i, ctl.model);
    // The boxes stay as they were until the new root is swapped in (or
    // the persister lets go of its root).
    if (base !== null && (view.swap ? SWAP_PHASES.indexOf(view.swap) < SOLID : COMMIT_PHASES.indexOf(view.commit) < COMMIT_PHASES.indexOf('release'))) {
      ctl.stateAt.set(i, ctl.stateAt.get(base));
    } else if (base !== null && view.commit && view.commit !== 'wake') {
      // ...and the merger, until the commit's epoch wakes it.
      ctl.stateAt.set(i, { ...ctl.stateAt.get(i), merger: ctl.stateAt.get(base).merger });
    }

    charts.emphasize(view.chart);
    knobs.attach(ctl.model);
    if (st.sandbox && !knobs.isOpen) { knobs.open(); ctl.autoKnobs = true; }
    if (!st.sandbox && ctl.autoKnobs) { knobs.close(); ctl.autoKnobs = false; }
    ctl.dirty = true;
  }

  // What the diagram shows at step i, for transitions.
  function record(i, m) {
    diagram.update(m);
    ctl.tokenAt.set(i, diagram.tokenTarget(m, views[i].token));
    ctl.chipAt.set(i, diagram.mergedTarget(m));
    ctl.stateAt.set(i, diagram.nodeStates);
    ctl.slotsAt.set(i, diagram.captureSlots());
  }

  // ---------------------------------------------------------------
  // Root swaps (see SWAP_PHASES): told over several steps (`swap: <phase>`
  // on each), or played within one step's scroll whenever the root changes.

  const WRITE_SHARE = 0.6; // of a `flow: write` step, before the marker moves
  const SOLID = SWAP_PHASES.indexOf('solid');
  const DROP = SWAP_PHASES.indexOf('drop');
  const phaseNum = (v) => (v.swap ? SWAP_PHASES.indexOf(v.swap) + 1 : 0);

  // The step before the told swap that step i is part of, or null.
  function swapBase(i) {
    if (!views[i].swap) return null;
    let j = i;
    while (j > 0 && views[j - 1].swap) j--;
    return j - 1;
  }

  // The swap shown at step i, progress p (t = ease(p)): {A, B, base, s},
  // with s from 0 to SWAP_PHASES.length; or null.
  function swapAt(i, p, t) {
    const base = swapBase(i);
    if (base !== null) {
      const A = ctl.slotsAt.get(base), B = ctl.slotsAt.get(i);
      if (!A || !B) return null;
      // Phases follow the scroll evenly (not eased), so each gets its
      // fair share. In the step where the new root goes solid, it does
      // so in the first half; the boxes catch up in the second (see
      // boxProgress).
      const tt = crossesSolid(i) ? clamp01(p / 0.5) : p;
      // An empty 'drop' phase (nothing replaced) passes in no scroll.
      let from = phaseNum(views[i - 1]);
      if (from === DROP && phaseNum(views[i]) > DROP + 1 && !Diagram.swapDrops(A, B)) from = DROP + 1;
      return { A, B, base, s: lerp(from, phaseNum(views[i]), tt) };
    }
    const A = ctl.slotsAt.get(i - 1), B = ctl.slotsAt.get(i);
    if (p < 1 && Diagram.isSwap(A, B)) return { A, B, base: i - 1, s: SWAP_PHASES.length * clamp01((t - 0.1) / 0.8) };
    return null;
  }
  // The persister's commit, told over steps (`commit: <phase>`), the
  // same way: {A, B, s} with s from 0 to COMMIT_PHASES.length, or null.
  const commitNum = (v) => (v.commit ? COMMIT_PHASES.indexOf(v.commit) + 1 : 0);
  function commitBase(i) {
    if (!views[i].commit) return null;
    let j = i;
    while (j > 0 && views[j - 1].commit) j--;
    return j - 1;
  }
  const releases = (i) => views[i].commit === 'release';
  function commitAt(i, p) {
    const base = commitBase(i);
    if (base === null) return null;
    const A = ctl.slotsAt.get(base), B = ctl.slotsAt.get(i);
    if (!A || !B || !A.bolt || !B.bolt) return null;
    // Letting go takes the first half; the boxes follow in the second.
    const tt = releases(i) ? clamp01(p / 0.5) : p;
    return { A, B, s: lerp(commitNum(views[i - 1]), commitNum(views[i]), tt) };
  }

  const crossesSolid = (i) => !!views[i].swap && phaseNum(views[i - 1]) <= SOLID && phaseNum(views[i]) > SOLID;
  const boxProgress = (i, p) => (crossesSolid(i) || releases(i) ? clamp01((p - 0.5) / 0.5) : p);

  // The merged file segment's chip at step i: {p, o, dest}, or null.
  function mergedChipAt(i, p, t, u, swap) {
    if (swap) {
      const a = ctl.chipAt.get(swap.base), cur = ctl.tokenAt.get(i);
      if (!a || !cur) return null;
      // Into the new root: it lands where the merged segment's bar
      // appears, grows into that bar, slides left with it as the gaps
      // close, and gives way to the bar once the new root is solid.
      const spot = diagram.newBarSpot(swap.A, swap.B, cur.key) || cur.p;
      const [dx, dy] = swapShift(swap.s);
      const e = swapTravel(swap.s);
      const o = 1 - swapPart(swap.s, 'solid');
      const bar = diagram.barInSwap(swap.A, swap.B, cur.key, swap.s);
      // (growing into its bar's height on the way)
      if (e < 1) return { p: along(route(a, { ...cur, p: [spot[0] + dx, spot[1] + dy] }), e), h: lerp(14, bar ? bar.h : 14, e), o };
      if (!bar) return null;
      return { p: [bar.x + 7 + dx, bar.foot - 7 + dy], h: bar.h, o };
    }
    const a = i > 0 ? ctl.chipAt.get(i - 1) : null, b = ctl.chipAt.get(i);
    if (a && b) return { p: along(route(a, b), t), o: 1, dest: b.st, left: (t < 0.5 ? a : b).left };
    // It appears once the merged zap file is written and opened.
    if (b) return { p: b.p, left: b.left, o: views[i].flow === 'mergeWrite' ? clamp01((u - WRITE_SHARE) / 0.2) : t };
    if (a) return { p: a.p, left: a.left, o: 1 - t };
    return null;
  }

  function effectiveSpeed() {
    if (ui.speedSel.value !== 'auto') return Number(ui.speedSel.value);
    return ctl.speed > 0 ? ctl.speed : 0.25;
  }

  // ---------------------------------------------------------------
  // One frame of the view for the current scroll position

  // A callout's end: a static anchor shows once its lids and bubble do.
  function anchor(id, view) {
    return ANCHORS[id]
      ? { ...diagram.anchor(id), visible: isAnchorVisible(id, view.open, view.bubbles) }
      : diagram.anchor(id);
  }

  let lastChrome = -1;
  function setChrome(chrome) {
    if (chrome === lastChrome) return;
    lastChrome = chrome;
    // The charts column takes no room until shown.
    page.layout.style.setProperty('--chrome', chrome.toFixed(4));
    for (const el of [ui.controls, page.chartsCol]) {
      el.style.opacity = chrome.toFixed(3);
      el.style.visibility = chrome < 0.02 ? 'hidden' : '';
    }
    // On phones the toolbar wraps, so hidden controls would leave an empty row.
    ui.controls.style.display = chrome < 0.02 && window.innerWidth <= 900 ? 'none' : '';
    ui.zoomHint.style.opacity = (1 - chrome).toFixed(3);
    ui.zoomHint.style.visibility = chrome > 0.98 ? 'hidden' : '';
  }

  function render({ i, p, u, t, v, pv }) {

    setChrome(toggleAt(pv.ui === 'full', v.ui === 'full', p));

    // While the root is swapped, the marker waits for its turn.
    const swap = ctl.playing ? null : swapAt(i, p, t);
    // ...and while our file goes down to disk.
    // A write plays over the step's whole length (u), evenly: the file
    // goes down first, then the marker moves.
    const writing = /^(write|mergeWrite)$/.test(v.flow || '');
    const mf = (swap && swapMarker(views, ctl.tokenAt, i, swap.base, swap.s)) ||
      (writing ? markerFrame(views, ctl.tokenAt, i, u, [WRITE_SHARE, WRITE_SHARE + 0.25], true) : markerFrame(views, ctl.tokenAt, i, p));
    const markerPt = mf && mf.t && mf.o > 0.01 ? mf.t.p : null;
    camera.show(camera.follow(camera.between(i > 0 ? pv.camera : null, v.camera, p), markerPt));

    for (const id of Object.keys(LIDS)) diagram.setLid(id, toggleAt(pv.open.has(id), v.open.has(id), p));
    for (const id of Object.keys(BUBBLES)) diagram.setBubble(id, toggleAt(pv.bubbles.has(id), v.bubbles.has(id), p));
    if (pv.bubbles.has('merger') || v.bubbles.has('merger')) diagram.setStairs(pv.plan, v.plan, t);
    diagram.setToken(mf && mf.t, mf ? mf.o : 0);
    diagram.setDocs(mf && mf.birth !== undefined ? mf.birth : -1, mf && mf.t);
    diagram.setQueueDocs(v.flow === 'analysis' && u < 1 ? u : -1);
    // The persister's epoch watcher: up to the introducer, then a note
    // while it waits there; the note goes once a new root closes it.
    diagram.setWatcherFly(v.flow === 'watcher' && p < 1 ? clamp01(t / WRITE_SHARE) : -1);
    if (!ctl.playing) {
      const wa = ctl.slotsAt.get(i - 1)?.watcher || '', wb = ctl.slotsAt.get(i)?.watcher || '';
      const wq = p >= 1 ? 1 : v.flow === 'watcher' ? clamp01((t - WRITE_SHARE) / (1 - WRITE_SHARE)) : wa && !wb ? clamp01((t - 0.85) / 0.15) : t;
      diagram.blendWatcher(wa, wb, wq);
    }
    // our zap file down a write arrow: the persister's, or the merger's
    diagram.setWriteFly(writing && u < WRITE_SHARE ? clamp01(u / WRITE_SHARE) : -1, ...(v.flow === 'mergeWrite' ? [720, 'merged zap file'] : [280]));
    // Our segment's slot stays faint until the marker arrives.
    diagram.setArrival(mf && mf.dest, mf && mf.dest && !mf.arrived ? 0 : 1);
    // Our file's channel lights as the marker reaches it.
    if (mf && mf.dest && mf.dest.st === 'fileIntroducing' && !ctl.playing) {
      diagram.setChanLit('merges', diagram.reachedChan('merges', mf.t.p, mf.t.size));
    }
    // The merger's result, on its own: written and opened, up to the
    // introducer, then (in a told swap) into the new root.
    const chip = ctl.playing ? null : mergedChipAt(i, p, t, u, swap);
    diagram.setMergedChip(chip);
    // The introducer's channel stays lit while it builds the new root
    // for what came on it, until the new root is swapped in.
    if (swap && !ctl.playing && swapPart(swap.s, 'solid') < 1) {
      const b = ctl.tokenAt.get(swap.base);
      if (ctl.chipAt.get(swap.base) || (b && b.st === 'fileIntroducing')) diagram.setChanLit('merges', true);
    }
    if (chip && chip.dest === 'mergeIntroducing') diagram.setChanLit('merges', diagram.reachedChan('merges', chip.p, 14));

    // Who owns time: the clock while the simulation plays, otherwise the scroll.
    if (ctl.playing) {
      diagram.liveNodes(diagram.nodeStates, performance.now(), 450);
    } else {
      diagram.scrubNodes(boxFrames(ctl.stateAt, Diagram.NODE_ORDER, i, boxProgress(i, p), diagram.nodeStates));
      const sa = ctl.slotsAt.get(i - 1), sb = ctl.slotsAt.get(i);
      const commit = swap ? null : commitAt(i, p);
      if (swap) {
        diagram.drawSwap(swap.A, swap.B, swap.s);
        ctl.blending = true;
      } else if (commit) {
        diagram.drawCommit(commit.A, commit.B, commit.s);
        ctl.blending = true;
      } else if (sa && sb && p < 1) {
        diagram.blendSlots(sa, sb, clamp01((t - 0.1) / 0.8));
        ctl.blending = true;
      } else if (ctl.blending && sb) {
        diagram.blendSlots(sb, sb, 1);
        ctl.blending = false;
      }
    }
  }

  function drawSim() {
    const m = ctl.model;
    if (!m) return;
    ui.clock.textContent = `t = ${(m.now / 1000).toFixed(2)}s`;
    ui.playBtn.textContent = ctl.playing ? 'Pause' : 'Play';
    diagram.live = ctl.playing;
    diagram.update(m);
    if (ctl.playing) {
      ctl.tokenAt.set(ctl.current, diagram.tokenTarget(m, views[ctl.current].token));
      ctl.stateAt.set(ctl.current, diagram.nodeStates);
    }
    if (lastChrome > 0.02) charts.update(m);
    if (debug) {
      const errs = checkInvariants(m);
      if (errs.length) console.error('invariant violations', errs);
    }
  }

  function beforeFrame(ts) {
    if (ctl.lastTs === null) ctl.lastTs = ts;
    const dt = Math.min(100, ts - ctl.lastTs);
    ctl.lastTs = ts;
    if (ctl.playing && ctl.model) ctl.model.advance(dt * effectiveSpeed());
    if (ctl.dirty || (ctl.playing && ts - ctl.lastSim > 100)) {
      ctl.lastSim = ts;
      ctl.dirty = false;
      drawSim();
    }
  }

  // ---------------------------------------------------------------
  // Controls

  ui.playBtn.addEventListener('click', () => { ctl.playing = !ctl.playing; ctl.dirty = true; });
  ui.replayBtn.addEventListener('click', () => enter(ctl.current, { rebuild: true }));
  ui.knobsBtn.addEventListener('click', () => { ctl.autoKnobs = false; if (knobs.isOpen) knobs.close(); else knobs.open(); });
  function onKey(e) {
    if (e.key === ' ' && !e.target.closest('button') && views[ctl.current]?.ui === 'full') {
      e.preventDefault(); ctl.playing = !ctl.playing; ctl.dirty = true;
    }
  }

  return {
    diagram, enter: enterStepAt, render, anchor, beforeFrame, onKey,
    overlay: (o) => charts.drawLeaders(o, diagram, camera, lastChrome),
    onEscape: () => knobs.close(),
  };
}
