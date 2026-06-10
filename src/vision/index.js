import { startCamera } from './camera.js';
import { createMoveNet } from './detector.js';
import { Tracker } from './tracker.js';
import { EnergyMonitor, classifyRatio, ratioFor } from './energy.js';
import { drawPose, drawLabelForPose } from './overlay.js';

export class VisionEngine {
  constructor({ video, canvas, config, onSignal, onStatus }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;
    this.onSignal = onSignal;
    this.onStatus = onStatus || (() => {});
    this.tracker = new Tracker();
    this.monitor = new EnergyMonitor(config);
    this.running = false;
    this.muted = false; // sim mode: keep drawing, stop emitting signals
  }

  async start() {
    this.onStatus('starting camera…');
    await startCamera(this.video, { width: 640, height: 480 });
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.onStatus('loading MoveNet…');
    this.detector = await createMoveNet();
    this.onStatus('live');
    this.running = true;
    this.#loop();
  }

  stop() {
    this.running = false;
  }

  async #loop() {
    if (!this.running) return;
    try {
      const poses = await this.detector.estimatePoses(this.video, {
        maxPoses: this.config.maxPoses,
      });

      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

      const { entries, tracks } = this.tracker.update(poses);
      poses.forEach((pose) => drawPose(ctx, pose));

      for (const tr of tracks) {
        if (tr.tentative) continue;
        const pose = this.tracker.poseFor(tr, entries);
        if (pose) {
          const level = classifyRatio(ratioFor(tr), this.config);
          drawLabelForPose(ctx, canvas, pose, `${tr.label} ${level}`);
        }
      }

      const signal = this.monitor.update(tracks);
      if (!this.muted) this.onSignal(signal);
    } catch (error) {
      console.error('Detection loop error:', error);
      this.onStatus(`detection error: ${error.message}`);
    }
    requestAnimationFrame(() => this.#loop());
  }
}
