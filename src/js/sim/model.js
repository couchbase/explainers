// A simulation of one cbft pindex: DCP feed -> cbft batch workers ->
// app herder -> scorch Batch() -> introducer / persister / merger, plus
// queries pinning snapshots. Each process mirrors a real goroutine; the
// comments name the Go functions they model so readers can cross-check
// (see content/coderefs.yaml for links).
//
// It is a model, not an emulator: doc ids aren't tracked, only counts,
// and costs are parameterized assumptions (see config.js). But the
// control flow, channel capacities, refcounting and the
// persister/merger/herder interplay follow the real code.

import { Kernel, Chan, Cond, Sem } from './des.js';
import { makeConfig, applyConfig } from './config.js';
import { fmtMs } from './fmt.js';
import { Snapshot } from './segments.js';
import { CbftProcs } from './procs/cbft.js';
import { BatchProcs } from './procs/batch.js';
import { IntroducerProcs } from './procs/introducer.js';
import { PersisterProcs } from './procs/persister.js';
import { MergerProcs } from './procs/merger.js';
import { MergingProcs } from './procs/merging.js';

export { zapFileName } from './segments.js';

// ---------------------------------------------------------------

export class Model {
  constructor({ seed = 1, config } = {}) {
    this.cfg = makeConfig(config);
    this.k = new Kernel({ seed });
    this.seed = seed;
    this.nextSegmentID = 1;
    this.nextEpoch = 1;
    this.liveSnapshots = new Set();

    this.stats = {
      // scorch
      TotBatches: 0, TotBatchesEmpty: 0, TotIntroducedItems: 0, TotIntroducedSegmentsBatch: 0,
      TotIntroducedSegmentsMerge: 0, TotPersistedItems: 0, TotPersistedSegments: 0,
      TotPersistLoopBeg: 0, TotPersistLoopProgress: 0, TotPersistLoopWait: 0,
      TotPersisterNapPauseCompleted: 0, TotPersisterMergerNapBreak: 0,
      TotPersisterSlowMergerPause: 0, TotPersisterSlowMergerResume: 0,
      TotMemMergeDone: 0, TotMemMergeSegments: 0,
      TotFileMergePlan: 0, TotFileMergePlanNone: 0, TotFileMergePlanTasks: 0,
      TotFileMergeSegments: 0, TotFileMergeWrittenBytes: 0,
      TotFileMergeIntroductionsDone: 0, TotFileMergeIntroductionsObsoleted: 0,
      TotSnapshotsRemovedFromMetaStore: 0, TotFilesRemoved: 0,
      CurRootEpoch: 0, LastPersistedEpoch: 0, LastMergedEpoch: 0,
      MaxBatchIntroTime: 0, TotBatchIntroTime: 0,
      // cbft
      TotBatchesFlushedOnMaxOps: 0, TotBatchesFlushedOnTimer: 0, TotBatchesNew: 0,
      TotBatchesMerged: 0, NumBatchesIntroduced: 0, BatchBytesAdded: 0, BatchBytesRemoved: 0,
      TotHerderWaitingIn: 0, TotHerderWaitingOut: 0, TotHerderQueriesRejected: 0,
      // DCP
      TotDcpMutations: 0, TotDcpSnapshots: 0, DcpFlowControlPausedMs: 0,
      // queries
      TotQueries: 0, TotQueriesTimedOut: 0,
    };

    // Disk: zap files and root.bolt's snapshots (newest first).
    this.files = new Map(); // name -> {name, bytes, seg, createdAt}
    this.zombies = new Map(); // unlinked-but-open: name -> {bytes, seg}
    this.bolt = []; // [{epoch, time, files: Set<name>}]
    this.ineligibleForRemoval = new Set();
    this.eligibleForRemoval = [];
    this.diskActiveWriters = 0;

    // DCP and cbft state.
    this.dcpBufUsed = 0;
    this.kvPausedSince = null;
    this.dcpQueue = [];
    this.expectedLiveDocs = 0; // for the doc-conservation invariant
    this.pendingBatchBytes = 0; // BatchBytesAdded - BatchBytesRemoved
    this.analysisBytes = 0;
    this.inflightMemBytes = 0; // built segments not yet introduced
    this.numEventsBlocking = 0;
    this.queries = new Map();
    this.nextQueryId = 1;
    this.events = []; // recent notable events for the log
    this.series = []; // sampled time series
    this.flags = {}; // misc. scenario/visual flags
    this.trace = null; // the batch we follow through the system, if any
    this.followNext = false;
    this.kvOneShot = null; // see _kvOneShot
    this.committedPending = null; // see _pausePersister
    this.writing = new Map(); // file name -> {by, seg, since}
    this.recentDeletes = []; // [{name, bytes, t}]
    this.introLast = null; // {kind, t}: the introducer's last message

    this._buildProcs();
  }

