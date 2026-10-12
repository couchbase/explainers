// The seam between the engine and an explainer. The engine's generic
// parts read everything explainer-specific from D, at call time; a
// page's entry point (or the build, or a test) picks the explainer with
// useDomain() before anything runs. See src/explainers/<id>/domain.js.

export let D = null;

export function useDomain(domain) {
  D = domain;
}
