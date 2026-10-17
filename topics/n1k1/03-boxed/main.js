// The 03-boxed explainer's page: the engine's story runner (see
// engine/js/ui/story.js), with this explainer's diagram. Each step's
// state comes from its view (`at`); the scroll plays every state
// between the last step's and this one's, one change at a time. A stage
// that makes several things gets more scroll, one thing at a time.

import { runStory } from '../../../engine/js/ui/story.js';
import { clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { STATE, changed } from './states.js';
import { sceneAt, statePath } from './story.js';
import { Diagram, NODES } from './diagram.js';

// a change's size: the things it makes, one at a time
function sizeOf(a, b) {
  const A = STATE[a], B = STATE[b], field = changed(A, B)[0];
  if (field === 'boxed' || field === 'bytes') return 0.6 + 0.5 * NODES[field].filter((n) => n.stage === B[field] - 1).length;
  if (field === 'twenty') return 2.5;
  // (the sweep through the 20 rows, one at a time)
  if (field === 'group' && B.group === 2) return 14;
  if (field === 'table') return 2;
  return 1;
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