  // ---- public API ----

  // Advances simulated time by ms.
  advance(ms) { this.k.runUntil(this.k.now + ms); }
  get now() { return this.k.now; }

  set(overrides) {
    applyConfig(this.cfg, overrides);
    this.log('config', `config: ${Object.entries(overrides).map(([k, v]) => `${k}=${fmtVal(v)}`).join(', ')}`);
    this.dcpSpace.broadcast();
    this.herderCond.broadcast();
  }

  // Starts a query that pins the current root snapshot.
  startQuery({ durationMs = 50, timeoutMs = 10000, label } = {}) {
    const id = this.nextQueryId++;
    const m = this;
    this.k.spawn(`query-${id}`, function* (p) { yield* m._queryProc(p, id, durationMs, timeoutMs, label); }, { group: 'query', queryId: id });
    return id;
  }

  // Tags the next batch the DCP goroutine starts for a vbucket that
  // goes to batch worker `worker`, so we can follow it (and, later, the
  // segments and files its docs end up in). alone: KV lets what's in
  // flight drain, sends just that batch's snapshot, then stops.
  follow({ worker = 0, alone = false } = {}) {
    this.followNext = { worker };
    this.trace = null;
    if (alone) this.kvOneShot = { worker };
  }

  reached(stage) {
    return !!(this.trace && this.trace.history.some((h) => h.stage === stage));
  }

  _trace(stage, extra) {
    if (!this.trace) this.trace = { history: [], oldFiles: [] };
    Object.assign(this.trace, extra, { stage });
    this.trace.history.push({ stage, t: this.k.now });
    this.log('trace', `our batch: ${stage}`);
  }

