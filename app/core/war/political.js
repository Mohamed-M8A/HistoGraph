// =====================================================================================
// POLITICAL ENGINE — FILE OVERVIEW
// =====================================================================================
//
// This file implements the "political map" subsystem: a grid of territory cells that
// states claim over time, and a small scripting language used to drive those claims
// tick by tick. It is organized into the following sections, in order:
//
//   1. Color Utilities & Validation
//      Hex color parsing/validation and color-math helpers (adjustColor, shadeColor,
//      lerpColor) used to derive a state's occupied/advance/border shades from its
//      base color, and to animate fade transitions between colors over time.
//
//   2. Grid Constants & Helpers
//      Defines the political grid data structure: a 2D array of cells, where each
//      cell is either null (unclaimed) or an object recording its owner and the data
//      needed to animate its color transition (ownerId, conqueredAt, transitionStart,
//      fromColor, lastColor). Includes bounds checking, cell lookup, and border
//      detection (a cell is a "border cell" if any orthogonal neighbor has a
//      different owner or is off-grid).
//
//   3. Grid Mutation Operations
//      claimCell is the single source of truth for taking ownership of a cell — it
//      records fromColor/lastColor itself so the engine never depends on a renderer
//      having run first to know what color a cell was previously displaying.
//      Also includes eraseCell, stabilizeState (freezes a state's cells so they stop
//      animating, used by the PEACE command), and claimRect (claims a rectangular
//      region by repeatedly calling claimCell).
//
//   4. Grid Compression Utilities
//      Converts the raw cell grid into a small list of same-owner rectangles, so a
//      large grid can be exported/serialized as a handful of RECT commands instead of
//      one PIX per cell. fastCompressGrid scans row by row and merges runs of
//      identical ownership vertically; fastCompressRegion does the same over a
//      sub-rectangle of the grid.
//
//   5. State Color Derivation
//      Given a state's base color plus optional occupied/advance overrides ('*' or
//      omitted means "derive it from the base color"), builds the four-color set a
//      state uses across the political layer: base (stabilized/PEACE color), occupied
//      (older claims), advance (cells claimed on the current tick), and border
//      (always auto-derived, never overridable).
//
//   6. Script Command Grammar
//      A script is a sequence of lines. Each line starts with a tick marker (e.g.
//      "T1") followed by a payload, and must end with a semicolon. The payload may
//      contain several commands separated by semicolons:
//
//        PIX:   x,y stateId                       -> claims a single cell
//        RECT:  x1,y1 x2,y2 stateId               -> claims a rectangular area
//        {STATE code baseColor occ|* adv|*}       -> defines or redefines a state's
//                                                     color set
//        {PEACE baseId id1 id2}                   -> freezes the current displayed
//                                                     color of baseId and every listed
//                                                     id in place, so no further
//                                                     transition animation plays for
//                                                     their cells until they are
//                                                     claimed again
//
//      STATE and PEACE both live inside curly braces. The braces mark exactly where a
//      block's contents start and end, so either kind of block can safely sit
//      anywhere inside a tick's payload (beginning, middle, or end) without
//      swallowing unrelated PIX/RECT commands that follow it on the same line. The
//      closing brace "}" is itself treated as the end of the command, the same way a
//      semicolon ends a PIX or RECT command, so a braced block does not need a
//      trailing semicolon of its own.
//
//      A state code must be introduced by a {STATE ...} block before any
//      PIX/RECT/PEACE command in the script can reference it. "Before" means earlier
//      in the script text itself (line order), not an earlier tick number —
//      validation happens as the script is read top to bottom, independently of what
//      tick each line is stamped with. A state code can be redefined later in the
//      script with another {STATE ...} block using the same code; the new color set
//      replaces the old one from that point in the script onward, and is applied to
//      the live grid once the interpreter's clock reaches that block's tick.
//
//   6a. Strict State Definition Format (Import/Export)
//      A deliberately separate, simpler grammar from the tick-based script above: no
//      tick prefix, no PIX/RECT, just a flat list of STATE definitions. It exists
//      because the UI's Import/Export panel is about loading or saving a *palette* —
//      the reusable set of state codes/colors a mapmaker wants to paint with —
//      independently of any specific tick script or map. Mixing this into
//      parsePoliticalScript's tick grammar would force every palette import/export to
//      carry a fake "T0" wrapper it has no use for, and would make exported palettes
//      non-portable across scripts that use different tick numbering. The two
//      grammars intentionally share the same underlying color model (buildStateColors)
//      so a state defined here and one defined via a {STATE ...} block in a tick
//      script always produce byte-for-byte identical base/occupied/advance/border
//      sets.
//
//      Grammar (one command per line, case-insensitive keyword):
//        STATE <code> <baseHexColor> [<occupiedHexOrStar>] [<advanceHexOrStar>];
//      Every line must end with a semicolon, matching this file's other parsers'
//      convention. Blank lines and "//" comment lines are ignored, matching
//      parseUnitsScript's convention in units.js. A state code redefined later in the
//      text simply overwrites the earlier definition in the returned stateColors
//      (last one wins) — this is a straight import/replace operation, not a script
//      the interpreter steps through, so there's no notion of "when" a redefinition
//      takes effect to warn about.
//
//      Error messages here are plain English (not the i18n-key style used by
//      parsePoliticalScript's own errors below), because this format's errors are
//      meant to be shown directly to the user in the Import panel, the same way
//      parseUnitsScript's unit-script errors already are.
//
//   7. Script Parsing Entry Point
//      parsePoliticalScript parses the whole script in a single top-to-bottom pass.
//      STATE blocks are resolved as they're encountered, growing the set of known
//      state IDs and the state color map as the pass continues, so any
//      PIX/RECT/PEACE command later in the script can reference a state defined
//      earlier in it. All parsed commands (including STATE ones) are returned sorted
//      by tick, for the interpreter to run in chronological order; stateColors is the
//      snapshot of colors as of the end of parsing, useful for an initial render
//      before the interpreter has advanced.
//
//   8. Engine Execution
//      PoliticalEngine steps through the parsed, tick-sorted commands as the game
//      clock advances. PIX/RECT claim cells, PEACE stabilizes a state's cells so they
//      stop animating, and STATE writes a (re)defined color set into the live
//      stateColors map that a renderer reads from — so a mid-script STATE
//      redefinition takes visible effect once the clock reaches its tick, without
//      needing a page reload or a fresh parse.
//
//   9. HGPM File Format (Export / Import)
//      A .hgpm file is just the political script text itself — state definitions and
//      tick commands share one grammar and one file, so the whole map (colors
//      included) can be shared or backed up as a single portable text file. Loading
//      one is the same operation as parsing any other script, e.g.:
//        T0 {STATE FR #0000FF #6699FF #3377FF};
//        T0 {STATE GER #FF0000 * *};
//        T1 10,10 FR;
//        T2 {PEACE FR GER};
//
// This module is a headless simulation: it never touches the DOM, Canvas, or any
// browser-only API. Rendering the grid onto a canvas is the responsibility of
// renderer/political.js; writing a .hgpm file to disk is the responsibility of the UI
// layer.
// =====================================================================================

