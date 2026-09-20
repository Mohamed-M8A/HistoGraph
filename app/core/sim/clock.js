// ==========================================================================
// SIMULATION CLOCK
//
// Drives the simulation's tick loop using requestAnimationFrame. Rather
// than firing a tick every frame, it accumulates elapsed time and fires
// onTick(currentTick) once per tickDurationMs, catching up with
// multiple ticks in a single frame if the browser lagged behind.
//
// Split out of the old monolithic Controller.js: Clock has zero
// dependency on the units/political engines or the recorder, so it did
// not need to live in the same file as SimulationController.
// ==========================================================================

export class Clock {
  constructor(tickDurationMs, onTick, maxSubSteps = 10) {
    this.tickDurationMs = tickDurationMs;
    this.onTick = onTick;
    this.maxSubSteps = maxSubSteps;
    this.currentTick = 0;
    this.running = false;
    this._accumulatedMs = 0;
    this._lastFrameTime = null;
    this._rafId = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastFrameTime = performance.now();
    this._loop();
  }

  pause() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  reset() {
    this.pause();
    this.currentTick = 0;
    this._accumulatedMs = 0;
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    
    const delta = Math.min(now - this._lastFrameTime, 250);
    this._lastFrameTime = now;
    this._accumulatedMs += delta;

    let subSteps = 0;
    while (this._accumulatedMs >= this.tickDurationMs && subSteps < this.maxSubSteps) {
      this._accumulatedMs -= this.tickDurationMs;
      this.currentTick += 1;
      this.onTick(this.currentTick);
      subSteps++;
    }

    if (subSteps >= this.maxSubSteps) {
      this._accumulatedMs = 0;
    }

    this._rafId = requestAnimationFrame(() => this._loop());
  }
}