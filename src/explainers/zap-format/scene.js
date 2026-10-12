// What each lens shows, laid out, as plain data (no DOM): the cells,
// labels, graph nodes and edges, with positions, all from the example
// segment. The diagram draws this; the story's focus points (story.js)
// point into it, so callouts and the marker land on what's drawn.

import { SEG, LENSES } from './layout.js';

const field = (name) => SEG.fields.find((f) => f.name === name);
const termOf = (fname, t) => field(fname).terms.find((x) => x.term === t);
export const SECTION_NAMES = { 0: 'text', 1: 'vector', 2: 'synonym', 3: 'geo' };
const uvarintLen = (v) => { let n = 1; while (v >= 128) { v = Math.floor(v / 128); n++; } return n; };
const at = (lens, dx, dy) => [LENSES[lens].box[0] + dx, LENSES[lens].box[1] + dy];

// A row of cells, left to right from [x, y], each {key, label, value, w}.
function row(x, y, h, cells) {
  let cx = x;
  return cells.map((c) => {
    const out = { ...c, x: cx, y, w: c.w, h };
    cx += c.w;
    return out;
  });
}

// ---- footer ----
function footerScene() {
  const short = { writerID: 'writer ID', idLen: 'ID len', numDocs: 'numDocs', storedIndexOffset: 'stored idx @',
    sectionsIndexOffset: 'sections idx @', chunkMode: 'chunk mode', version: 'version', crc: 'CRC' };
  const [x, y] = at('footer', 20, 50);
  // readable widths: 4-byte fields 74, 8-byte ones 108 (the writer ID
  // is empty here)
  const w = (size) => (size === 0 ? 0 : size === 4 ? 74 : 108);
  const cells = row(x, y, 64, SEG.footer.map((f) => ({
    key: f.name, label: short[f.name] + (f.name === 'crc' ? ' (hex)' : ''), start: f.start, size: f.size,
    value: f.name === 'crc' ? f.value.toString(16) : f.name === 'writerID' ? '(none)' : String(f.value),
    w: w(f.size),
  })));
  return { cells, hexY: y + 100 };
}

// ---- sections index and field info ----
function sectionsScene() {
  const [x, y] = at('sections', 20, 52);
  const idx = SEG.sectionsIndex;
  const head = row(x, y, 40, [
    { key: 'nf', label: 'NF', value: String(idx.nf), w: 60, start: idx.start, size: uvarintLen(idx.nf) },
    ...idx.offsets.map((o, i) => ({ key: `off${i}`, label: `field ${i} @`, value: String(o), w: 100,
      start: idx.start + uvarintLen(idx.nf) + 8 * i, size: 8 })),
  ]);
  const infos = SEG.fields.map((f, i) => {
    const ry = y + 70 + i * 52;
    const next = i + 1 < SEG.fields.length ? SEG.fields[i + 1].infoStart : idx.start;
    return {
      key: f.name, name: f.name, id: f.id, start: f.infoStart, end: next,
      cells: row(x, ry, 38, [
        { key: 'name', label: 'name', value: f.name, w: 110 },
        { key: 'opts', label: 'options', value: String(f.options), w: 60 },
        ...f.sections.map((s) => ({ key: `s${s.type}`, label: SECTION_NAMES[s.type], value: s.addr ? `@${s.addr}` : '0', w: 96, type: s.type, addr: s.addr })),
      ]),
    };
  });
  return { head, infos };
}

// ---- description's inverted-text record ----
function recordScene() {
  const f = field('description');
  const [x, y] = at('record', 20, 60);
  const len = uvarintLen(f.dvStart) + uvarintLen(f.dvEnd) + uvarintLen(f.dictOffset);
  const cells = row(x, y, 50, [
    { key: 'dvStart', label: 'doc values from', value: String(f.dvStart), w: 135 },
    { key: 'dvEnd', label: 'doc values to', value: String(f.dvEnd), w: 135 },
    { key: 'dictOffset', label: 'dictionary @', value: String(f.dictOffset), w: 135 },
  ]);
  return { cells, start: f.recordStart, end: f.recordStart + len, fstStart: f.fstStart, fstLen: f.fstLen,
    note: [x, y + 85] };
}