// ==========================================
// 1. Color Utilities & Validation
// ==========================================
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const STATE_CODE_RE = /^[A-Za-z0-9_]+$/;

export function isValidHexColor(token) {
    return HEX_RE.test(token) || token === '*';
}

function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return "#" + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function adjustColor(hex, factor) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor);
}

function shadeColor(hex, factor) {
    const { r, g, b } = hexToRgb(hex);
    const f = 1 + factor;
    return rgbToHex(r * f, g * f, b * f);
}

export function lerpColor(hexA, hexB, t) {
    if (!hexA && !hexB) return null;
    if (!hexA) return hexB;
    if (!hexB) return hexA;
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    return `rgb(${Math.round(a.r + (b.r - a.r) * t)}, ${Math.round(a.g + (b.g - a.g) * t)}, ${Math.round(a.b + (b.b - a.b) * t)})`;
}

// ==========================================
// 2. Grid Constants & Helpers
// ==========================================
export const DEFAULT_TRANSITION_MS = 400;

export function createPoliticalGrid(width, height) {
    const cells = new Array(height);
    for (let y = 0; y < height; y++) {
        cells[y] = new Array(width).fill(null);
    }
    return { width, height, cells, dirty: true, animatingUntil: 0 };
}

function inBounds(grid, x, y) {
    return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function getCell(grid, x, y) {
    if (!inBounds(grid, x, y)) return null;
    return grid.cells[y][x];
}

export function isBorderCell(grid, x, y) {
    const cell = getCell(grid, x, y);
    if (!cell) return false;

    const neighbors = [
        [x - 1, y], [x + 1, y],
        [x, y - 1], [x, y + 1]
    ];

    for (const [nx, ny] of neighbors) {
        if (!inBounds(grid, nx, ny)) return true;
        const neighbor = grid.cells[ny][nx];
        if (!neighbor || neighbor.ownerId !== cell.ownerId) return true;
    }
    return false;
}

// ==========================================
// 3. Grid Mutation Operations
// ==========================================
export function claimCell(grid, x, y, stateId, tick, now) {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (!inBounds(grid, gx, gy)) return;

    const existing = grid.cells[gy][gx];

    grid.cells[gy][gx] = {
        ownerId: stateId,
        conqueredAt: tick,
        transitionStart: now,
        fromColor: existing ? existing.lastColor : null,
        lastColor: existing ? existing.lastColor : null
    };

    grid.dirty = true;
    grid.animatingUntil = Math.max(grid.animatingUntil, now + DEFAULT_TRANSITION_MS);
}

export function eraseCell(grid, x, y) {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (inBounds(grid, gx, gy)) {
        grid.cells[gy][gx] = null;
        grid.dirty = true;
    }
}

export function stabilizeState(grid, stateId) {
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const cell = grid.cells[y][x];
            if (cell && cell.ownerId === stateId) {
                cell.conqueredAt = -Infinity;
            }
        }
    }
    grid.dirty = true;
}

