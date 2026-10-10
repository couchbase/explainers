// The persister (persister.go): naps, in-memory merges, writing zap
// files, root.bolt commits, and cleanup (removeOldData). Mixed into
// Model; `this` is the model.

import { Chan, Sem, WaitGroup } from '../des.js';
import { MB } from '../config.js';
import { fmtBytes, fmtMs } from '../fmt.js';
import { Segment, zapFileName } from '../segments.js';

export class PersisterProcs {
  // ---------------------------------------------------------------
  // Persister (persister.go)

  * _persisterLoop(p) {
    const k = this.k;
    let watchers = [];
    let lastPersistedEpoch = 0, lastMergedEpoch = 0;
    for (;;) {
      this.stats.TotPersistLoopBeg++;
      let r = yield k.select([this.persisterNotifier.recvCase()], { default: true });
      if (r.index === 0) {
        watchers.push(r.value);
        if (r.value.epoch > lastMergedEpoch) lastMergedEpoch = r.value.epoch;
      }

      // pausePersisterForMergerCatchUp
      ({ lastMergedEpoch, watchers } = yield* this._pausePersister(p, lastPersistedEpoch, lastMergedEpoch, watchers));

      if (this.root.epoch > lastPersistedEpoch) {
        const ourSnapshot = this.root.addRef();
        this.persisterSnapshot = ourSnapshot;
        const ourPersisted = this.rootPersisted || [];
        this.rootPersisted = null;
        const t0 = k.now;
        yield* this._persistSnapshot(p, ourSnapshot);
        for (const ch of ourPersisted) ch.close();
        this.stats.LastPersistedEpoch = ourSnapshot.epoch;
        lastPersistedEpoch = ourSnapshot.epoch;
        for (const w of watchers) w.notifyCh.close();
        watchers = [];
        this.persisterSnapshot = null;
        ourSnapshot.decRef();
        this._herderWake(); // EventKindPersisterProgress
        this.log('persist', `persister: epoch ${ourSnapshot.epoch} persisted in ${fmtMs(k.now - t0)}`);
        if (this.root.epoch !== lastPersistedEpoch) {
          this.stats.TotPersistLoopProgress++;
          continue;
        }
      }

      // Tell the introducer we're waiting for changes.
      const w = { epoch: lastPersistedEpoch, notifyCh: new Chan(k, 'persisterWatcher', 1) };
      yield this.introducerNotifier.send(w, 'introducerNotifier <- watcher');
      yield* this._removeOldData(p); // might as well cleanup while waiting
      this.stats.TotPersistLoopWait++;
      r = yield k.select([w.notifyCh.recvCase(), this.persisterNotifier.recvCase()],
        { label: 'waiting for a new root epoch' });
      if (r.index === 1) watchers.push(r.value);
    }
  }

  * _pausePersister(p, lastPersistedEpoch, lastMergedEpoch, watchers) {
    const k = this.k, cfg = this.cfg;
    watchers = this._notifyMergeWatchers(lastPersistedEpoch, watchers);
    let numFiles = this.numFilesOnDisk();
    if (numFiles < cfg.persisterNapUnderNumFiles && cfg.persisterNapMs > 0 && this.numEventsBlocking === 0) {
      const r = yield k.select([k.timeoutCase(cfg.persisterNapMs), this.persisterNotifier.recvCase()],
        { state: 'sleep', label: `nap ${cfg.persisterNapMs}ms: letting segments pile up` });
      if (r.index === 0) {
        this.stats.TotPersisterNapPauseCompleted++;
      } else {
        watchers.push(r.value);
        lastMergedEpoch = r.value.epoch;
        watchers = this._notifyMergeWatchers(lastPersistedEpoch, watchers);
        this.stats.TotPersisterMergerNapBreak++;
      }
      return { lastMergedEpoch, watchers };
    }
    if (numFiles > cfg.persisterNapUnderNumFiles) {
      yield* this._removeOldData(p);
      numFiles = this.numFilesOnDisk();
    }
    while (cfg.persisterNapUnderNumFiles > 0 && numFiles >= cfg.persisterNapUnderNumFiles &&
      lastMergedEpoch < lastPersistedEpoch) {
      this.stats.TotPersisterSlowMergerPause++;
      this.log('pause', `persister: ${numFiles} files ≥ ${cfg.persisterNapUnderNumFiles}, pausing for merger`);
      const r = yield k.select([this.persisterNotifier.recvCase()],
        { label: `paused: ${numFiles} files, waiting for merger to catch up` });
      watchers.push(r.value);
      lastMergedEpoch = r.value.epoch;
      this.stats.TotPersisterSlowMergerResume++;
      watchers = this._notifyMergeWatchers(lastPersistedEpoch, watchers);
      numFiles = this.numFilesOnDisk();
    }
    return { lastMergedEpoch, watchers };
  }

