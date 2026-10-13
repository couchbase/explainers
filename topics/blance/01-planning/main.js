// The 01-planning explainer's page: the engine's story runner (see
// engine/js/ui/story.js), with this explainer's diagram. Each step's
// frame and panel come from its view (see sceneAt in story.js), and
// the scroll moves the board from one step's frame to the next's,
// through every decision in between, stage by stage: the scroll is the
// timeline, and no chip teleports.
//
// A step that plays a lot (arrows, one at a time) scrubs over its whole
// length (the engine's step-scrub), made as tall as its frames need:
// each frame gets a share of the scroll by what it plays (each arrow,
// each row outlined, each pick), more for a step about one decision,
// less for one that runs through several.

import { runStory } from '../../../engine/js/ui/story.js';
import { clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { FRAMES, PARTITIONS } from './scenarios.js';
import { cameraFor } from './layout.js';
import { sceneAt, framePath } from './story.js';
import { Diagram } from './diagram.js';

// How much a frame plays, getting there: its stage's arrows (at least 1).
function weightOf(f) {
  const d = f.decision;
  if (!d || f.stage === undefined) return 1;
  const x = d.seq[f.stage];
  if (x.stage === 'row') return 1;
  if (x.stage === 'pick') return 3;
  const c = d.scored.find((y) => y.node === x.node), np = PARTITIONS.length;
  const n = { count: c.count, spread: Math.round(c.lowerPriorityBalanceFactor * np), fill: Math.round((c.filledFactor * np) / 0.001), sticky: 1 }[x.term];
  return Math.max(1, n);
}
// scroll per unit of weight, in vh, and at most: a step about one
// decision, or one that runs through several
const VH_ONE = 9, VH_MANY = 4, MAX_ONE = 600, MAX_MANY = 600;
// (a step needing less than this plays in the engine's usual transition)
const TRANSITION_VH = 40;

runStory({
  setup({ page, views, stepEls, camera }) {
    const diagram = new Diagram(page.svg);
    const scenes = views.map((_, i) => sceneAt(views, i));
    // each step's path, and where along it each frame is, by weight
    const plans = scenes.map((B, i) => {
      const A = scenes[i > 0 ? i - 1 : i];
      const path = framePath(A.at, B.at);
      const w = path.slice(1).map((k) => weightOf(FRAMES[k]));
      const total = w.reduce((s, x) => s + x, 0);
      const picks = path.slice(1).filter((k) => FRAMES[k].decision && FRAMES[k].stage === FRAMES[k].decision.seq.length - 1).length;
      const vh = picks > 1 ? Math.min(MAX_MANY, total * VH_MANY) : Math.min(MAX_ONE, total * VH_ONE);
      const scrub = path.length > 2 && vh > TRANSITION_VH;
      if (scrub) {
        stepEls[i].classList.add('step-scrub');
        stepEls[i].style.minHeight = `${vh.toFixed(0)}vh`;
      }
      const cum = [0];
      for (const x of w) cum.push(cum[cum.length - 1] + x / Math.max(total, 1));
      return { path, cum, scrub };
    });

    return {
      diagram,
      render({ i, p, v, pv }) {
        const A = scenes[i > 0 ? i - 1 : i], B = scenes[i];
        // the board and strip alone, or with the panel on the right
        camera.show(camera.between(i > 0 ? cameraFor(A.panel) : null, cameraFor(B.panel), p));
        // through each frame between the two, by its share of the scroll
        const { path, cum, scrub } = plans[i];
        const x = clamp01(p);
        let j = 0;
        while (j < path.length - 2 && x > cum[j + 1]) j++;
        const f = (x - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
        const FA = FRAMES[path[j]], FB = FRAMES[path[j + 1]];
        // (the panel follows the board's frame, or changes on its own)
        diagram.draw(FA, FB, scrub ? clamp01(f) : easeQuad(clamp01(f)), A.panel, B.panel, p, FA, FB);
        // the attention box: early in a long step, with the transition in a short one
        diagram.setFocus(i > 0 ? A.focus : null, B.focus, easeQuad(scrub ? clamp01(p * 5) : clamp01(p)));
      },
      expose: { scenes, plans },
    };
  },
});
