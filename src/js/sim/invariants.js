// Invariants the simulated scorch must uphold at every instant. Used by
// the tests, and available in the UI via ?debug=1.
export function checkInvariants(m) {
  const errs = [];
  const s = m.stats;
  if (s.LastPersistedEpoch > s.CurRootEpoch) errs.push('persisted epoch ahead of root');
  if (s.LastMergedEpoch > s.CurRootEpoch) errs.push('merged epoch ahead of root');

  // Refcounts: every file segment in a live snapshot is open, with at
  // least one ref per live snapshot containing it.
  const holders = new Map();
  for (const snap of m.liveSnapshots) {
    if (snap.refs <= 0) errs.push(`live snapshot ${snap.epoch} has refs ${snap.refs}`);
    for (const ss of snap.segs) {
      if (ss.seg.kind !== 'file') continue;
      holders.set(ss.seg, (holders.get(ss.seg) || 0) + 1);
    }
  }
  for (const [seg, n] of holders) {
    if (!seg.open) errs.push(`closed file segment ${seg.fileName} in a live snapshot`);
    if (seg.refs < n) errs.push(`${seg.fileName} refs ${seg.refs} < ${n} holders`);
  }

  // The current root's files are on disk, not merely unlinked.
  for (const ss of m.root.segs) {
    if (ss.seg.kind === 'file' && !m.files.has(ss.seg.fileName)) {
      errs.push(`root file ${ss.seg.fileName} missing from disk`);
    }
    if (ss.deleted < 0 || ss.deleted >= ss.seg.docs) errs.push(`bad deleted count on segment ${ss.seg.id}`);
  }

  // Durability: every file root.bolt lists exists on disk.
  for (const b of m.bolt) {
    for (const n of b.files) if (!m.files.has(n)) errs.push(`bolt epoch ${b.epoch} lists missing ${n}`);
  }

  // Doc conservation through introductions, merges and deletes.
  const live = m.root.liveDocs();
  if (live !== m.expectedLiveDocs) errs.push(`root live docs ${live} != expected ${m.expectedLiveDocs}`);

  // Zombies are only files that are unlinked but still open.
  for (const [n, z] of m.zombies) {
    if (m.files.has(n)) errs.push(`zombie ${n} still listed on disk`);
    if (!z.seg.open) errs.push(`zombie ${n} already closed`);
  }
  return errs;
}
