// Group-level energy signal from per-person movement ratios.
// Note: the prototype's SUSTAIN_MS was 300ms with a comment claiming 30s;
// sustain timing is now real and owned by the consumer (the DJ brain) via
// signal.sustainedMs, so windows are configurable.

export function classifyRatio(r, config) {
  if (r < config.ratioLow) return 'still';
  if (r < config.ratioMedium) return 'low';
  if (r < config.ratioHigh) return 'medium';
  return 'high';
}

export function ratioFor(track) {
  const base = Math.max(track.baselineEMA, 1e-3);
  return track.movementEMA / base;
}

export class EnergyMonitor {
  constructor(config) {
    this.config = config;
    this.isActive = null; // true = medium/high, false = still/low
    this.stateStartTs = performance.now();
    this.envelope = 0;
    this.lastTs = null;
  }

  update(tracks, now = performance.now()) {
    const ratios = tracks
      .filter((tr) => !tr.tentative)
      .map(ratioFor)
      .sort((a, b) => b - a);
    const count = ratios.length;

    // The dance floor counts more than the couch: score the top half of the
    // room, so spectators don't drag down the people actually dancing.
    const topHalf = ratios.slice(0, Math.max(1, Math.ceil(count / 2)));
    const rawRatio = count ? topHalf.reduce((s, r) => s + r, 0) / topHalf.length : 0;

    // Peak-hold envelope: dancing has pauses, so a burst of movement keeps
    // counting while it decays, instead of collapsing the moment someone
    // holds a pose.
    const dt = this.lastTs == null ? 0 : now - this.lastTs;
    this.lastTs = now;
    this.envelope = Math.max(rawRatio, this.envelope * Math.pow(0.5, dt / this.config.energyHalfLifeMs));

    const avgRatio = this.envelope;
    const level = classifyRatio(avgRatio, this.config);
    const isActive = level === 'medium' || level === 'high';

    if (this.isActive === null || this.isActive !== isActive) {
      this.isActive = isActive;
      this.stateStartTs = now;
    }

    return {
      level,
      avgRatio,
      people: count,
      isActive,
      sustainedMs: now - this.stateStartTs,
      ts: now,
    };
  }
}
