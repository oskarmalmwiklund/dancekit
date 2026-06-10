// Per-person tracking with auto-calibrated movement baselines.
// Ported from the original prototype index.html — behavior preserved.

const KP_MIN_SCORE = 0.3;

// Smoothing/threshold params
const TRACK_MAX_MISSED = 45; // drop a confirmed track after ~45 frames unseen
const TENTATIVE_MAX_MISSED = 8; // drop a tentative track quickly if not confirmed
const MATCH_DIST_THRESH = 0.55; // looser match to avoid fragmenting IDs
const CENTER_WEIGHT = 0.4; // weight for center-prediction term in cost
const BASELINE_ALPHA = 0.98; // very slow EMA to track room baseline (per person)
const MOVEMENT_ALPHA = 0.85; // per-track movement smoothing
const STILL_GATE = 0.015; // only update baseline when frame movement is very low
const PROMOTE_HITS = 3; // #matches before a track is considered confirmed
const NEW_TRACK_BUFFER = 2; // require persistence across N frames before adding a new track
const PENDING_GRID = 0.1; // grid size in normalized coords (quantizes candidate positions)

export function getKeypointByName(pose, name) {
  return pose.keypoints.find((kp) => kp.name === name && kp.score > KP_MIN_SCORE);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Normalize keypoints so movement is scale/translation invariant:
// root at hip midpoint, divide by shoulder width (fallbacks provided).
export function normalizeKeypoints(pose) {
  const leftHip = getKeypointByName(pose, 'left_hip');
  const rightHip = getKeypointByName(pose, 'right_hip');
  const leftShoulder = getKeypointByName(pose, 'left_shoulder');
  const rightShoulder = getKeypointByName(pose, 'right_shoulder');

  let root = null;
  if (leftHip && rightHip) root = midpoint(leftHip, rightHip);
  else root = getKeypointByName(pose, 'nose') || pose.keypoints.find((kp) => kp.score > KP_MIN_SCORE);
  if (!root) return null;

  let scale = 0;
  if (leftShoulder && rightShoulder) scale = dist(leftShoulder, rightShoulder);
  if (!scale && leftHip && rightHip) scale = dist(leftHip, rightHip);
  if (!scale) scale = 100; // reasonable fallback for 640px video

  const norm = [];
  for (const kp of pose.keypoints) {
    if (kp.score > KP_MIN_SCORE) {
      norm.push({
        name: kp.name,
        x: (kp.x - root.x) / scale,
        y: (kp.y - root.y) / scale,
        w: kp.score,
      });
    }
  }
  return norm;
}

// Per-frame movement between two normalized keypoint sets,
// weighted by confidence to downweight jittery low-score points.
function movementBetween(prev, curr) {
  if (!prev || !curr) return 0;
  let total = 0;
  let count = 0;
  for (const a of curr) {
    const b = prev.find((k) => k.name === a.name);
    if (b) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const w = (a.w + b.w) / 2;
      total += d * w;
      count += w;
    }
  }
  return count === 0 ? 0 : total / count;
}

