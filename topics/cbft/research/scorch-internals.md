# Scorch internals: goroutines, refcounts, backpressure

Research notes backing the explainer. Versions are pinned to what
cbft master uses (see `topics/cbft/sources.yaml`):

- bleve `v2.6.1-0.20260807085028-9d2da23a5c58` (commit `9d2da23a5c58`)
- zapx/v17 `v17.2.2-0.20260806075952-6594f3d6bd0d` (commit `6594f3d6bd0d`)

Paths are relative to each module root. Line numbers refer to those
versions; the explainer's code links are resolved from symbols by
`npm run snippets`, so they don't rot the way the numbers below can.

**TL;DR**: scorch has *no* built-in mechanism that pauses introductions
based on in-memory segment count. Backpressure comes from:

1. `Batch()` being synchronous (and, in safe mode, waiting for persist);
2. a single introducer goroutine fed by unbuffered channels;
3. the persister pausing when the merger falls behind (too many files);
4. an optional app `onEvent` hook that can block inside `Batch()`
   (and whose in-flight count, `NumEventsBlocking`, the persister
   consults).

cbft runs with `unsafe_batch=true`, so (1) does not wait for persist,
and cbft's "app herder" (4) is the real memory backpressure. See
[cbft-usage.md](cbft-usage.md).

## 0. Goroutines and channels

- `Open()` always starts `introducerLoop`; `persisterLoop` and
  `mergerLoop` only if not read-only and path != "" (`scorch.go:343-356`).
  With no path, `unsafeBatch` is forced true (`scorch.go:367-369`).
- Channels (`scorch.go:420-426`): unbuffered `introductions`,
  `persists`, `merges`; buffered(1) `introducerNotifier`,
  `persisterNotifier` (both `chan *epochWatcher`), `forceMergeRequestCh`.
- No online revert: rollback is offline, `Rollback(path, to)` deletes
  newer bolt snapshot buckets in a closed store (`rollback.go:140-230`).
- One global epoch counter `nextSnapshotEpoch` (starts at 1,
  `scorch.go:63,190`), bumped on every root swap: segment introduction
  (`introducer.go:240-241`), persist introduction (`introducer.go:270-271`),
  merge introduction (`introducer.go:500-501`).
- Stats: `CurRootEpoch`, `LastPersistedEpoch`, `LastMergedEpoch`;
  `index_bgthreads_active` is true if either of the latter lags root
  (`scorch.go:820-826`).

## 1. `Batch()` path (`scorch.go:500-610`)

1. Fires `EventKindBatchIntroductionStart` (`scorch.go:504`). `fireEvent`
   brackets the callback with `TotEventTriggerStarted/Completed`
   (`scorch.go:318-326`); `NumEventsBlocking() = started - completed`
   (`scorch.go:312-316`). This is how an app (cbft) can block writers
   and how scorch notices that pressure.
2. Analysis fan-out: one `analyze(doc)` per doc onto the shared
   `analysisQueue` worker pool (`scorch.go:538-551`); caller collects
   from `resultChan` (`scorch.go:557-569`).
3. Builds the in-memory segment in the caller's goroutine:
   `s.segPlugin.NewUsing(analysisResults, s.segmentConfig)`
   (`scorch.go:580`). In zapx this encodes the whole batch into a
   zap-format `bytes.Buffer` wrapped as a `*SegmentBase`
   (`(zapx) new.go:53-96`). `SegmentBase.AddRef/DecRef` are no-ops
   (`(zapx) segment.go:185-186`) — GC manages in-memory segment memory.
   Delete-only batches build no segment (`TotBatchesEmpty`).
