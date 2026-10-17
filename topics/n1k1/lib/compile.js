// What the 02-compile explainer shows of n1k1's compiler, from its real
// run (compile.json, from tools/compile-golden): the interpreter's
// source for an operator, line by line, beside what intermed_build
// makes of each line; and the Go the compiler emits for the plan,
// tidied for reading, each line tagged with the operator that printed
// it. test/compile.test.mjs checks the pairing and the tags.

import GOLDEN from './compile.json' with { type: 'json' };

export const COMPILE = GOLDEN;
export const funcNamed = (name) => GOLDEN.funcs.find((f) => f.name === name);

// (a tab, as 3 spaces)
const untab = (s) => s.replace(/\t/g, '   ');

// intermed's lines, as statements: an Emit(`...`) spans its string's
// lines; anything else is one line.
export function statements(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^Emit(Lift)?\(`/.test(l) && !/`(, [^`]*)?\)\s*$/.test(l.replace(/^Emit(Lift)?\(`/, ''))) {
      let j = i + 1;
      while (j < lines.length && !/`(, [^`]*)?\)\s*$/.test(lines[j])) j++;
      out.push(lines.slice(i, j + 1).join('\n'));
      i = j;
    } else out.push(l);
  }
  return out;
}

// A statement, for reading: an Emit's string trimmed of its indent and
// newline, on one line.
export function readable(st) {
  const m = st.match(/^(Emit|EmitLift)\(`([\s\S]*)`(.*)\)\s*$/);
  if (m) return `${m[1]}(\`${m[2].trim()}\`${m[3]})`;
  return untab(st);
}

// A source line's kind:
//   early     marked `// !lz`: run once, as the plan is set up (also
//             the first line of a `// !lz` statement that goes on to a
//             second)
//   late      the per-row code: its names start with lz
//   hide      marked `<== genCompiler:hide`: the interpreter's only
//   captured  marked `<== emitCaptured`: a call to code from elsewhere
//   lift      marked `<== varLift`: a var to hoist out
//   go        the function's own Go: its signature and closing brace
//   comment, blank
export function kindOf(line, next = '') {
  const t = line.trim();
  if (!t) return 'blank';
  if (t.startsWith('//')) return 'comment';
  if (line.includes('genCompiler:hide')) return 'hide';
  if (line.includes('<== emitCaptured')) return 'captured';
  if (line.includes('<== varLift')) return 'lift';
  if (line.includes('// !lz') || (/:=\s*$/.test(t) && next.includes('// !lz'))) return 'early';
  return 'late';
}

// An operator's lines: its source, its kind, and intermed's statement
// for it (one each, in order).
export function pairs(name) {
  const f = funcNamed(name), st = statements(f.intermed);
  // (its signature: to the line that opens its body)
  const sig = f.src.findIndex((l) => /\) \{$/.test(l));
  return f.src.map((src, i) => ({
    n: f.line + i,
    src: untab(src),
    kind: i <= sig || i === f.src.length - 1 ? 'go' : kindOf(src, f.src[i + 1]),
    inter: readable(st[i] ?? ''),
  }));
}

// ---- the emitted Go ----

// Its lines, trimmed, with no blanks.
const RAW = GOLDEN.emitted.join('').split('\n').map((l) => l.trim()).filter(Boolean);

