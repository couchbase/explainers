// Simulation configuration. Defaults model a single cbft pindex on a
// Couchbase Server node, using cbft's overrides of bleve's defaults.
// See docs/research/*.md for where each value comes from.
//
// Values tagged "model" are not real knobs: they're cost/size
// assumptions for the simulator, chosen to be plausible, not measured.

const MB = 1024 * 1024;

export const CONFIG_DOCS = {
  // ---- workload (model) ----
  ingestDocsPerSec: { group: 'workload', unit: 'docs/s', doc: 'KV mutation rate arriving over DCP for this pindex.' },
  docBytes: { group: 'workload', unit: 'B', doc: 'Average JSON document size.' },
  dcpSnapshotMeanDocs: { group: 'workload', unit: 'docs', doc: 'Average mutations per DCP snapshot marker (per vbucket). Backfill snapshots are huge; steady-state ones are small.' },
  updateFraction: { group: 'workload', unit: '0..1', doc: 'Fraction of mutations that update an existing doc (obsoleting an older version).' },
  deleteFraction: { group: 'workload', unit: '0..1', doc: 'Fraction of mutations that are deletions.' },
  numVBuckets: { group: 'workload', unit: '', doc: 'VBuckets (DCP partitions) feeding this pindex.' },

  // ---- cbft ----
  maxOpsPerBatch: { group: 'cbft', unit: 'ops', doc: 'BleveMaxOpsPerBatch: flush a partition batch at this many ops.', real: 'bleveMaxOpsPerBatch', cbft: 200 },
  batchFlushMs: { group: 'cbft', unit: 'ms', doc: 'BleveBatchFlushDuration: batch worker ticker.', real: 'bleveBatchFlushDuration', cbft: 100 },
  numBatchWorkers: { group: 'cbft', unit: '', doc: 'asyncBatchWorkerCount per pindex; each has a capacity-1 channel.', cbft: 4 },
  dcpBufferBytes: { group: 'cbft', unit: 'B', doc: 'DCPFeedBufferSizeBytes: DCP flow-control buffer.', cbft: 20 * MB },
  memQuotaBytes: { group: 'cbft', unit: 'B', doc: 'ftsMemoryQuota (scaled to one pindex for the sim).' },
  memIndexingFraction: { group: 'cbft', unit: '0..1', doc: 'indexQuota = quota × this.', cbft: 0.65 },
  herderEnabled: { group: 'cbft', unit: 'bool', doc: 'Whether the app herder blocks ingest when over the indexing quota.' },
  baseMemBytes: { group: 'cbft', unit: 'B', doc: 'Model: process memory not attributable to this index.' },

  // ---- scorch ----
  unsafeBatch: { group: 'scorch', unit: 'bool', doc: 'unsafe_batch: Batch() returns after introduction, not persistence.', bleve: false, cbft: true },
  numCPUs: { group: 'scorch', unit: '', doc: "bleve's analysis queue workers, shared by every index in the process (cbft: NumCPU, bleveAnalysisQueueSize)." },
  persisterNapMs: { group: 'scorch', unit: 'ms', doc: 'PersisterNapTimeMSec.', bleve: 0, cbft: 2000 },
  persisterNapUnderNumFiles: { group: 'scorch', unit: 'files', doc: 'PersisterNapUnderNumFiles: nap only under this many files; pause for merger at/over it.', bleve: 1000, cbft: 1000 },
  numPersisterWorkers: { group: 'scorch', unit: '', doc: 'NumPersisterWorkers for in-memory merge.', bleve: 1, cbft: 4 },
  maxSizeInMemoryMergePerWorker: { group: 'scorch', unit: 'B', doc: 'MaxSizeInMemoryMergePerWorker; also the default FloorSegmentFileSize.', bleve: 0, cbft: 20 * MB },
  memoryPressurePauseThreshold: { group: 'scorch', unit: 'events', doc: 'MemoryPressurePauseThreshold: skip in-memory merge when this many events are blocking.', bleve: Infinity, cbft: Infinity },
  numSnapshotsToKeep: { group: 'scorch', unit: '', doc: 'numSnapshotsToKeep (rollback points).', bleve: 1, cbft: 3 },
  rollbackSamplingIntervalMs: { group: 'scorch', unit: 'ms', doc: 'rollbackSamplingInterval.', bleve: 0, cbft: 600000 },

  // ---- mergeplan ----
  mergePlan: { group: 'mergeplan', unit: '', doc: 'scorchMergePlanOptions (cbft sets floorSegmentFileSize=20MB).' },

  // ---- costs (model) ----
  mapUsPerDoc: { group: 'costs', unit: 'µs', doc: 'Model: MapDocument cost on the DCP goroutine.' },
  analyzeUsPerDoc: { group: 'costs', unit: 'µs', doc: 'Model: text analysis CPU per doc.' },
  buildUsPerDoc: { group: 'costs', unit: 'µs', doc: 'Model: encoding an in-memory zap segment, per doc.' },
  memBytesPerDoc: { group: 'costs', unit: 'B', doc: 'Model: in-memory segment bytes per doc.' },
  fileBytesPerDoc: { group: 'costs', unit: 'B', doc: 'Model: zap file bytes per live doc.' },
  introduceMs: { group: 'costs', unit: 'ms', doc: 'Model: introducer cost per root swap.' },
  memMergeMBps: { group: 'costs', unit: 'MB/s', doc: 'Model: in-memory merge throughput (CPU) per persister worker.' },
  fileMergeMBps: { group: 'costs', unit: 'MB/s', doc: 'Model: file merge throughput (mmap read + remap + write) for the merger.' },
  diskWriteMBps: { group: 'costs', unit: 'MB/s', doc: 'Model: sequential write bandwidth.' },
  fsyncMs: { group: 'costs', unit: 'ms', doc: 'Model: latency of one fsync.' },
  boltCommitMs: { group: 'costs', unit: 'ms', doc: 'Model: bolt tx commit (before its fsync).' },
  queryMemBytes: { group: 'costs', unit: 'B', doc: 'Model: working memory of one running query.' },
};

