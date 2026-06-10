// Web Playback SDK wrapper. Requires Spotify Premium.
let sdkReady = null;

function loadSdk() {
  if (!sdkReady) {
    sdkReady = new Promise((resolve) => {
      window.onSpotifyWebPlaybackSDKReady = resolve;
      const s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      document.head.appendChild(s);
    });
  }
  return sdkReady;
}

export async function createPlayer({ name = 'DanceKit', getToken, volume = 0.8, onState, onError }) {
  await loadSdk();

  const player = new window.Spotify.Player({
    name,
    getOAuthToken: (cb) => getToken().then(cb).catch((e) => onError?.('auth', e.message)),
    volume,
  });

  for (const type of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
    player.addListener(type, ({ message }) => onError?.(type, message));
  }
  player.addListener('player_state_changed', (state) => {
    if (state) onState?.(state);
  });

  const deviceId = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Spotify player took too long to connect')), 20000);
    player.addListener('ready', ({ device_id }) => {
      clearTimeout(timeout);
      resolve(device_id);
    });
    player.connect().then((ok) => {
      if (!ok) {
        clearTimeout(timeout);
        reject(new Error('Spotify player failed to connect'));
      }
    });
  });

  return { player, deviceId };
}
