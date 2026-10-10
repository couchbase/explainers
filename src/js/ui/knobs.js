// Slide-out drawer of simulation knobs. Changes apply to the live
// model immediately; scrolling to another step rebuilds it from the
// narrative, so changes last only while you stay on this step.

const MB = 1024 * 1024;

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
};

const GROUPS = [
  ['workload', 'Workload (modeled)'],
  ['cbft', 'cbft'],
  ['scorch', 'scorch persister'],
  ['mergeplan', 'merge plan'],
  ['costs', 'Costs (modeled)'],
];

const MERGEPLAN_DOCS = {
  maxSegmentsPerTier: 'Max segments per tier of the budget staircase.',
  maxSegmentSize: 'Max docs in a merged segment; segments over half this are never merged.',
  tierGrowth: 'Each tier is this many times bigger than the last.',
  segmentsPerMergeTask: 'Max segments merged in one task.',
  floorSegmentSize: 'Smaller segments count as this many docs.',
  floorSegmentFileSize: 'Bytes; when > 0 the budget counts file bytes (cbft: 20MB).',
  reclaimDeletesWeight: 'How strongly merges that reclaim deletes are favored.',
};

const fmtDefault = (v, unit) => {
  if (v === undefined) return '';
  if (v === Infinity) return '∞';
  if (unit === 'B' && typeof v === 'number') return `${+(v / MB).toFixed(2)}MB`;
  return String(v);
};

export class KnobsDrawer {
  constructor(parent, data, { onReset }) {
    this.data = data;
    this.onReset = onReset;
    this.model = null;
    this.inputs = new Map();
    this.body = h('div', { class: 'body' });
    this.el = h('div', { class: 'drawer knobs', role: 'dialog', 'aria-label': 'Simulation knobs', 'aria-hidden': 'true' },
      h('header', {},
        h('h2', { text: 'Knobs' }),
        h('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => this.close() })),
      this.body);
    parent.append(this.el);
    this._build();
  }

  get isOpen() { return this.el.classList.contains('open'); }
  open() { this.el.classList.add('open'); this.el.setAttribute('aria-hidden', 'false'); this._sync(); }
  close() { this.el.classList.remove('open'); this.el.setAttribute('aria-hidden', 'true'); }

  attach(model) {
    this.model = model;
    if (this.isOpen) this._sync();
  }

  _set(overrides) {
    if (this.model) this.model.set(overrides);
  }

  _build() {
    const note = h('p', { class: 'doc', style: 'color: var(--muted); font-size: var(--step-0); margin: 0.75rem 0' },
      'Changes apply to the running simulation right away. Scrolling to another step rebuilds the simulation from the story, so they last only while you stay on this step. Large byte sizes are shown in MB.');
    const actions = h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', text: 'Start a 30s query', onclick: () => this.model && this.model.startQuery({ durationMs: 30000, timeoutMs: 60000, label: 'your query' }) }),
      h('button', { class: 'btn', type: 'button', text: 'Make the disk slow', onclick: () => { this._set({ diskWriteMBps: 4, fsyncMs: 2500 }); this._sync(); } }),
      h('button', { class: 'btn', type: 'button', text: 'Heal the disk', onclick: () => { this._set({ diskWriteMBps: this.data.defaultConfig.diskWriteMBps, fsyncMs: this.data.defaultConfig.fsyncMs }); this._sync(); } }),
      h('button', { class: 'btn', type: 'button', text: 'Reset simulation', onclick: () => this.onReset() }));
    this.body.append(note, actions);

    const docs = this.data.configDocs;
    const dflt = this.data.defaultConfig;
    for (const [group, title] of GROUPS) {
      const fs = h('fieldset', {}, h('legend', { text: title }));
      if (group === 'mergeplan') {
        for (const k of Object.keys(dflt.mergePlan)) {
          const unit = k === 'floorSegmentFileSize' ? 'B' : '';
          fs.append(this._knob(`mergePlan.${k}`, k, unit, MERGEPLAN_DOCS[k] || '', {}));
        }
      } else {
        for (const [k, d] of Object.entries(docs)) {
          if (d.group !== group || k === 'mergePlan') continue;
          // Show big byte quantities in MB; small ones (per-doc sizes) in bytes.
          const unit = d.unit === 'B' && dflt[k] < MB ? 'bytes' : d.unit;
          fs.append(this._knob(k, k, unit, d.doc, d));
        }
      }
      this.body.append(fs);
    }
  }

  _knob(path, name, unit, doc, d) {
    const id = `knob-${path.replace('.', '-')}`;
    let input;
    if (unit === 'bool') {
      input = h('input', { type: 'checkbox', id });
      input.addEventListener('change', () => this._apply(path, input.checked));
    } else {
      input = h('input', { type: 'number', id, step: 'any', min: '0' });
      input.addEventListener('change', () => {
        let v = input.value === '' ? Infinity : Number(input.value);
        if (unit === 'B' && Number.isFinite(v)) v = Math.round(v * MB);
        if (!Number.isNaN(v)) this._apply(path, v);
      });
    }
    this.inputs.set(path, { input, unit });
    const defaults = [];
    if (d.bleve !== undefined) defaults.push(`bleve ${fmtDefault(d.bleve, unit)}`);
    if (d.cbft !== undefined) defaults.push(`cbft ${fmtDefault(d.cbft, unit)}`);
    const unitLabel = unit === 'B' ? 'MB' : unit && unit !== 'bool' ? unit : '';
    return h('div', { class: 'knob' },
      h('label', { for: id, text: unitLabel ? `${name} (${unitLabel})` : name }),
      input,
      h('div', { class: 'doc' }, doc, defaults.length ? h('span', { class: 'dflt', text: ` [${defaults.join(', ')}]` }) : null));
  }

  _apply(path, v) {
    if (path.startsWith('mergePlan.')) this._set({ mergePlan: { [path.slice(10)]: v } });
    else this._set({ [path]: v });
  }

  _sync() {
    if (!this.model) return;
    const cfg = this.model.cfg;
    for (const [path, { input, unit }] of this.inputs) {
      const v = path.startsWith('mergePlan.') ? cfg.mergePlan[path.slice(10)] : cfg[path];
      if (unit === 'bool') input.checked = !!v;
      else if (v === Infinity) input.value = '';
      else input.value = unit === 'B' ? +(v / MB).toFixed(3) : v;
      if (v === Infinity) input.placeholder = '∞';
    }
  }
}