export const DEFAULT_CONFIG = Object.freeze({
  ingestDocsPerSec: 8000,
  docBytes: 1024,
  dcpSnapshotMeanDocs: 20,
  updateFraction: 0.3,
  deleteFraction: 0.0,
  numVBuckets: 171,

  maxOpsPerBatch: 200,
  batchFlushMs: 100,
  numBatchWorkers: 4,
  dcpBufferBytes: 20 * MB,
  memQuotaBytes: 1024 * MB,
  memIndexingFraction: 0.65,
  herderEnabled: true,
  baseMemBytes: 96 * MB,

  unsafeBatch: true,
  numCPUs: 8,
  persisterNapMs: 2000,
  persisterNapUnderNumFiles: 1000,
  numPersisterWorkers: 4,
  maxSizeInMemoryMergePerWorker: 20 * MB,
  memoryPressurePauseThreshold: Infinity,
  numSnapshotsToKeep: 3,
  rollbackSamplingIntervalMs: 600000,

  mergePlan: Object.freeze({
    maxSegmentsPerTier: 10,
    maxSegmentSize: 5000000,
    tierGrowth: 10.0,
    segmentsPerMergeTask: 10,
    floorSegmentSize: 2000,
    floorSegmentFileSize: 20 * MB,
    reclaimDeletesWeight: 2.0,
  }),

  mapUsPerDoc: 8,
  analyzeUsPerDoc: 120,
  buildUsPerDoc: 15,
  memBytesPerDoc: 2400,
  fileBytesPerDoc: 700,
  introduceMs: 0.2,
  memMergeMBps: 300,
  fileMergeMBps: 120,
  diskWriteMBps: 400,
  fsyncMs: 4,
  boltCommitMs: 1,
  queryMemBytes: 8 * MB,
});

export function makeConfig(overrides) {
  const cfg = { ...DEFAULT_CONFIG, mergePlan: { ...DEFAULT_CONFIG.mergePlan } };
  applyConfig(cfg, overrides);
  return cfg;
}

// Applies overrides in place; nested mergePlan is merged, not replaced.
export function applyConfig(cfg, overrides) {
  if (!overrides) return cfg;
  for (const [key, v] of Object.entries(overrides)) {
    if (!(key in DEFAULT_CONFIG)) throw new Error(`unknown sim config key: ${key}`);
    if (key === 'mergePlan') {
      for (const mk of Object.keys(v)) {
        if (!(mk in DEFAULT_CONFIG.mergePlan)) throw new Error(`unknown mergePlan key: ${mk}`);
      }
      cfg.mergePlan = { ...cfg.mergePlan, ...v };
    } else {
      cfg[key] = v;
    }
  }
  return cfg;
}

export { MB };
