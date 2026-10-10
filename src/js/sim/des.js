// A tiny deterministic discrete-event kernel.
//
// Processes are generator functions that yield "ops", mirroring Go
// goroutines that block on channels, timers and condition variables.
// Time is simulated (milliseconds), and all randomness comes from a
// seeded PRNG, so a given (seed, config, script) always produces the
// same run -- which is what lets the explainer scroll backwards and
// lets the tests assert on behavior.
//
// Usage inside a process:
//
//   function* worker(k, ch) {
//     for (;;) {
//       const v = yield ch.recv('waiting for work');
//       yield k.work(5, 'processing');
//       const r = yield k.select([ch.recvCase(), k.timeoutCase(100)]);
//     }
//   }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Binary min-heap of timer events ordered by (t, seq).
class EventHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(ev) {
    const a = this.a;
    a.push(ev);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function less(x, y) {
  return x.t < y.t || (x.t === y.t && x.seq < y.seq);
}

// Proc states, used by the visualization:
//   running  - currently executing (instantaneous in sim time)
//   busy     - doing timed work (CPU or I/O), see label
//   sleep    - deliberately idle on a timer (e.g. persister nap)
//   blocked  - waiting on a channel / cond, see label
//   done     - exited
export class Proc {
  constructor(k, name, gen, meta) {
    this.k = k;
    this.id = k._nextProcId++;
    this.name = name;
    this.gen = gen;
    this.meta = meta || {};
    this.state = 'running';
    this.label = '';
    this.since = k.now;
    this.done = false;
    this.token = null; // current select token, if blocked in a select
  }
  setState(state, label) {
    if (this.state !== state || this.label !== label) {
      this.state = state;
      this.label = label || '';
      this.since = this.k.now;
    }
  }
}

export class Kernel {
  constructor({ seed = 1 } = {}) {
    this.now = 0;
    this.rng = mulberry32(seed);
    this.heap = new EventHeap();
    this._seq = 0;
    this._nextProcId = 1;
    this.procs = [];
    this.eventsProcessed = 0;
  }

  // ---- scheduling ----

  at(t, fn) {
    this.heap.push({ t: Math.max(t, this.now), seq: this._seq++, fn });
  }

  after(ms, fn) { this.at(this.now + ms, fn); }

  spawn(name, genFn, meta) {
    const p = new Proc(this, name, null, meta);
    p.gen = genFn(p);
    this.procs.push(p);
    this._resume(p, undefined);
    return p;
  }

  _resume(p, value) {
    this.at(this.now, () => this._step(p, value));
  }

  _step(p, value) {
    if (p.done) return;
    p.setState('running', p.label);
    let r;
    try {
      r = p.gen.next(value);
    } catch (err) {
      p.done = true;
      p.setState('done', 'panic: ' + err.message);
      throw err;
    }
    if (r.done) {
      p.done = true;
      p.setState('done', '');
      this.procs = this.procs.filter((x) => x !== p);
      return;
    }
    const op = r.value;
    if (!op || typeof op.apply !== 'function') {
      throw new Error(`proc ${p.name} yielded a non-op: ${op}`);
    }
    op.apply(this, p);
  }

  kill(p) {
    if (p.done) return;
    p.done = true;
    if (p.token) p.token.fired = true;
    p.setState('done', 'killed');
    this.procs = this.procs.filter((x) => x !== p);
  }

  // Runs all events with time <= t, then advances the clock to t.
  runUntil(t, maxEvents = Infinity) {
    let n = 0;
    while (this.heap.size > 0 && this.heap.peek().t <= t && n < maxEvents) {
      const ev = this.heap.pop();
      this.now = ev.t;
      ev.fn();
      n++;
    }
    this.eventsProcessed += n;
    if (n < maxEvents) this.now = Math.max(this.now, t);
    return n;
  }

  // ---- ops ----

  // Timed CPU or I/O work.
  work(ms, label) { return timerOp(ms, 'busy', label); }

  // Deliberate idle time (e.g., a nap).
  sleep(ms, label) { return timerOp(ms, 'sleep', label); }

  // Go-style select. cases: array of chan.recvCase()/sendCase(v)/
  // k.timeoutCase(ms). Resumes with {index, value, ok}. With
  // opts.default, resumes immediately with index -1 if nothing's ready.
  select(cases, opts = {}) {
    return { apply: (k, p) => k._select(p, cases, opts) };
  }

  timeoutCase(ms) { return { kind: 'timeout', ms }; }

  _select(p, cases, opts) {
    // Find ready cases; pick one at random like Go does.
    const ready = [];
    cases.forEach((c, i) => { if (c && c.kind !== 'timeout' && c.ch._ready(c)) ready.push(i); });
    if (ready.length > 0) {
      const i = ready[Math.floor(this.rng() * ready.length)];
      const res = cases[i].ch._commit(cases[i]);
      this._resume(p, { index: i, value: res.value, ok: res.ok });
      return;
    }
    if (opts.default) {
      this._resume(p, { index: -1 });
      return;
    }
    const token = { fired: false, proc: p };
    p.token = token;
    p.setState(opts.state || 'blocked', opts.label || 'select');
    cases.forEach((c, i) => {
      if (!c) return;
      if (c.kind === 'timeout') {
        this.after(c.ms, () => {
          if (token.fired) return;
          token.fired = true;
          p.token = null;
          this._step(p, { index: i, timeout: true });
        });
      } else {
        c.ch._enqueue(c, token, i);
      }
    });
  }
}

function timerOp(ms, state, label) {
  return {
    apply(k, p) {
      p.setState(state, label);
      k.after(Math.max(0, ms), () => k._step(p, undefined));
    },
  };
}

// Go-like channel with optional buffer capacity (0 = unbuffered).
export class Chan {
  constructor(k, name, cap = 0) {
    this.k = k;
    this.name = name;
    this.cap = cap;
    this.buf = [];
    this.recvq = []; // {token, index}
    this.sendq = []; // {token, index, value}
    this.closed = false;
  }