// Each line's origin: the operator whose intermed code printed it.
//   project, filter, expr (the filter's comparison), scan
// and its group: when, in the compiler's walk, it's printed.
//   project   the project's lifted vars and its scope
//   filter    the filter's frame (with its two holes)
//   expr      the comparison, into the filter's first hole (and its
//             lifted vars)
//   fuse      the project's per-row code, into the filter's second hole
//   scan      the scan's loop
function tag() {
  const at = (re, from = 0) => {
    const i = RAW.findIndex((l, k) => k >= from && re.test(l));
    if (i < 0) throw new Error(`emitted: no line like ${re}`);
    return i;
  };
  const top = at(/^if true \{$/), inner = top + 1;
  const exprAt = at(/^_, _, _ = lzCmpLT/), truthy = at(/^if base\.ValTruthy\(lzVal\) \{$/);
  const projEnd = at(/^lzYieldValsOrig\(lzValsOut\)$/), scanAt = at(/^lzJsonsData := /), scanEnd = at(/^lzYieldErr\(lzScanner\.Err\(\)\)$/);
  if (RAW[inner] !== 'if true {') throw new Error('emitted: no filter scope');
  return RAW.map((text, i) => {
    let origin, group;
    if (i < top) {
      origin = /_F_FF/.test(text) ? 'expr' : 'project';
      group = origin === 'expr' ? 'expr' : 'project';
    } else if (i === top || i === RAW.length - 1) [origin, group] = ['project', 'project'];
    else if (i < exprAt) [origin, group] = ['filter', 'filter'];
    else if (i < truthy) [origin, group] = ['expr', 'expr'];
    else if (i === truthy) [origin, group] = ['filter', 'filter'];
    else if (i <= projEnd) [origin, group] = ['project', 'fuse'];
    else if (i < scanAt) [origin, group] = ['filter', 'filter'];
    else if (i <= scanEnd) [origin, group] = ['scan', 'scan'];
    else [origin, group] = ['filter', 'filter'];
    return { i, text, origin, group };
  });
}
export const EMITTED = tag();

// The groups, in the order the compiler prints them.
export const GROUPS = ['project', 'filter', 'expr', 'fuse', 'scan'];
// the filter's two holes: what fills each
export const HOLES = { expr: 'EmitCaptured: the filter\'s expression goes here', fuse: 'EmitCaptured: its parent\'s yield goes here' };

// Folds: runs of lines shown as one, each with what they do: a block
// (to its closing brace), or a line and the block after it.
const FOLDS = [
  { from: /^if lzCmpNeeded \{$/, what: 'compare as JSON, when a total isn\'t a number' },
  { from: /^lzYielded\+\+$/, what: 'every 1024 rows, report the scan\'s stats', withNext: true },
  { from: /^if lzVars != nil && lzVars\.Ctx != nil && lzVars\.Ctx\.Stats != nil \{$/, what: 'report the scan\'s stats, at the end' },
];
const net = (t) => (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
// (the index of the line that closes the block opened at i)
function blockEnd(i) {
  let d = 0;
  for (let j = i; j < EMITTED.length; j++) {
    d += net(EMITTED[j].text);
    if (d <= 0) return j;
  }
  throw new Error(`emitted: block at ${i} never closes`);
}

// The emitted Go, as shown: indented by its braces, folds folded, its
// long inline data cut short. Each row: its text, depth, origin, group,
// and the raw lines it stands for.
export function shownEmitted() {
  const rows = [];
  let depth = 0;
  for (let i = 0; i < EMITTED.length; i++) {
    const e = EMITTED[i], lead = (e.text.match(/^\}+/) || [''])[0].length;
    const fold = FOLDS.find((f) => f.from.test(e.text));
    if (fold) {
      const j = blockEnd(fold.withNext ? i + 1 : i);
      rows.push({ text: `⋯ ${j - i + 1} lines: ${fold.what}`, depth, origin: e.origin, group: e.group, raw: EMITTED.slice(i, j + 1).map((x) => x.i), fold: true });
      i = j;
      continue;
    }
    // (the inline data, cut short)
    const text = /^lzJsonsData := /.test(e.text) ? `${e.text.slice(0, 70)}…"` : e.text;
    rows.push({ text, depth: depth - lead, origin: e.origin, group: e.group, raw: [e.i] });
    depth += net(e.text);
  }
  if (depth !== 0) throw new Error(`emitted: braces don't balance (${depth})`);
  return rows;
}
export const SHOWN = shownEmitted();
