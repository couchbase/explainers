# How cbft drives scorch

Research notes backing the explainer. Paths are relative to a
Couchbase Server `repo sync` checkout (cbft at `c467517403c8`).
Line numbers are from that snapshot.

bleve `v2.6.1-0.20260807085028-9d2da23a5c58`, zapx v11–v17
(`cbft/go.mod:9-17`). Scorch is forced (`cbft/bleve_config_default.go:23`,
`cbft/pindex_bleve.go:1406-1411`).

## 1. DCP mutation → pindex → bleve batch

Feed (cbgt + gocbcore):

- gocbcore StreamObserver callbacks run on the DCP connection goroutine
  and are **synchronous**: `SnapshotMarker → dest.SnapshotStart`,
  `Mutation → DataUpdate[Ex]`, `Deletion → DataDelete[Ex]`, OSO, and
  `SeqNoAdvanced` (`cbgt/feed_dcp_gocbcore_observer.go:45-381`).
- Flow control: `DCPFeedBufferSizeBytes` = 20MB (`cbgt/feed_dcp.go:20`),
  ack threshold 0.8 (`:25`), noop 120s (`:29`). If the callback blocks,
  gocbcore stops acking; after ~20MB unacked, KV stops sending.

Dest (cbft):

- per-vbucket `BleveDestPartition` with its own `*bleve.Batch`
  (`cbft/pindex_bleve.go:400, 2108-2135`).
- `dataUpdate` builds the doc and calls `batch.Index` under the
  partition lock (`:2804-2850`); deletes → `batch.Delete` (`:2887`).
  `batch.Index` runs mapping on the DCP goroutine and fires scorch
  `EventKindIndexStart` — a herder blocking point.
- Text analysis happens later inside `Scorch.Batch` on the analysis
  queue (size NumCPU; `bleveAnalysisQueueSize`).

Flush policy per partition (`updateSeqLOCKED`, `:3146-3163`): when
`seq >= seqSnapEnd` (end of DCP snapshot) or `batch.Size() >=
BleveMaxOpsPerBatch` (**200**, `:104`). Also on SnapshotStart, OSO
start/end, SeqNoAdvanced. No byte-size trigger.

Async hand-off (`submitAsyncBatchRequestLOCKED`, `:3165-3207`): stamp
`SetInternal(partition, seqMax)` (used for rollback), swap in a fresh
batch, send to worker channel `partition % 4` (**4 workers/pindex**,
`:113`; **channel capacity 1**, `:498`). **The DCP goroutine blocks on
this send** while the worker is busy.

Batch worker (`runBatchWorker`, `:3215-3299`): merges incoming batches
into one target batch; executes on reaching 200 ops
(`TotBatchesFlushedOnMaxOps`) or every **100ms** ticker
(`BleveBatchFlushDuration`, `:110`).

Execute (`:3350-3396`): `bindex.Batch(batch)` synchronously. With
`unsafe_batch=true`, returns after **introduction**, not persistence.
Then `seqMaxBatch` advances and at_plus consistency waiters are
released (`:3383-3392`).

What the DCP stream waits on: herder `IndexStart` → capacity-1 worker
channel → (indirectly) the worker in `bindex.Batch`, i.e. herder
`BatchIntroductionStart`, analysis, introducer.

## 2. Scorch config set by cbft

Runtime (`bleveRuntimeConfigMap`, `cbft/pindex_bleve.go:1379-1414`):
`unsafe_batch=true`, `numSnapshotsToKeep=3`,
`rollbackSamplingInterval="10m"`, `forceSegmentType="zap"`,
`bolt_timeout="30s"`, event + async error callbacks.

Index-create defaults (`PrepareIndexDef`, `:837-884`):
`scorchPersisterOptions.numPersisterWorkers=4`,
`maxSizeInMemoryMergePerWorker=20MB` (400MB for vector indexes),
`scorchMergePlanOptions.floorSegmentFileSize=20MB` (~133MB vector).

Process-wide (`cbft/cmd/cbft/init_bleve.go:38-39, 106-124`):
`DefaultPersisterNapTimeMSec=2000` (bleve default 0),
`DefaultPersisterNapUnderNumFiles=1000`. `MemoryPressurePauseThreshold`
left disabled.

Async errors: `ErrPersist`, `ErrCleanup` logged; anything else
`log.Fatalf` (`init_bleve.go:139-163`).

