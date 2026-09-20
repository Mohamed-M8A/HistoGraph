// ==========================================================================
// HISTOGRAPH — UNIT LAYER PAINTER
//
// Draws every unit in state.units onto the canvas as an image (asset.flag,
// resolved to content/assets/flags/circular/<flag>.svg) at its map
// position, scaled by UNIT_SCALE relative to one grid cell. Loaded images
// are cached so the same flag is never re-requested from the network. A
// unit whose image has not finished loading yet (or has no image) falls
// back to a plain red circle so it still renders on the map instead of
// being invisible.
// ==========================================================================

import { toPixel } from "./utils.js";

const UNITS_FLAG_BASE = "../content/assets/flags/circular/";
const UNIT_SCALE = 1.5;

export class UnitPainter {
  constructor() {
    this.images = new Map();
  }

  getUnitImage(asset) {
    const src = UNITS_FLAG_BASE + asset.flag + ".svg";
    if (!this.images.has(src)) {
      const img = new Image();
      img.src = src;
      this.images.set(src, img);
    }
    return this.images.get(src);
  }

  draw(ctx, units, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    for (const unit of units.values()) {
      this._drawUnit(ctx, unit, mapWidth, mapHeight, canvasWidth, canvasHeight);
    }
  }

  _drawUnit(ctx, unit, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    const [px, py] = toPixel(unit.x, unit.y, mapWidth, mapHeight, canvasWidth, canvasHeight);
    const size = (canvasWidth / mapWidth) * UNIT_SCALE;
    const img = this.getUnitImage(unit.asset);

    ctx.save();
    ctx.translate(px, py);
    ctx.globalAlpha = unit.opacity ?? 1;

    if (img?.complete && img.naturalWidth > 0) {
      const aspectRatio = img.naturalHeight / img.naturalWidth;
      const h = size * aspectRatio;
      ctx.drawImage(img, -size / 2, -h / 2, size, h);
    } else {
      ctx.fillStyle = "#ff0000";
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
