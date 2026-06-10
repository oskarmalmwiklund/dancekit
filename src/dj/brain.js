// The DJ brain: turns the sustained crowd-energy signal into playback decisions.
//
// Policy:
//   crowd high           → stay in band; pre-queue same-band/+1 for a natural transition
//   crowd medium         → hold
//   crowd low sustained  → escalate one band, switch early
//   crowd still sustained→ jump two bands, switch early
//
// Guardrails: minimum play time before any forced switch, decision cooldown,
// no repeats until the pool is exhausted, BPM-proximity preference when picking.

const MAX_BPM_JUMP = 25; // preferred max BPM step when the floor isn't dead

export class DJBrain {
  constructor({ pool, config, actions, log }) {
    this.pool = pool;
    this.config = config;
    this.actions = actions;
    this.log = log;

    this.playedIds = new Set();
    this.current = null; // pool track currently playing
    this.trackStartedAt = 0;
    this.lastSwitchAt = 0;
    this.queued = null;
    this.lastSignal = null;
    this.lastKeepTrackId = null;
    this.bandLock = null; // number | null — manual override from the UI
    this.onQueueChange = null;
  }

  get currentBand() {
    return this.current?.band ?? Math.floor(this.pool.nBands / 2) - 1;
  }

  async startSession() {
    // Open mid-low: warm enough to dance to, with headroom to climb.
    const startBand = Math.max(0, Math.floor(this.pool.nBands / 2) - 1);
    const track = this.pick(this.bandLock ?? startBand);
    if (!track) throw new Error('No playable tracks in the pool');
    this.log('info', `opening in band ${track.band + 1}: ${track.name}`);
    await this.#play(track, { fade: false });
  }

  // Wire to Web Playback SDK player_state_changed.
  handlePlayerState(state) {
    const sdkTrack = state.track_window?.current_track;
    if (!sdkTrack) return;

    const poolTrack = this.pool.trackById.get(sdkTrack.id);
    if (sdkTrack.id !== this.current?.id) {
      // A new track began (queued transition, manual change on another device, …)
      this.current = poolTrack || {
        id: sdkTrack.id,
        name: sdkTrack.name,
        band: this.currentBand,
        bpm: null,
        uri: sdkTrack.uri,
      };
      this.playedIds.add(sdkTrack.id);
      this.trackStartedAt = Date.now();
      this.lastKeepTrackId = null;
      if (this.queued?.id === sdkTrack.id) this.#setQueued(null);
    }

    // Near the end with nothing queued → line up a natural transition.
    const remaining = state.duration - state.position;
    if (!state.paused && state.duration > 0 && remaining < this.config.nearEndMs && !this.queued) {
      const level = this.lastSignal?.level;
      const bump = level === 'high' ? 1 : 0;
      const target = this.bandLock ?? Math.min(this.currentBand + bump, this.pool.nBands - 1);
      const next = this.pick(target);
      if (next) {
        this.#setQueued(next);
        this.actions.queueTrack(next).catch(() => this.#setQueued(null));
        this.log('info', `queued for natural transition: ${next.name} (band ${next.band + 1}${next.bpm ? `, ${Math.round(next.bpm)} BPM` : ''})`);
      }
    }
  }

  // Wire to the vision energy signal (or the simulator).
  handleSignal(signal) {
    this.lastSignal = signal;
    if (!this.current) return;
    const now = Date.now();
    const played = now - this.trackStartedAt;
    const cfg = this.config;

    if (signal.isActive) {
      if (signal.sustainedMs >= cfg.sustainKeepMs && this.lastKeepTrackId !== this.current.id) {
        this.lastKeepTrackId = this.current.id;
        this.log('keep', `crowd ${signal.level} for ${Math.round(signal.sustainedMs / 1000)}s — keep going, holding band ${this.currentBand + 1}`);
      }
      return;
    }

    // Passive crowd: escalate if sustained and guardrails allow.
    if (
      signal.sustainedMs >= cfg.sustainSwitchMs &&
      played >= cfg.minPlayMs &&
      now - this.lastSwitchAt >= cfg.decisionCooldownMs
    ) {
      const jump = signal.level === 'still' ? 2 : 1;
      const target = this.bandLock ?? Math.min(this.currentBand + jump, this.pool.nBands - 1);
      const track = this.pick(target, { allowBigBpmJump: signal.level === 'still' });
      if (!track) return;
      this.log(
        'switch',
        `crowd ${signal.level} for ${Math.round(signal.sustainedMs / 1000)}s — fading into band ${this.currentBand + 1}→${track.band + 1}: ${track.name}${track.bpm ? ` (${Math.round(track.bpm)} BPM)` : ''}`
      );
      this.#play(track);
    }
  }

  manualSkip() {
    const target = this.bandLock ?? this.currentBand;
    const track = this.pick(target);
    if (!track) return;
    this.log('info', `manual skip → ${track.name}`);
    this.#play(track);
  }

  setBandLock(band) {
    this.bandLock = band;
    this.log('info', band == null ? 'band lock off — auto mode' : `band locked to ${band + 1}`);
  }

  // Pick an unplayed track in the target band, widening to neighbors if needed.
  // Among candidates, prefer BPM close to the current track.
  pick(targetBand, { allowBigBpmJump = false } = {}) {
    let candidates = [];
    for (let widen = 0; widen < this.pool.nBands && !candidates.length; widen++) {
      candidates = this.pool.tracks.filter(
        (t) =>
          t.band != null &&
          Math.abs(t.band - targetBand) <= widen &&
          !this.playedIds.has(t.id) &&
          t.id !== this.current?.id
      );
    }
    // Pool exhausted → allow repeats (but never the current track).
    if (!candidates.length) {
      this.playedIds.clear();
      candidates = this.pool.tracks.filter((t) => t.band === targetBand && t.id !== this.current?.id);
    }
    if (!candidates.length) return null;

    const currentBpm = this.current?.bpm;
    if (currentBpm && !allowBigBpmJump) {
      const near = candidates.filter((t) => t.bpm && Math.abs(t.bpm - currentBpm) <= MAX_BPM_JUMP);
      if (near.length) candidates = near;
    }
    candidates.sort((a, b) => {
      const da = a.bpm && currentBpm ? Math.abs(a.bpm - currentBpm) : 999;
      const db = b.bpm && currentBpm ? Math.abs(b.bpm - currentBpm) : 999;
      return da - db;
    });
    const top = candidates.slice(0, Math.min(5, candidates.length));
    return top[Math.floor(Math.random() * top.length)];
  }

  async #play(track, { fade = true } = {}) {
    this.lastSwitchAt = Date.now();
    this.#setQueued(null);
    try {
      await this.actions.playTrack(track, { fade });
    } catch {
      // already logged by the executor; brain state will resync on next player event
    }
  }

  #setQueued(track) {
    this.queued = track;
    this.onQueueChange?.(track);
  }
}
