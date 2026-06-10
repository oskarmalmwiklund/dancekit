// Feature provider with a startup capability probe:
//  - grandfathered Spotify keys (apps created before 2024-11-27) still get
//    /v1/audio-features → use real tempo & energy
//  - new keys get a 403 → fall back to Deezer ISRC lookups
import { api } from '../spotify/api.js';
import { cacheGetMany, cacheSet } from './cache.js';
import { lookupByIsrc, estimateEnergy } from './deezer.js';

// Any well-known, stable track works as a probe target.
const PROBE_TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';

export async function probeSpotifyFeatures() {
  try {
    const res = await api.audioFeatures([PROBE_TRACK_ID]);
    return Boolean(res?.audio_features?.[0]?.tempo);
  } catch {
    return false;
  }
}

async function fromSpotify(tracks, onProgress) {
  const result = new Map();
  for (let i = 0; i < tracks.length; i += 100) {
    const batch = tracks.slice(i, i + 100);
    const res = await api.audioFeatures(batch.map((t) => t.id));
    for (const f of res.audio_features || []) {
      if (f) result.set(f.id, { bpm: f.tempo, energy: f.energy, source: 'spotify' });
    }
    onProgress?.(Math.min(i + 100, tracks.length), tracks.length);
  }
  return result;
}

async function fromDeezer(tracks, onProgress) {
  const result = new Map();
  let done = 0;
  for (const t of tracks) {
    if (t.isrc) {
      const dz = await lookupByIsrc(t.isrc);
      if (dz?.bpm) {
        result.set(t.id, { bpm: dz.bpm, energy: estimateEnergy(dz.bpm, dz.gain), source: 'deezer' });
      }
    }
    done++;
    if (done % 5 === 0 || done === tracks.length) onProgress?.(done, tracks.length);
  }
  return result;
}

// tracks: [{id, isrc, ...}] → Map<trackId, {bpm, energy, source}>
// Cached results (including misses, stored as null) are never re-fetched.
export async function getFeatures(tracks, { spotifyMode, onProgress } = {}) {
  const cached = await cacheGetMany(tracks.map((t) => t.id));
  const missing = tracks.filter((t) => !cached.has(t.id));

  const fresh = spotifyMode
    ? await fromSpotify(missing, onProgress)
    : await fromDeezer(missing, onProgress);

  for (const t of missing) {
    await cacheSet(t.id, fresh.get(t.id) ?? null);
  }

  const result = new Map();
  for (const t of tracks) {
    const f = cached.has(t.id) ? cached.get(t.id) : fresh.get(t.id);
    if (f) result.set(t.id, f);
  }
  return result;
}
