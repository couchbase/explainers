// The vbucket maps the rebalance explainers show. vbmap's are real:
// made by the vbmap tool itself (tools/vbmap-golden, into runs.json).
// The naive one is the story's foil, made here: actives dealt evenly,
// each node's replicas on the next node over.

import RUNS from './runs.json' with { type: 'json' };

export { RUNS };

// A run's map, with node names: vbucket -> [active, replica, ...].
export const mapOf = (run) => RUNS[run].map.map((chain) => chain.map((i) => RUNS[run].nodes[i]));

// The naive deal on the same nodes: vbmap's actives, each with its
// replica on the next node (a -> b -> c -> d -> a).
export function naiveMap(run) {
  const nodes = RUNS[run].nodes;
  return mapOf(run).map(([a]) => [a, nodes[(nodes.indexOf(a) + 1) % nodes.length]]);
}

// Couchbase's vbucket for a key: crc32, the top 15 bits of the low 32,
// mod the number of vbuckets (libcouchbase's vbucket_get_vbucket_by_key).
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(s) {
  let c = 0xffffffff;
  for (const b of new TextEncoder().encode(s)) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const vbucketOf = (key, numVBuckets) => ((crc32(key) >>> 16) & 0x7fff) % numVBuckets;

// Who serves what when some nodes are down: each vbucket's first copy
// on a node that's up (its active, or a promoted replica); a vbucket
// with no copy up is lost.
export function serving(map, down = []) {
  const serves = {}, lost = [];
  map.forEach((chain, v) => {
    const n = chain.find((x) => !down.includes(x));
    if (n) serves[n] = (serves[n] || 0) + 1; else lost.push(v);
  });
  return { serves, lost };
}
