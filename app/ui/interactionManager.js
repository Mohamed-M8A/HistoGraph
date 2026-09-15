import { claimCell, claimRect, eraseCell } from "../system/politicalEngine.js";
import { compressStrokeToSyntax } from "./mapEditorPanel.js";

// ==========================================
// Interaction Manager
// ==========================================
export class InteractionManager {
  constructor(refs, settings, mapEditor, renderer) {
    this.refs = refs;
    this.settings = settings;
    this.mapEditor = mapEditor;
    this.renderer = renderer;
    this.paintActive = false;
    this.eraseActive = false;
    this.isDragging = false;
    this.rectStart = null;
  }

  init(politicalGrid, drawCall, refreshUICall) {
    this.politicalGrid = politicalGrid;
    this.drawCall = drawCall;
    this.refreshUICall = refreshUICall;
    this._setupEvents();
  }

  setGrid(politicalGrid) {
    this.politicalGrid = politicalGrid;
  }

  _getMousePos(e) {
    const r = this.refs.canvas.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * this.settings.mapWidth),
      y: Math.floor(((e.clientY - r.top) / r.height) * this.settings.mapHeight)
    };
  }

  // ---- Freehand Brush ----
  _paintStroke(pos) {
    const sid = this.refs.paintStateSelect.value;
    const tick = Number(this.refs.paintTickInput.value) || 1;
    const radius = Number(this.refs.paintBrushInput.value) || 0;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.hypot(dx, dy) > radius) continue;
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        if (this.eraseActive) eraseCell(this.politicalGrid, nx, ny);
        else if (sid) claimCell(this.politicalGrid, nx, ny, sid, tick, performance.now());
      }
    }

    if (!this.eraseActive && sid) {
      const lines = compressStrokeToSyntax(
        this.politicalGrid,
        pos.x - radius, pos.y - radius,
        pos.x + radius, pos.y + radius
      );
      this.mapEditor.recordEntries(tick, lines);
    }

    this.drawCall();
  }

  // ---- Event Wiring ----
  _setupEvents() {
    this.refs.paintModeBtn.onclick = () => {
      this.paintActive = !this.paintActive;
      this.refs.paintModeBtn.classList.toggle("is-active", this.paintActive);
    };

    this.refs.paintEraseBtn.onclick = () => {
      this.eraseActive = !this.eraseActive;
      this.refs.paintEraseBtn.classList.toggle("is-active", this.eraseActive);
    };

    this.refs.canvas.onmousedown = (e) => {
      if (!this.paintActive) return;
      this.isDragging = true;
      const pos = this._getMousePos(e);
      if (this.refs.paintShapeSelect.value === "RECT") this.rectStart = pos;
      else this._paintStroke(pos);
    };

    window.onmousemove = (e) => {
      if (!this.isDragging || this.refs.paintShapeSelect.value === "RECT") return;
      this._paintStroke(this._getMousePos(e));
    };

    window.onmouseup = (e) => {
      if (!this.isDragging) return;
      if (this.refs.paintShapeSelect.value === "RECT" && this.rectStart) {
        const end = this._getMousePos(e);
        const sid = this.refs.paintStateSelect.value;
        const tick = Number(this.refs.paintTickInput.value) || 1;
        if (this.eraseActive) {
          for (let y = Math.min(this.rectStart.y, end.y); y <= Math.max(this.rectStart.y, end.y); y++) {
            for (let x = Math.min(this.rectStart.x, end.x); x <= Math.max(this.rectStart.x, end.x); x++)
              eraseCell(this.politicalGrid, x, y);
          }
        } else if (sid) {
          claimRect(this.politicalGrid, this.rectStart.x, this.rectStart.y, end.x, end.y, sid, tick, performance.now());
          this.mapEditor.recordEntries(tick, [`${this.rectStart.x},${this.rectStart.y} ${end.x},${end.y} ${sid}`]);
        }
      }
      this.isDragging = false;
      this.rectStart = null;
      this.refreshUICall();
      this.drawCall();
    };
  }
}
