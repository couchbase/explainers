// cbft's side: KV's DCP producer, the DCP goroutine and its batches,
// the batch workers, and the app herder (pindex_bleve.go,
// cmd/cbft/app_herder.go). Mixed into Model; `this` is the model.

import { MB } from '../config.js';
import { fmtBytes } from '../fmt.js';

export class CbftProcs {
  // ---------------------------------------------------------------
  // KV + DCP

  // The KV engine's DCP producer: sends snapshots of mutations for
  // random vbuckets, subject to DCP flow control (buffer-ack).
  * _kvProducer(p) {
    const k = this.k;
    for (;;) {
      const rate = this.cfg.ingestDocsPerSec;
      if (rate <= 0) {
        yield k.sleep(100, 'idle: no mutations');
        continue;
      }
      const mean = Math.max(1, this.cfg.dcpSnapshotMeanDocs);
      const n = Math.max(1, Math.round(-Math.log(1 - k.rng()) * mean));
      const bytes = n * this.cfg.docBytes;
      if (this.dcpBufUsed + bytes > this.cfg.dcpBufferBytes && this.dcpBufUsed > 0) {
        this.kvPausedSince = k.now;
        this.log('dcp', `KV: DCP buffer full (${fmtBytes(this.dcpBufUsed)} unacked), pausing`);
        while (this.dcpBufUsed + bytes > this.cfg.dcpBufferBytes && this.dcpBufUsed > 0) {
          yield this.dcpSpace.wait('flow control: DCP buffer full, not acked');
        }
        this.stats.DcpFlowControlPausedMs += k.now - this.kvPausedSince;
        this.kvPausedSince = null;
      }
      this.dcpBufUsed += bytes;
      this.dcpQueue.push({ vb: Math.floor(k.rng() * this.cfg.numVBuckets), n, bytes });
      this.dcpReady.broadcast();
      yield k.work(n / rate * 1000, 'sending mutations');
    }
  }

  // gocbcore's DCP callback goroutine calling cbgt Dest ->
  // BleveDestPartition.DataUpdate / SnapshotStart (pindex_bleve.go).
  * _dcpConsumer(p) {
    const k = this.k;
    let batch = null;
    for (;;) {
      while (this.dcpQueue.length === 0) yield this.dcpReady.wait('waiting for DCP mutations');
      const snap = this.dcpQueue.shift();
      this.stats.TotDcpSnapshots++;
      // Within a snapshot: batch.Index() per doc, flush at maxOps;
      // flush at snapshot end (seq >= seqSnapEnd).
      let remaining = snap.n;
      while (remaining > 0) {
        if (!batch) batch = this._newBatch(snap.vb);
        const chunk = Math.min(remaining, Math.max(1, this.cfg.maxOpsPerBatch - batch.ops));
        // batch.Index fires EventKindIndexStart -> herder checkAndBlockIndex
        yield* this._herderBlock(p, 'IndexStart: over index quota');
        yield k.work(chunk * this.cfg.mapUsPerDoc / 1000, 'batch.Index: MapDocument');
        this._addToBatch(batch, chunk);
        remaining -= chunk;
        this.stats.TotDcpMutations += chunk;
        if (batch.ops >= this.cfg.maxOpsPerBatch) {
          yield* this._submitBatch(batch);
          batch = null;
        }
      }
      if (batch) {
        yield* this._submitBatch(batch);
        batch = null;
      }
      // Processed; ack the bytes (simplified: immediate buffer-ack).
      this.dcpBufUsed -= snap.bytes;
      this.dcpSpace.broadcast();
    }
  }

  _newBatch(vb) {
    const b = { vb, ops: 0, inserts: 0, updates: 0, deletes: 0, bytes: 0 };
    if (this.followNext && vb % this.workerChs.length === this.followNext.worker) {
      this.followNext = false;
      b.traced = true;
      this._trace('dcp', { vb });
    }
    return b;
  }

  _addToBatch(batch, n) {
    const rng = this.k.rng;
    for (let i = 0; i < n; i++) {
      const r = rng();
      if (r < this.cfg.deleteFraction) batch.deletes++;
      else if (r < this.cfg.deleteFraction + this.cfg.updateFraction) batch.updates++;
      else batch.inserts++;
    }
    const bytes = (n - 0) * this.cfg.docBytes;
    batch.ops += n;
    batch.bytes += bytes;
    this.pendingBatchBytes += bytes;
    this.stats.BatchBytesAdded += bytes;
  }

  // submitAsyncBatchRequestLOCKED: send to worker vb % N; blocks while
  // that worker's capacity-1 channel is full.
  * _submitBatch(batch) {
    const w = batch.vb % this.workerChs.length;
    const ch = this.workerChs[w];
    if (batch.traced) this._trace('channel', { worker: w });
    yield ch.send(batch, `${ch.name} <- batch (cap 1, worker busy)`);
  }

  // runBatchWorker: merge incoming batches, execute at maxOps or on the
  // flush ticker.
  * _batchWorker(p, i) {
    const k = this.k;
    const ch = this.workerChs[i];
    let target = null;
    let nextTick = k.now + this.cfg.batchFlushMs;
    for (;;) {
      const wait = Math.max(0, nextTick - k.now);
      const r = yield k.select([ch.recvCase(), k.timeoutCase(wait)], { label: 'waiting for batches / ticker' });
      if (r.index === 1) {
        nextTick = Math.max(nextTick + this.cfg.batchFlushMs, k.now + 1);
        if (target) {
          this.stats.TotBatchesFlushedOnTimer++;
          yield* this._execute(p, target);
          target = null;
        }
        continue;
      }
      const b = r.value;
      if (b.traced) this._trace('worker', { worker: i });
      if (!target) {
        target = b;
        this.stats.TotBatchesNew++;
      } else {
        target.ops += b.ops; target.inserts += b.inserts; target.updates += b.updates;
        target.deletes += b.deletes; target.bytes += b.bytes;
        target.traced ||= b.traced;
        this.stats.TotBatchesMerged++;
      }
      if (target.ops >= this.cfg.maxOpsPerBatch) {
        this.stats.TotBatchesFlushedOnMaxOps++;
        yield* this._execute(p, target);
        target = null;
      }
    }
  }

  // execute(): bindex.Batch(batch), synchronously.
  * _execute(p, batch) {
    yield* this._scorchBatch(p, batch);
    this.pendingBatchBytes -= batch.bytes;
    this.stats.BatchBytesRemoved += batch.bytes;
    this.stats.NumBatchesIntroduced++;
  }

  // ---------------------------------------------------------------
  // cbft app herder (cmd/cbft/app_herder.go)

  * _herderBlock(p, label, isBatch) {
    if (!this.cfg.herderEnabled) return;
    // MB-29504: let batches through if everything's persisted+merged.
    if (isBatch && !this.bgThreadsActive()) return;
    if (!this.overIndexQuota()) return;
    this.numEventsBlocking++;
    while (this.overIndexQuota() && !(isBatch && !this.bgThreadsActive())) {
      this.stats.TotHerderWaitingIn++;
      yield this.herderCond.wait(`herder: ${label}`);
      this.stats.TotHerderWaitingOut++;
    }
    this.numEventsBlocking--;
  }

  _herderWake() { this.herderCond.broadcast(); }
}