function centroid(normKP) {
  if (!normKP || !normKP.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  let w = 0;
  for (const k of normKP) {
    const wt = k.w || 1;
    sx += k.x * wt;
    sy += k.y * wt;
    w += wt;
  }
  return w ? { x: sx / w, y: sy / w } : { x: 0, y: 0 };
}

// Compact distance between two poses for matching (normalized centroid + overlap bonus)
function poseMatchDistance(normA, normB) {
  if (!normA || !normB) return Infinity;
  const cA = centroid(normA);
  const cB = centroid(normB);
  const d = Math.hypot(cA.x - cB.x, cA.y - cB.y);
  let overlap = 0;
  for (const a of normA) {
    if (normB.find((k) => k.name === a.name)) overlap += 1;
  }
  const overlapBonus = Math.min(overlap / 20, 0.15);
  return Math.max(0, d - overlapBonus);
}

export class Tracker {
  constructor() {
    this.tracks = new Map();
    this.pendingCandidates = new Map();
    this.nextTrackId = 1;
    this.frameIndex = 0;
  }

  // Returns { entries, tracks } where entries are the normalized current poses
  // and tracks are all live tracks (check .tentative for confirmation).
  update(poses) {
    const entries = [];
    for (const pose of poses) {
      const norm = normalizeKeypoints(pose);
      if (!norm) continue;
      entries.push({ pose, norm, center: centroid(norm) });
    }
    this.#match(entries);
    this.frameIndex++;
    return { entries, tracks: Array.from(this.tracks.values()) };
  }

  // Find the current pose entry closest to a track (for label anchoring).
  poseFor(track, entries) {
    let best = null;
    let bestDist = Infinity;
    for (const ce of entries) {
      const d = poseMatchDistance(track.prevNorm, ce.norm);
      if (d < bestDist) {
        bestDist = d;
        best = ce.pose;
      }
    }
    return best;
  }

  #candidateKey(center) {
    const gx = Math.round(center.x / PENDING_GRID);
    const gy = Math.round(center.y / PENDING_GRID);
    return `${gx},${gy}`;
  }

  #match(currEntries) {
    const trackList = Array.from(this.tracks.values());
    const usedCurr = new Set();
    const usedTracks = new Set();

    const matchCost = (tr, ce) => {
      const dPose = poseMatchDistance(tr.prevNorm, ce.norm);
      const predX = (tr.lastCenter?.x || 0) + (tr.vel?.x || 0);
      const predY = (tr.lastCenter?.y || 0) + (tr.vel?.y || 0);
      const dCenter = Math.hypot(predX - ce.center.x, predY - ce.center.y);
      return dPose + CENTER_WEIGHT * dCenter;
    };

    const pairs = [];
    for (const tr of trackList) {
      for (let i = 0; i < currEntries.length; i++) {
        pairs.push({ trackId: tr.id, idx: i, dist: matchCost(tr, currEntries[i]) });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);

    // Greedy assignment under threshold
    for (const p of pairs) {
      if (p.dist > MATCH_DIST_THRESH) continue;
      if (usedTracks.has(p.trackId) || usedCurr.has(p.idx)) continue;
      usedTracks.add(p.trackId);
      usedCurr.add(p.idx);

      this.pendingCandidates.delete(this.#candidateKey(currEntries[p.idx].center));

      const tr = this.tracks.get(p.trackId);
      const ce = currEntries[p.idx];
      const prevCenter = tr.lastCenter;

      const frameMove = movementBetween(tr.prevNorm, ce.norm);
      tr.movementEMA = MOVEMENT_ALPHA * tr.movementEMA + (1 - MOVEMENT_ALPHA) * frameMove;
      if (frameMove < STILL_GATE) {
        tr.baselineEMA = BASELINE_ALPHA * tr.baselineEMA + (1 - BASELINE_ALPHA) * frameMove;
      }
      tr.prevNorm = ce.norm;
      tr.lastCenter = ce.center;
      tr.vel = prevCenter
        ? { x: ce.center.x - prevCenter.x, y: ce.center.y - prevCenter.y }
        : { x: 0, y: 0 };
      tr.lastSeen = this.frameIndex;
      tr.hits = (tr.hits || 0) + 1;
      if (tr.tentative && tr.hits >= PROMOTE_HITS) tr.tentative = false;
    }

    // Create tracks for unmatched current poses (with persistence buffer)
    for (let i = 0; i < currEntries.length; i++) {
      if (usedCurr.has(i)) continue;
      const ce = currEntries[i];
      const key = this.#candidateKey(ce.center);
      const rec = this.pendingCandidates.get(key) || { count: 0, norm: ce.norm, center: ce.center };
      rec.count += 1;
      rec.norm = ce.norm;
      rec.center = ce.center;
      this.pendingCandidates.set(key, rec);

      if (rec.count >= NEW_TRACK_BUFFER) {
        const id = this.nextTrackId++;
        this.tracks.set(id, {
          id,
          prevNorm: rec.norm,
          movementEMA: 0,
          baselineEMA: 0.01,
          lastCenter: rec.center,
          lastSeen: this.frameIndex,
          vel: { x: 0, y: 0 },
          label: `#${id}`,
          hits: 1,
          tentative: true,
        });
        this.pendingCandidates.delete(key);
      }
    }

    // Remove stale tracks with different timeouts for tentative/confirmed
    for (const [id, tr] of this.tracks) {
      const missed = this.frameIndex - tr.lastSeen;
      const limit = tr.tentative ? TENTATIVE_MAX_MISSED : TRACK_MAX_MISSED;
      if (missed > limit) this.tracks.delete(id);
    }
  }
}
