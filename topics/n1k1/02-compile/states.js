// The diagram's states, in story order. Each is the whole picture.
// Between two neighbors, exactly one thing changes (test/states.test.mjs
// checks), so the scroll from one step to the next plays one change at
// a time.
//
// A state's fields:
//   panel   the code panel: 'none'; 'src' (the filter's source, which
//           turns into intermed's); or 'emit' (the compiled query's Go)
//   kinds   how many kinds of source line are marked, in order: early,
//           late, hide, captured
//   inter   how many kinds have turned into intermed's lines, in order:
//           late (into Emit calls), hide (and comments: empty Emits),
//           captured (into EmitCaptured calls)
//   emit    how many of the compiler's groups of lines are printed (see
//           GROUPS in ../lib/compile.js): project, filter, expr, fuse,
//           scan
//   rows    both engines' rows are shown
//   done    the summary: what's baked into the compiled Go, marked

const START = { panel: 'none', kinds: 0, inter: 0, emit: 0, rows: false, done: false };
export const KINDS = ['early', 'late', 'hide', 'captured'];
// which kind of line each inter level turns, and when it's marked
export const INTER = [['late'], ['hide', 'comment'], ['captured']];

const CHANGES = [
  ['start', {}],
  ['src', { panel: 'src' }],
  ...KINDS.map((k, i) => [`kind.${k}`, { kinds: i + 1 }]),
  ...INTER.map((ks, i) => [`inter.${ks[0]}`, { inter: i + 1 }]),
  ['swap', { panel: 'emit' }],
  ...['project', 'filter', 'expr', 'fuse', 'scan'].map((g, i) => [`emit.${g}`, { emit: i + 1 }]),
  ['rows', { rows: true }],
  ['done', { done: true }],
];

export const STATES = [];
{
  let s = START;
  CHANGES.forEach(([key, change], i) => {
    s = { ...s, ...change };
    STATES.push({ key, i, ...s });
  });
}
export const STATE = Object.fromEntries(STATES.map((s) => [s.key, s]));

export const changed = (a, b) => Object.keys(START).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

export function statePath(a, b) {
  const sa = STATE[a], sb = STATE[b];
  if (!sa || !sb || sb.i <= sa.i) return [a, b];
  return STATES.slice(sa.i, sb.i + 1).map((s) => s.key);
}
