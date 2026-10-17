// What a state shows of the rows' journey, with no DOM: the plan's
// operators and their registers, where the row in flight is and what
// its values are (a slice of the record buffer, or a copy), the
// counters, the heap, and the output.

import { ORDERS, SORTED, outputRow, LIMIT } from '../lib/query.js';
import { EVENTS, PLANS } from './states.js';

// The operators, by id, as cbq's planner names them and as n1k1 does,
// with each one's params (as .explain prints them) and its labels.
const Q = (f) => `(\`orders\`.\`${f}\`)`;
export const OPS = {
  strip: { cbq: null, n1k1: 'project', params: 'labelPath, labelPath, labelPath', labels: ['.["id"]', '.["customer"]', '.["total"]'] },
  order: { cbq: 'Order', cbqParams: `${Q('total')} DESC`, n1k1: 'order-offset-limit', params: `${Q('total')} desc`, labels: ['.["id"]', '.["customer"]', '.["total"]', '.["orders"]'] },
  proj: { cbq: 'InitialProject', cbqParams: 'id, customer, total', n1k1: 'project', params: `${Q('id')}, ${Q('customer')}, ${Q('total')}`, labels: ['.["id"]', '.["customer"]', '.["total"]'] },
  filter: { cbq: 'Filter', cbqParams: `(200 < ${Q('total')})`, n1k1: 'filter', params: `(200 < ${Q('total')})`, labels: ['.["orders"]', '^id'] },
  fetch: { cbq: 'Fetch', cbqParams: 'orders', n1k1: null },
  scan: { cbq: 'PrimaryScan', cbqParams: 'orders', n1k1: 'datastore-scan-records', params: '.["orders"] ^id', labels: ['.["orders"]', '^id'] },
};
export const OP_IDS = Object.keys(OPS);
const after = (s, p) => PLANS.indexOf(s.plan) >= PLANS.indexOf(p);

// An operator, in a state: its slot (0 is the top), whether it's
// shown, its name and params, and its labels.
export function opLook(s, id) {
  const op = OPS[id], n1k1 = after(s, 'n1k1');
  const slot = { strip: 0, order: 1, proj: 2, filter: 3, fetch: 3, scan: 4 }[id] - (!after(s, 'nofetch') && id !== 'scan' && id !== 'fetch' ? 1 : 0);
  let shown = after(s, 'cbq');
  if (id === 'fetch') shown = s.plan === 'cbq';
  if (id === 'strip') shown = after(s, 'strip');
  // (the project: the doc carried through, once augmented)
  const aug = id === 'proj' && after(s, 'aug');
  const labels = n1k1 && op.labels ? (aug ? [...op.labels, '.["orders"]'] : op.labels) : [];
  return {
    slot, o: shown ? 1 : 0, n1k1,
    title: n1k1 ? op.n1k1 : op.cbq,
    params: n1k1 ? (aug ? `${op.params}, labelPath` : op.params) : op.cbqParams,
    labels,
  };
}

// a doc's bytes, shortened to fit a register chip
export const short = (t, n = 12) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// The row in flight: which operator holds it, its values (each a
// slice of the record buffer, `slice`, with its byte range, or a
// `copy`), the filter's test, and the bytes it reads.
export function rowAt(s) {
  if (s.out > 0) {
    // (a sorted row, decoded from its copy on the heap)
    const o = SORTED[s.out - 1];
    const vals = [o.id.bytes, o.customer.bytes, o.total.bytes].map((t) => ({ t, kind: 'copy' }));
    return { op: 'strip', order: o, vals, from: { op: 'order', vals: [...vals, { t: short(o.doc), kind: 'copy' }] } };
  }
  if (s.ev < 0 || s.eof) return null;
  const e = EVENTS[s.ev], o = ORDERS[e.file], whole = [0, o.doc.length];
  const doc = { t: short(o.doc), kind: 'slice', range: whole };
  if (e.stage === 'read') return { op: 'scan', order: o, vals: [doc, { t: `"${o.stem}"`, kind: 'copy' }] };
  if (e.stage === 'filter') {
    return {
      op: 'filter', order: o, vals: [doc, { t: `"${o.stem}"`, kind: 'copy' }],
      test: `200 < ${o.total.bytes} → ${o.pass}`, pass: o.pass, reads: [o.total.start, o.total.end],
    };
  }
  const vals = [
    { t: o.id.bytes, kind: 'copy' }, { t: o.customer.bytes, kind: 'copy' },
    { t: o.total.bytes, kind: 'slice', range: [o.total.start, o.total.end] }, doc,
  ];
  return { op: e.stage === 'project' ? 'proj' : 'order', order: o, vals };
}

// The file whose doc the record buffer holds, if any.
export function bufferAt(s) {
  if (s.ev >= 0) return { order: ORDERS[EVENTS[s.ev].file], read: true };
  return s.peek ? { order: ORDERS[0], read: false } : null;
}

// The counters, as n1k1's stats count them: rows out of the scan, in
// and out of the filter and the sort.
export function countersAt(s) {
  const done = EVENTS.slice(0, s.ev + 1);
  const n = (stage) => done.filter((e) => e.stage === stage).length;
  return {
    scan: { out: n('read') },
    filter: { in: n('filter'), out: done.filter((e) => e.stage === 'filter' && ORDERS[e.file].pass).length },
    order: { in: n('order'), out: s.out },
  };
}

// The files read so far, each with its total and whether it passed
// (once the filter's seen it).
export function filesAt(s) {
  const done = EVENTS.slice(0, s.ev + 1);
  return ORDERS.map((o, i) => ({
    read: done.some((e) => e.file === i),
    tested: done.some((e) => e.file === i && e.stage === 'filter'),
    current: !s.eof && s.ev >= 0 && EVENTS[s.ev].file === i,
  }));
}

// The heap's rows, in the order they're in: as pushed, or sorted.
export function heapAt(s) {
  const pushed = EVENTS.slice(0, s.ev + 1).filter((e) => e.stage === 'order').map((e) => ORDERS[e.file]);
  return s.sorted ? [...SORTED] : pushed;
}

export const outputAt = (s) => SORTED.slice(0, s.out).map(outputRow);
export { LIMIT };
