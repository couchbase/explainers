// The 01-planning explainer's page: the engine's story runner (see
// engine/js/ui/story.js), with this explainer's diagram. Each step's
// frame and panel come from its view (see sceneAt in story.js), and
// the scroll moves the board from one step's frame to the next's,
// through every decision in between, one at a time: the scroll is the
// timeline, and no chip teleports.

import { runStory } from '../../../engine/js/ui/story.js';
import { clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { FRAMES } from './scenarios.js';
import { cameraFor } from './layout.js';
import { sceneAt, framePath } from './story.js';
import { Diagram } from './diagram.js';

runStory({
  setup({ page, views, camera }) {
    const diagram = new Diagram(page.svg);
    const scenes = views.map((_, i) => sceneAt(views, i));

    return {
      diagram,
      render({ i, p, v, pv }) {
        const A = scenes[i > 0 ? i - 1 : i], B = scenes[i];
        // the board and strip alone, or with the panel on the right
        camera.show(camera.between(i > 0 ? cameraFor(A.panel) : null, cameraFor(B.panel), p));
        // through each decision between the two frames, in turn
        const path = framePath(A.at, B.at);
        const s = clamp01(p) * (path.length - 1);
        const j = Math.min(Math.floor(s), path.length - 2);
        const FA = FRAMES[path[j]], FB = FRAMES[path[j + 1]];
        const q = easeQuad(s - j);
        // the panel follows the board's frame, or changes on its own
        diagram.draw(FA, FB, q, A.panel, B.panel, A.panel === B.panel ? q : clamp01(p), FA, FB);
      },
      expose: { scenes },
    };
  },
});
