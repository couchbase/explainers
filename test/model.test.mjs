import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/explainers/scorch-goroutines/sim/model.js';
import { checkInvariants } from '../src/explainers/scorch-goroutines/sim/invariants.js';

function runChecked(m, ms, step = 50) {
  for (let t = 0; t < ms; t += step) {
    m.advance(step);
    const errs = checkInvariants(m);
    if (errs.length) assert.fail(`t=${m.now}ms: ${errs.join('; ')}`);
  }
}

test('steady ingest upholds invariants and keeps up', () => {
  const m = new Model({ seed: 3 });
  runChecked(m, 30000);
  const s = m.stats;
  assert.ok(s.TotDcpMutations > 200000);
  assert.ok(s.TotIntroducedItems > 0.98 * s.TotDcpMutations - 5000);
  assert.ok(s.TotMemMergeDone > 0, 'persister did in-memory merges');
  assert.ok(s.TotFileMergeIntroductionsDone > 0, 'merger merged files');
  assert.equal(s.TotHerderWaitingIn, 0, 'no herder blocking at steady state');
});

test('deterministic for a given seed', () => {
  const a = new Model({ seed: 11 }); a.advance(10000);
  const b = new Model({ seed: 11 }); b.advance(10000);
  assert.deepEqual(a.stats, b.stats);
  const c = new Model({ seed: 12 }); c.advance(10000);
  assert.notDeepEqual(a.stats, c.stats);
});

test('deletes and updates are conserved through merges', () => {
  const m = new Model({ seed: 5, config: { updateFraction: 0.5, deleteFraction: 0.2 } });
  runChecked(m, 20000);
  assert.ok(m.stats.TotFileMergeIntroductionsDone > 0);
});

test('slow I/O backs up memory, then the herder, then DCP', () => {
  const m = new Model({ seed: 2, config: { memQuotaBytes: 512 * 1024 * 1024 } });
  runChecked(m, 5000);
  m.set({ diskWriteMBps: 4, fsyncMs: 3000 });
  runChecked(m, 40000, 100);
  const s = m.stats;
  assert.ok(s.TotHerderWaitingIn > 0, 'herder blocked ingest');
  assert.ok(m.dcpPausedMs() > 0, 'DCP flow control kicked in');
  m.set({ diskWriteMBps: 400, fsyncMs: 4 });
  runChecked(m, 30000, 100);
  assert.ok(m.memUsed() < m.indexQuota(), 'recovered under quota');
});

test('safe (non-unsafe) batches wait for persistence', () => {
  const unsafe = new Model({ seed: 4 }); unsafe.advance(10000);
  const safe = new Model({ seed: 4, config: { unsafeBatch: false } }); safe.advance(10000);
  const avg = (m) => m.stats.TotBatchIntroTime / m.stats.NumBatchesIntroduced;
  assert.ok(avg(safe) > 5 * avg(unsafe), `safe ${avg(safe)} vs unsafe ${avg(unsafe)}`);
});

test('a long query pins segments; removed files linger as zombies until it ends', () => {
  const m = new Model({ seed: 9, config: { rollbackSamplingIntervalMs: 0, numSnapshotsToKeep: 1 } });
  runChecked(m, 5000);
  const id = m.startQuery({ durationMs: 30000, timeoutMs: 60000 });
  runChecked(m, 20000, 100);
  const q = m.queries.get(id);
  assert.ok(q, 'query still running');
  assert.ok(m.zombieBytes() > 0, 'some files unlinked while still mmapped');
  runChecked(m, 15000, 100);
  assert.equal(m.queries.size, 0);
  assert.equal(m.zombieBytes(), 0, 'zombies freed when the query closed its snapshot');
});

test('query timeout bounds how long a snapshot is pinned', () => {
  const m = new Model({ seed: 1 });
  m.advance(1000);
  m.startQuery({ durationMs: 60000, timeoutMs: 10000 });
  m.advance(10500);
  assert.equal(m.queries.size, 0);
  assert.equal(m.stats.TotQueriesTimedOut, 1);
});

test('slow merger triggers the persister pause at the file threshold', () => {
  const m = new Model({ seed: 6, config: { persisterNapUnderNumFiles: 30, fileMergeMBps: 2, ingestDocsPerSec: 20000 } });
  runChecked(m, 60000, 100);
  assert.ok(m.stats.TotPersisterSlowMergerPause > 0);
});
