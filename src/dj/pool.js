import { api } from '../spotify/api.js';
import { getFeatures, probeSpotifyFeatures } from '../metadata/features.js';

// Build the night's track pool from the chosen playlists:
// fetch + dedupe tracks, attach BPM/energy, split into energy bands by quantile.
// playlists: [{id, name}]
export async function buildPool({ playlists, config, onProgress }) {
  onProgress?.('Checking feature access…');
  const spotifyMode = await probeSpotifyFeatures();

  onProgress?.('Fetching playlist tracks…');
  const byId = new Map();
  const failed = [];
  for (const p of playlists) {
    try {
      for (const t of await api.playlistTracks(p.id)) {
        if (!byId.has(t.id)) byId.set(t.id, t);
      }
    } catch (e) {
      console.error(`Playlist "${p.name}" failed:`, e);
      failed.push(p.name);
    }
  }
  const tracks = Array.from(byId.values());
  if (!tracks.length) {
    throw new Error(
      failed.length
        ? `Couldn't read ${failed.join(', ')}. Spotify only lets development-mode apps read playlists you own or collaborate on — followed or Spotify-made playlists won't work. Try one you created yourself.`
        : 'The selected playlists contain no playable tracks'
    );
  }
  if (failed.length) onProgress?.(`Skipped (not readable): ${failed.join(', ')}`);

  const features = await getFeatures(tracks, {
    spotifyMode,
    onProgress: (done, total) =>
      onProgress?.(`Analyzing tempo & energy… ${done}/${total} (${spotifyMode ? 'Spotify' : 'Deezer'})`),
  });

  for (const t of tracks) {
    const f = features.get(t.id);
    t.bpm = f?.bpm ?? null;
    t.energy = f?.energy ?? null;
    t.band = null;
  }

  // Quantile-cut tracks with known energy into config.bands buckets (band 0 = calmest).
  const known = tracks.filter((t) => t.energy != null).sort((a, b) => a.energy - b.energy);
  const nBands = config.bands;
  known.forEach((t, i) => {
    t.band = Math.min(nBands - 1, Math.floor((i / known.length) * nBands));
  });

  return {
    tracks,
    trackById: byId,
    nBands,
    spotifyMode,
    coverage: {
      total: tracks.length,
      withBpm: tracks.filter((t) => t.bpm != null).length,
      withEnergy: known.length,
    },
  };
}
