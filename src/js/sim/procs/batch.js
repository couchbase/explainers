// scorch's Batch() (scorch.go): analysis on the shared analysis queue,
// building an in-memory segment, and handing it to the introducer.
// Mixed into Model; `this` is the model.

import { Chan, WaitGroup } from '../des.js';
import { Segment } from '../segments.js';

export class BatchProcs {
  // ---------------------------------------------------------------
  // scorch Batch() (scorch.go)

  * _scorchBatch(p, batch) {
    const k = this.k, cfg = this.cfg;
    const t0 = k.now;
    if (batch.traced) this._trace('herder');
    // fireEvent(EventKindBatchIntroductionStart) -> herder checkAndBlockBatch
    yield* this._herderBlock(p, 'BatchIntroductionStart: over index quota', true);
    this.stats.TotBatches++;
    // A zero-time step, so passing the herder and starting analysis are
    // separate moments (a story step can stop between them).
    if (batch.traced) yield k.work(0, 'Scorch.Batch()');
    if (batch.traced) this._trace('analysis');

    const numDocs = batch.inserts + batch.updates;
    let seg = null;
    if (numDocs > 0) {
      // Analysis fan-out onto the shared analysis queue (NumCPU workers).
      const abytes = numDocs * cfg.docBytes;
      this.analysisBytes += abytes;
      yield* this._analyze(p, numDocs);
      // NewUsing(): encode an in-memory zap segment.
      yield k.work(numDocs * cfg.buildUsPerDoc / 1000, 'NewUsing: building in-memory segment');
      this.analysisBytes -= abytes;
      seg = new Segment(this, { kind: 'mem', docs: numDocs, bytes: numDocs * cfg.memBytesPerDoc, origin: 'batch' });
      this.inflightMemBytes += seg.bytes;
      if (batch.traced) this._trace('introducing', { segId: seg.id });
    } else {
      this.stats.TotBatchesEmpty++;
    }
    // prepareSegment(): obsoletes computed against every root segment.
    const obsoleting = batch.updates + batch.deletes;
    if (obsoleting > 0) {
      yield k.work(this.root.segs.length * obsoleting * 0.0005, 'prepareSegment: computing obsoletes');
    }
    const intro = {
      seg, updates: batch.updates, deletes: batch.deletes, inserts: batch.inserts,
      applied: new Chan(k, 'applied', 0),
      persisted: cfg.unsafeBatch ? null : new Chan(k, 'persisted', 1),
    };
    yield this.introductions.send(intro, 'introductions <- segment');
    yield intro.applied.recv('waiting for introduction to be applied');
    if (batch.traced && seg) this._trace('introduced', { segId: seg.id });
    if (seg) this.inflightMemBytes -= seg.bytes;
    if (intro.persisted) yield intro.persisted.recv('waiting for persistence (safe batch)');
    const dt = k.now - t0;
    this.stats.TotBatchIntroTime += dt;
    this.stats.MaxBatchIntroTime = Math.max(this.stats.MaxBatchIntroTime, dt);
  }

  * _analyze(p, numDocs) {
    const k = this.k, cfg = this.cfg;
    const n = Math.min(cfg.numCPUs, numDocs);
    const wg = new WaitGroup(k);
    const per = numDocs / n;
    const q = this.analysisQueue;
    for (let i = 0; i < n; i++) {
      wg.add(1);
      k.spawn(`analyze`, function* () {
        yield q.acquire('analysis queue full');
        yield k.work(per * cfg.analyzeUsPerDoc / 1000, 'analyzing');
        q.release();
        wg.done();
      }, { hidden: true });
    }
    yield wg.wait('waiting for analysis');
  }
}
