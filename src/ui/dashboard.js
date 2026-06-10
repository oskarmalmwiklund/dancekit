import { config, updateConfig } from '../config.js';

const $ = (id) => document.getElementById(id);
const METER_SEGMENTS = 28;
const METER_MAX_RATIO = 8;

export class Dashboard {
  constructor({ onSkip, onBandLock, onSimToggle, onSimRatio, nBands }) {
    $('screen-dash').hidden = false;
    $('pill-live').classList.add('live');
    $('pill-live').querySelector('span').textContent = 'LIVE';

    this.lastPlayerState = null;
    this.lastPlayerStateAt = 0;
    this.coachTimer = null;

    // energy meter segments
    const meter = $('energy-meter');
    this.segments = [];
    for (let i = 0; i < METER_SEGMENTS; i++) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      meter.appendChild(seg);
      this.segments.push(seg);
    }

    // band lock options
    const lockSel = $('band-lock');
    for (let b = 0; b < nBands; b++) {
      const opt = document.createElement('option');
      opt.value = String(b);
      opt.textContent = `band ${b + 1}`;
      lockSel.appendChild(opt);
    }
    lockSel.onchange = () => onBandLock(lockSel.value === '' ? null : Number(lockSel.value));

    $('btn-skip').onclick = onSkip;

    // sim controls
    const simToggle = $('sim-toggle');
    const simSlider = $('sim-slider');
    simToggle.onchange = () => {
      simSlider.disabled = !simToggle.checked;
      $('pill-mode').hidden = !simToggle.checked;
      $('pill-mode').classList.toggle('sim-on', simToggle.checked);
      onSimToggle(simToggle.checked);
    };
    simSlider.oninput = () => onSimRatio(Number(simSlider.value));

    // tuning panel (values shown in seconds, stored in ms)
    $('btn-tuning').onclick = () => {
      $('tuning').hidden = !$('tuning').hidden;
    };
    for (const key of ['sustainSwitchMs', 'sustainKeepMs', 'minPlayMs', 'decisionCooldownMs', 'nearEndMs', 'fadeMs']) {
      const input = $(`tune-${key}`);
      input.value = config[key] / 1000;
      input.onchange = () => {
        const v = Number(input.value);
        if (v > 0) updateConfig({ [key]: v * 1000 });
      };
    }

    // progress ticker interpolates between SDK state events
    setInterval(() => this.#tickProgress(), 1000);
  }

  setVisionStatus(text) {
    $('vision-status').textContent = text;
  }

  updateSignal(signal) {
    const lit = Math.round((Math.min(signal.avgRatio, METER_MAX_RATIO) / METER_MAX_RATIO) * METER_SEGMENTS);
    this.segments.forEach((seg, i) => {
      seg.className = 'seg';
      if (i < lit) {
        if (i < METER_SEGMENTS * 0.4) seg.classList.add('lit-low');
        else if (i < METER_SEGMENTS * 0.75) seg.classList.add('lit-mid');
        else seg.classList.add('lit-hot');
      }
    });

    const levelEl = $('group-level');
    levelEl.textContent = signal.people === 0 && !signal.sim ? 'no one' : signal.level;
    levelEl.className = `big level-${signal.level}`;
    $('people-count').textContent = signal.sim ? 'sim' : signal.people;
    $('ratio').textContent = signal.avgRatio.toFixed(1);
    $('sustain').textContent = `${Math.floor(signal.sustainedMs / 1000)}s`;
  }

  updatePlayer(state, poolTrack) {
    this.lastPlayerState = state;
    this.lastPlayerStateAt = Date.now();
    const t = state.track_window?.current_track;
    if (!t) return;

    $('np-name').textContent = t.name;
    $('np-artist').textContent = t.artists.map((a) => a.name).join(', ');
    const art = t.album?.images?.[0]?.url;
    $('np-art').hidden = !art;
    if (art) $('np-art').src = art;

    const bpmChip = $('np-bpm');
    bpmChip.hidden = !poolTrack?.bpm;
    if (poolTrack?.bpm) bpmChip.textContent = `${Math.round(poolTrack.bpm)} BPM`;
    const bandChip = $('np-band');
    bandChip.hidden = poolTrack?.band == null;
    if (poolTrack?.band != null) bandChip.textContent = `BAND ${poolTrack.band + 1}`;

    const metaPill = $('pill-meta');
    metaPill.hidden = !poolTrack?.bpm;
    if (poolTrack?.bpm) metaPill.textContent = `BPM ${Math.round(poolTrack.bpm)}`;

    this.#tickProgress();
  }

  setNext(track) {
    const el = $('next-track');
    if (!track) {
      el.textContent = 'nothing queued';
      el.classList.add('dim');
    } else {
      el.classList.remove('dim');
      el.textContent = `${track.name} — ${track.artists}${track.bpm ? ` · ${Math.round(track.bpm)} BPM` : ''}`;
    }
  }

  addLog(kind, message) {
    const log = $('log');
    const entry = document.createElement('div');
    entry.className = `entry ${kind}`;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    entry.innerHTML = `<span class="t">${time}</span>`;
    entry.appendChild(document.createTextNode(message));
    log.prepend(entry);
    while (log.children.length > 200) log.lastChild.remove();

    if (kind === 'keep') this.coach('KEEP GOING', 'keep');
    if (kind === 'switch') this.coach('SWITCH IT UP', 'switch');
  }

  coach(message, kind) {
    const el = $('coach');
    el.textContent = message;
    el.classList.remove('keep', 'switch');
    el.classList.add(kind, 'show');
    clearTimeout(this.coachTimer);
    this.coachTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  #tickProgress() {
    const s = this.lastPlayerState;
    if (!s || !s.duration) return;
    const position = s.paused ? s.position : Math.min(s.position + (Date.now() - this.lastPlayerStateAt), s.duration);
    $('np-progress').style.width = `${(position / s.duration) * 100}%`;
  }
}