  _notifyMergeWatchers(lastPersistedEpoch, watchers) {
    const next = [];
    for (const w of watchers) {
      if (w.epoch < lastPersistedEpoch) w.notifyCh.close();
      else next.push(w);
    }
    return next;
  }

  * _persistSnapshot(p, snap) {
    if (this.numEventsBlocking < this.cfg.memoryPressurePauseThreshold) {
      const ok = yield* this._persistSnapshotMaybeMerge(p, snap);
      if (ok) return;
    }
    yield* this._persistSnapshotDirect(p, snap);
  }

  * _persistSnapshotMaybeMerge(p, snap) {
    const k = this.k, cfg = this.cfg;
    const unpersisted = snap.segs.filter((ss) => ss.seg.kind === 'mem');
    if (unpersisted.length < 2) return false;

    const flushSet = [];
    if (cfg.numPersisterWorkers <= 1 && cfg.maxSizeInMemoryMergePerWorker <= 0) {
      flushSet.push(unpersisted);
    } else {
      let cur = [], running = 0;
      for (const ss of unpersisted) {
        cur.push(ss);
        running += ss.seg.bytes;
        if (running >= cfg.maxSizeInMemoryMergePerWorker && cur.length >= 2) {
          flushSet.push(cur);
          cur = [];
          running = 0;
        }
      }
      if (cur.length > 0) flushSet.push(cur);
    }

    // mergeAndPersistInMemorySegments: up to NumPersisterWorkers at once.
    const m = this;
    const sem = new Sem(k, 'persisterWorkers', Math.max(1, cfg.numPersisterWorkers));
    const wg = new WaitGroup(k);
    const newFiles = [];
    let skipped = false;
    flushSet.forEach((flushable, wi) => {
      wg.add(1);
      k.spawn(`persisterWorker-${wi}`, function* (wp) {
        yield sem.acquire('waiting for a persister worker slot');
        const ours = m.trace && flushable.some((ss) => ss.seg.id === m.trace.segId);
        if (ours) m._trace('persisting', { pworker: wi });
        const seg = yield* m._mergeToFile(wp, flushable,
          { origin: 'memmerge', mbps: cfg.memMergeMBps, by: 'persister', label: `${flushable.length} mem segs` });
        if (seg) {
          m.stats.TotMemMergeDone++;
          m.stats.TotMemMergeSegments += flushable.length;
        }
        const introduced = yield* m._introduceMergeResult(flushable, seg, false);
        if (introduced) newFiles.push(seg);
        else skipped = true;
        if (ours && introduced) m._trace('file', { segId: seg.id, fileName: seg.fileName });
        sem.release();
        wg.done();
      }, { group: 'scorch', persisterWorker: wi });
    });
    yield wg.wait(`waiting for ${flushSet.length} in-memory merge(s)`);
    if (skipped) {
      this.log('memmerge', 'persister: in-memory merge result obsoleted; falling back');
      return false;
    }
    this.log('memmerge', `persister: merged ${unpersisted.length} mem segs → ${newFiles.length} file(s)`);
    // Persist an "equivalent" snapshot: same epoch, all files.
    const names = new Set(snap.segs.filter((ss) => ss.seg.kind === 'file').map((ss) => ss.seg.fileName));
    for (const f of newFiles) names.add(f.fileName);
    this.stats.TotPersistedItems += unpersisted.reduce((a, ss) => a + ss.seg.docs, 0);
    this.stats.TotPersistedSegments += newFiles.length;
    yield* this._boltCommit(p, snap.epoch, names);
    return true;
  }

