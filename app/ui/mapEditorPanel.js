import {
  isValidHexColor,
  parseStateDefinitionsStrict,
  serializeStateDefinitionsStrict,
  fastCompressRegion,
  rectToSyntax
} from "../system/politicalEngine.js";

// ==========================================
// 1. Map Editor
// ==========================================
export class MapEditor {
  constructor() {
    this.stateColorMap = {};
    this.scriptEntries = new Map();
  }

  addState(code, hex) {
    if (!code || !isValidHexColor(hex)) return false;
    const upperCode = code.toUpperCase();

    const hexToRgb = (h) => {
      const n = parseInt(h.replace('#', ''), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    const rgbToHex = (r, g, b) => {
      const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
      return "#" + [cl(r), cl(g), cl(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    };

    const { r, g, b } = hexToRgb(hex);
    this.stateColorMap[upperCode] = {
      base: hex,
      occupied: rgbToHex(r + (255 - r) * 0.4, g + (255 - g) * 0.4, b + (255 - b) * 0.4),
      advance: rgbToHex(r + (255 - r) * 0.7, g + (255 - g) * 0.7, b + (255 - b) * 0.7),
      border: rgbToHex(r * 0.7, g * 0.7, b * 0.7)
    };
    return true;
  }

  removeState(code) {
    delete this.stateColorMap[code];
  }

  importStrict(text) {
    const { stateColors, errors } = parseStateDefinitionsStrict(text);
    if (errors.length === 0) {
      this.stateColorMap = { ...this.stateColorMap, ...stateColors };
    }
    return { added: Object.keys(stateColors).length, errors };
  }

  exportStatesText() {
    return serializeStateDefinitionsStrict(this.stateColorMap);
  }

  recordEntries(tick, lines) {
    if (!lines.length) return;
    const existing = this.scriptEntries.get(tick) || [];
    this.scriptEntries.set(tick, existing.concat(lines));
  }

  clearScript() {
    this.scriptEntries.clear();
  }

  buildScriptText() {
    const ticks = Array.from(this.scriptEntries.keys()).sort((a, b) => a - b);
    return ticks
      .map((tick) => `T${tick} ${this.scriptEntries.get(tick).join("; ")};`)
      .join("\n");
  }

  maxRecordedTick() {
    let max = 0;
    for (const tick of this.scriptEntries.keys()) max = Math.max(max, tick);
    return max;
  }
}

// ==========================================
// 2. Rendering Helpers
// ==========================================
export function renderStatesList(refs, editor, onChange, emptyLabel) {
  const codes = Object.keys(editor.stateColorMap);
  refs.statesList.innerHTML = codes.length
    ? codes
        .map((code) => {
          const def = editor.stateColorMap[code];
          return `
        <div class="state-row" data-code="${code}">
          <span class="state-swatch" style="background:${def.base}" title="Base"></span>
          <span class="state-swatch" style="background:${def.occupied}" title="Occupied"></span>
          <span class="state-swatch" style="background:${def.advance}" title="Advance"></span>
          <span class="state-code">${code}</span>
          <button type="button" class="state-remove-btn" data-code="${code}">&times;</button>
        </div>`;
        })
        .join("")
    : `<p class="hint-text">${emptyLabel}</p>`;

  refs.statesList.querySelectorAll(".state-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      editor.removeState(btn.dataset.code);
      onChange();
    });
  });
}

export function populatePaintStateOptions(refs, editor, emptyLabel) {
  const codes = Object.keys(editor.stateColorMap);
  refs.paintStateSelect.innerHTML = codes.length
    ? codes.map((code) => `<option value="${code}">${code}</option>`).join("")
    : `<option value="">${emptyLabel || ""}</option>`;
}

export function renderSyntax(refs, editor, emptyLabel) {
  const maxTick = Math.max(1, editor.maxRecordedTick());
  const blocks = [];
  for (let tick = 1; tick <= maxTick; tick++) {
    const lines = editor.scriptEntries.get(tick) || [];
    if (lines.length === 0 && tick !== 1) continue;
    blocks.push(`
      <div class="syntax-block">
        <div class="syntax-tick-label">T${tick}</div>
        <div class="syntax-lines">${
          lines.length
            ? lines.map((line) => `<div class="syntax-line">${line};</div>`).join("")
            : `<div class="syntax-line syntax-line--empty">${emptyLabel}</div>`
        }</div>
      </div>`);
  }
  refs.syntaxOutput.innerHTML = blocks.join("");
}

// ==========================================
// 3. Stroke Compression
// ==========================================
export function compressStrokeToSyntax(grid, x1, y1, x2, y2) {
  return fastCompressRegion(grid, x1, y1, x2, y2).map(rectToSyntax);
}
