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
import { Diagram } from './diagram.js';

// scroll per change, in vh; a step needing less plays in the engine's
// usual transition
const VH = 30, TRANSITION_VH = 40;

runStory({
  setup({ page, views, stepEls, camera }) {
    const diagram = new Diagram(page.svg);
    const scenes = views.map((_, i) => sceneAt(views, i));
    const plans = scenes.map((B, i) => {
      const A = scenes[i > 0 ? i - 1 : i];
      const path = statePath(A.at, B.at);
      const total = path.length - 1;
      const scrub = total * VH > TRANSITION_VH;
      if (scrub) {
        stepEls[i].classList.add('step-scrub');
        stepEls[i].style.minHeight = `${Math.min(600, total * VH).toFixed(0)}vh`;
      }
      return { path, scrub };
    });

    return {
      diagram,
      render({ i, p }) {
        const { path, scrub } = plans[i];
        const x = clamp01(p) * Math.max(1, path.length - 1);
        const j = Math.min(path.length - 2, Math.floor(x));
        const a = path[Math.max(0, j)], b = path[Math.min(path.length - 1, j + 1)];
        const f = path.length < 2 ? 1 : clamp01(x - Math.max(0, j));
        const q = scrub ? f : easeQuad(f);
        // the camera: from the last state's view to the next one's
        camera.show(camera.between(cameraOf(STATE[a]), cameraOf(STATE[b]), q));
        diagram.draw(a, b, q);
      },
      expose: { scenes, plans },
    };
  },
});