export function claimRect(grid, x1, y1, x2, y2, stateId, tick, now) {
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(grid.width - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(grid.height - 1, Math.max(y1, y2));

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            claimCell(grid, x, y, stateId, tick, now);
        }
    }
}

// ==========================================
// 4. Grid Compression Utilities
// ==========================================
function sameRun(a, b) {
    if (!a || !b) return a === b;
    return a.ownerId === b.ownerId;
}

function rowRuns(cells, y, width) {
    const runs = [];
    let x = 0;
    while (x < width) {
        const cell = cells[y][x];
        if (!cell) {
            x += 1;
            continue;
        }
        let xEnd = x;
        while (xEnd + 1 < width && sameRun(cells[y][xEnd + 1], cell)) {
            xEnd += 1;
        }
        runs.push({ x1: x, x2: xEnd, ownerId: cell.ownerId });
        x = xEnd + 1;
    }
    return runs;
}

export function fastCompressGrid(grid) {
    const { width, height, cells } = grid;
    let active = [];
    const finished = [];

    for (let y = 0; y < height; y++) {
        const runs = rowRuns(cells, y, width);
        const nextActive = [];
        let ai = 0;

        for (let ri = 0; ri < runs.length; ri++) {
            const run = runs[ri];

            while (ai < active.length && active[ai].x2 < run.x1) {
                finished.push(active[ai]);
                ai += 1;
            }

            if (ai < active.length && active[ai].x1 === run.x1 && active[ai].x2 === run.x2 && active[ai].ownerId === run.ownerId) {
                active[ai].y2 = y;
                nextActive.push(active[ai]);
                ai += 1;
            } else {
                nextActive.push({ x1: run.x1, x2: run.x2, y1: y, y2: y, ownerId: run.ownerId });
            }
        }

        while (ai < active.length) {
            finished.push(active[ai]);
            ai += 1;
        }

        active = nextActive;
    }

    finished.push(...active);
    return finished;
}

