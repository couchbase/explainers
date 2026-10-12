// Hints for routing the marker in this explainer's diagram (the engine
// routes it along the corridors between boxes; see transitions.js).

import { STATIONS } from './layout.js';

// Trips that pass through a station on the way.
export const VIA = {
  // a segment becomes a file via the persister, then the introducer
  'cell>bar': ['persisting', 'written', 'fileIntroducing'],
  'merging>mergeIntroducing': ['mergeWritten'],
};

// Hops that follow a drawn arrow instead of the general rule: our new
// file rides the persister's "introduce ↑" arrow to the introducer,
// straight on across to its 'merges' channel, then drops just below it.
export const HOPS = {
  'written>fileIntroducing': () => [STATIONS.introducing, [STATIONS.fileIntroducing[0], STATIONS.introducing[1]]],
  // the merger's result, up its arrow on the right, into the introducer
  'mergeWritten>mergeIntroducing': () => [[668, 752], [STATIONS.mergeIntroducing[0], 752]],
};

