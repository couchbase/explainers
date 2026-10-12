// The marker during a told root swap (see SWAP_PHASES in snapstack.js).

import { between } from '../../js/ui/transitions.js';
import { clamp01 } from '../../js/ui/util/anim.js';
import { swapShift, swapTravel, swapPart, ADD_TRAVEL } from './snapstack.js';

// The marker while the introducer swaps in a new root (see
// SWAP_PHASES), from its place at step `base` (before the swap) to its
// place at step i: it waits for the 'add' phase, travels then, and a
// place on the root moves with the new root as it lifts and settles.
// Null if the marker isn't shown at both ends.
export function swapMarker(views, tokenAt, i, base, s) {
  const cur = views[i].token === 'hide' ? null : tokenAt.get(i) || null;
  const prev = views[base].token === 'hide' ? null : tokenAt.get(base) || null;
  if (!cur || !prev) return null;
  const [dx, dy] = swapShift(s);
  const onRoot = (t) => t.st === 'cell' || t.st === 'bar';
  const dest = onRoot(cur) ? { ...cur, p: [cur.p[0] + dx, cur.p[1] + dy] } : cur;
  const from = onRoot(prev) ? { ...prev, p: [prev.p[0] + dx, prev.p[1] + dy] } : prev;
  // Already in the root (a merge): it moves over to the merged segment
  // as the ones it replaces drop out, with the other bars as they close
  // up the gaps. Its label steps aside while the new root is built, and
  // comes back only when the merged chip, whose label it takes over,
  // gives way to the new root's bar.
  const hop = onRoot(prev) && onRoot(cur) && prev.key !== cur.key;
  const e = hop ? clamp01((swapPart(s, 'drop') - 0.6) / 0.4) : swapTravel(s);
  const f = between(from, dest, e);
  // Landing on a bar that's new in this root: its square gives way only
  // as the bar appears.
  if (!onRoot(prev) && onRoot(cur)) f.t.barMix = clamp01((swapPart(s, 'add') - ADD_TRAVEL) / (1 - ADD_TRAVEL));
  if (hop) f.t.labelO = swapPart(s, 'solid') > 0 ? swapPart(s, 'solid') : 1 - swapPart(s, 'cover');
  return f;
}

