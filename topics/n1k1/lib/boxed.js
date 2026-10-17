// What the 03-boxed explainer shows of n1k1's two expression lanes, from
// their real run (boxed.json, from tools/boxed-golden): 01-query's
// filter, `200 < orders.total`, over each order, in the byte lane (n1k1's
// native code) and the boxed lane (cbq's Evaluate); each lane's answer,
// its allocations per row, and, for the boxed lane, where each one
// happened; and what each total becomes, boxed and written back.

import GOLDEN from './boxed.json' with { type: 'json' };
import { ORDERS } from './query.js';

export const BOXED = GOLDEN;
export const ROWS = GOLDEN.rows.map((r, i) => ({ ...r, order: ORDERS[i] }));
// the story's row: order-1003, the first that passes
export const HERO = ROWS.find((r) => r.file === 'order-1003.json');
export const STAGES = ['convert', 'evaluate', 'compare', 'write'];
// the hero's boxed allocations, each with its stage, what it is, how
// many, and its bytes
export const ALLOCS = HERO.allocs;
export const bytesOf = (r) => r.allocs.reduce((s, a) => s + a.bytes, 0);
// the totals whose text changes, boxed and written back
export const CHANGED = ROWS.filter((r) => r.totalBoxed !== r.order.total.bytes);
