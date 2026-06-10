import { config } from './config.js';
import { isAuthed, completeLogin, getClientId, getAccessToken, logout } from './spotify/auth.js';
import { api } from './spotify/api.js';
import { createPlayer } from './spotify/player.js';
import { buildPool } from './dj/pool.js';
import { DJBrain } from './dj/brain.js';
import { createActions } from './dj/transitions.js';
import { VisionEngine } from './vision/index.js';
import { showConnectStep, showPlaylistStep, hideSetup } from './ui/setup.js';
import { Dashboard } from './ui/dashboard.js';
import { Simulator } from './ui/sim.js';

async function boot() {
  // ?demo renders the dashboard with sample data — no auth, no Spotify.
  // Used for screenshots and UI development.
  if (new URLSearchParams(location.search).has('demo')) {
    demoMode();
    return;
  }

  // OAuth callback leg
  if (location.pathname === '/callback') {
    try {
      await completeLogin();
    } catch (e) {
      history.replaceState({}, '', '/');
      showConnectStep(e.message);
      return;
    }
    history.replaceState({}, '', '/');
  }

  if (!getClientId() || !isAuthed()) {
    showConnectStep();
    return;
  }

  // Validate the session before showing the playlist step.
  try {
    await getAccessToken();
    const me = await api.me();
    const chip = document.getElementById('user-chip');
    chip.hidden = false;
    chip.textContent = `${me.display_name || me.id}${me.product !== 'premium' ? ' · NOT PREMIUM' : ''}`;
    if (me.product !== 'premium') {
      showConnectStep('This account does not have Spotify Premium — playback will not work.');
      return;
    }
  } catch (e) {
    logout();
    showConnectStep(`Session check failed: ${e.message}`);
    return;
  }

  showPlaylistStep({
    // Dev-mode apps can only read items of playlists the user owns or
    // collaborates on — hide the rest instead of letting them fail.
    listPlaylists: async () => {
      const me = await api.me();
      const all = await api.myPlaylists();
      const usable = all.filter((p) => p.ownerId == null || p.ownerId === me.id || p.collaborative);
      if (!usable.length) {
        throw new Error(
          'None of your playlists are readable by this app — Spotify only allows playlists you own or collaborate on. Create a playlist of your own and reload.'
        );
      }
      return usable;
    },
    onStart: startSession,
  });
}

async function startSession(playlists, reportProgress) {
  const pool = await buildPool({ playlists, config, onProgress: reportProgress });
  if (pool.coverage.withEnergy === 0) {
    throw new Error(
      'No tempo/energy data found for any selected track — the DJ brain has nothing to steer with. Try playlists with better-known songs.'
    );
  }

  reportProgress('Starting Spotify player…');
  let dashboard;
  const { player, deviceId } = await createPlayer({
    getToken: () => getAccessToken(),
    onState: (state) => {
      brain.handlePlayerState(state);
      dashboard?.updatePlayer(state, pool.trackById.get(state.track_window?.current_track?.id));
    },
    onError: (type, message) => {
      console.error('Spotify player error:', type, message);
      dashboard?.addLog('info', `player ${type}: ${message}`);
    },
  });
  await api.transfer(deviceId);

  const actions = createActions({
    deviceId,
    player,
    config,
    onError: (msg) => dashboard?.addLog('info', msg),
    onTransition: (info, ms) => dashboard?.beginCrossfade(info, ms),
  });
  const brain = new DJBrain({
    pool,
    config,
    actions,
    log: (kind, message) => dashboard?.addLog(kind, message),
  });

  // ---- UI + signal routing ----
  let simMode = false;
  const routeSignal = (signal) => {
    dashboard.updateSignal(signal);
    brain.handleSignal(signal);
  };

  const vision = new VisionEngine({
    video: document.getElementById('webcam'),
    canvas: document.getElementById('output'),
    config,
    onSignal: (signal) => {
      if (!simMode) routeSignal(signal);
    },
    onStatus: (text) => dashboard?.setVisionStatus(text),
  });

  const sim = new Simulator({ config, onSignal: routeSignal });

  hideSetup();
  dashboard = new Dashboard({
    nBands: pool.nBands,
    onSkip: () => brain.manualSkip(),
    onBandLock: (band) => brain.setBandLock(band),
    onSimToggle: (on) => {
      simMode = on;
      vision.muted = on;
      if (on) sim.start();
      else sim.stop();
    },
    onSimRatio: (v) => sim.setRatio(v),
  });
  brain.onQueueChange = (track) => dashboard.setNext(track);

  const cov = pool.coverage;
  dashboard.addLog(
    'info',
    `pool ready: ${cov.total} tracks, energy known for ${cov.withEnergy} (${Math.round((cov.withEnergy / cov.total) * 100)}%) via ${pool.spotifyMode ? 'Spotify audio-features' : 'Deezer'}`
  );

  vision.start().catch((e) => {
    dashboard.setVisionStatus(`camera/model failed: ${e.message}`);
    dashboard.addLog('info', `vision failed (${e.message}) — use SIM mode to drive the DJ`);
  });

  await brain.startSession();
}

function demoMode() {
  hideSetup();
  const dashboard = new Dashboard({
    nBands: config.bands,
    onSkip: () => dashboard.addLog('info', 'manual skip (demo)'),
    onBandLock: () => {},
    onSimToggle: () => {},
    onSimRatio: () => {},
  });

  const art =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8ff3e"/><stop offset="1" stop-color="#4dd9ff"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>'
    );
  dashboard.updatePlayer(
    {
      paused: false,
      duration: 214000,
      position: 83000,
      track_window: {
        current_track: {
          id: 'demo',
          name: 'One More Time',
          artists: [{ name: 'Daft Punk' }],
          album: { images: [{ url: art }] },
        },
      },
    },
    { bpm: 123, band: 2 }
  );
  dashboard.setNext({ name: 'Around the World', artists: 'Daft Punk', bpm: 121 });
  dashboard.addLog('info', 'pool ready: 213 tracks, energy known for 178 (84%) via Deezer');
  dashboard.addLog('switch', 'crowd low for 46s — fading into band 2→3: One More Time (123 BPM)');
  dashboard.addLog('info', 'queued for natural transition: Around the World (band 3, 121 BPM)');
  dashboard.addLog('keep', 'crowd high for 12s — keep going, holding band 3');

  // Alternate the decks so the crossfader animation is visible in demo.
  const demoTracks = [
    { id: 'demo-a', name: 'One More Time', art },
    { id: 'demo-b', name: 'Around the World', art },
  ];
  let deckFlip = 0;
  setInterval(() => {
    deckFlip = 1 - deckFlip;
    dashboard.beginCrossfade(demoTracks[deckFlip], 4000);
  }, 7000);

  const start = performance.now();
  setInterval(() => {
    const t = performance.now();
    dashboard.updateSignal({
      level: 'high',
      avgRatio: 4.9 + 0.6 * Math.sin(t / 900),
      people: 4,
      isActive: true,
      sustainedMs: t - start,
      ts: t,
    });
    dashboard.coach('KEEP GOING', 'keep');
  }, 400);

  const vision = new VisionEngine({
    video: document.getElementById('webcam'),
    canvas: document.getElementById('output'),
    config,
    onSignal: () => {},
    onStatus: (text) => dashboard.setVisionStatus(text),
  });
  vision.start().catch((e) => dashboard.setVisionStatus(`camera unavailable: ${e.message}`));
}

boot().catch((e) => {
  console.error(e);
  showConnectStep(e.message);
});
