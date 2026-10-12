// The seam between the engine and an explainer: the engine imports
// everything explainer-specific from here. There's one explainer so
// far; with more, the build would point this at the one it's building.

export * from '../explainers/scorch-goroutines/domain.js';
