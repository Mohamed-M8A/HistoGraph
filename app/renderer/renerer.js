// ==========================================================================
// HISTOGRAPH - MAIN COMPOSITE RENDERER
//
// Master multi-layer canvas coordinator. Renders terrain, political boundaries,
// human settlements, military unit sprites, and combat visual effects onto
// a unified screen canvas in bottom-to-top rendering order.
// ==========================================================================

import { PoliticalPainter } from "./political_painter.js";
import { UnitPainter } from "./unit_painter.js";
import { EffectPainter } from "./effect_painter.js";
import { CelestialEngine } from "./utils.js";

export class MainRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.options = options;

    this.political = new PoliticalPainter(canvas.width, canvas.height);
    this.units = new UnitPainter();
    this.effects = new EffectPainter();
    this.celestial = new CelestialEngine();

    this.terrain = null;
    this.human = null;
    this.terrainGrid = null;
    this.mapWidth = 1;
    this.mapHeight = 1;
  }

  // ---- Sizing ----
  setMapSize(width, height) {
    this.mapWidth = width;
    this.mapHeight = height;

    if (this.terrain) {
      this.terrain.setCanvasSize(this.canvas.width, this.canvas.height);
      this.terrain.setSize(width, height);
    }

    this.political.setCanvasSize(this.canvas.width, this.canvas.height);
    this.political.setSize(width, height);

    if (this.human) {
      this.human.setCanvasSize(this.canvas.width, this.canvas.height);
      this.human.setSize(width, height);
    }
  }

  setTerrainPainter(terrainPainter) {
    this.terrain = terrainPainter;
    if (this.terrain) {
      this.terrain.setCanvasSize(this.canvas.width, this.canvas.height);
      this.terrain.setSize(this.mapWidth, this.mapHeight);
    }
  }

  setHumanPainter(humanPainter) {
    this.human = humanPainter;
    if (this.human) {
      this.human.setCanvasSize(this.canvas.width, this.canvas.height);
      this.human.setSize(this.mapWidth, this.mapHeight);
    }
  }

  setTerrain(terrainGrid, elevationGrid, seaLevel = 0) {
    this.terrainGrid = terrainGrid;
    if (this.terrain) {
      this.terrain.setTerrain(terrainGrid, elevationGrid, seaLevel);
    }
  }

  setHumanElements(settlements, roads, heightmap = null, rng = null, terrainGrid = null) {
    if (this.human) {
      this.human.setHumanElements(
        settlements,
        roads,
        heightmap,
        rng,
        terrainGrid ?? this.terrainGrid ?? null
      );
    }
  }

  setSun(azimuth, altitude) {
    if (this.terrain) {
      this.terrain.setSun(azimuth, altitude);
    }
  }

  _syncLayers() {
    if (this.terrain && this.political) {
      const mask = this.terrain.getWaterMask ? this.terrain.getWaterMask() : null;
      this.political.setWaterMask(mask);
    }
  }

  // ---- Render Loop ----
  render(state, politicalGrid, activeEffects = [], now = performance.now(), stateColorMap = {}) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Terrain Layer
    if (this.terrain) {
      const terrainLayer = this.terrain.getLayer();
      if (terrainLayer) ctx.drawImage(terrainLayer, 0, 0);
    }

    // 2. Political Borders Layer
    this._syncLayers();
    if (this.political && politicalGrid) {
      const politicalLayer = this.political.getLayer(politicalGrid, stateColorMap, state?.tick ?? 0, now);
      if (politicalLayer) ctx.drawImage(politicalLayer, 0, 0);
    }

    // 3. Human Infrastructure Layer (Settlements/Roads)
    if (this.human) {
      const humanLayer = this.human.getLayer();
      if (humanLayer) ctx.drawImage(humanLayer, 0, 0);
    }

    // 4. Units Layer
    if (this.units && state?.units) {
      this.units.draw(ctx, state.units, this.mapWidth, this.mapHeight, canvas.width, canvas.height);
    }

    // 5. Combat Effects Layer (Tracers, explosions, smoke)
    if (this.effects && activeEffects?.length) {
      this.effects.draw(ctx, activeEffects, now, this.mapWidth, this.mapHeight, canvas.width, canvas.height);
    }

    // 6. Optional Debug HUD
    if (this.options.showDebugOverlay && state?.tick !== undefined) {
      this._drawDebugHUD(ctx, state.tick);
    }
  }

  _drawDebugHUD(ctx, tick) {
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(10, 10, 110, 26);
    ctx.fillStyle = "#00ff66";
    ctx.font = "bold 12px monospace";
    ctx.fillText(`TICK: ${tick}`, 18, 27);
    ctx.restore();
  }
}