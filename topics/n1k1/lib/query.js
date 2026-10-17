// The story's query, worked through in JS on the real example files
// (runs.json, from the real n1k1: tools/query-golden): each order's
// `total` as the bytes it is in its file, the filter, the sort, and
// the rows n1k1 prints. test/query.test.mjs checks this against what
// n1k1 printed, so the explainer can't drift from the real thing.

import GOLDEN from './runs.json' with { type: 'json' };

export const RUN = GOLDEN;
export const LIMIT = 200;

// A field's value in a doc's JSON text: its bytes, and where they are
// (for strings, the quotes included).
export function fieldAt(doc, name) {
  const key = `"${name}":`;
  const k = doc.indexOf(key);
  if (k < 0) return null;
  const start = k + key.length;
  let end = start;
  if (doc[start] === '"') end = doc.indexOf('"', start + 1) + 1;
  else while (end < doc.length && !',}]'.includes(doc[end])) end++;
  return { start, end, bytes: doc.slice(start, end) };
}

// The orders, as the scan reads them: in file name order.
export const ORDERS = GOLDEN.files.map((f) => {
  const id = fieldAt(f.doc, 'id'), customer = fieldAt(f.doc, 'customer'), total = fieldAt(f.doc, 'total');
  return {
    name: f.name, stem: f.name.replace(/\.json$/, ''), doc: f.doc,
    id, customer, total,
    // (the filter: total > 200, as numbers)
    pass: LIMIT < parseFloat(total.bytes),
  };
});

// The rows that pass, in the order they reach the heap; and sorted,
// by total, descending.
export const PASSED = ORDERS.filter((o) => o.pass);
export const SORTED = [...PASSED].sort((a, b) => parseFloat(b.total.bytes) - parseFloat(a.total.bytes));

// A row as n1k1 prints it: the projected values' bytes, concatenated.
export const outputRow = (o) => `{"id":${o.id.bytes},"customer":${o.customer.bytes},"total":${o.total.bytes}}`;
