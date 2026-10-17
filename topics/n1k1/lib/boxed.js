// What the 03-boxed explainer shows of n1k1's two expression lanes, from
// their real run (boxed.json, from tools/boxed-golden): 01-query's
// filter, `orders.total > 200`, over each order, in the byte lane (n1k1's
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

// GROUP BY: SELECT customer, SUM(total), COUNT(*) ... GROUP BY customer.
// cbq's steps per row (its group key, and each aggregate's
// CumulateInitial), measured; n1k1's group op, measured; and n1k1's
// state for each group, row by row (SUM's 8 bytes, COUNT's 8).
export const GROUP = GOLDEN.group;
// the groups, in the order they first appear
export const CUSTOMERS = [...new Set(GROUP.steps.map((s) => s.customer))];

// ORDER BY total DESC, and orders JOIN customers ON o.customer = c.id
// (a hash join): cbq's steps, measured by stage; n1k1's ops, at setup
// and per row
export const ORDER = GOLDEN.order;
export const JOIN = GOLDEN.join;

// A window function, SUM(total) OVER (PARTITION BY customer ORDER BY
// id): cbq's steps per row, measured; n1k1's window's own cost per row
// (its query with the window, less without); and the running totals,
// from n1k1, row by row
export const WINDOW = GOLDEN.window;
// (each row's total and running total as n1k1 printed them, as text)
const field = (r, k) => r.match(new RegExp(`"${k}":([^,}]+)`))[1];
export const WINDOW_ROWS = WINDOW.rows.map((r) => ({ ...JSON.parse(r), totalText: field(r, 'total'), runningText: field(r, 'running') }));