  * _persistSnapshotDirect(p, snap) {
    const k = this.k;
    const persisted = new Map();
    for (const ss of snap.segs) {
      if (ss.seg.kind !== 'mem') continue;
      const f = new Segment(this, { kind: 'file', docs: ss.seg.docs, bytes: ss.seg.docs * this.cfg.fileBytesPerDoc, origin: 'persist', sources: [ss.seg.id] });
      // Persisted segments keep the id of the in-memory segment.
      this.nextSegmentID--;
      f.id = ss.seg.id;
      f.fileName = zapFileName(f.id);
      this.ineligibleForRemoval.add(f.fileName);
      if (this.trace && this.trace.segId === ss.seg.id && this.trace.stage === 'introduced') this._trace('persisting', { pworker: null });
      yield* this._writeFile(p, f, 'persister');
      persisted.set(ss.seg.id, f);
      this.stats.TotPersistedItems += f.docs;
      this.stats.TotPersistedSegments++;
    }
    if (persisted.size > 0) {
      const persist = { persisted, used: new Set(), applied: new Chan(k, 'persistApplied', 0) };
      yield this.persists.send(persist, 'persists <- new files');
      yield persist.applied.recv('waiting for persist introduction');
      for (const f of persisted.values()) if (!persist.used.has(f)) f.decRef();
      const ourFile = this.trace && persisted.get(this.trace.segId);
      if (ourFile && persist.used.has(ourFile) && this.trace.stage === 'persisting') {
        this._trace('file', { segId: ourFile.id, fileName: ourFile.fileName });
      }
    }
    const names = new Set();
    for (const ss of snap.segs) names.add(ss.seg.kind === 'file' ? ss.seg.fileName : zapFileName(ss.seg.id));
    yield* this._boltCommit(p, snap.epoch, names);
  }

  // zapx PersistSegmentBase / merge output: write, fsync, then mmap.
  * _writeFile(p, seg, by) {
    const k = this.k, cfg = this.cfg;
    this.diskActiveWriters++;
    this.writing.set(seg.fileName, { by, seg, since: k.now });
    const share = cfg.diskWriteMBps / this.diskActiveWriters;
    this.files.set(seg.fileName, { name: seg.fileName, bytes: 0, seg, createdAt: k.now });
    yield k.work(seg.bytes / MB / share * 1000, `writing ${seg.fileName} (${fmtBytes(seg.bytes)})`);
    this.files.get(seg.fileName).bytes = seg.bytes;
    yield k.work(cfg.fsyncMs, `fsync ${seg.fileName}`);
    this.diskActiveWriters--;
    this.writing.delete(seg.fileName);
  }

  * _boltCommit(p, epoch, names) {
    const k = this.k;
    yield k.work(this.cfg.boltCommitMs, `root.bolt: commit snapshot ${epoch}`);
    yield k.work(this.cfg.fsyncMs, 'root.bolt: fsync');
    this.bolt.unshift({ epoch, time: k.now, files: names });
    for (const n of names) this.ineligibleForRemoval.delete(n);
  }

  // ---- cleanup (removeOldData) ----

  _addEligibleForRemoval(epoch) {
    if (this.root && epoch === this.root.epoch) return;
    this.eligibleForRemoval.push(epoch);
  }

