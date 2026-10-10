// The merger (merge.go): tiered merge plans over file segments, run
// one task at a time. Mixed into Model; `this` is the model.

import { Chan } from '../des.js';
import { plan as mergePlan } from '../mergeplan.js';
import { fmtBytes, fmtMs } from '../fmt.js';

// A snapshot's file segments, as mergeplan.Plan() sees them.
export function planInput(snap) {
  return snap.segs.filter((ss) => ss.seg.kind === 'file').map((ss) => ({
    id: ss.seg.id,
    ss,
    fullSize: ss.seg.docs,
    liveSize: ss.seg.docs - ss.deleted,
    fileSize: ss.seg.bytes,
    liveFileSize: ss.seg.docs > 0 ? Math.floor(ss.seg.bytes * (ss.seg.docs - ss.deleted) / ss.seg.docs) : 0,
  }));
}

export class MergerProcs {
  // ---------------------------------------------------------------
  // Merger (merge.go)

  * _mergerLoop(p) {
    const k = this.k;
    let lastEpochMergePlanned = 0;
    for (;;) {
      const ourSnapshot = this.root.addRef();
      if (ourSnapshot.epoch !== lastEpochMergePlanned) {
        this.mergerSnapshot = ourSnapshot;
        const t0 = k.now;
        yield* this._planMergeAtSnapshot(p, ourSnapshot);
        this.mergerSnapshot = null;
        lastEpochMergePlanned = ourSnapshot.epoch;
        this.stats.LastMergedEpoch = ourSnapshot.epoch;
        this._herderWake(); // EventKindMergerProgress
        if (k.now - t0 > 1) this.log('merge', `merger: planned epoch ${ourSnapshot.epoch} in ${fmtMs(k.now - t0)}`);
      }
      ourSnapshot.decRef();
      const ew = { epoch: lastEpochMergePlanned, notifyCh: new Chan(k, 'mergerWatcher', 1) };
      yield this.persisterNotifier.send(ew, 'persisterNotifier <- watcher');
      yield ew.notifyCh.recv('waiting for persister to persist a newer epoch');
    }
  }

  * _planMergeAtSnapshot(p, snap) {
    const k = this.k, cfg = this.cfg;
    const input = planInput(snap);
    this.stats.TotFileMergePlan++;
    const pl = mergePlan(input, cfg.mergePlan);
    this.lastMergePlan = { epoch: snap.epoch, budget: pl.budget, numSegs: input.length, tasks: pl.tasks.length };
    if (pl.tasks.length === 0) {
      this.stats.TotFileMergePlanNone++;
      return;
    }
    this.stats.TotFileMergePlanTasks += pl.tasks.length;
    for (const task of pl.tasks) {
      const srcs = task.segments.map((x) => x.ss);
      const inBytes = srcs.reduce((a, ss) => a + ss.seg.bytes, 0);
      const label = `merging ${srcs.length} files (${fmtBytes(inBytes)})`;
      const ours = this.trace && srcs.find((ss) => ss.seg.id === this.trace.segId);
      if (ours) this._trace('merging');
      this.currentMerge = { srcs: srcs.map((ss) => ss.seg.id), label };
      const newSeg = yield* this._mergeToFile(p, srcs,
        { origin: 'filemerge', mbps: cfg.fileMergeMBps, by: 'merger', label });
      if (newSeg) this.stats.TotFileMergeWrittenBytes += newSeg.bytes;
      this.stats.TotFileMergeSegments += srcs.length;
      const introduced = yield* this._introduceMergeResult(srcs, newSeg, true);
      if (ours && introduced) {
        this.trace.oldFiles.push(ours.seg.fileName);
        this._trace('merged', { segId: newSeg.id, fileName: newSeg.fileName });
      }
      this.currentMerge = null;
      this.log('merge', `merger: ${srcs.length} files → ${newSeg ? newSeg.fileName : '(nothing live)'}`);
    }
  }
}
