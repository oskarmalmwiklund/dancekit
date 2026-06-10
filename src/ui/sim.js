import { classifyRatio } from '../vision/energy.js';

// Simulation mode: a slider stands in for the crowd, producing the same
// signal shape as the vision pipeline so the brain can be tested without a party.
export class Simulator {
  constructor({ config, onSignal }) {
    this.config = config;
    this.onSignal = onSignal;
    this.ratio = 4;
    this.timer = null;
    this.isActive = null;
    this.stateStartTs = 0;
  }

  setRatio(v) {
    this.ratio = v;
  }

  start() {
    if (this.timer) return;
    this.isActive = null;
    this.timer = setInterval(() => this.#tick(), 500);
    this.#tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  #tick() {
    const now = performance.now();
    const level = classifyRatio(this.ratio, this.config);
    const isActive = level === 'medium' || level === 'high';
    if (this.isActive === null || this.isActive !== isActive) {
      this.isActive = isActive;
      this.stateStartTs = now;
    }
    this.onSignal({
      level,
      avgRatio: this.ratio,
      people: 4,
      isActive,
      sustainedMs: now - this.stateStartTs,
      ts: now,
      sim: true,
    });
  }
}