export function fastCompressRegion(grid, x1, y1, x2, y2) {
    const xMin = Math.max(0, Math.min(x1, x2));
    const xMax = Math.min(grid.width - 1, Math.max(x1, x2));
    const yMin = Math.max(0, Math.min(y1, y2));
    const yMax = Math.min(grid.height - 1, Math.max(y1, y2));

    const subCells = [];
    for (let y = yMin; y <= yMax; y++) {
        subCells.push(grid.cells[y].slice(xMin, xMax + 1));
    }

    const rects = fastCompressGrid({ width: xMax - xMin + 1, height: yMax - yMin + 1, cells: subCells });
    return rects.map((r) => ({
        x1: r.x1 + xMin,
        x2: r.x2 + xMin,
        y1: r.y1 + yMin,
        y2: r.y2 + yMin,
        ownerId: r.ownerId
    }));
}

export function rectToSyntax(rect) {
    if (rect.x1 === rect.x2 && rect.y1 === rect.y2) {
        return `${rect.x1},${rect.y1} ${rect.ownerId}`;
    }
    return `${rect.x1},${rect.y1} ${rect.x2},${rect.y2} ${rect.ownerId}`;
}

// ==========================================
// 5. State Color Derivation
// ==========================================
export function buildStateColors(baseColor, occupiedToken, advanceToken) {
    let occupied = occupiedToken || '*';
    let advance = advanceToken || '*';

    if (occupied === '*') occupied = adjustColor(baseColor, 0.4);
    if (advance === '*') advance = adjustColor(baseColor, 0.7);

    return {
        base: baseColor,
        occupied,
        advance,
        border: shadeColor(baseColor, -0.3)
    };
}

export function getStateColors(stateColorMap, id) {
    return stateColorMap[id] || null;
}

// ==========================================
// 6. Script Command Grammar
// ==========================================
const COORD_RE = /^(-?\d+),(-?\d+)$/;
const BRACED_BLOCK_RE = /\{([^{}]*)\}/g;
const BLOCK_PLACEHOLDER_RE = /^\u0000BLOCK(\d+)\u0000$/;

function parseStateBlock(parts) {
    if (parts.length < 3) {
        return { error: "STATE command needs a code and a base color" };
    }

    const code = parts[1].toUpperCase();
    if (!STATE_CODE_RE.test(code)) {
        return { error: `Invalid state code: "${code}"` };
    }

    const baseColor = parts[2];
    if (!HEX_RE.test(baseColor)) {
        return { error: "Invalid hex color" };
    }

    return {
        command: "STATE",
        args: { code, colors: buildStateColors(baseColor, parts[3], parts[4]) }
    };
}

function parsePeaceBlock(parts, knownStateIds) {
    if (parts.length < 2) {
        return { error: "PEACE command needs at least one state ID" };
    }

    const baseStateId = parts[1].toUpperCase();
    const targetStateIds = parts.slice(2).map(id => id.toUpperCase());

    if (!knownStateIds.has(baseStateId)) {
        return { error: `Unknown state ID: ${baseStateId}` };
    }

    return {
        command: "PEACE",
        args: { baseStateId, targetStateIds }
    };
}

function parseBracedBlock(rawContent, knownStateIds) {
    const parts = rawContent.trim().split(/\s+/).filter(Boolean);
    const keyword = (parts[0] || "").toUpperCase();

    if (keyword === "STATE") return parseStateBlock(parts);
    if (keyword === "PEACE") return parsePeaceBlock(parts, knownStateIds);

    return { error: `Invalid block contents, expected PEACE or STATE: "{${rawContent}}"` };
}

