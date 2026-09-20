// ==========================================================================
// HISTOGRAPH — POLITICAL LAYER PAINTER
//
// Renders the political grid onto an offscreen canvas layer: border cells
// get the border color, cells conquered this tick get the "advance" color,
// older cells get the "occupied" color, and permanently stabilized cells
// (via PEACE) get the flat base color. Ownership changes fade in over
// DEFAULT_TRANSITION_MS using cell.fromColor -> the current target color.
// Because stateColorMap is read fresh on every rebuild, a STATE
// redefinition applied by core/war/political.js's PoliticalEngine shows up
// immediately on the cells it affects, without its own fade.
//
// Performance note: the canvas and its 2D context are created once in the
// constructor and reused for every rebuild (cleared with clearRect instead
// of being recreated), to avoid per-frame canvas allocation and the GC
// pressure / micro-stutter it causes during animation and map zoom/pan.
// ==========================================================================

import { lerpColor } from "./utils.js";
import { isBorderCell, DEFAULT_TRANSITION_MS } from "../core/war/political.js";

export class PoliticalPainter {
    constructor(canvasWidth, canvasHeight) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;

        // Canvas and context are created once and reused for every rebuild instead
        // of being recreated per frame inside updatePoliticalLayer (see file-level
        // note above for why this matters for GC pressure).
        this.canvas = document.createElement("canvas");
        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        this.ctx = this.canvas.getContext("2d");

        this.politicalLayer = null;
        this.mapWidth = 1;
        this.mapHeight = 1;
        this.politicalOpacity = 0.5;
        this.waterMask = null;
    }

    setSize(width, height) {
        this.mapWidth = width;
        this.mapHeight = height;
    }

    setCanvasSize(width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.canvas.width = width;
        this.canvas.height = height;
    }

    setPoliticalOpacity(opacity) {
        this.politicalOpacity = opacity;
    }

    setWaterMask(mask) {
        this.waterMask = mask;
    }

    updatePoliticalLayer(grid, stateColorMap, currentTick, now) {
        if (!grid) return;

        const needsRebuild = grid.dirty || now < grid.animatingUntil;
        if (!needsRebuild && this.politicalLayer) return;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const cellW = this.canvas.width / this.mapWidth;
        const cellH = this.canvas.height / this.mapHeight;

        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const cell = grid.cells[y][x];
                if (!cell || !cell.ownerId) continue;

                const colors = stateColorMap[cell.ownerId];
                if (!colors) continue;

                if (this.waterMask?.[y]?.[x]) {
                    ctx.globalAlpha = 0.2;
                } else {
                    ctx.globalAlpha = this.politicalOpacity;
                }

                let targetColor;
                if (isBorderCell(grid, x, y)) {
                    targetColor = colors.border;
                } else if (cell.conqueredAt === -Infinity) {
                    targetColor = colors.base;
                } else if (cell.conqueredAt === currentTick) {
                    targetColor = colors.advance;
                } else {
                    targetColor = colors.occupied;
                }

                const t = Math.max(0, Math.min(1, (now - cell.transitionStart) / DEFAULT_TRANSITION_MS));
                const fill = t >= 1 ? targetColor : lerpColor(cell.fromColor, targetColor, t);

                if (fill) {
                    ctx.fillStyle = fill;
                    ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
                    cell.lastColor = targetColor;
                }
            }
        }
        this.politicalLayer = this.canvas;

        if (now >= grid.animatingUntil) {
            grid.dirty = false;
        }
    }

    getLayer(grid, stateColorMap, currentTick, now) {
        this.updatePoliticalLayer(grid, stateColorMap, currentTick, now);
        return this.politicalLayer;
    }
}
