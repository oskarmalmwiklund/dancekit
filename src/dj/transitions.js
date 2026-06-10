import { api } from '../spotify/api.js';

async function ramp(player, from, to, ms) {
  const steps = Math.max(2, Math.round(ms / 80));
  for (let i = 1; i <= steps; i++) {
    await player.setVolume(from + (to - from) * (i / steps));
    await new Promise((r) => setTimeout(r, ms / steps));
  }
}

// Executor between the brain's decisions and the Spotify player.
// Spotify streams can't overlap (one DRM'd stream per account), so "mixing"
// a forced switch means fade out → swap track → fade in via player volume.
export function createActions({ deviceId, player, config, onError }) {
  let lastQueuedUri = null;
  let baseVolume = 0.8;

  return {
    async playTrack(track, { fade = true } = {}) {
      const doFade = fade && player;
      try {
        if (doFade) {
          const v = await player.getVolume();
          if (v > 0.05) baseVolume = v; // don't capture mid-fade silence as the target
          await ramp(player, baseVolume, 0, config.fadeMs);
        }
        await api.play({ deviceId, uris: [track.uri] });
        lastQueuedUri = null;
        if (doFade) await ramp(player, 0, baseVolume, config.fadeMs * 0.7);
      } catch (e) {
        if (player) player.setVolume(baseVolume).catch(() => {});
        onError?.(`play failed: ${e.message}`);
        throw e;
      }
    },

    async queueTrack(track) {
      if (track.uri === lastQueuedUri) return;
      try {
        await api.queue(track.uri, deviceId);
        lastQueuedUri = track.uri;
      } catch (e) {
        onError?.(`queue failed: ${e.message}`);
        throw e;
      }
    },
  };
}
