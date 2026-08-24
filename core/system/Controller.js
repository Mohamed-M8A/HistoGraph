import { parseUnitsScript, UnitsInterpreter, createUnitsState } from "./unitsEngine.js";
import { createPoliticalGrid, parsePoliticalScript, PoliticalEngine } from "./politicalEngine.js";

// ==========================================
// 1. Simulation Clock
//
// Drives the simulation's tick loop using requestAnimationFrame. Rather
// than firing a tick every frame, it accumulates elapsed time and fires
// onTick(currentTick) once per tickDurationMs, catching up with
// multiple ticks in a single frame if the browser lagged behind.
// ==========================================
export class Clock {
  constructor(tickDurationMs, onTick) {
    this.tickDurationMs = tickDurationMs;
    this.onTick = onTick;
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
    const delta = now - this._lastFrameTime;
    this._lastFrameTime = now;
    this._accumulatedMs += delta;

    while (this._accumulatedMs >= this.tickDurationMs) {
      this._accumulatedMs -= this.tickDurationMs;
      this.currentTick += 1;
      this.onTick(this.currentTick);
    }

    this._rafId = requestAnimationFrame(() => this._loop());
  }
}

// ==========================================
// 2. Battle Recorder
//
// Captures the simulation canvas as a video stream (via
// canvas.captureStream) and records it into a WebM blob using
// MediaRecorder. Falls back to plain "video/webm" if VP9 isn't
// supported by the browser.
// ==========================================
export class BattleRecorder {
  constructor(canvas, fps = 30) {
    this.canvas = canvas;
    this.fps = fps;
    this.recorder = null;
    this.chunks = [];
    this.recording = false;
  }

  start() {
    if (this.recording) return;
    const stream = this.canvas.captureStream(this.fps);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.recording = true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recording || !this.recorder) {
        resolve(null);
        return;
      }
      this.recorder.onstop = () => {
        this.recording = false;
        resolve(new Blob(this.chunks, { type: "video/webm" }));
      };
      this.recorder.stop();
    });
  }

  isRecording() {
    return this.recording;
  }
}

// ==========================================
// 3. Download Helper
//
// Generic utility to trigger a browser download for any Blob (used by
// BattleRecorder to save recorded footage, and reusable for any other
// exported file).
// ==========================================
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ==========================================
// 4. Simulation Controller
//
// Top-level orchestrator that ties the units engine, political engine,
// clock, and renderer together. Owns the live simulation state, rebuilds
// it from the scripts currently in the UI on reset(), and drives both
// engines forward on every clock tick.
// ==========================================
export class SimulationController {
  constructor(refs, settings, mapEditor, renderer, effectsManager) {
    this.refs = refs;
    this.settings = settings;
    this.mapEditor = mapEditor;
    this.renderer = renderer;
    this.effectsManager = effectsManager;

    this.unitsState = null;
    this.politicalGrid = null;
    this.unitsInterpreter = null;
    this.politicalEngine = null;
    this.clock = null;

    this._gridListeners = [];
  }

  // ---- Grid replacement notifications ----
  onGridReplaced(callback) {
    this._gridListeners.push(callback);
  }

  _notifyGridReplaced() {
    for (const cb of this._gridListeners) cb(this.politicalGrid);
  }

  // ---- Lifecycle ----
  setupInitialState() {
    this.unitsState = createUnitsState(this.settings);
    this.politicalGrid = createPoliticalGrid(this.settings.mapWidth, this.settings.mapHeight);
    this._notifyGridReplaced();
  }

  // ==========================================================================
  // Political state-color wiring
  //
  // parsePoliticalScript() returns not just the tick-sorted commands but
  // also stateColors - the color palette snapshot built from any
  // {STATE ...} blocks in the script text itself. This used to be
  // silently dropped (destructured out as `commands` only), which meant
  // PoliticalEngine was constructed with no third argument, leaving its
  // own `this.stateColors` undefined; the moment a {STATE ...} command
  // actually executed at runtime, `_execute()`'s
  // `this.stateColors[cmd.args.code] = ...` would throw
  // "Cannot set properties of undefined". this.politicalStateColors now
  // seeds from the UI-defined palette (mapEditor.stateColorMap) merged
  // with whatever the script itself defines, and that exact object is
  // handed to PoliticalEngine so any mid-script STATE redefinition
  // mutates it in place - draw() below reads from this same object
  // instead of mapEditor.stateColorMap directly, so those mutations are
  // actually visible on screen instead of being an invisible side effect
  // on an object nobody ever rendered from.
  // ==========================================================================
  reset() {
    const { commands: uCmds, errors: uErr } = parseUnitsScript(this.refs.scriptInput.value);
    const { stateColors: pColors, commands: pCmds, errors: pErr } = parsePoliticalScript(this.mapEditor.buildScriptText());

    const errorLines = [
      ...uErr.map(e => `<div>[Units] Line ${e.line}: ${e.message}</div>`),
      ...pErr.map(e => `<div>[Map] Line ${e.line}: ${e.message}</div>`)
    ];
    this.refs.errors.innerHTML = errorLines.join("");

    this.unitsState = createUnitsState(this.settings);
    this.unitsInterpreter = new UnitsInterpreter(this.unitsState, uCmds, this.effectsManager);
    this.politicalGrid = createPoliticalGrid(this.settings.mapWidth, this.settings.mapHeight);
    this._notifyGridReplaced();

    // Re-derived fresh from mapEditor.stateColorMap on every reset() so
    // editing states in the UI and hitting Reset always takes effect;
    // a mid-simulation {STATE ...} script command only mutates this live
    // copy afterward, without touching mapEditor.stateColorMap itself.
    this.politicalStateColors = { ...this.mapEditor.stateColorMap, ...pColors };
    this.politicalEngine = new PoliticalEngine(this.politicalGrid, pCmds, this.politicalStateColors);

    if (this.clock) {
      this.clock.reset();
    }

    this.clock = new Clock(this.settings.tickDurationMs, (tick) => {
      this.unitsState.tick = tick;
      this.unitsInterpreter.onTick(tick);
      this.politicalEngine.onTick(tick);
    });

    this.draw();
  }

  start() {
    if (this.clock) {
      this.clock.start();
    }
  }

  pause() {
    if (this.clock) {
      this.clock.pause();
    }
  }

  draw() {
    this.renderer.render(
      this.unitsState,
      this.politicalGrid,
      this.effectsManager.getActive(),
      performance.now(),
      this.politicalStateColors || {}
    );
  }

  getStates() {
    return {
      unitsState: this.unitsState,
      politicalGrid: this.politicalGrid
    };
  }
}