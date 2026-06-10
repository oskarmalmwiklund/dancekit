// Central tunables. Everything time-based is in milliseconds internally;
// the tuning panel exposes seconds.
const STORAGE_KEY = 'dancekit:config';
const VERSION = 2;

export const defaults = {
  // How long the crowd must stay passive (still/low) before the brain switches tracks.
  sustainSwitchMs: 45000,
  // How long the crowd must stay active (medium/high) before a "keep going" is logged.
  sustainKeepMs: 10000,
  // Never force-switch a song before it has played this long.
  minPlayMs: 75000,
  // Minimum gap between two forced switches.
  decisionCooldownMs: 20000,
  // Queue the next track when this close to the end of the current one.
  nearEndMs: 12000,
  // Fade-out duration for forced switches (fade-in is 70% of this).
  fadeMs: 2500,
  // Number of energy bands the pool is split into.
  bands: 4,
  // Movement-ratio thresholds (movementEMA / baselineEMA) for group classification.
  ratioLow: 1.3,
  ratioMedium: 2.2,
  ratioHigh: 4.5,
  // Half-life of the peak-hold envelope on the group ratio: how long a burst
  // of dancing keeps counting after people pause.
  energyHalfLifeMs: 3500,
  // Vision
  maxPoses: 6,
};

// Only user-changed values are persisted, so updated defaults still apply
// to everyone who hasn't touched that knob. (v1 stored a full config dump —
// discard it, otherwise old defaults would be pinned forever.)
function loadOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!raw || raw.__v !== VERSION) return {};
    return raw.overrides || {};
  } catch {
    return {};
  }
}

const overrides = loadOverrides();
export const config = { ...defaults, ...overrides };

export function updateConfig(partial) {
  Object.assign(config, partial);
  Object.assign(overrides, partial);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ __v: VERSION, overrides }));
}