  log(kind, msg) {
    this.events.push({ t: this.k.now, kind, msg });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // ---- memory and disk accounting ----

  // Approximates cbft.FetchCurMemoryUsed() for this process.
  memUsed() {
    return this.cfg.baseMemBytes + this.reachableMemSegBytes() + this.pendingBatchBytes +
      this.analysisBytes + this.inflightMemBytes + this.queries.size * this.cfg.queryMemBytes;
  }

  // In-memory segments are GC-managed: alive while any live snapshot
  // (root, a query's, the persister's or merger's) references them.
  reachableMemSegBytes() {
    const seen = new Set();
    let total = 0;
    for (const snap of this.liveSnapshots) {
      for (const ss of snap.segs) {
        if (ss.seg.kind === 'mem' && !seen.has(ss.seg)) {
          seen.add(ss.seg);
          total += ss.seg.bytes;
        }
      }
    }
    return total;
  }

  numFilesOnDisk() { return this.files.size + 1; } // +1 for root.bolt
  diskBytes() { let b = 0; for (const f of this.files.values()) b += f.bytes; return b; }
  zombieBytes() { let b = 0; for (const z of this.zombies.values()) b += z.bytes; return b; }

  // Mirrors index_bgthreads_active / the herder's scorchSize()==0 check.
  dcpPausedMs() {
    return this.stats.DcpFlowControlPausedMs + (this.kvPausedSince === null ? 0 : this.k.now - this.kvPausedSince);
  }

  bgThreadsActive() {
    const s = this.stats;
    return !(s.CurRootEpoch === s.LastPersistedEpoch && s.CurRootEpoch === s.LastMergedEpoch);
  }

  indexQuota() { return this.cfg.memQuotaBytes * this.cfg.memIndexingFraction; }
  overIndexQuota() { return this.memUsed() > this.indexQuota(); }

  // ---------------------------------------------------------------

  _buildProcs() {
    const m = this, k = this.k, cfg = this.cfg;

    // scorch channels (scorch.go Open)
    this.introductions = new Chan(k, 'introductions', 0);
    this.persists = new Chan(k, 'persists', 0);
    this.merges = new Chan(k, 'merges', 0);
    this.introducerNotifier = new Chan(k, 'introducerNotifier', 1);
    this.persisterNotifier = new Chan(k, 'persisterNotifier', 1);

    // cbft
    this.workerChs = [];
    for (let i = 0; i < cfg.numBatchWorkers; i++) this.workerChs.push(new Chan(k, `batchCh-${i}`, 1));
    this.dcpReady = new Cond(k, 'dcpReady');
    this.dcpSpace = new Cond(k, 'dcpSpace');
    this.herderCond = new Cond(k, 'herder.waitCond');
    this.analysisQueue = new Sem(k, 'analysisQueue', cfg.numCPUs);

    // Empty initial root, epoch 1 (as a freshly created index).
    this.root = new Snapshot(this, this.nextEpoch++, []);
    this.stats.CurRootEpoch = this.root.epoch;
    this.stats.LastPersistedEpoch = 0;
    this.stats.LastMergedEpoch = 0;

    k.spawn('kv', function* (p) { yield* m._kvProducer(p); }, { group: 'kv' });
    k.spawn('dcp', function* (p) { yield* m._dcpConsumer(p); }, { group: 'cbft' });
    for (let i = 0; i < cfg.numBatchWorkers; i++) {
      k.spawn(`batchWorker-${i}`, function* (p) { yield* m._batchWorker(p, i); }, { group: 'cbft', worker: i });
    }
    k.spawn('introducer', function* (p) { yield* m._introducerLoop(p); }, { group: 'scorch' });
    k.spawn('persister', function* (p) { yield* m._persisterLoop(p); }, { group: 'scorch' });
    k.spawn('merger', function* (p) { yield* m._mergerLoop(p); }, { group: 'scorch' });
    k.spawn('sampler', function* (p) { yield* m._sampler(p); }, { hidden: true });
    // cbft also wakes herder waiters when memory usage drops
    // (init_mem.go); model that as a periodic re-check.
    k.spawn('memChecker', function* () {
      for (;;) { yield k.sleep(250, 'memory check'); m._herderWake(); }
    }, { hidden: true });
  }

  // ---------------------------------------------------------------
  // Queries

  * _queryProc(p, id, durationMs, timeoutMs, label) {
    const k = this.k;
    // Reader() -> currentSnapshot(): AddRef root for the whole query.
    const snap = this.root.addRef();
    const q = { id, epoch: snap.epoch, snap, startedAt: k.now, durationMs, timeoutMs, label: label || '' };
    this.queries.set(id, q);
    this.stats.TotQueries++;
    const runFor = Math.min(durationMs, timeoutMs);
    yield k.work(runFor, `searching snapshot epoch ${snap.epoch}`);
    if (durationMs > timeoutMs) {
      this.stats.TotQueriesTimedOut++;
      this.log('query', `query ${id}: timed out after ${fmtMs(timeoutMs)} (context deadline exceeded)`);
    }
    this.queries.delete(id);
    snap.decRef(); // indexReader.Close()
    this._herderWake();
  }

  // ---------------------------------------------------------------
  // Sampling for charts

  * _sampler(p) {
    for (;;) {
      this.series.push(this.sample());
      if (this.series.length > 1200) this.series.splice(0, this.series.length - 1200);
      yield this.k.sleep(100, 'sampling');
    }
  }

  sample() {
    const root = this.root;
    let memSegs = 0, fileSegs = 0;
    for (const ss of root.segs) (ss.seg.kind === 'mem' ? memSegs++ : fileSegs++);
    return {
      t: this.k.now,
      memUsed: this.memUsed(),
      indexQuota: this.indexQuota(),
      memSegs, fileSegs,
      filesOnDisk: this.numFilesOnDisk(),
      diskBytes: this.diskBytes(),
      zombieBytes: this.zombieBytes(),
      dcpBuf: this.dcpBufUsed,
      mutations: this.stats.TotDcpMutations,
      introduced: this.stats.TotIntroducedItems,
      persisted: this.stats.TotPersistedItems,
      epochLag: this.stats.CurRootEpoch - this.stats.LastPersistedEpoch,
      blocked: this.numEventsBlocking,
    };
  }
}

function fmtVal(v) {
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Each goroutine group lives in its own file under procs/; their
// methods become Model's.
for (const Procs of [CbftProcs, BatchProcs, IntroducerProcs, PersisterProcs, MergerProcs, MergingProcs]) {
  for (const name of Object.getOwnPropertyNames(Procs.prototype)) {
    if (name !== 'constructor') Object.defineProperty(Model.prototype, name, Object.getOwnPropertyDescriptor(Procs.prototype, name));
  }
}
