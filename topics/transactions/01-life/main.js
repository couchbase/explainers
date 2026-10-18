// The 01-life explainer's page: the engine's story runner (see
// engine/js/ui/story.js), with this explainer's diagram. Each step's
// state comes from its view (`at`); the scroll plays every state
// between the last step's and this one's, one change at a time. A
// request (the ball out, and its landing) gets more scroll than a
// label does.

import { runStory } from '../../../engine/js/ui/story.js';
import { clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { STATE, changed } from './states.js';
import { sceneAt, statePath } from './story.js';
import { Diagram } from './diagram.js';

// a change's size, in screens of scroll
function sizeOf(a, b) {
  const field = changed(STATE[a], STATE[b])[0];
  return { reads: 2.2, writes: 2.8, track: 2.4, halves: 1.4 }[field] || 1;
}
const VH = 30, TRANSITION_VH = 40;

runStory({
  setup({ page, views, stepEls, camera }) {
    const diagram = new Diagram(page.svg);
    const scenes = views.map((_, i) => sceneAt(views, i));
    const plans = scenes.map((B, i) => {
      const A = scenes[i > 0 ? i - 1 : i];
      const path = statePath(A.at, B.at);
      const w = path.slice(1).map((k, j) => sizeOf(path[j], k));
      const total = w.reduce((s, x) => s + x, 0);
      const scrub = total * VH > TRANSITION_VH;
      if (scrub) {
        stepEls[i].classList.add('step-scrub');
        stepEls[i].style.minHeight = `${Math.min(600, total * VH).toFixed(0)}vh`;
      }
      const cum = [0];
      for (const x of w) cum.push(cum[cum.length - 1] + x / Math.max(total, 1e-9));
      return { path, cum, scrub };
    });

    return {
      diagram,
      render({ i, p, v, pv }) {
        camera.show(camera.between(i > 0 ? pv.camera : null, v.camera, p));
        const { path, cum, scrub } = plans[i];
        const x = clamp01(p);
        let j = 0;
        while (j < path.length - 2 && x > cum[j + 1]) j++;
        const f = clamp01((x - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]));
        diagram.draw(path[j], path[Math.min(j + 1, path.length - 1)], scrub ? f : easeQuad(f));
      },
      expose: { scenes, plans },
    };
  },
});
