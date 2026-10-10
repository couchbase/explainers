// The overlay of lines across the page: the story's callout (from the
// highlighted phrase into the diagram) and the charts' leader lines.
// Both share one shape: a horizontal run, a diagonal, then a horizontal
// run into the target, ending in a dot.

import { elbowPath } from './util/anim.js';

export class Overlay {
  constructor(svg) { this.svg = svg; this.out = ''; }
  begin() { this.out = ''; }
  end() { this.svg.innerHTML = this.out; }

  _line(cls, d, end, r, opacity) {
    if (opacity <= 0.01) return;
    this.out += `<g style="opacity:${opacity.toFixed(3)}"><path class="${cls}" d="${d}"/>` +
      `<circle class="${cls}-end" cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="${r}"/></g>`;
  }

  // From under the phrase's last line box, to the story column's edge
  // (edgeX), then into target (screen coordinates).
  callout(phraseRect, edgeX, target, opacity) {
    const [tx, ty] = target;
    const end = [tx - 4, ty];
    this._line('callout', elbowPath(phraseRect.left, phraseRect.bottom + 2, edgeX, end[0], ty, 22), end, 3.5, opacity);
  }

  // From a chart card's left edge (x0, y0) into target.
  leader(x0, y0, target, opacity) {
    const end = [target[0] + 5, target[1]];
    this._line('leader', elbowPath(x0, y0, x0 - 12, end[0], end[1], 12), end, 2.5, opacity);
  }
}
