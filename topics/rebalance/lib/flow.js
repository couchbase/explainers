// Max-flow, the way vbmap's graph.go finds it (augmentFlow): rounds of
// a breadth-first search from the source, labeling each vertex with its
// level, then depth-first searches for paths that step one level at a
// time through edges with room left, pushing as much as each path's
// tightest edge allows (Dinic's algorithm). Each path pushed is
// recorded, for the diagram to replay.
//
// A graph: vertices (names, in order), and edges {from, to, cap}. Every
// edge gets a reverse edge, with no room until flow is pushed forward,
// so a later path can undo part of an earlier one.

export function maxflow(vertices, edges, source, sink) {
  const adj = Object.fromEntries(vertices.map((v) => [v, []]));
  const all = [];
  for (const e of edges) {
    const fwd = { from: e.from, to: e.to, cap: e.cap, flow: 0, rev: null, real: true };
    const back = { from: e.to, to: e.from, cap: 0, flow: 0, rev: fwd, real: false };
    fwd.rev = back;
    adj[e.from].push(fwd);
    adj[e.to].push(back);
    all.push(fwd);
  }
  const room = (e) => e.cap - e.flow;
  const paths = [];
  for (;;) {
    // levels, breadth-first, through edges with room
    const level = { [source]: 0 }, queue = [source];
    while (queue.length) {
      const u = queue.shift();
      for (const e of adj[u]) if (room(e) > 0 && !(e.to in level)) { level[e.to] = level[u] + 1; queue.push(e.to); }
    }
    if (!(sink in level)) break;
    // paths, depth-first, one level at a time
    const next = Object.fromEntries(vertices.map((v) => [v, 0]));
    const dfs = (u, path) => {
      if (u === sink) return path;
      for (; next[u] < adj[u].length; next[u]++) {
        const e = adj[u][next[u]];
        if (room(e) > 0 && level[e.to] === level[u] + 1) {
          const p = dfs(e.to, [...path, e]);
          if (p) return p;
        }
      }
      return null;
    };
    for (let p = dfs(source, []); p; p = dfs(source, [])) {
      const push = Math.min(...p.map(room));
      for (const e of p) { e.flow += push; e.rev.flow -= push; }
      paths.push({ vertices: [source, ...p.map((e) => e.to)], push });
    }
  }
  const flow = Object.fromEntries(all.map((e) => [`${e.from}>${e.to}`, e.flow]));
  return { flow, paths, total: paths.reduce((s, p) => s + p.push, 0) };
}
