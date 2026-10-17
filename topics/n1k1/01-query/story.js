// The 01-query explainer's story vocabulary, for the engine. There's
// no simulation: a step's state is one of the diagram's states (`at`,
// see states.js). Facts, for `expect`, come from the real n1k1's run of
// the story's query (../lib/runs.json, from tools/query-golden) and
// the example files it read.

import { STATES, STATE, statePath } from './states.js';
import { RUN, ORDERS, PASSED, SORTED } from '../lib/query.js';

// the regions a step's `focus` can box (see diagram.js)
export const FOCUS_REGIONS = ['query', 'query.where', 'files', 'dir', 'buffer', 'plan', 'heap', 'out', 'prepared', 'op.0', 'op.1', 'op.2', 'op.3', 'op.4'];

export const VIEW_KEYS = {
  // the diagram's state; carried over, and each move counts as the step's change
  at: { values: STATES.map((s) => s.key), sticky: true, initial: 'start', counts: () => true },
  // a box around what to look at, for this step only: a reading aid,
  // so not the step's one change
  focus: { values: FOCUS_REGIONS },
};

// a stats line's numbers: "filter 20 3" from "  filter    20    3"
const stat = (name) => {
  const l = RUN.stats.find((x) => x.trim().startsWith(`${name} `));
  return l ? l.trim().split(/\s+/).slice(1).join(' ') : null;
};
function facts() {
  const out = {
    files: ORDERS.length,
    customers: RUN.customers.length,
    keyspaces: RUN.tables.filter((l) => /json · \d+ file/.test(l)).length,
    passed: PASSED.length,
    rows: RUN.rows.length,
    'plan.ops': RUN.plan.length,
    'plan.top': RUN.plan[0].trim().split(/\s+/)[0],
    'plan.filter': RUN.plan.find((l) => l.trim().startsWith('filter')).trim().replace(/^filter\s+/, ''),
    'stats.scan': stat('datastore-scan-records'),
    'stats.filter': stat('filter'),
    'stats.order': stat('order-offset-limit'),
    'doc1001.bytes': ORDERS[0].doc.length,
    'sorted': SORTED.map((o) => o.total.bytes).join(','),
    'passed.ids': PASSED.map((o) => o.id.bytes.replace(/"/g, '')).join(','),
  };
  for (const o of ORDERS) {
    out[`${o.stem}.total`] = o.total.bytes;
    out[`${o.stem}.range`] = `${o.total.start}:${o.total.end}`;
  }
  // the rows, as n1k1 printed them
  RUN.rows.forEach((r, i) => (out[`row${i + 1}`] = r));
  return out;
}
export const FACTS = facts();

export const EXPECTATION_PARAMS = {
  fact: {
    valid: (arg) => /^[\w.-]+=.+$/.test(arg) && arg.split('=')[0] in FACTS,
    check: (_m, arg) => {
      const [k, v] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
      return String(FACTS[k]) === v;
    },
  },
};
export const factModel = () => ({});

export function sceneAt(views, i) {
  return { at: views[i].at, state: STATE[views[i].at] };
}
export { statePath };
