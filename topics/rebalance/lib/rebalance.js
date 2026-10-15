// How ns_server picks a rebalance's new map (mb_map.erl), ported: it
// asks vbmap for maps, seats each map's chains on the vbuckets so as
// few copies move as it can (simple_minimize_moves), scores each by
// what must move (vbucket_movements), and keeps the cheapest.
//
// A map: vbucket -> chain, a chain being [active, replica, ...] of
// node names. Erlang compares node names (atoms) as strings, and a
// missing copy is the atom 'undefined', so it's the string here too.

export const UNDEFINED = 'undefined';

const cmpAtom = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

// listcmp: compares two lists element by element, up to the shorter's
// length; 0 if one is a prefix of the other.
export function listcmp(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = cmpAtom(a[i], b[i]);
    if (c) return c;
  }
  return 0;
}

// Erlang's order on lists: element by element, then the shorter first.
const termcmp = (a, b) => listcmp(a, b) || a.length - b.length;

// genmerge: walks two sorted lists together, pairing items cmp calls
// equal; returns the pairs, and the two lists' leftovers.
export function genmerge(cmp, L1, L2) {
  const pairs = [], rest1 = [], rest2 = [];
  let i = 0, j = 0;
  while (i < L1.length && j < L2.length) {
    const c = cmp(L1[i], L2[j]);
    if (c < 0) rest1.push(L1[i++]);
    else if (c > 0) rest2.push(L2[j++]);
    else pairs.push([L1[i++], L2[j++]]);
  }
  return { pairs, rest1: [...rest1, ...L1.slice(i)], rest2: [...rest2, ...L2.slice(j)] };
}

// map_strip: each chain cut to numCopies, nodes leaving made undefined.
const mapStrip = (map, numCopies, keepNodes) =>
  map.map((chain) => chain.slice(0, numCopies).map((n) => (keepNodes.includes(n) ? n : UNDEFINED)));

// simple_minimize_moves: seats the new chains on the vbuckets in passes.
// Pass `shift` matches a vbucket whose current chain, less its first
// `shift` copies, starts the new chain: pass 0, the same chain (nothing
// moves); pass 1, its replica first (a replica becomes the active); the
// last pass, anything (whatever's left). Returns the new map, and each
// vbucket's pass.
export function simpleMinimizeMoves(map, chains, numCopies, keepNodes) {
  let left = mapStrip(map, numCopies, keepNodes).map((chain, v) => ({ v, chain }));
  let cands = [...chains].sort(termcmp);
  const out = [], pass = [];
  for (let shift = 0; shift <= numCopies; shift++) {
    const sorted = [...left].sort((x, y) => termcmp(x.chain.slice(shift), y.chain.slice(shift)));
    const { pairs, rest1, rest2 } = genmerge((x, cand) => listcmp(x.chain.slice(shift), cand), sorted, cands);
    for (const [{ v }, chain] of pairs) { out[v] = chain; pass[v] = shift; }
    left = rest1;
    cands = rest2;
  }
  return { map: out, pass };
}

// vbucket_movements: what a move from map src to map dst costs, as
// ns_server scores it: [copies built from scratch (a node in the new
// chain that isn't in the old), takeovers (a new active)]. Compared in
// that order.
export function vbucketMovements(src, dst) {
  let scratch = 0, takeovers = 0;
  src.forEach((s, v) => {
    const d = dst[v];
    if (s[0] !== d[0]) takeovers++;
    for (const n of d) if (n !== UNDEFINED && !s.includes(n)) scratch++;
  });
  return [scratch, takeovers];
}
export const scoreLess = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

// maybe_simple_minimize_moves: the seated map, unless vbmap's own was
// cheaper.
export function maybeMinimize(current, chains, keepNodes) {
  const asDealt = vbucketMovements(current, chains);
  const seated = simpleMinimizeMoves(current, chains, chains[0].length, keepNodes);
  const score = vbucketMovements(current, seated.map);
  return scoreLess(asDealt, score) ? { map: chains, score: asDealt, asDealt } : { map: seated.map, pass: seated.pass, score, asDealt };
}

// generate_map_new, less the maps from history: each of vbmap's maps,
// seated, scored; the cheapest (the first, of equals) wins.
export function pickMap(current, generated, keepNodes) {
  const tried = generated.map((g) => ({ ...g, ...maybeMinimize(current, g.map, keepNodes) }));
  const best = tried.reduce((b, t) => (scoreLess(t.score, b.score) ? t : b));
  return { tried, best };
}
