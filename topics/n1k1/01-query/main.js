// The 01-query explainer's page: the engine's story runner (see
// engine/js/ui/story.js), with this explainer's diagram. Each step's
// state comes from its view (`at`); the scroll plays every state
// between the last step's and this one's, one change at a time (the
// path through states.js). A sweep through many rows gets more of the
// scroll, so each row's moves can be followed.

import { runStory } from '../../../engine/js/ui/story.js';
import { clamp01, easeQuad } from '../../../engine/js/ui/util/anim.js';
import { STATE, changed } from './states.js';
import { sceneAt, statePath } from './story.js';
import { Diagram } from './diagram.js';

// How much scroll a change gets.
const WEIGHT = { plan: 1.5, ev: 1, out: 2, sorted: 1.5, eof: 1.5 };
const weightOf = (a, b) => WEIGHT[changed(STATE[a], STATE[b])[0]] || 1;
// scroll per unit of weight, in vh; a step needing less plays in the
// engine's usual transition
const VH = 26, TRANSITION_VH = 40;

runStory({
  setup({ page, views, stepEls, camera }) {
    const diagram = new Diagram(page.svg);
    const scenes = views.map((_, i) => sceneAt(views, i));
    const plans = scenes.map((B, i) => {
      const A = scenes[i > 0 ? i - 1 : i];
      const path = statePath(A.at, B.at);
      const w = path.slice(1).map((k, j) => weightOf(path[j], k));
      const total = w.reduce((s, x) => s + x, 0);
      const scrub = total * VH > TRANSITION_VH;
      if (scrub) {
        stepEls[i].classList.add('step-scrub');
        stepEls[i].style.minHeight = `${Math.min(900, total * VH).toFixed(0)}vh`;
      }
      const cum = [0];
      for (const x of w) cum.push(cum[cum.length - 1] + x / Math.max(total, 1));
      return { path, cum, scrub };
    });

    return {
      diagram,
      render({ i, p, u, v, pv }) {
        camera.show(camera.between(i > 0 ? pv.camera : null, v.camera, p));
        const { path, cum, scrub } = plans[i];
        const x = clamp01(p);
        let j = 0;
        while (j < path.length - 2 && x > cum[j + 1]) j++;
        const f = clamp01((x - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]));
        diagram.draw(path[j], path[Math.min(j + 1, path.length - 1)], scrub ? f : easeQuad(f));
        // the focus box: the last step's leaves as the change starts;
        // this step's comes once it's played (a scrubbing step's, in
        // its last stretch)
        const pf = i > 0 ? pv.focus : null, start = scrub ? 0.92 : 0.6;
        if (v.focus && v.focus === pf) diagram.setFocus(v.focus, 1);
        else if (v.focus && (scrub ? u : p) >= start) diagram.setFocus(v.focus, clamp01(((scrub ? u : p) - start) / (scrub ? 0.04 : 0.3)));
        else if (pf && p < 0.3) diagram.setFocus(pf, 1 - p / 0.3);
        else diagram.setFocus(null, 0);
      },
      expose: { scenes, plans },
    };
  },
});