// ---- stored fields, doc 0 ----
function storedScene() {
  const s = SEG.stored[0];
  const [x, y] = at('stored', 20, 52);
  const index = row(x, y, 40, [{ key: 'idx0', label: `stored index[0] @${SEG.regions[1].start}`, value: String(s.recordStart), w: 200 }]);
  const lenBytes = uvarintLen(s.metaLen) + uvarintLen(s.dataLen);
  const total = lenBytes + s.metaLen + s.dataLen;
  // (not to scale: the small fields get room for their labels)
  const rec = row(x, y + 80, 44, [
    { key: 'lens', label: 'lengths', value: `${s.metaLen}, ${s.dataLen}`, w: 66 },
    { key: 'meta', label: 'meta', value: `${s.metaLen} B`, w: 54 },
    { key: 'id', label: '_id', value: s.id, w: 116 },
    { key: 'snappy', label: 'snappy', value: `${s.snappyLen} B`, w: 154 },
  ]);
  const d = SEG.docs[0];
  const fields = [['name', d.name], ['city', d.city], ['description', d.description]]
    .map(([k, v], i) => ({ key: k, text: `${k}: ${v}`, x: x + 10, y: y + 170 + i * 22 }));
  return { index, rec, fields, start: s.recordStart, end: s.recordStart + total, idx: { start: SEG.regions[1].start, size: 8 } };
}

// ---- city's FST: as a trie, then as the real minimized FST ----
function fstScene() {
  const f = field('city');
  const states = new Map(f.fstStates.map((s) => [s.addr, s]));
  const terms = f.terms.map((t) => t.term);
  // the trie: one node per prefix
  const nodes = new Map([['', { prefix: '', depth: 0 }]]);
  for (const t of terms) for (let i = 1; i <= t.length; i++) if (!nodes.has(t.slice(0, i))) nodes.set(t.slice(0, i), { prefix: t.slice(0, i), depth: i });
  // rows: leaves in term order; a node sits on its first child's row
  const kids = (p) => [...nodes.keys()].filter((k) => k.length === p.length + 1 && k.startsWith(p)).sort();
  let rowN = 0;
  const place = (p) => {
    const n = nodes.get(p);
    const ks = kids(p);
    if (!ks.length) n.row = rowN++;
    for (const k of ks) place(k);
    if (ks.length) n.row = nodes.get(ks[0]).row;
  };
  place('');
  const [x0, y0] = at('fst', 50, 80);
  const dx = 82, dy = 62;
  // each trie node's FST state: the state its prefix leads to
  const walk = (p) => { let a = f.fstRoot; for (const ch of p) a = states.get(a).trans.find((t) => t.b === ch.charCodeAt(0)).to; return a; };
  const trie = [...nodes.values()].map((n) => ({ ...n, x: x0 + n.depth * dx, y: y0 + n.row * dy, state: walk(n.prefix), final: terms.includes(n.prefix) }));
  // the FST's own nodes sit where their first trie node does
  const fstPos = new Map();
  for (const n of trie) if (!fstPos.has(n.state)) fstPos.set(n.state, [n.x, n.y]);
  const edges = trie.filter((n) => n.prefix).map((n) => {
    const parent = n.prefix.slice(0, -1);
    const from = trie.find((m) => m.prefix === parent);
    const tr = states.get(from.state).trans.find((t) => t.b === n.prefix.charCodeAt(n.prefix.length - 1));
    return { from: parent, to: n.prefix, ch: n.prefix.slice(-1), out: tr.out, fromState: from.state, toState: n.state };
  });
  return { trie, edges, fstPos, states: f.fstStates.length, nodes: trie.length, terms: f.terms };
}

