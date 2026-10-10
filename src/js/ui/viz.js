// The instrument panel: renders a Model's state into plain DOM. The
// skeleton is built once; update() patches text, classes and keyed
// child lists, so it's cheap enough to run at ~15fps.

import { fmtBytes, fmtMs } from '../sim/model.js';
import { sparkline } from './charts.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
};

// Classifies a proc's state for coloring. "stall" means blocked by
// backpressure, as opposed to idly waiting for work.
const STALL = /herder|flow control|worker busy|paused|persistence \(safe/;
export function procClass(p) {
  if (!p) return 's-wait';
  if (p.state === 'busy' || p.state === 'running') return 's-busy';
  if (p.state === 'sleep') return 's-nap';
  if (p.state === 'blocked' && STALL.test(p.label)) return 's-stall';
  return 's-wait';
}

function grNode(name, title) {
  const el = h('div', { class: 'gr s-wait', 'data-proc': name },
    h('div', { class: 'name', text: title || name }),
    h('div', { class: 'label' }),
    h('div', { class: 'since' }));
  return el;
}

function gauge(title) {
  const fill = h('div', { class: 'fill' });
  const bar = h('div', { class: 'bar' }, fill);
  const val = h('span');
  const el = h('div', { class: 'gauge' }, h('div', { class: 'head' }, h('span', { text: title }), val), bar);
  return { el, fill, bar, val };
}

const CHARTS = [
  { id: 'memUsed', title: 'memory', fmt: fmtBytes, ref: (s) => s.indexQuota },
  { id: 'files', title: 'files on disk', key: 'filesOnDisk', fmt: (v) => String(v) },
  { id: 'dcpBuf', title: 'DCP unacked', fmt: fmtBytes, ref: () => 20 * 1024 * 1024 },
  { id: 'disk', title: 'disk bytes', key: 'diskBytes', fmt: fmtBytes, extra: 'zombieBytes' },
];

export class Viz {
  constructor(root) {
    this.root = root;
    this.board = h('div', { class: 'board' });
    root.append(this.board);
    this.procEls = new Map();
    this.segEls = new Map();
    this.fileEls = new Map();
    this._build();
  }

  _proc(name, title) {
    const el = grNode(name, title);
    this.procEls.set(name, el);
    return el;
  }

  _build() {
    const b = this.board;

    // ---- cbft zone ----
    this.dcpGauge = gauge('DCP buffer (unacked)');
    this.memGauge = gauge('memory vs indexing quota');
    this.memGauge.mark = h('div', { class: 'mark' });
    this.memGauge.bar.append(this.memGauge.mark);
    this.herderText = h('div', { class: 'label' });

    const workers = h('div', { class: 'workers', 'data-focus': 'workers' });
    this.slots = [];
    for (let i = 0; i < 4; i++) {
      const slot = h('div', { class: 'slot', title: `batchCh-${i} (capacity 1)` });
      this.slots.push(slot);
      workers.append(h('div', { class: 'worker' }, slot, this._proc(`batchWorker-${i}`, `worker ${i}`)));
    }

    const kvBox = h('div', { class: 'row', 'data-focus': 'kv', style: 'flex: 1 1 12rem' },
      this._proc('kv', 'KV · DCP producer'));
    kvBox.append(this.dcpGauge.el);
    kvBox.firstChild.style.flexBasis = '100%';

    const herder = h('div', { class: 'gauge', 'data-focus': 'herder', style: 'flex: 1 1 12rem' });
    herder.append(this.memGauge.el, this.herderText);
    this.memGauge.el.style.flex = 'none';
    this.herderText.style.cssText = 'font: 400 0.6875rem/1.3 var(--font-mono); color: var(--muted)';

    this.cbftStat = h('span', { class: 'stat' });
    b.append(h('section', { class: 'zone' },
      h('div', { class: 'zone-title' }, h('span', { text: 'cbft · DCP → batches' }), this.cbftStat),
      h('div', { class: 'row' },
        kvBox,
        h('div', { 'data-focus': 'dcp', class: 'row', style: 'flex: 1 1 9rem' }, this._proc('dcp', 'DCP goroutine')),
        workers),
      h('div', { class: 'row' }, herder)));

    // ---- scorch zone ----
    this.cpuGauge = gauge('analysis queue (CPUs)');
    this.cpuGauge.fill.classList.add('busy');
    this.epochs = h('div', { class: 'epochs' });
    this.strip = h('div', { class: 'strip' });
    this.stripMore = h('span', { class: 'more' });
    this.rootStat = h('span', { class: 'stat' });
    this.persisterWorkers = h('div', { class: 'row' });
    this.mergeInfo = h('div', { class: 'label', style: 'font: 400 0.6875rem/1.3 var(--font-mono); color: var(--muted)' });

    b.append(h('section', { class: 'zone' },
      h('div', { class: 'zone-title' }, h('span', { text: 'scorch' }), this.epochs),
      h('div', { class: 'row' },
        h('div', { 'data-focus': 'analysis', class: 'row', style: 'flex: 1 1 10rem' }, this.cpuGauge.el),
        h('div', { 'data-focus': 'introducer', class: 'row', style: 'flex: 2 1 12rem' }, this._proc('introducer'))),
      h('div', { class: 'strip-wrap', 'data-focus': 'root' },
        h('div', { class: 'zone-title' }, h('span', { text: 'root snapshot' }), this.rootStat),
        this.strip,
        h('div', { class: 'legend' },
          h('span', {}, h('i', { style: 'background: var(--seg-mem)' }), 'in-memory segment'),
          h('span', {}, h('i', { style: 'background: var(--seg-file)' }), 'file segment (mmapped zap)'),
          h('span', {}, h('i', { style: 'background: repeating-linear-gradient(135deg, var(--seg-file) 0 2px, var(--panel) 2px 4px)' }), 'deleted docs'))),
      h('div', { class: 'row' },
        h('div', { 'data-focus': 'persister', class: 'col', style: 'flex: 1 1 14rem' },
          this._proc('persister'), this.persisterWorkers),
        h('div', { 'data-focus': 'merger', class: 'col', style: 'flex: 1 1 14rem' },
          this._proc('merger'), this.mergeInfo))));

    // ---- disk zone ----
    this.diskGrid = h('div', { class: 'disk-grid' });
    this.bolt = h('div', { class: 'bolt' });
    this.diskStat = h('span', { class: 'stat' });
    b.append(h('section', { class: 'zone', 'data-focus': 'disk' },
      h('div', { class: 'zone-title' }, h('span', { text: 'index directory' }), this.diskStat),
      this.diskGrid,
      h('div', { 'data-focus': 'bolt' }, this.bolt),
      h('div', { class: 'legend' },
        h('span', {}, h('i', { style: 'background: var(--seg-file)' }), 'in root'),
        h('span', {}, h('i', { style: 'border: 1.5px dashed var(--seg-file)' }), 'new, not yet in root.bolt'),
        h('span', {}, h('i', { style: 'background: var(--seg-garbage)' }), 'not in root (kept by root.bolt or awaiting cleanup)'),
        h('span', {}, h('i', { style: 'background: var(--seg-zombie)' }), 'unlinked but still open'))));

    // ---- queries, charts, log ----
    this.queries = h('div', { class: 'queries' });
    this.chartEls = {};
    const charts = h('div', { class: 'charts' });
    for (const c of CHARTS) {
      const val = h('b');
      const svgHost = h('div');
      const el = h('div', { class: 'chart', 'data-chart': c.id }, h('div', { class: 'head' }, h('span', { text: c.title }), val), svgHost);
      this.chartEls[c.id] = { el, val, svgHost };
      charts.append(el);
    }
    this.log = h('ul', { class: 'log' });
    b.append(h('section', { class: 'zone' },
      h('div', { 'data-focus': 'queries', style: 'display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap' },
        h('div', { class: 'zone-title', text: 'queries' }), this.queries),
      charts,
      this.log));
  }

  setFocus(ids, chart) {
    const set = new Set(ids || []);
    this.board.classList.toggle('has-focus', set.size > 0);
    for (const el of this.board.querySelectorAll('[data-focus]')) {
      el.classList.toggle('focused', set.has(el.getAttribute('data-focus')));
    }
    for (const [id, c] of Object.entries(this.chartEls)) c.el.classList.toggle('emph', id === chart);
    // Bring the focused components into view when the panel scrolls.
    const first = this.board.querySelector('.focused');
    if (first) {
      const b = this.board.getBoundingClientRect();
      const r = first.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.board.scrollTo({ top: this.board.scrollTop + r.top - b.top - 8, behavior: reduce ? 'auto' : 'smooth' });
      }
    }
  }

  update(m) {
    const now = m.now;
    const procs = new Map(m.k.procs.map((p) => [p.name, p]));

    for (const [name, el] of this.procEls) {
      const p = procs.get(name);
      const cls = procClass(p);
      if (!el.classList.contains(cls)) {
        el.classList.remove('s-busy', 's-nap', 's-wait', 's-stall');
        el.classList.add(cls);
      }
      const label = p ? p.label : '';
      const lab = el.children[1];
      if (lab.textContent !== label) { lab.textContent = label; lab.title = label; }
      el.children[2].textContent = p && now - p.since >= 1 ? fmtMs(now - p.since) : '';
    }

    // worker slots (capacity-1 channels)
    m.workerChs.forEach((ch, i) => {
      const s = this.slots[i];
      if (!s) return;
      s.classList.toggle('full', ch.length > 0);
      s.classList.toggle('stalled', ch.length > 0 && ch.sendq.some((w) => !w.token.fired));
    });

    // gauges
    const dcpFrac = m.dcpBufUsed / m.cfg.dcpBufferBytes;
    this.dcpGauge.fill.style.width = `${Math.min(100, dcpFrac * 100)}%`;
    this.dcpGauge.fill.classList.toggle('warn', dcpFrac > 0.8);
    this.dcpGauge.val.textContent = `${fmtBytes(m.dcpBufUsed)} / ${fmtBytes(m.cfg.dcpBufferBytes)}`;

    const mem = m.memUsed(), quota = m.indexQuota();
    const memMax = Math.max(quota * 1.15, mem);
    this.memGauge.fill.style.width = `${(mem / memMax) * 100}%`;
    this.memGauge.fill.classList.toggle('warn', mem > quota);
    this.memGauge.fill.classList.toggle('mem', mem <= quota);
    this.memGauge.mark.style.left = `${(quota / memMax) * 100}%`;
    this.memGauge.val.textContent = `${fmtBytes(mem)} / ${fmtBytes(quota)}`;
    const blocked = m.numEventsBlocking;
    this.herderText.textContent = !m.cfg.herderEnabled ? 'app herder disabled'
      : blocked > 0 ? `app herder: blocking ${blocked} goroutine${blocked > 1 ? 's' : ''} until memory drops`
        : 'app herder: under quota, not blocking';
    this.herderText.style.color = blocked > 0 ? 'var(--stall)' : '';

    const s = m.stats;
    this.cbftStat.textContent = `${fmtRate(m)} docs/s · batches ${s.NumBatchesIntroduced}`;

    const q = m.analysisQueue;
    this.cpuGauge.fill.style.width = `${(q.inUse / q.permits) * 100}%`;
    this.cpuGauge.val.textContent = `${q.inUse}/${q.permits} busy${q.waiters.length ? ` · ${q.waiters.length} queued` : ''}`;

    this.epochs.replaceChildren(
      h('span', {}, 'root ', h('b', { text: String(s.CurRootEpoch) })),
      h('span', {}, 'persisted ', h('b', { text: String(s.LastPersistedEpoch) })),
      h('span', {}, 'merged ', h('b', { text: String(s.LastMergedEpoch) })));

    this._updateStrip(m);
    this._updatePersisterWorkers(m, procs);
    this.mergeInfo.textContent = m.lastMergePlan
      ? `last plan @ epoch ${m.lastMergePlan.epoch}: ${m.lastMergePlan.numSegs} file segs, budget ${m.lastMergePlan.budget}, ${m.lastMergePlan.tasks} task(s)`
      : 'no plan yet';
    this._updateDisk(m);
    this._updateQueries(m);
    this._updateCharts(m);
    this._updateLog(m);
  }

  _updateStrip(m) {
    const segs = m.root.segs;
    const pinned = new Set();
    for (const qq of m.queries.values()) for (const ss of qq.snap.segs) pinned.add(ss.seg.id);
    const merging = new Set(m.currentMerge ? m.currentMerge.srcs : []);
    const MAX = 90;
    // Show all file segments, and as many in-memory ones as fit.
    const files = segs.filter((ss) => ss.seg.kind === 'file');
    const mems = segs.filter((ss) => ss.seg.kind === 'mem');
    const shownMems = mems.slice(-Math.max(0, MAX - files.length));
    const shown = [...files, ...shownMems];
    const keep = new Set();
    let prev = null;
    for (const ss of shown) {
      const seg = ss.seg;
      keep.add(seg.id + seg.kind);
      let el = this.segEls.get(seg.id + seg.kind);
      if (!el) {
        el = h('div', { class: `seg ${seg.kind}` }, h('div', { class: 'del' }));
        this.segEls.set(seg.id + seg.kind, el);
      }
      const w = seg.kind === 'mem' ? 4 + Math.sqrt(seg.docs) * 0.25 : 6 + Math.sqrt(seg.bytes / 1024) * 0.55;
      el.style.width = `${Math.min(w, 220).toFixed(1)}px`;
      el.firstChild.style.width = `${((ss.deleted / seg.docs) * 100).toFixed(1)}%`;
      el.classList.toggle('merging', merging.has(seg.id));
      el.classList.toggle('pinned', pinned.has(seg.id));
      el.title = `${seg.kind === 'file' ? seg.fileName : 'in-memory segment ' + seg.id}: ${seg.docs - ss.deleted} live / ${seg.docs} docs, ${fmtBytes(seg.bytes)}`;
      const want = prev ? prev.nextSibling : this.strip.firstChild;
      if (want !== el) this.strip.insertBefore(el, want);
      prev = el;
    }
    for (const [k, el] of this.segEls) {
      if (!keep.has(k)) { el.remove(); this.segEls.delete(k); }
    }
    const hidden = mems.length - shownMems.length;
    this.stripMore.textContent = hidden > 0 ? `+${hidden} more in-memory` : '';
    if (hidden > 0) this.strip.append(this.stripMore); else this.stripMore.remove();
    const memBytes = mems.reduce((a, ss) => a + ss.seg.bytes, 0);
    this.rootStat.textContent = `${mems.length} in-memory (${fmtBytes(memBytes)}) · ${files.length} file · ${fmtNum(m.root.liveDocs())} live docs`;
  }

  _updatePersisterWorkers(m, procs) {
    const names = [...procs.keys()].filter((n) => n.startsWith('persisterWorker-'));
    const have = new Set();
    for (const n of names) {
      have.add(n);
      if (!this.procEls.has(n)) {
        const el = this._proc(n, n.replace('persisterWorker-', 'p.worker '));
        el.style.flex = '1 1 6rem';
        el.style.minWidth = '6rem';
        this.persisterWorkers.append(el);
      }
    }
    for (const [n, el] of this.procEls) {
      if (n.startsWith('persisterWorker-') && !have.has(n)) { el.remove(); this.procEls.delete(n); }
    }
  }

  _updateDisk(m) {
    const inRoot = new Set(m.root.segs.filter((ss) => ss.seg.kind === 'file').map((ss) => ss.seg.fileName));
    const inBolt = new Set();
    for (const b of m.bolt) for (const n of b.files) inBolt.add(n);
    const keep = new Set();
    let prev = null;
    const list = [...m.files.values(), ...[...m.zombies.values()].map((z) => ({ ...z, zombie: true }))];
    for (const f of list) {
      keep.add(f.name);
      let el = this.fileEls.get(f.name);
      if (!el) {
        el = h('div', { class: 'file' });
        this.fileEls.set(f.name, el);
      }
      const side = Math.max(5, Math.min(44, Math.sqrt(Math.max(f.bytes, 1) / 1024) * 0.32));
      el.style.width = el.style.height = `${side.toFixed(1)}px`;
      const cls = f.zombie ? 'zombie' : !inBolt.has(f.name) && m.ineligibleForRemoval.has(f.name) ? 'new' : inRoot.has(f.name) ? 'root' : 'garbage';
      el.className = `file ${cls}`;
      el.title = `${f.name} · ${fmtBytes(f.bytes)} · ${cls === 'zombie' ? 'unlinked but still mmapped' : cls === 'new' ? 'new, not yet listed in root.bolt' : cls === 'root' ? 'in the root snapshot' : 'not in root'}`;
      const want = prev ? prev.nextSibling : this.diskGrid.firstChild;
      if (want !== el) this.diskGrid.insertBefore(el, want);
      prev = el;
    }
    for (const [k, el] of this.fileEls) if (!keep.has(k)) { el.remove(); this.fileEls.delete(k); }

    const prot = m.protected || new Set();
    const snaps = m.bolt.slice(0, 8).map((b, i) => h('span', {
      class: `snap${i === 0 ? ' latest' : ''}${prot.has(b.epoch) && i > 0 ? ' protected' : ''}`,
      text: String(b.epoch),
      title: `snapshot epoch ${b.epoch}, ${b.files.size} files${prot.has(b.epoch) ? ', protected rollback point' : ''}`,
    }));
    const more = m.bolt.length > 8 ? h('span', { text: `+${m.bolt.length - 8}` }) : null;
    this.bolt.replaceChildren(h('span', { text: 'root.bolt snapshots:' }), ...snaps, ...(more ? [more] : []));
    const z = m.zombieBytes();
    this.diskStat.textContent = `${m.numFilesOnDisk()} files · ${fmtBytes(m.diskBytes())}${z ? ` · +${fmtBytes(z)} unlinked` : ''}`;
  }

  _updateQueries(m) {
    if (m.queries.size === 0) {
      if (this.queries.dataset.empty !== '1') {
        this.queries.replaceChildren(h('span', { text: 'none running' }));
        this.queries.dataset.empty = '1';
      }
      return;
    }
    this.queries.dataset.empty = '';
    const kids = [];
    for (const q of m.queries.values()) {
      const age = m.now - q.startedAt;
      kids.push(h('span', { class: 'query', text: `${q.label || 'query ' + q.id} · pins epoch ${q.epoch} · ${fmtMs(age)} / timeout ${fmtMs(q.timeoutMs)}` }));
    }
    this.queries.replaceChildren(...kids);
  }

  _updateCharts(m) {
    const series = m.series.filter((p) => p.t >= m.now - 60000);
    if (series.length === 0) return;
    const last = series[series.length - 1];
    for (const c of CHARTS) {
      const key = c.key || c.id;
      const ce = this.chartEls[c.id];
      const vals = series.map((p) => p[key] + (c.extra ? p[c.extra] : 0));
      const ref = c.ref ? c.ref(last) : null;
      ce.val.textContent = c.fmt(vals[vals.length - 1]) + (c.extra && last[c.extra] ? ` (+${c.fmt(last[c.extra])})` : '');
      ce.svgHost.innerHTML = sparkline(series.map((p) => p.t), vals, { ref, t0: m.now - 60000, t1: m.now });
    }
  }

  _updateLog(m) {
    const ev = m.events.slice(-4).reverse();
    const sig = ev.map((e) => e.t + e.msg).join('|');
    if (sig === this._logSig) return;
    this._logSig = sig;
    this.log.replaceChildren(...ev.map((e) => h('li', { class: `k-${e.kind}` }, h('span', { class: 't', text: (e.t / 1000).toFixed(1) + 's' }), e.msg)));
  }
}

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

function fmtRate(m) {
  const s = m.series;
  if (s.length < 11) return '–';
  const a = s[s.length - 11], b = s[s.length - 1];
  return fmtNum(Math.round((b.mutations - a.mutations) / ((b.t - a.t) / 1000)));
}
