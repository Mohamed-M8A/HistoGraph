import { TerrainPainter } from "../terrain/terrainManager.js";
import { PoliticalPainter } from "./politicalEngine.js";
import { HumanPainter } from "../terrain/human.js";
import { UnitPainter } from "./unitsEngine.js";
import { EffectPainter } from "./effects.js";

// ==========================================
// Main Renderer
// ==========================================
export class MainRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.terrain = new TerrainPainter(canvas.width, canvas.height);
    this.political = new PoliticalPainter(canvas.width, canvas.height);
    this.human = new HumanPainter(canvas.width, canvas.height, { seaLevel: options.seaLevel ?? -0.1 });
    this.units = new UnitPainter();
    this.effects = new EffectPainter();
    this.mapWidth = 1;
    this.mapHeight = 1;
  }

  // ---- Sizing ----
  setMapSize(width, height) {
    this.mapWidth = width;
    this.mapHeight = height;
    this.terrain.setCanvasSize(this.canvas.width, this.canvas.height);
    this.terrain.setSize(width, height);
    this.political.setCanvasSize(this.canvas.width, this.canvas.height);
    this.political.setSize(width, height);
    this.human.setCanvasSize(this.canvas.width, this.canvas.height);
    this.human.setSize(width, height);
  }

  // ==========================================================================
  // Terrain/human layer coordination
  //
  // human.js's setHumanElements gained an optional fifth `terrainGrid`
  // argument so its internal water check can also recognize river cells,
  // not just ocean - without it, walls, buildings, and keeps can render
  // directly on top of a river because the only water check available to
  // them falls back to heightmap/seaLevel alone. This class was still
  // calling `this.human.setHumanElements(settlements, roads, heightmap,
  // rng)` with just four arguments, so that argument was silently defaulting
  // to null on every call and the river-avoidance fix never actually took
  // effect through this renderer, regardless of anything correct happening
  // inside human.js itself.
  //
  // The fix stores the terrain grid the last time setTerrain ran and
  // forwards it automatically from setHumanElements, rather than adding a
  // required fifth parameter to this method's own signature. Requiring
  // every external call site to start passing a new argument would mean
  // hunting down and updating every place in the codebase that calls
  // `renderer.setHumanElements(...)` - an unknown, potentially large set of
  // call sites outside this file - whereas capturing it here means every
  // existing call, unmodified, starts getting the correct terrain grid for
  // free as long as setTerrain has already been called for that map (which
  // is already the normal generation order: terrain before settlements). An
  // optional fifth parameter is still accepted and takes precedence when
  // explicitly supplied, for any call site that wants to pass a different
  // grid than the one last set on this renderer.
  // ==========================================================================
  setTerrain(terrainGrid, elevationGrid, seaLevel = 0) {
    this.terrainGrid = terrainGrid;
    this.terrain.setTerrain(terrainGrid, elevationGrid, seaLevel);
  }

  setHumanElements(settlements, roads, heightmap = null, rng = null, terrainGrid = null) {
    this.human.setHumanElements(settlements, roads, heightmap, rng, terrainGrid ?? this.terrainGrid ?? null);
  }

  setSun(azimuth, altitude) {
    this.terrain.setSun(azimuth, altitude);
  }

  _syncLayers() {
    const mask = this.terrain.getWaterMask();
    this.political.setWaterMask(mask);
  }

  // ---- Render ----
  render(state, politicalGrid, activeEffects, now, stateColorMap) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const terrainLayer = this.terrain.getLayer();
    if (terrainLayer) ctx.drawImage(terrainLayer, 0, 0);

    this._syncLayers();
    const politicalLayer = this.political.getLayer(politicalGrid, stateColorMap, state.tick, now);
    if (politicalLayer) ctx.drawImage(politicalLayer, 0, 0);

    const humanLayer = this.human.getLayer();
    if (humanLayer) ctx.drawImage(humanLayer, 0, 0);

    this.units.draw(ctx, state.units, this.mapWidth, this.mapHeight, canvas.width, canvas.height);
    this.effects.draw(ctx, activeEffects, now, this.mapWidth, this.mapHeight, canvas.width, canvas.height);

    this._drawUI(ctx, state.tick);
  }

  _drawUI(ctx, tick) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(10, 10, 100, 30);
    ctx.fillStyle = "#00ff00";
    ctx.font = "bold 14px 'Courier New', monospace";
    ctx.fillText(`TICK: ${tick}`, 20, 30);
  }
}