// ---- the walk for "quiet" in description's FST ----
function walkScene() {
  const f = field('description');
  const states = new Map(f.fstStates.map((s) => [s.addr, s]));
  const [x0, y0] = at('walk', 60, 110);
  const term = 'quiet';
  let a = f.fstRoot, sum = 0;
  const steps = [];
  for (let i = 0; i <= term.length; i++) {
    const s = states.get(a);
    const step = { i, addr: a, x: x0 + i * 180, y: y0, sum, letters: (s.trans || []).map((t) => String.fromCharCode(t.b)), final: s.final, finalOut: s.finalOut };
    if (i < term.length) {
      const tr = s.trans.find((t) => t.b === term.charCodeAt(i));
      step.next = { ch: term[i], out: tr.out };
      sum += tr.out;
      a = tr.to;
    }
    steps.push(step);
  }
  const value = sum + steps[steps.length - 1].finalOut;
  return { term, steps, value, fstStart: f.fstStart, fstLen: f.fstLen };
}

// ---- "quiet": postings, deletions, freq/norm; and AND "hotel" ----
function postingsScene() {
  const q = termOf('description', 'quiet');
  const [x, y] = at('postings', 20, 52);
  const header = row(x, y, 40, [
    { key: 'freqOffset', label: 'freq/norm @', value: String(q.freqOffset), w: 120 },
    { key: 'locOffset', label: 'locations @', value: String(q.locOffset), w: 120 },
    { key: 'len', label: 'bitmap len', value: String(q.bitmapLen), w: 100 },
    { key: 'bitmap', label: 'roaring bitmap', value: `${q.bitmapLen} B`, w: 120 },
  ]);
  const chips = (cy, docs, key) => SEG.docs.map((d, i) => ({ key: `${key}${i}`, doc: i, x: x + i * 50, y: cy, on: docs.includes(i) }));
  return {
    term: q, header, start: q.postingsStart, bitmapStart: q.bitmapStart, bitmapEnd: q.bitmapStart + q.bitmapLen,
    container: { x, y: y + 60, text: `container key 0 · array · [${q.docs.join(', ')}]` },
    docs: chips(y + 120, q.docs, 'q'), deletedY: y + 160, deletedText: '↑ deleted: from root.bolt, not this file',
  };
}

function freqScene() {
  const q = termOf('description', 'quiet');
  const [x, y] = at('freq', 20, 52);
  const rows = q.hits.map((h, i) => ({
    key: `hit${h.doc}`, doc: h.doc, x, y: y + 44 + i * 34, freq: h.freq, fieldLen: h.fieldLen, hasLocs: h.hasLocs,
    deleted: SEG.deleted.includes(h.doc),
  }));
  return { head: { x, y, text: `${q.numChunks} chunk (chunk size ${q.chunkSize}): one hit per doc` }, rows,
    start: q.freqOffset, end: q.locOffset };
}

function andScene() {
  const q = termOf('description', 'quiet'), h = termOf('description', 'hotel');
  const [x, y] = at('and', 130, 46);
  const live = (docs) => docs.filter((d) => !SEG.deleted.includes(d));
  const both = live(q.docs).filter((d) => h.docs.includes(d));
  const chips = (cy, docs, key) => SEG.docs.map((d, i) => ({ key: `${key}${i}`, doc: i, x: x + i * 50, y: cy, on: docs.includes(i) }));
  return {
    rows: [
      { key: 'quiet', label: 'quiet − deleted', chips: chips(y, live(q.docs), 'aq') },
      { key: 'hotel', label: 'hotel − deleted', chips: chips(y + 40, live(h.docs), 'ah') },
      { key: 'result', label: 'AND', chips: chips(y + 80, both, 'ar') },
    ],
    labelX: x - 120, hotel: h, result: both,
  };
}

export const SCENE = {
  footer: footerScene(),
  sections: sectionsScene(),
  record: recordScene(),
  stored: storedScene(),
  fst: fstScene(),
  walk: walkScene(),
  postings: postingsScene(),
  freq: freqScene(),
  and: andScene(),
};
