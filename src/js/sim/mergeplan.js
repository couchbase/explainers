// A faithful JS port of bleve's index/scorch/mergeplan/merge_plan.go
// (plan, CalcBudget, ScoreSegments, betterThan), so the simulated
// merger picks the same merges the real one would, given the same
// segment sizes. Vector-specific checks are omitted.
//
// A segment here is any object with:
//   id, fullSize (docs), liveSize (docs), fileSize (bytes),
//   liveFileSize (bytes)

export const DefaultMergePlanOptions = Object.freeze({
  maxSegmentsPerTier: 10,
  maxSegmentSize: 5000000,
  maxSegmentFileSize: 4 * 1024 * 1024 * 1024,
  tierGrowth: 10.0,
  segmentsPerMergeTask: 10,
  floorSegmentSize: 2000,
  floorSegmentFileSize: 0,
  reclaimDeletesWeight: 2.0,
});

const raiseToFloorSegmentSize = (o, s) => (s > o.floorSegmentSize ? s : o.floorSegmentSize);
const raiseToFloorSegmentFileSize = (o, s) => (s > o.floorSegmentFileSize ? s : o.floorSegmentFileSize);

export function calcBudget(totalSize, firstTierSize, o) {
  let tierSize = Math.max(1, firstTierSize);
  const maxSegmentsPerTier = Math.max(1, o.maxSegmentsPerTier);
  const tierGrowth = Math.max(1.0, o.tierGrowth);
  let budget = 0;
  while (totalSize > 0) {
    const segmentsInTier = totalSize / tierSize;
    if (segmentsInTier < maxSegmentsPerTier) {
      budget += Math.ceil(segmentsInTier);
      break;
    }
    budget += maxSegmentsPerTier;
    totalSize -= maxSegmentsPerTier * tierSize;
    tierSize = Math.floor(tierSize * tierGrowth);
  }
  return budget;
}

export function scoreSegments(segments, o) {
  let totBefore = 0, totAfter = 0, totAfterFloored = 0;
  for (const s of segments) {
    totBefore += s.fullSize;
    totAfter += s.liveSize;
    totAfterFloored += raiseToFloorSegmentSize(o, s.liveSize);
  }
  if (totBefore <= 0 || totAfter <= 0 || totAfterFloored <= 0) return 0;
  const balance = raiseToFloorSegmentSize(o, segments[0].liveSize) / totAfterFloored;
  let score = balance * Math.pow(totAfter, 0.05);
  const nonDelRatio = totAfter / totBefore;
  score *= Math.pow(nonDelRatio, o.reclaimDeletesWeight);
  return score;
}

function betterThan(c, other) {
  const ours = c.segments.length, theirs = other.segments.length;
  if (ours > 1 && theirs === 1) {
    const solo = other.segments[0];
    if (solo.liveSize === solo.fullSize) return true;
  }
  if (ours === 1 && theirs > 1) {
    const solo = c.segments[0];
    if (solo.liveSize === solo.fullSize) return false;
  }
  return c.score < other.score;
}

// Returns {tasks: [{segments: [...]}], budget, eligibles}.
export function plan(segmentsIn, opts) {
  const o = { ...DefaultMergePlanOptions, ...(opts || {}) };
  const rv = { tasks: [], budget: 0, numEligible: 0 };
  if (segmentsIn.length <= 1) return rv;

  // Go's sort.Sort isn't stable; we tie-break by id for determinism.
  const segments = [...segmentsIn].sort((a, b) => (b.liveSize - a.liveSize) || (a.id - b.id));

  let minLiveSize = Infinity, minLiveFileSize = Infinity;
  let eligibles = [];
  let eligiblesLiveSize = 0, eligiblesLiveFileSize = 0;
  for (const s of segments) {
    minLiveSize = Math.min(minLiveSize, s.liveSize);
    minLiveFileSize = Math.min(minLiveFileSize, s.liveFileSize);
    if (s.liveSize < o.maxSegmentSize / 2) {
      eligibles.push(s);
      eligiblesLiveSize += s.liveSize;
      eligiblesLiveFileSize += s.liveFileSize;
    }
  }
  rv.numEligible = eligibles.length;

  let budget;
  if (o.floorSegmentFileSize > 0) {
    budget = calcBudget(eligiblesLiveFileSize, raiseToFloorSegmentFileSize(o, minLiveFileSize), o);
  } else {
    budget = calcBudget(eligiblesLiveSize, raiseToFloorSegmentSize(o, minLiveSize), o);
  }
  rv.budget = budget;

  const empties = eligibles.filter((s) => s.liveSize <= 0);
  if (empties.length > 0) {
    rv.tasks.push({ segments: empties });
    eligibles = eligibles.filter((s) => !empties.includes(s));
  }

  let numMergeTasks = 0;
  while (eligibles.length > 0 && eligibles.length + numMergeTasks > budget) {
    let best = null;
    for (let start = 0; start < eligibles.length; start++) {
      const roster = [];
      let rosterLive = 0;
      for (let i = start; i < eligibles.length && roster.length < o.segmentsPerMergeTask; i++) {
        const e = eligibles[i];
        if (rosterLive + e.liveSize >= o.maxSegmentSize) continue;
        roster.push(e);
        rosterLive += e.liveSize;
      }
      if (roster.length > 0) {
        const cand = { segments: roster, score: scoreSegments(roster, o) };
        if (best === null || betterThan(cand, best)) best = cand;
      }
    }
    if (best === null) return rv;
    const r = best.segments;
    if (r.length > 1 || r[0].liveSize < r[0].fullSize) {
      rv.tasks.push({ segments: r });
      numMergeTasks++;
    }
    eligibles = eligibles.filter((s) => !r.includes(s));
  }
  return rv;
}
