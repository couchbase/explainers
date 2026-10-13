// The 02-moving explainer's page: the engine's story runner (see
// engine/js/ui/story.js), with this explainer's diagram. Each step's
// moment and panel come from its view (see sceneAt in story.js); the
// scroll moves time from one step's moment to the next's, so a step
// that covers a lot of a run gets a long scroll, and its time follows
// the whole of it. The scroll is the timeline: literally, here.

import { runStory } from '../../../engine/js/ui/story.js';
import { easeQuad } from '../../../engine/js/ui/util/anim.js';
import { sceneAt } from './story.js';
import { Diagram } from './diagram.js';

runStory({
  setup({ page, views, camera }) {
    const diagram = new Diagram(page.svg);
    const scenes = views.map((_, i) => sceneAt(views, i));

    return {
      diagram,
      render({ i, p, v, pv }) {
        camera.show(camera.between(i > 0 ? pv.camera : null, v.camera, p));
        const A = scenes[i > 0 ? i - 1 : i], B = scenes[i];
        // time runs evenly with the scroll; a change of run eases
        const q = A.run === B.run ? p : easeQuad(p);
        diagram.draw(A, B, q, p);
      },
      expose: { scenes },
    };
  },
});
