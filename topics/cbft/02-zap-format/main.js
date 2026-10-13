// The 02-zap-format explainer's page: the engine's story runner (story column, camera,
// callouts, contents, code drawer), with this explainer's diagram.
// There's no simulation, so no controls or charts: each step's scene
// comes from its view (see sceneAt in story.js), and the scroll blends
// one step's scene into the next. The same rules as the first explainer: the scroll is the
// timeline, and the reader marker never teleports.

import { runStory } from '../../../engine/js/ui/story.js';
import { along, ease, toggleAt } from '../../../engine/js/ui/util/anim.js';
import { LIDS, BUBBLES, LANE_X } from './layout.js';
import { FOCI, sceneAt } from './story.js';
import { Diagram } from './diagram.js';

runStory({
  setup({ page, views, camera }) {
    const diagram = new Diagram(page.svg);
    const scenes = views.map((_, i) => sceneAt(views, i));

    // The reader marker partway (p) from step i-1's focus to step i's.
    function readerAt(i, p) {
      const fa = i > 0 && views[i - 1].focus ? FOCI[views[i - 1].focus] : null;
      const fb = views[i].focus ? FOCI[views[i].focus] : null;
      if (!fa && !fb) return null;
      if (!fa) return { p: fb.p, o: ease(p) };
      if (!fb) return { p: fa.p, o: 1 - ease(p) };
      // within a lens, straight across or down and then across; between
      // lenses, out to the lane beside the strip, along it, and back in
      const pts = fa.p[1] === fb.p[1] || fa.p[0] === fb.p[0] ? [fa.p, fb.p]
        : fa.lens === fb.lens ? [fa.p, [fa.p[0], fb.p[1]], fb.p]
          : [fa.p, [LANE_X, fa.p[1]], [LANE_X, fb.p[1]], fb.p];
      return { p: along(pts, ease(p)), o: 1 };
    }

    // On the file camera, with no reader yet, the camera follows the
    // story's target down the strip, partway from the last step's.
    function fileFollow(i, p) {
      const v = views[i];
      if (v.camera !== 'file' || !v.target) return null;
      const b = diagram.anchor(v.target), a = i > 0 && views[i - 1].target ? diagram.anchor(views[i - 1].target) : null;
      if (!b) return null;
      if (!a) return b.p;
      const t = ease(p);
      return [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t];
    }

    return {
      diagram,
      enter(i) {
        const view = views[i];
        diagram.setView(view.open, view.bubbles);
      },
      render({ i, p, t, v, pv }) {
        const r = readerAt(i, p);
        diagram.readerAt = r && r.p;
        camera.show(camera.follow(camera.between(i > 0 ? pv.camera : null, v.camera, p), r && r.o > 0.01 ? r.p : fileFollow(i, p)));
        for (const id of Object.keys(LIDS)) diagram.setLid(id, toggleAt(pv.open.has(id), v.open.has(id), p));
        for (const id of Object.keys(BUBBLES)) diagram.setBubble(id, toggleAt(pv.bubbles.has(id), v.bubbles.has(id), p));
        diagram.drawScene(i > 0 ? scenes[i - 1] : scenes[i], scenes[i], p);
        diagram.setReader(r && r.p, r ? r.o : 0);
      },
      expose: { scenes },
    };
  },
});