  * _removeOldData(p) {
    const removed = this._removeOldBoltSnapshots();
    if (removed > 0) {
      yield this.k.work(this.cfg.boltCommitMs + this.cfg.fsyncMs, `root.bolt: removed ${removed} old snapshot(s)`);
    }
    this._removeOldZapFiles();
  }

  liveBoltSnapshots() {
    const cfg = this.cfg, meta = this.bolt;
    if (meta.length === 0) return [];
    if (!(cfg.rollbackSamplingIntervalMs > 0)) return meta.slice(0, cfg.numSnapshotsToKeep);
    const extra = cfg.numSnapshotsToKeep - 1;
    if (extra <= 0) return [meta[0]];
    const cutoff = this.k.now - extra * cfg.rollbackSamplingIntervalMs;
    return [meta[0], ...meta.slice(1).filter((s) => s.time >= cutoff)];
  }

  // getProtectedSnapshots + getTimeSeriesSnapshots
  protectedEpochs(live) {
    const cfg = this.cfg;
    const rv = new Set();
    const maxPoints = cfg.numSnapshotsToKeep - 1;
    const interval = cfg.rollbackSamplingIntervalMs;
    if (interval > 0 && live.length > 0 && maxPoints > 0) {
      let ptr = live.length - 1;
      rv.add(live[ptr].epoch);
      let n = 1;
      for (let i = ptr - 1; i >= 0 && n < maxPoints; i--) {
        const since = live[i].time - live[ptr].time;
        if (since >= interval) {
          const idx = since > interval ? i + 1 : i;
          if (!rv.has(live[idx].epoch)) {
            rv.add(live[idx].epoch);
            ptr = idx;
            n++;
          }
        }
      }
    }
    if (live.length > 0) rv.add(live[0].epoch);
    for (let i = 1; i < live.length && rv.size < cfg.numSnapshotsToKeep; i++) rv.add(live[i].epoch);
    return rv;
  }

  _removeOldBoltSnapshots() {
    const live = this.liveBoltSnapshots();
    if (live.length === 0) return 0;
    const prot = this.protectedEpochs(live);
    this.protected = prot;
    const toRemove = new Set();
    const keep = [];
    for (const e of this.eligibleForRemoval) {
      if (prot.has(e)) keep.push(e);
      else toRemove.add(e);
    }
    this.eligibleForRemoval = keep;
    const before = this.bolt.length;
    this.bolt = this.bolt.filter((s) => !toRemove.has(s.epoch));
    const n = before - this.bolt.length;
    this.stats.TotSnapshotsRemovedFromMetaStore += n;
    return n;
  }

  _removeOldZapFiles() {
    const live = new Set();
    for (const s of this.bolt) for (const n of s.files) live.add(n);
    for (const [name, f] of this.files) {
      if (live.has(name) || this.ineligibleForRemoval.has(name)) continue;
      this.files.delete(name);
      this.stats.TotFilesRemoved++;
      this.recentDeletes.push({ name, bytes: f.bytes, t: this.k.now });
      if (this.recentDeletes.length > 60) this.recentDeletes.shift();
      if (this.trace && this.trace.oldFiles.includes(name)) this._trace('oldFileDeleted', { deletedFile: name });
      if (f.seg.open) {
        // os.Remove() on a file that's still mmapped by some snapshot:
        // the name is gone, the blocks aren't.
        this.zombies.set(name, { name, bytes: f.bytes, seg: f.seg, since: this.k.now });
        this.log('zombie', `removeOldZapFiles: unlinked ${name} but it is still open (refs=${f.seg.refs})`);
      }
    }
  }

  _closeFileSegment(seg) {
    seg.open = false;
    if (this.zombies.delete(seg.fileName)) {
      this.log('zombie', `${seg.fileName} closed; its ${fmtBytes(seg.bytes)} are finally freed`);
    }
  }
}
