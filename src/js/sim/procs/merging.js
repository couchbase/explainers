// What the persister's in-memory merges and the merger's file merges
// have in common: merging segments into a new zap file (zapx
// MergeUsing, which drops deleted docs), and handing the result to the
// introducer. Mixed into Model; `this` is the model.

import { Chan } from '../des.js';
import { MB } from '../config.js';
import { Segment } from '../segments.js';

export class MergingProcs {
  // Merges the segment snapshots `srcs` into one new file segment,
  // writes and fsyncs it. Returns it, or null if nothing in srcs is live.
  * _mergeToFile(p, srcs, { origin, mbps, by, label }) {
    const cfg = this.cfg;
    const liveDocs = srcs.reduce((a, ss) => a + ss.seg.docs - ss.deleted, 0);
    if (liveDocs <= 0) return null;
    const inBytes = srcs.reduce((a, ss) => a + ss.seg.bytes, 0);
    const bytes = liveDocs * cfg.fileBytesPerDoc;
    const seg = new Segment(this, { kind: 'file', docs: liveDocs, bytes, origin, sources: srcs.map((ss) => ss.seg.id) });
    this.ineligibleForRemoval.add(seg.fileName); // until a root.bolt commit lists it
    yield this.k.work((inBytes + bytes) / MB / mbps * 1000, `MergeUsing: ${label} → ${seg.fileName}`);
    yield* this._writeFile(p, seg, by);
    return seg;
  }

  // Sends a merge result on the introducer's merges channel and waits
  // until it's applied. Returns whether newSeg made it into the root
  // (it doesn't if everything in it was deleted meanwhile).
  * _introduceMergeResult(srcs, newSeg, fileMerge) {
    const notifyCh = new Chan(this.k, 'mergeNotify', 1);
    const old = new Map(srcs.map((ss) => [ss.seg.id, { seg: ss.seg, deleted: ss.deleted }]));
    const msg = { old, newSeg, fileMerge, notifyCh, introduced: false };
    yield this.merges.send(msg, fileMerge ? 'merges <- file merge result' : 'merges <- in-memory merge result');
    yield notifyCh.recv('waiting for merge introduction');
    return msg.introduced;
  }
}
