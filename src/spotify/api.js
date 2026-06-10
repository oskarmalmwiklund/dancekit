import { getAccessToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';

async function call(path, { method = 'GET', query, body, _retried = false } = {}) {
  const token = await getAccessToken();
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && !_retried) {
    const wait = (Number(res.headers.get('Retry-After')) || 1) * 1000;
    await new Promise((r) => setTimeout(r, wait + 100));
    return call(path, { method, query, body, _retried: true });
  }
  if (res.status === 401 && !_retried) {
    await getAccessToken({ force: true });
    return call(path, { method, query, body, _retried: true });
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Spotify API ${res.status} on ${path}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function paginate(path, query, pick) {
  const items = [];
  let offset = 0;
  const limit = 50;
  for (;;) {
    const page = await call(path, { query: { ...query, limit, offset } });
    items.push(...page.items.map(pick).filter(Boolean));
    if (!page.next) break;
    offset += limit;
  }
  return items;
}

export const api = {
  me: () => call('/me'),

  myPlaylists: () =>
    paginate('/me/playlists', {}, (p) =>
      p
        ? {
            id: p.id,
            name: p.name,
            // Feb 2026 dev-mode migration renamed tracks → items in playlist objects
            total: p.items?.total ?? p.tracks?.total ?? null,
            image: p.images?.[p.images.length - 1]?.url || p.images?.[0]?.url || null,
            ownerId: p.owner?.id ?? null,
            collaborative: Boolean(p.collaborative),
          }
        : null
    ),

  playlistTracks: async (playlistId) => {
    const pick = (entry) => {
      // Feb 2026 dev-mode migration: entry.track → entry.item
      const t = entry?.item ?? entry?.track;
      if (!t || !t.id || t.is_local || t.type !== 'track') return null;
      return {
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: t.artists.map((a) => a.name).join(', '),
        durationMs: t.duration_ms,
        isrc: t.external_ids?.isrc || null,
        popularity: t.popularity ?? 0,
        image: t.album?.images?.[t.album.images.length - 1]?.url || null,
      };
    };
    try {
      return await paginate(`/playlists/${playlistId}/items`, {}, pick);
    } catch (e) {
      // Grandfathered extended-quota apps may only know the pre-2026 endpoint.
      if (e.status === 403 || e.status === 404) {
        return paginate(`/playlists/${playlistId}/tracks`, {}, pick);
      }
      throw e;
    }
  },

  play: ({ deviceId, uris, contextUri, positionMs }) =>
    call('/me/player/play', {
      method: 'PUT',
      query: { device_id: deviceId },
      body: {
        ...(uris ? { uris } : {}),
        ...(contextUri ? { context_uri: contextUri } : {}),
        ...(positionMs != null ? { position_ms: positionMs } : {}),
      },
    }),

  queue: (uri, deviceId) =>
    call('/me/player/queue', { method: 'POST', query: { uri, device_id: deviceId } }),

  next: (deviceId) => call('/me/player/next', { method: 'POST', query: { device_id: deviceId } }),

  transfer: (deviceId, play = false) =>
    call('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play } }),

  // Deprecated for apps created after 2024-11-27; works only for grandfathered keys.
  audioFeatures: (ids) => call('/audio-features', { query: { ids: ids.join(',') } }),
};