## 3. Backpressure and throttling — the app herder

Quotas (`cbft/cmd/cbft/init_mem.go`, `app_herder.go:69-71`):
`ftsMemoryQuota` (capped at 0.75× system/cgroup; also Go
`SetMemoryLimit`); appQuota = quota × 1.0; **indexQuota = appQuota ×
0.65**; **queryQuota = appQuota × 0.80**.

`onScorchEvent` (`app_herder.go:496-519`):

| Event | Effect |
|---|---|
| `IndexStart` (per doc in `batch.Index`) | `checkAndBlockIndex` blocks the **DCP goroutine** while over quota |
| `BatchIntroductionStart` | `checkAndBlockBatch` blocks the **batch worker** while over quota |
| `PersisterProgress`, `MergerProgress` | wake waiters |
| `PreMergeCheck` | `concurrentMergeLimit` gate (default off) |

- Over-quota test: `FetchCurMemoryUsed() + (BatchBytesAdded −
  BatchBytesRemoved)` vs indexQuota then appQuota (`:296-309`).
- Escape hatch: if all indexes' `scorchSize` sum to 0 (fully
  persisted+merged), the batch proceeds (MB-29504, `:232-234, 479-494`).
- While the herder blocks anything, `NumEventsBlocking() > 0`, so the
  scorch persister **skips its 2s nap** to flush faster
  (`persister.go:326-327`).
- Waiters are also woken when a query ends and when memory drops.

Query side: `QueryBleve` estimates merge memory and fires
`EventQueryStart`; the herder rejects (`total_queries_rejected_by_herder`)
if over queryQuota/appQuota *and* other queries are running
(`app_herder.go:385-446`). KNN has its own throttle.

Query supervisor (`cbft/query_supervisor.go`): lists long-running
queries (`/api/query`), `KillQuery` → context cancel. No automatic
killer; default timeout 10s (`cbgt/pindex_impl.go:322`).

## 4. Query reader lifecycle

`bindex.SearchInContext` → `indexImpl.SearchInContext` → `Reader()` =
`currentSnapshot()` AddRef root; deferred `Close()` = DecRef. A query
pins one root epoch for its whole duration.

at_plus consistency: `ConsistencyWait` queues on `cwrQueue`, released
by `execute()` after **introduction** (`pindex_bleve.go:2200-2252, 3386-3392`).

## 5. Rollback

DCP rollback → `BleveDest.Rollback` → pindex restart →
`partialScorchRollbackLOCKED` (`cbft/pindex_bleve_scorch_rollback.go:28-99`):
close scorch, list `RollbackPoints` (retained bolt snapshots), pick the
first whose stored per-partition seqMax ≤ rollbackSeq and vbUUID
matches, `scorch.Rollback(path, point)`. Else full rollback (rebuild).

## 6. Stats

Per index (`cbft/ns_server.go:259-284`): `num_root_memorysegments`,
`num_root_filesegments`, `num_recs_to_persist`,
`num_persister_nap_pause_completed`, `num_persister_nap_merger_break`,
`total_compaction_written_bytes`, `num_file_merge_ops`,
`num_mem_merge_ops`, `num_files_on_disk`, `num_bytes_used_disk`,
`num_bytes_used_disk_by_root(_reclaimable)`, `index_bgthreads_active`,
`num_mutations_to_index`.

Process: `curr_batches_blocked_by_herder`,
`total_queries_rejected_by_herder`, `batch_bytes_added/removed`,
`num_batches_introduced`, `tot_batches_flushed_on_maxops/timer`,
`tot_rollback_full/partial`, `num_bytes_used_ram`.

## End-to-end backpressure chain

KV → DCP 20MB flow-control buffer → gocbcore callback `DataUpdate` →
`batch.Index` (herder IndexStart may block) → at snapshot end / 200
ops, send to capacity-1 worker chan (1 of 4) → worker merges ≤100ms /
200 ops → `Scorch.Batch` (herder BatchIntroductionStart may block) →
analysis → introducer → new root epoch (seqMaxBatch advances,
consistency waiters released) → persister (4 workers, 20MB in-mem
merge, 2s nap under 1000 files, nap skipped when herder blocking) →
zap files + bolt → `PersisterProgress` wakes herder → merger (tiered,
20MB file floor) → `MergerProgress`. Queries AddRef one root snapshot
for their duration.
