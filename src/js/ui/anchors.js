// Whether a named anchor shows: the lids it needs are open, and the
// bubble it's on (if any) shows. Static anchors come from the
// explainer's ANCHORS; live ones bring their own needs.

import { D } from '../domain.js';

export function isAnchorVisible(id, open, bubbles, dynamicNeeds) {
  const a = D.ANCHORS[id];
  const needs = a ? a.needs : dynamicNeeds || [];
  if (!needs.every((n) => open.has(n))) return false;
  if (a && a.bubble && !bubbles.has(a.bubble)) return false;
  return true;
}