function parseCommand(segment, knownStateIds) {
    const parts = segment.split(/\s+/);
    const firstToken = parts[0].toUpperCase();

    if (firstToken === "PEACE" || firstToken === "STATE") {
        return { error: `${firstToken} must be wrapped in braces, e.g. {${firstToken} ...}` };
    }

    if (parts.length === 2) {
        const coord = parts[0].match(COORD_RE);
        if (!coord) return { error: `Invalid coordinates: ${parts[0]}` };
        const stateId = parts[1].toUpperCase();

        if (!knownStateIds.has(stateId)) {
            return { error: `Unknown state ID: ${stateId}` };
        }

        return {
            command: "PIX",
            args: { x: Number(coord[1]), y: Number(coord[2]), stateId }
        };
    }

    if (parts.length === 3) {
        const c1 = parts[0].match(COORD_RE);
        const c2 = parts[1].match(COORD_RE);
        if (!c1 || !c2) return { error: `Invalid rectangle coordinates: ${parts[0]} ${parts[1]}` };
        const stateId = parts[2].toUpperCase();

        if (!knownStateIds.has(stateId)) {
            return { error: `Unknown state ID: ${stateId}` };
        }

        return {
            command: "RECT",
            args: { x1: Number(c1[1]), y1: Number(c1[2]), x2: Number(c2[1]), y2: Number(c2[2]), stateId }
        };
    }

    return { error: `Unknown syntax: "${segment}"` };
}

// ==========================================
// 6a. Strict State Definition Format (Import/Export)
// ==========================================
export function parseStateDefinitionsStrict(text) {
    const lines = (text || "").split("\n");
    const stateColors = {};
    const errors = [];

    lines.forEach((rawLine, index) => {
        const lineNumber = index + 1;
        const line = rawLine.trim();
        if (line === "" || line.startsWith("//")) return;

        if (!line.endsWith(";")) {
            errors.push({ line: lineNumber, message: "Line must end with a semicolon (;)" });
            return;
        }

        const body = line.slice(0, -1).trim();
        const parts = body.split(/\s+/).filter(Boolean);
        const keyword = (parts[0] || "").toUpperCase();

        if (keyword !== "STATE") {
            errors.push({ line: lineNumber, message: `Expected STATE, got: "${parts[0] || ""}"` });
            return;
        }

        if (parts.length < 3) {
            errors.push({ line: lineNumber, message: "STATE command needs a code and a base color" });
            return;
        }

        const code = parts[1].toUpperCase();
        if (!STATE_CODE_RE.test(code)) {
            errors.push({ line: lineNumber, message: `Invalid state code: "${code}"` });
            return;
        }

        const baseColor = parts[2];
        if (!HEX_RE.test(baseColor)) {
            errors.push({ line: lineNumber, message: "Invalid hex color" });
            return;
        }

        stateColors[code] = buildStateColors(baseColor, parts[3], parts[4]);
    });

    return { stateColors, errors };
}

export function serializeStateDefinitionsStrict(stateColorMap) {
    const codes = Object.keys(stateColorMap || {}).sort();
    return codes
        .map((code) => {
            const colors = stateColorMap[code];
            return `STATE ${code} ${colors.base} ${colors.occupied} ${colors.advance};`;
        })
        .join("\n");
}

