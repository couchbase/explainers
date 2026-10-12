// The introducer (introducer.go): the one goroutine that swaps the
// root snapshot, for batches, persists and merges. Mixed into Model;
// `this` is the model.

import { Snapshot } from '../segments.js';

export class IntroducerProcs {
  // ---------------------------------------------------------------
  // Introducer (introducer.go)

  * _introducerLoop(p) {
    const k = this.k;
    let watchers = [];
    for (;;) {
      const r = yield k.select([
        this.introducerNotifier.recvCase(),
        this.merges.recvCase(),
        this.introductions.recvCase(),
        this.persists.recvCase(),
      ], { label: 'select: introductions / persists / merges' });
      this.introLast = { kind: ['watchers', 'merges', 'introductions', 'persists'][r.index], t: this.k.now };
      switch (r.index) {
        case 0: watchers.push(r.value); this.introWatchers = watchers; break;
        case 1: yield* this._introduceMerge(p, r.value); break;
        case 2: yield* this._introduceSegment(p, r.value); break;
        case 3: yield* this._introducePersist(p, r.value); break;
      }
      const epoch = this.root.epoch;
      const still = [];
      for (const w of watchers) {
        if (w.epoch < epoch) {
          w.notifyCh.close();
          if (w.traced) this._trace('watcherClosed');
        }
        else still.push(w);
      }
      watchers = still;
      this.introWatchers = watchers; // for the diagram
    }
  }

  _swapRoot(next) {
    const prev = this.root;
    this.root = next;
    this.stats.CurRootEpoch = next.epoch;
    prev.decRef();
  }

  * _introduceSegment(p, intro) {
    const k = this.k;
    yield k.work(this.cfg.introduceMs + this.root.segs.length * 0.002, 'introduceSegment');
    // Obsolete older versions of updated/deleted docs, spread across
    // existing segments weighted by live docs (we don't track ids).
    const prevSegs = this.root.segs;
    const deltas = this._pickVictims(prevSegs, intro.updates + intro.deletes);
    const segs = [];
    prevSegs.forEach((ss, i) => {
      const deleted = ss.deleted + deltas[i];
      if (ss.seg.docs - deleted > 0) {
        ss.seg.addRef();
        segs.push({ seg: ss.seg, deleted });
      } else if (ss.seg.kind === 'file') {
        this.log('drop', `introducer: dropped fully-deleted ${ss.seg.fileName}`);
      }
    });
    if (intro.seg) {
      segs.push({ seg: intro.seg, deleted: 0 });
      this.stats.TotIntroducedSegmentsBatch++;
      this.stats.TotIntroducedItems += intro.seg.docs;
    }
    this.expectedLiveDocs += (intro.seg ? intro.seg.docs : 0) - deltas.reduce((a, b) => a + b, 0);
    const next = new Snapshot(this, this.nextEpoch++, segs);
    if (intro.persisted) (this.rootPersisted ||= []).push(intro.persisted);
    this._swapRoot(next);
    intro.applied.close();
  }

  _pickVictims(segs, n) {
    const deltas = segs.map(() => 0);
    if (n <= 0 || segs.length === 0) return deltas;
    const lives = segs.map((ss) => ss.seg.docs - ss.deleted);
    let total = lives.reduce((a, b) => a + b, 0);
    const rng = this.k.rng;
    // Split n proportionally, with a random remainder; cap at live.
    for (let i = 0; i < segs.length && total > 0; i++) {
      const want = n * lives[i] / total;
      let d = Math.floor(want) + (rng() < want - Math.floor(want) ? 1 : 0);
      d = Math.min(d, lives[i]);
      deltas[i] = d;
    }
    return deltas;
  }

  * _introducePersist(p, persist) {
    yield this.k.work(this.cfg.introduceMs, 'introducePersist');
    const segs = [];
    for (const ss of this.root.segs) {
      const f = persist.persisted.get(ss.seg.id);
      if (f) {
        segs.push({ seg: f, deleted: ss.deleted }); // takes the open ref
        persist.used.add(f);
      } else {
        ss.seg.addRef();
        segs.push({ seg: ss.seg, deleted: ss.deleted });
      }
    }
    this._swapRoot(new Snapshot(this, this.nextEpoch++, segs));
    persist.applied.close();
  }

  * _introduceMerge(p, merge) {
    yield this.k.work(this.cfg.introduceMs + this.root.segs.length * 0.002, 'introduceMerge');
    const segs = [];
    let newDeleted = 0;
    const seen = new Set();
    for (const ss of this.root.segs) {
      const old = merge.old.get(ss.seg.id);
      if (old) {
        // deletes that arrived while merging, remapped to the new segment
        newDeleted += ss.deleted - old.deleted;
        seen.add(ss.seg.id);
      } else {
        ss.seg.addRef();
        segs.push({ seg: ss.seg, deleted: ss.deleted });
      }
    }
    // Sources that left root mid-merge (fully deleted): all their docs
    // that were live at merge start are deleted in the output.
    for (const [id, old] of merge.old) {
      if (!seen.has(id)) newDeleted += old.seg.docs - old.deleted;
    }
    let introduced = false;
    if (merge.newSeg && merge.newSeg.docs > newDeleted) {
      segs.push({ seg: merge.newSeg, deleted: newDeleted });
      introduced = true;
    }
    this._swapRoot(new Snapshot(this, this.nextEpoch++, segs));
    if (merge.fileMerge) {
      if (introduced) this.stats.TotFileMergeIntroductionsDone++;
      else this.stats.TotFileMergeIntroductionsObsoleted++;
      this.stats.TotIntroducedSegmentsMerge++;
    }
    if (!introduced && merge.newSeg) merge.newSeg.decRef();
    merge.introduced = introduced;
    merge.notifyCh.close();
  }
}
