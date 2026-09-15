import { Clock } from "./clock.js";
import { parseUnitsScript, UnitsInterpreter, createUnitsState } from "../battle/unitsEngine.js";
import { createPoliticalGrid, parsePoliticalScript, PoliticalEngine } from "../battle/politicalEngine.js";

// ==========================================================================
// SIMULATION
//
// Top-level orchestrator that coordinates units execution, political grid
// state, clock progression, and visual rendering. Drives simulation
// steps on every clock tick in a headless, DOM-independent manner.
// ==========================================================================

export class Simulation {
  constructor(settings, renderer = null, effectsManager = null) {
    this.settings = settings;
    this.renderer = renderer;
    this.effectsManager = effectsManager;

    this.unitsState = null;
    this.politicalGrid = null;
    this.unitsInterpreter = null;
    this.politicalEngine = null;
    this.politicalStateColors = {};
    this.clock = null;

    this._gridListeners = [];
    this.onTick = null;
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

  reset(unitsScript = "", politicalScript = "", stateColorMap = {}) {
    const { commands: uCmds, errors: uErr } = parseUnitsScript(unitsScript);
    const { stateColors: pColors, commands: pCmds, errors: pErr } = parsePoliticalScript(politicalScript);

    this.unitsState = createUnitsState(this.settings);
    this.unitsInterpreter = new UnitsInterpreter(this.unitsState, uCmds, this.effectsManager);
    this.politicalGrid = createPoliticalGrid(this.settings.mapWidth, this.settings.mapHeight);
    this._notifyGridReplaced();

    // Merge baseline palette with any script-defined overrides
    this.politicalStateColors = { ...stateColorMap, ...pColors };
    this.politicalEngine = new PoliticalEngine(this.politicalGrid, pCmds, this.politicalStateColors);

    if (this.clock) {
      this.clock.reset();
    }

    this.clock = new Clock(this.settings.tickDurationMs, (tick) => {
      this.unitsState.tick = tick;
      this.unitsInterpreter.onTick(tick);
      this.politicalEngine.onTick(tick);
      if (this.onTick) this.onTick(tick);
    });

    if (this.renderer) {
      this.draw();
    }

    return { unitsErrors: uErr, politicalErrors: pErr };
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
    if (!this.renderer) return;
    this.renderer.render(
      this.unitsState,
      this.politicalGrid,
      this.effectsManager ? this.effectsManager.getActive() : [],
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