// ==========================================
// 7. Script Parsing Entry Point
// ==========================================
export function parsePoliticalScript(text) {
    const lines = (text || "").split("\n");
    const commands = [];
    const errors = [];
    const seenInTick = new Map();
    const stateColors = {};
    const knownStateIds = new Set();

    lines.forEach((rawLine, index) => {
        const lineNumber = index + 1;
        const line = rawLine.trim();
        if (!line) return;

        const tickMatch = line.match(/^(T\d+)\s+(.*)$/i);
        if (!tickMatch) {
            errors.push({ line: lineNumber, message: "err_missing_tick", raw: line });
            return;
        }

        const tick = parseInt(tickMatch[1].slice(1), 10);
        let body = tickMatch[2].trim();

        if (!body.endsWith(";")) {
            errors.push({ line: lineNumber, message: "err_missing_semi", raw: line });
            return;
        }

        body = body.slice(0, -1);

        const blocks = [];
        const bodyWithPlaceholders = body.replace(BRACED_BLOCK_RE, (_match, inner) => {
            const token = `\u0000BLOCK${blocks.length}\u0000`;
            blocks.push(inner);
            return `${token};`;
        });

        const segments = bodyWithPlaceholders.split(";").map(s => s.trim()).filter(s => s !== "");

        for (const segment of segments) {
            const blockMatch = segment.match(BLOCK_PLACEHOLDER_RE);

            if (blockMatch) {
                const blockIndex = Number(blockMatch[1]);
                const parsed = parseBracedBlock(blocks[blockIndex], knownStateIds);

                if (parsed.error) {
                    errors.push({ line: lineNumber, message: parsed.error, raw: line });
                } else {
                    if (parsed.command === "STATE") {
                        knownStateIds.add(parsed.args.code);
                        stateColors[parsed.args.code] = parsed.args.colors;
                    }
                    commands.push({ ...parsed, tick, line: lineNumber });
                }
                continue;
            }

            if (segment.includes("{") || segment.includes("}")) {
                errors.push({ line: lineNumber, message: `Malformed block near: "${segment}"`, raw: line });
                continue;
            }

            const parsed = parseCommand(segment, knownStateIds);
            if (parsed.error) {
                errors.push({ line: lineNumber, message: parsed.error, raw: line });
                continue;
            }

            if (parsed.command === "PIX" || parsed.command === "RECT") {
                const key = parsed.command === "PIX"
                    ? `${tick}:${parsed.args.x},${parsed.args.y}`
                    : `${tick}:${parsed.args.x1},${parsed.args.y1}-${parsed.args.x2},${parsed.args.y2}`;
                if (seenInTick.has(key)) {
                    errors.push({
                        line: lineNumber,
                        message: `warn_duplicate_claim_in_tick T${tick}: previously claimed by ${seenInTick.get(key)}, now ${parsed.args.stateId}`,
                        raw: line,
                        warning: true
                    });
                }
                seenInTick.set(key, parsed.args.stateId);
            }

            commands.push({ ...parsed, tick, line: lineNumber });
        }
    });

    commands.sort((a, b) => a.tick - b.tick);
    return { stateColors, commands, errors };
}

// ==========================================
// 8. Engine Execution
// ==========================================
export class PoliticalEngine {
    constructor(grid, commands, stateColors) {
        this.grid = grid;
        this.commands = commands;
        this.stateColors = stateColors;
        this.cursor = 0;
    }

    onTick(tick) {
        while (this.cursor < this.commands.length && this.commands[this.cursor].tick <= tick) {
            this._execute(this.commands[this.cursor], tick);
            this.cursor++;
        }
    }

    _execute(cmd, tick) {
        const now = performance.now();
        if (cmd.command === "PIX") {
            claimCell(this.grid, cmd.args.x, cmd.args.y, cmd.args.stateId, tick, now);
        } else if (cmd.command === "RECT") {
            claimRect(this.grid, cmd.args.x1, cmd.args.y1, cmd.args.x2, cmd.args.y2, cmd.args.stateId, tick, now);
        } else if (cmd.command === "PEACE") {
            stabilizeState(this.grid, cmd.args.baseStateId);
            cmd.args.targetStateIds.forEach(id => stabilizeState(this.grid, id));
        } else if (cmd.command === "STATE") {
            this.stateColors[cmd.args.code] = cmd.args.colors;
        }
    }

    isDone() {
        return this.cursor >= this.commands.length;
    }
}

// ==========================================
// 9. HGPM File Format (Export / Import)
// ==========================================
export const HGPM_EXTENSION = ".hgpm";

export function buildHgpmFile(scriptText) {
    return `${(scriptText || "").trim()}\n`;
}
