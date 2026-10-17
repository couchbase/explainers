// The 02-compile explainer's page: the engine's story runner (see
// engine/js/ui/story.js), with this explainer's diagram. Each step's
// state comes from its view (`at`); the scroll plays every state
// between the last step's and this one's, one change at a time. The
// camera follows the code just printed (cameraOf, in layout.js).

import { runStory } from '../../../engine/js/ui/story.js';
import { clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { STATE } from './states.js';
import { sceneAt, statePath } from './story.js';
import { cameraOf } from './layout.js';
import { Diagram, changeSize } from './diagram.js';

// scroll per unit of a change's size (see changeSize), in vh; a step needing less plays in the engine's
// usual transition
const VH = 30, TRANSITION_VH = 40;

runStory({
  setup({ page, views, stepEls, camera }) {
    const diagram = new Diagram(page.svg);
    const scenes = views.map((_, i) => sceneAt(views, i));
    const plans = scenes.map((B, i) => {
      const A = scenes[i > 0 ? i - 1 : i];
      const path = statePath(A.at, B.at);
      // (each change's share: the lines it turns or prints, one at a time)
      const w = path.slice(1).map((k, j) => changeSize(STATE[path[j]], STATE[k]));
      const total = w.reduce((s, x) => s + x, 0);
      const scrub = total * VH > TRANSITION_VH;
      if (scrub) {
        stepEls[i].classList.add('step-scrub');
        stepEls[i].style.minHeight = `${Math.min(900, total * VH).toFixed(0)}vh`;
      }
      const cum = [0];
      for (const x of w) cum.push(cum[cum.length - 1] + x / Math.max(total, 1e-9));
      return { path, cum, scrub };
    });

    return {
      diagram,
      render({ i, p }) {
        const { path, cum, scrub } = plans[i];
        const x = clamp01(p);
        let j = 0;
        while (j < path.length - 2 && x > cum[j + 1]) j++;
        const a = path[j], b = path[Math.min(j + 1, path.length - 1)];
        const f = clamp01((x - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]));
        // (a scrubbing step's changes play at the scroll's pace; their
        // own stretches, one line at a time, ease each one)
        const q = scrub ? f : easeQuad(f);
        // the camera: from the last state's view to the next one's
        camera.show(camera.between(cameraOf(STATE[a]), cameraOf(STATE[b]), q));
        // (the plan and its keys, kept in view as the camera goes down)
        diagram.setSticky(camera.free.y);
        diagram.draw(a, b, q);
      },
      expose: { scenes, plans },
    };
  },
});
