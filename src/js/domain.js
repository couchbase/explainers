// The seam between the engine and an explainer. The engine's generic
// parts read everything explainer-specific from D, at call time; a
// page's entry point (or the build, or a test) picks the explainer with
// useDomain() before anything runs. See src/explainers/<id>/domain.js.
//
// An explainer exports what it uses. These are the defaults for the
// optional parts: with no simulation (no makeModel), no SIM
// directives and no config; no marker routing (stations, boxes,
// corridors, vias, hops); no charts and no token modes.

export let D = null;

const DEFAULTS = {
  SIM: null,
  EXPECTATIONS: {},
  EXPECTATION_PARAMS: {},
  VIEW_KEYS: {},
  DYNAMIC_ANCHORS: [],
  CHART_IDS: [],
  TOKEN_MODES: [],
  STATIONS: {},
  BOXES: {},
  CORRIDOR_XS: [],
  CORRIDOR_YS: [],
  BOX_GAP: 10,
  VIA: {},
  HOPS: {},
};

export function useDomain(domain) {
  D = { ...DEFAULTS, ...domain };
}