  get length() { return this.buf.length; }

  recvCase() { return { kind: 'recv', ch: this }; }
  sendCase(value) { return { kind: 'send', ch: this, value }; }

  recv(label) {
    return {
      apply: (k, p) => k._select(p, [this.recvCase()],
        { label: label || `recv ${this.name}` }),
      // result is unwrapped by the caller via .value; see Proc helpers.
    };
  }

  send(value, label) {
    return {
      apply: (k, p) => k._select(p, [this.sendCase(value)],
        { label: label || `send ${this.name}` }),
    };
  }

  // Non-blocking send from outside a process (or inside, without
  // yielding); returns true if delivered.
  trySend(value) {
    const c = this.sendCase(value);
    if (!this._ready(c)) return false;
    this._commit(c);
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    // Wake all receivers with ok=false.
    const rq = this.recvq;
    this.recvq = [];
    for (const w of rq) {
      if (w.token.fired) continue;
      w.token.fired = true;
      w.token.proc.token = null;
      this.k._resume(w.token.proc, { index: w.index, value: undefined, ok: false });
    }
  }

  _live(q) {
    while (q.length > 0 && q[0].token.fired) q.shift();
    return q;
  }

  _ready(c) {
    if (c.kind === 'recv') {
      return this.buf.length > 0 || this._live(this.sendq).length > 0 || this.closed;
    }
    if (this.closed) throw new Error(`send on closed channel ${this.name}`);
    return this._live(this.recvq).length > 0 || this.buf.length < this.cap;
  }

  // Performs a ready case immediately. Returns {value, ok}.
  _commit(c) {
    const k = this.k;
    if (c.kind === 'recv') {
      if (this.buf.length > 0) {
        const value = this.buf.shift();
        // Refill buffer from a blocked sender.
        const sq = this._live(this.sendq);
        if (sq.length > 0) {
          const s = sq.shift();
          s.token.fired = true;
          s.token.proc.token = null;
          this.buf.push(s.value);
          k._resume(s.token.proc, { index: s.index, ok: true });
        }
        return { value, ok: true };
      }
      const sq = this._live(this.sendq);
      if (sq.length > 0) {
        const s = sq.shift();
        s.token.fired = true;
        s.token.proc.token = null;
        k._resume(s.token.proc, { index: s.index, ok: true });
        return { value: s.value, ok: true };
      }
      return { value: undefined, ok: false }; // closed
    }
    // send
    const rq = this._live(this.recvq);
    if (rq.length > 0) {
      const r = rq.shift();
      r.token.fired = true;
      r.token.proc.token = null;
      k._resume(r.token.proc, { index: r.index, value: c.value, ok: true });
      return { ok: true };
    }
    this.buf.push(c.value);
    return { ok: true };
  }

  _enqueue(c, token, index) {
    if (c.kind === 'recv') this.recvq.push({ token, index });
    else this.sendq.push({ token, index, value: c.value });
  }
}

// Condition variable: wait() blocks until the next broadcast().
export class Cond {
  constructor(k, name) {
    this.k = k;
    this.name = name;
    this.waiters = [];
  }
  wait(label) {
    return {
      apply: (k, p) => {
        p.setState('blocked', label || `wait ${this.name}`);
        this.waiters.push(p);
      },
    };
  }
  broadcast() {
    const ws = this.waiters;
    this.waiters = [];
    for (const p of ws) this.k._resume(p, undefined);
  }
  get numWaiting() { return this.waiters.length; }
}

// Counting semaphore, e.g. a pool of CPUs.
export class Sem {
  constructor(k, name, permits) {
    this.k = k;
    this.name = name;
    this.permits = permits;
    this.inUse = 0;
    this.waiters = [];
  }
  acquire(label) {
    return {
      apply: (k, p) => {
        if (this.inUse < this.permits) {
          this.inUse++;
          k._resume(p, undefined);
        } else {
          p.setState('blocked', label || `acquire ${this.name}`);
          this.waiters.push(p);
        }
      },
    };
  }
  release() {
    if (this.waiters.length > 0) {
      this.k._resume(this.waiters.shift(), undefined);
    } else {
      this.inUse--;
    }
  }
}

// WaitGroup for fan-out/fan-in.
export class WaitGroup {
  constructor(k) { this.k = k; this.n = 0; this.waiters = []; }
  add(n = 1) { this.n += n; }
  done() {
    this.n--;
    if (this.n === 0) {
      const ws = this.waiters;
      this.waiters = [];
      for (const p of ws) this.k._resume(p, undefined);
    }
  }
  wait(label) {
    return {
      apply: (k, p) => {
        if (this.n === 0) { k._resume(p, undefined); return; }
        p.setState('blocked', label || 'wg.Wait');
        this.waiters.push(p);
      },
    };
  }
}
