// The 03-moving explainer's story vocabulary, for the engine. There's
// no simulation running in the page: a step's state is a moment of one
// of the runs (`at`: "one@270") and what the panel shows (`panel`).
// Facts, for `expect`, come from the same runs, made by the simulation
// of blance's orchestrator that its golden cases check against the
// real one.

import { RUNS, MOMENTS, PARTITIONS, NODES, stateAt, noPrimary, busy } from './scenarios.js';

export const PANELS = ['none', 'plans', 'timeline'];

export const VIEW_KEYS = {
  at: { values: Object.keys(MOMENTS), sticky: true, initial: 'one@0', counts: () => true },
  panel: { values: PANELS, sticky: true, initial: 'none', counts: () => true },
};

const movesText = (ms) => ms.map((m) => (m.op === 'del' ? `del ${m.node}` : `${m.op} ${m.node}:${m.state}`)).join(', ');
function facts() {
  const out = {};
  for (const r of Object.values(RUNS)) {
    out[`${r.id}.end`] = r.end;
    out[`${r.id}.batches`] = r.batches.length;
    out[`${r.id}.rounds`] = r.rounds.length;
    out[`${r.id}.moves`] = Object.values(r.plans).reduce((n, ms) => n + ms.length, 0);
    out[`${r.id}.moved`] = PARTITIONS.filter((p) => r.plans[p].length).length;
    for (const p of PARTITIONS) out[`${r.id}.plan.${p}`] = movesText(r.plans[p]);
    const b = busy(r.id);
    for (const n of NODES) out[`${r.id}.busy.${n}`] = b[n];
    for (const [p, [from, to]] of Object.entries(noPrimary(r.id))) out[`${r.id}.noPrimary.${p}`] = `${from}-${to}`;
    out[`${r.id}.noPrimary`] = Object.keys(noPrimary(r.id)).join(',') || 'none';
    // each moment: what each node's mover is doing (a batch's moves, or idle)
    for (const t of r.times) {
      const { flying } = stateAt(r.id, t);
      for (const n of NODES) {
        const f = flying.filter((x) => x.node === n && x.progress === 0);
        if (f.length) out[`${r.id}@${t}.starts.${n}`] = f.map((x) => `${x.op} ${x.p}`).join(',');
      }
    }
    // each round: who's offered what, and who's waiting on a move in flight
    for (const rd of r.rounds) {
      out[`${r.id}.round@${rd.t}`] = rd.offers.map((o) => `${o.node}:${o.partitions.join('+')}${o.waiting ? ' waits' : ''}${o.blocked ? ' queued' : ''}`).join(', ');
    }
  }
  return out;
}
export const FACTS = facts();

export const EXPECTATION_PARAMS = {
  fact: {
    valid: (arg) => /^[\w.@]+=.+$/.test(arg) && arg.split('=')[0] in FACTS,
    check: (_m, arg) => {
      const [k, v] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
      return String(FACTS[k]) === v;
    },
  },
};

export const factModel = () => ({});

export function sceneAt(views, i) {
  const v = views[i];
  return { at: v.at, ...MOMENTS[v.at], panel: v.panel };
}

// Callout ends the page works out: the timeline's "now" line.
export const DYNAMIC_ANCHORS = ['now'];
