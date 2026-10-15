// The plumbing: the max-flow on act 3's network gives the same R (how
// many of each node's actives have their replica on each other node)
// as vbmap itself printed, and as its map has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNS } from '../../lib/maps.js';
import { MAPS } from '../deals.js';
import { R_FLOW, FLOW, PATHS } from '../plumbing.js';
import { NODES } from '../layout.js';

// vbmap's "Final map R" table, from its diagnostics
function vbmapR(run) {
  const lines = RUNS[run].diag.split('\n'), at = lines.findIndex((l) => l.includes('Final map R'));
  const cols = lines[at + 1].split('|')[2].trim().split(/\s+/).map(Number);
  const out = {};
  for (const l of lines.slice(at + 5)) {
    const m = l.match(/^\s+(\d+) \|\s+\d+ \|([\d\s]+)\|/);
    if (!m) break;
    const row = m[2].trim().split(/\s+/).map(Number);
    out[RUNS[run].nodes[+m[1]]] = Object.fromEntries(cols.map((c, i) => [RUNS[run].nodes[c], row[i]]));
  }
  return out;
}

test("the flow's R is vbmap's R", () => {
  assert.deepEqual(R_FLOW, vbmapR('maxflow-story4'));
});

test("the flow's R is what vbmap's map has", () => {
  const fromMap = Object.fromEntries(NODES.map((i) => [i, Object.fromEntries(NODES.map((j) => [j, MAPS.vbmap.filter(([a, r]) => a === i && r === j).length]))]));
  assert.deepEqual(R_FLOW, fromMap);
});

test('the flow is the most the pipes can carry, path by path', () => {
  assert.equal(FLOW.total, 32);
  assert.equal(PATHS.reduce((s, p) => s + p.push, 0), 32);
});