4. `prepareSegment` (`scorch.go:635-690`):
   - builds `segmentIntroduction{id, data, ids, internal, applied,
     persistedCallback}` (`introducer.go:29-39`);
   - if `!unsafeBatch`, adds `persisted = make(chan error, 1)`
     (`scorch.go:647-649`);
   - computes obsoletes optimistically *outside* the introducer:
     AddRefs current root and runs `DocNumbers(ids)` on every root
     segment (`scorch.go:651-667`) — O(#segments × #ids) in the caller;
   - `s.introductions <- introduction` (`scorch.go:671`), blocks on
     `<-introduction.applied` (`scorch.go:674`), and in safe mode also
     on `<-introduction.persisted` (`scorch.go:679-681`).
5. `batch.PersistedCallback()` is invoked by the persister after a
   successful persist (`persister.go:236-238`).

## 2. Introducer loop (`introducer.go:51-106`)

`select`s on `closeCh`, `introducerNotifier`, `merges`,
`introductions`, `persists`. Go's `select` picks randomly among ready
cases. After each event, watchers with `w.epoch < root.epoch` get their
channel closed (`introducer.go:90-104`).

`introduceSegment` (`introducer.go:108-261`):

- new `IndexSnapshot{refs:1}`; reuse the caller-computed obsoletes,
  recompute only for segments newer than that pass (`:137-147`);
- `deleted = old.deleted OR delta` (`:158-166`);
- keep segments with `LiveSize() > 0` (AddRef), drop fully-deleted ones
  (`:174-182`);
- append the new segment last (`:197-217`); apply internal k/v (`:218-229`);
- under `rootLock`: queue `persisted` chan + callback for the persister,
  assign epoch, swap root (`:232-246`); then `rootPrev.DecRef()` and
  `close(next.applied)` (`:248-258`).

`introducePersist` (`introducer.go:263-340`): replaces each
just-persisted in-memory segment by its mmapped file segment (same id,
deleted bitmap, stats), AddRefs the rest, closes `persist.applied`.

Refcounting:

- `s.root` holds one ref. `IndexSnapshot.AddRef/DecRef` are
  mutex-protected (`snapshot_index.go:112-136`); at 0 it DecRefs every
  segment and `go parent.AddEligibleForRemoval(epoch)` (`:121-132`);
  skipped if that epoch is still root's (`scorch.go:922-928`).
- File segments start at `refs:1` in `OpenUsing`; at 0 → `closeActual()`
  unmaps and closes the fd (`(zapx) segment.go:227-241, 695-716`).
  An mmap/fd lives exactly as long as the last snapshot containing it.

## 3. Persister loop (`persister.go:142-297`)

Each iteration:

1. non-blocking read of `persisterNotifier` (merger watchers) (`:165-171`);
2. `pausePersisterForMergerCatchUp` (`:175-176`, body at `:313-379`):
   - **nap**: if `numFilesOnDisk < PersisterNapUnderNumFiles &&
     PersisterNapTimeMSec > 0 && NumEventsBlocking()==0`, sleep
     `PersisterNapTimeMSec` (letting memory segments pile up for a bigger
     in-memory merge); a merger watcher breaks the nap.
     Stats: `TotPersisterNapPauseCompleted`, `TotPersisterMergerNapBreak`.
   - if `numFilesOnDisk > PersisterNapUnderNumFiles`, `removeOldData()` first.
   - **slow-merger pause**: while `numFilesOnDisk >= PersisterNapUnderNumFiles
     && lastMergedEpoch < lastPersistedEpoch`, block until the merger
     sends a watcher. Stats: `TotPersisterSlowMergerPause/Resume`.
   - `numFilesOnDisk` counts every file in the dir incl. `root.bolt`
     (`scorch.go:728-757`).
3. under `rootLock`, if `root.epoch > lastPersistedEpoch`: AddRef root,
   take ownership of `rootPersisted` + `persistedCallbacks`
   (`:183-194`). Only the latest root is persisted; intermediate epochs
   are skipped — a natural group commit.
4. `persistSnapshot()`; signal `ourPersisted` chans (`:199-205`); on
   success run callbacks, set `LastPersistedEpoch`, close merger
   watchers (`:228-248`), fire `EventKindPersisterProgress`; loop again
   immediately if root moved (`TotPersistLoopProgress`).
5. else send `epochWatcher{lastPersistedEpoch}` to the introducer, run
   `removeOldData()` while idle (`:277-279`), wait for the watcher or a
   merger watcher.

Persist strategy (`persister.go:422-437`): if `NumEventsBlocking() <
MemoryPressurePauseThreshold` (default MaxUint64) try
`persistSnapshotMaybeMerge`, else / on decline `persistSnapshotDirect`.

`persistSnapshotMaybeMerge` (`persister.go:453-572`):

- needs ≥ `DefaultMinSegmentsForInMemoryMerge = 2` unpersisted segments.
- legacy mode (`NumPersisterWorkers==1 && MaxSizeInMemoryMergePerWorker==0`):
  merge all in-memory segments into one; otherwise cut flushables at
  `MaxSizeInMemoryMergePerWorker` bytes (`:494-521`).
- `mergeAndPersistInMemorySegments` (`merge.go:553-726`): up to
  `NumPersisterWorkers` goroutines, each `MergeUsing(...)` → file,
  `OpenUsing`, then sends `segmentMerge{fileMerge:false}` on the same
  `s.merges` channel the file merger uses.
- then persists an "equiv" snapshot (same epoch) whose segments are all
  files, so `persistSnapshotDirect` only commits bolt (`:536-571`).

`persistSnapshotDirect` (`persister.go:792-870`):

1. bolt write tx; `prepareBoltSnapshot` writes `snapshots/<epoch>`
   with meta, internal k/v, and per segment: path, `deleted` bitmap,
   stats (`:630-790`);
2. any unpersisted segment → `%012x.zap` via `seg.Persist(path)`; zapx
   writes the buffer then **`f.Sync()`** (`(zapx) build.go:49-94`);
3. open new files (mmap), send `persistIntroduction` on `s.persists`,
   wait `applied` (`:817-849`);
4. `tx.Commit()` + **`rootBolt.Sync()`** (`:851-859`);
5. clear `ineligibleForRemoval` for those files (`:861-867`).

Delete-only change: re-persists bolt only (bitmaps), no new zap.

### File removal

`removeOldData` (`persister.go:1278-1297`) = `removeOldBoltSnapshots` +
`removeOldZapFiles`.

- `getLiveSnapshots` (`:1570-1621`): newest `numSnapshotsToKeep`, or
  with `rollbackSamplingInterval > 0` all snapshots newer than
  `now - (N-1)*interval` (plus boundary-checkpoint extension).
- `getProtectedSnapshots` (`:1336-1357`): time-series points spaced by
  the sampling interval (up to N-1), always the latest, then fill with
  most recent.
- Epochs in `eligibleForRemoval` (refs hit 0) that aren't protected get
  their bolt bucket deleted.
- `removeOldZapFiles` (`:1473-1501`): delete `*.zap` not listed in any
  remaining bolt snapshot, not `ineligibleForRemoval`, not
  `copyScheduled`.

**Subtlety (verified by reading the code):** removal is driven by
*file names listed in bolt*, not by in-memory refcounts. A long-running
query holding an epoch that was never itself persisted can still have
its files `os.Remove`d once no remaining bolt snapshot lists them. On
POSIX the blocks stay allocated (unlinked-but-open) until the reader
closes, and that space is invisible to `CurOnDiskBytes` which uses
`ReadDir` (`scorch.go:728-757`).

## 4. Merger loop (`merge.go:48-174`)

- AddRef root; if `epoch != lastEpochMergePlanned` (or force merge),
  fire `EventKindPreMergeCheck` (false → retry) (`:84-101`), then
  `planMergeAtSnapshot`; set `LastMergedEpoch` (`:105-143`).
- Send `epochWatcher{lastEpochMergePlanned}` on `persisterNotifier`
  and wait until the persister closes it (newer epoch persisted)
  (`:147-169`). **Merger is paced by the persister; the persister is
  paced by the merger via file count.**

`planMergeAtSnapshot` (`merge.go:305-520`):

1. plans over **file segments only** (`:319-331`);
2. per task (sequentially): mark the new file ineligible,
   `MergeUsing(...)` (zapx: 1 MiB bufio writer, footer, **`f.Sync()`**,
   `(zapx) merge.go:32,68-126`), `OpenUsing`; returns
   `newDocNums[segIdx][oldDocNum]` (`docDropped = MaxUint64`);
3. send `segmentMerge{fileMerge:true}` on `s.merges`, block on
   `notifyCh` (`:460-504`).

Concurrent deletes (`introduceMerge`, `introducer.go:370-436`):
`deletedSince = root.deleted AndNot oldSegment.deleted`, remapped via
`oldNewDocIDs` into the new segment's deleted bitmap; if a source
segment left root mid-merge, all its docs are marked deleted in the
output. A merged output with no live docs is discarded.

### Mergeplan (`mergeplan/merge_plan.go`)

Lucene TieredMergePolicy-like. **"Size" = doc count** (`FullSize` /
`LiveSize`), except budget uses file size when `FloorSegmentFileSize > 0`
(cbft sets 20MB!) or for vector segments.

`plan()` (`:238-393`): sort by live size desc; eligible if
`liveSize < MaxSegmentSize/2`; `budget = CalcBudget(total,
max(minLive, floor))` — a staircase of `MaxSegmentsPerTier` per tier,
growing by `TierGrowth`; empties become one task; while
`len(eligibles)+numTasks > budget`, greedily build contiguous rosters
of ≤ `SegmentsPerMergeTask` under `MaxSegmentSize`, pick the best
score; single-segment task only if it reclaims deletes.

Score (lower better, `:446-478`):
`balance × totLive^0.05 × (live/full)^ReclaimDeletesWeight`.

Defaults (`:160-168`): `MaxSegmentsPerTier 10`, `MaxSegmentSize 5M docs`,
`MaxSegmentFileSize 4GiB`, `TierGrowth 10`, `SegmentsPerMergeTask 10`,
`FloorSegmentSize 2000`, `ReclaimDeletesWeight 2.0`.
`FloorSegmentFileSize` defaults from `MaxSizeInMemoryMergePerWorker`
(`merge.go:235`).

## 5. Readers / queries

- `Reader()` → `currentSnapshot()`: RLock `rootLock`, AddRef root
  (`scorch.go:706-718`); `Close()` = `DecRef()`.
- `indexImpl.SearchInContext` defers `indexReader.Close()`
  (`index_impl.go:676-684`). A query pins one immutable snapshot for its
  whole duration, keeping alive: in-memory `SegmentBase`s (GC
  reachable), file segment refs (mmap + fd), and its epoch out of
  `eligibleForRemoval`.
- `MemoryUsed()` (`scorch.go:930-968`): root size + persister/merger
  in-flight snapshots (if older than root) + new-segment buffer bytes +
  analysis bytes.

## 6. Config knobs

Config map (`NewScorch`, `scorch.go:182-293`): `unsafe_batch` (false),
`numSnapshotsToKeep` (1), `rollbackSamplingInterval` (0),
`rollbackRetentionFactor` (0.5), `read_only`, `bolt_timeout`,
`eventCallbackName`, `asyncErrorCallbackName`, `forceSegmentType/Version`.

`scorchPersisterOptions` (`persister.go:54-85, 381-404`):
`PersisterNapTimeMSec 0`, `PersisterNapUnderNumFiles 1000`,
`MemoryPressurePauseThreshold MaxUint64`, `NumPersisterWorkers 1`,
`MaxSizeInMemoryMergePerWorker 0` (must be > 0 if workers > 1).

`scorchMergePlanOptions` (`merge.go:237-252`): mergeplan fields above.

## 7. Stats worth visualizing (`stats.go:28-149`, `StatsMap` `scorch.go:759-857`)

- epochs: `CurRootEpoch`, `LastPersistedEpoch`, `LastMergedEpoch`
- root: `TotMemorySegmentsAtRoot`, `TotFileSegmentsAtRoot`, `TotItemsToPersist`
- flow: `TotIntroducedItems`, `TotPersistedItems`, `TotBatches`,
  `TotBatchIntroTime`, `MaxBatchIntroTime`
- backpressure: `TotPersisterSlowMergerPause/Resume`,
  `TotPersisterNapPauseCompleted`, `TotPersisterMergerNapBreak`,
  `TotEventTriggerStarted/Completed`
- merges: `TotMemMergeZapTime`, `TotFileMergePlanTasks`,
  `TotFileMergeZapTime`, `TotFileMergeWrittenBytes`,
  `TotFileMergeIntroductionsObsoleted/Skipped`
- disk: `CurOnDiskBytes`, `CurOnDiskFiles`, `CurFilesIneligibleForRemoval`,
  `TotSnapshotsRemovedFromMetaStore`

## 8. Edge behaviours

- **Slow fsync**: every persist cycle pays zap fsync per new file +
  bolt commit/Sync. Safe-mode `Batch()` blocks (group-committed); the
  merger slows too (it waits for persist progress).
- **Huge batch**: analyzed and encoded in one buffer in the caller;
  obsoletes computed against every segment; segments > `MaxSegmentSize/2`
  (2.5M live docs) are never merge-eligible.
- **Many small batches**: one in-memory segment + epoch each; persister
  nap lets them pile up for a bigger in-memory merge.
- **Deletes**: bitmaps only; fully-deleted segments vanish at the next
  introduction; `ReclaimDeletesWeight` drives compaction.
- **Crash recovery**: `loadFromBolt` walks epochs newest→oldest
  (`persister.go:877-925`); orphaned zap files removed at open
  (`scorch.go:428-434`). Durability order: zap fsync, then bolt
  commit + fsync — a zap file only "counts" once bolt lists it.
- **Merge vs. persist race**: if an in-memory segment is merged away
  while being persisted, the new file isn't swapped in; it's closed and
  later cleaned up.
