import { createRng } from './generator.js';

// ==========================================
// 1. Water Color & Depth Helpers
// ==========================================
export function getWaterDepth(elevation, seaLevel = 0) {
    if (elevation >= seaLevel) return 0;
    return Math.abs(elevation - seaLevel);
}

export function interpolateWaterColor(depth, options = {}) {
    const {
        shallow = { r: 63, g: 114, b: 133 },
        deep = { r: 28, g: 66, b: 88 },
        maxDepth = 0.8
    } = options;

    const t = Math.min(1, depth / maxDepth);

    const r = Math.round(shallow.r + (deep.r - shallow.r) * t);
    const g = Math.round(shallow.g + (deep.g - shallow.g) * t);
    const b = Math.round(shallow.b + (deep.b - shallow.b) * t);

    return `rgb(${r}, ${g}, ${b})`;
}

export function getShorelineGlow(elevation, seaLevel = 0, glowRange = 0.05) {
    const dist = seaLevel - elevation;
    if (dist > 0 && dist < glowRange) {
        return Math.min(1, (glowRange - dist) / glowRange);
    }
    return 0;
}

// ==========================================================================
// 1a. Per-pixel Surface Noise
//
// terrainManager.js's TerrainPainter.setTerrain builds its water/river
// color lookup table one grid cell at a time and already has that cell's
// (x, y) on hand - it has always passed them through to
// applyWaterVisuals/applyRiverVisuals as a 4th/5th positional argument,
// expecting a small deterministic per-pixel color jitter back so open
// water and river surfaces don't render as perfectly flat fills. Both
// functions used to silently ignore those extra arguments (JS doesn't
// error on unused positional params), so the feature never actually ran.
// pixelNoise is a cheap, allocation-free hash (not a full noise library
// call like generator.js's Perlin implementation - this runs once per
// water/river pixel in a hot loop, so it deliberately trades quality for
// near-zero cost) that returns a deterministic value in [0, 1) for a
// given integer cell coordinate; the same (x, y) always produces the same
// jitter, so regenerating the same seed/map twice still looks identical.
// applySurfaceNoise turns that into a small +/- offset shared across all
// three channels (channel-correlated jitter reads as a brightness
// speckle, which is the intended "water surface glint" look, rather than
// per-channel noise which would read as color-fringing static).
// ==========================================================================
const DEFAULT_SURFACE_NOISE_AMPLITUDE = 4;

function pixelNoise(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
}

function applySurfaceNoise(rgb, x, y, amplitude) {
    if (!amplitude) return rgb;
    const jitter = (pixelNoise(x, y) - 0.5) * 2 * amplitude;
    return rgb.map((v) => Math.max(0, Math.min(255, v + jitter)));
}

export function applyWaterVisuals(elevation, seaLevel, waterSettings = {}, x = 0, y = 0) {
    const depth = getWaterDepth(elevation, seaLevel);
    const baseColor = interpolateWaterColor(depth, waterSettings);

    const glow = getShorelineGlow(elevation, seaLevel, waterSettings.shorelineGlowRange);
    let rgb = baseColor.match(/\d+/g).map(Number);

    if (glow > 0) {
        const factor = 1 + (glow * (waterSettings.shorelineGlowIntensity || 0.2));
        rgb = rgb.map((v) => Math.min(255, v * factor));
    }

    rgb = applySurfaceNoise(rgb, x, y, waterSettings.surfaceNoiseAmplitude ?? DEFAULT_SURFACE_NOISE_AMPLITUDE);

    return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

export function getRiverColor(depth = 0.25, options = {}) {
    return interpolateWaterColor(depth, { maxDepth: 0.6, ...options });
}

// ==========================================================================
// applyRiverVisuals
//
// terrainManager.js has imported and called this function for river cells
// since it added dedicated river-surface handling (see the comment on
// TerrainPainter.setTerrain), but it never existed in this file - an
// import of a non-existent named export, which throws at module-load
// time under native ESM ("does not provide an export named
// 'applyRiverVisuals'") and breaks the entire module graph that depends
// on terrainManager.js, including main.js. It intentionally reuses
// getRiverColor() rather than duplicating interpolateWaterColor's math,
// since a river's shallow/deep curve (maxDepth 0.6) is already
// consistent with getRiverColor's own default and with how
// applyRiverToTerrain/applyRiversToTerrain reason about river width -
// keeping color and geometry both anchored to the same "river" profile.
// Shoreline glow and per-pixel surface noise are applied the same way as
// applyWaterVisuals for visual consistency between ocean and river water.
// ==========================================================================
export function applyRiverVisuals(elevation, seaLevel, riverSettings = {}, x = 0, y = 0) {
    const depth = getWaterDepth(elevation, seaLevel);
    const baseColor = getRiverColor(depth, riverSettings);

    const glow = getShorelineGlow(elevation, seaLevel, riverSettings.shorelineGlowRange);
    let rgb = baseColor.match(/\d+/g).map(Number);

    if (glow > 0) {
        const factor = 1 + (glow * (riverSettings.shorelineGlowIntensity || 0.2));
        rgb = rgb.map((v) => Math.min(255, v * factor));
    }

    rgb = applySurfaceNoise(rgb, x, y, riverSettings.surfaceNoiseAmplitude ?? DEFAULT_SURFACE_NOISE_AMPLITUDE);

    return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

// ==========================================
// 2. River Generation & Tracing
// ==========================================
function pickSourcePoints(heightmap, count, minElevation, rng) {
    const height = heightmap.length;
    const width = heightmap[0].length;

    let threshold = minElevation;
    let candidates = [];

    while (threshold > -1) {
        candidates = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (heightmap[y][x] >= threshold) candidates.push({ x, y });
            }
        }
        if (candidates.length >= count) break;
        threshold -= 0.1;
    }

    const sources = [];
    for (let i = 0; i < count && candidates.length > 0; i++) {
        const idx = Math.floor(rng() * candidates.length);
        sources.push(candidates[idx]);
        candidates.splice(idx, 1);
    }
    return sources;
}

function findEscapeCell(heightmap, curr, visited, currentH, maxRadius) {
    const height = heightmap.length;
    const width = heightmap[0].length;

    for (let radius = 2; radius <= maxRadius; radius++) {
        let best = null;
        let bestH = currentH;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                const nx = curr.x + dx;
                const ny = curr.y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

                const nk = `${nx},${ny}`;
                if (visited.has(nk)) continue;

                const h = heightmap[ny][nx];
                if (h < bestH) {
                    bestH = h;
                    best = { x: nx, y: ny };
                }
            }
        }

        if (best) return best;
    }
    return null;
}

// ==========================================================================
// Tributary merge detection
//
// tributaryMergeDistance (an option threaded through generateRivers ->
// traceRiver) lets a river currently being traced stop and attach itself
// to an already-generated river instead of always continuing all the way
// to the sea independently. findNearbyRiverPoint does a straightforward
// linear scan of every point of every already-traced river - acceptable
// because this only runs when tributaryMergeDistance > 0 (opt-in,
// defaults to disabled/0) and river paths are short relative to a map's
// pixel count; a spatial index would be overkill for the river counts
// this generator produces. `river` here is the same array traceRiver
// returns, carrying its own `.riverId` property (set by generateRivers
// right after a successful trace) - that id is what a merging tributary
// records in its own `.mergesInto`, following the same "extra properties
// on the path array" convention terrainManager.js already uses for road
// paths (`path.importance` / `path.roadType`).
// ==========================================================================
function findNearbyRiverPoint(existingRivers, x, y, maxDist) {
    for (const river of existingRivers) {
        for (const point of river) {
            if (Math.hypot(point.x - x, point.y - y) <= maxDist) {
                return river;
            }
        }
    }
    return null;
}

function bresenhamLine(x0, y0, x1, y1) {
    const points = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0, y = y0;

    while (true) {
        points.push({ x, y });
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
    }
    return points;
}

// ==========================================================================
// estuaryLevel / estuarySlack
//
// The original stopping rule was a single hard cutoff: trace strictly
// downhill until elevation drops to seaLevel, then stop. That produces a
// river that terminates at a single pixel-wide point right at the
// coastline, which reads as an unnaturally abrupt "snap to the sea"
// rather than a widening river mouth. estuaryLevel (defaults to
// seaLevel, so omitting it reproduces the old cutoff exactly) and
// estuarySlack (defaults to 0, also reproducing the old behavior exactly)
// together define a zone between estuaryLevel and
// (estuaryLevel - estuarySlack) where two things change: the trace no
// longer requires a strictly-downhill step (equal-elevation neighbors are
// now valid candidates too, picked at random rather than deterministically,
// to produce a wandering, spreading mouth instead of a straight line) and
// tracing only fully stops once elevation drops below
// (estuaryLevel - estuarySlack). Each pushed path point records whether it
// was placed while inside this zone (`inEstuaryZone`), which
// applyRiverToTerrain reads to widen the river's rendered footprint near
// its mouth via the `estuaryWidthBoost` option.
// ==========================================================================
export function traceRiver(heightmap, start, options = {}) {
    const {
        seaLevel = -0.1,
        maxLength = 2000,
        escapeRadius = 20,
        estuaryLevel = seaLevel,
        estuarySlack = 0,
        existingRivers = [],
        tributaryMergeDistance = 0
    } = options;
    const height = heightmap.length;
    const width = heightmap[0].length;
    const stopLevel = estuaryLevel - estuarySlack;

    const path = [];
    const visited = new Set();
    let curr = { x: start.x, y: start.y };

    for (let step = 0; step < maxLength; step++) {
        const currentElevation = heightmap[curr.y][curr.x];
        const inEstuaryZone = estuarySlack > 0 && currentElevation < estuaryLevel;

        path.push({ x: curr.x, y: curr.y, elevation: currentElevation, inEstuaryZone });
        visited.add(`${curr.x},${curr.y}`);

        if (tributaryMergeDistance > 0 && existingRivers.length > 0) {
            const merge = findNearbyRiverPoint(existingRivers, curr.x, curr.y, tributaryMergeDistance);
            if (merge) {
                path.isTributary = true;
                path.mergesInto = merge.riverId;
                break;
            }
        }

        if (currentElevation <= stopLevel) break;

        let next = null;
        let lowest = currentElevation;
        const candidates = [];

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = curr.x + dx;
                const ny = curr.y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

                const nk = `${nx},${ny}`;
                if (visited.has(nk)) continue;

                const h = heightmap[ny][nx];
                const isCandidate = inEstuaryZone ? h <= lowest : h < lowest;
                if (isCandidate) {
                    if (h < lowest) lowest = h;
                    candidates.push({ x: nx, y: ny });
                }
            }
        }

        if (candidates.length > 0) {
            next = inEstuaryZone
                ? candidates[Math.floor(Math.random() * candidates.length)]
                : candidates[candidates.length - 1];
        }

        if (!next) {
            const escape = findEscapeCell(heightmap, curr, visited, heightmap[curr.y][curr.x], escapeRadius);
            if (!escape) break;

            const bridge = bresenhamLine(curr.x, curr.y, escape.x, escape.y);
            for (let i = 1; i < bridge.length; i++) {
                const p = bridge[i];
                if (p.y < 0 || p.y >= height || p.x < 0 || p.x >= width) continue;
                path.push({ x: p.x, y: p.y, elevation: heightmap[p.y][p.x] });
                visited.add(`${p.x},${p.y}`);
            }
            curr = escape;
            continue;
        }

        curr = next;
    }

    return path;
}

export function generateRivers(heightmap, options = {}) {
    const {
        count,
        density = 0.02,
        minCount = 6,
        minSourceElevation = 0.6,
        seaLevel = -0.1,
        seed = 1,
        escapeRadius = 20,
        maxLength = 2000,
        estuaryLevel = seaLevel,
        estuarySlack = 0,
        tributaryMergeDistance = 0
    } = options;

    const height = heightmap.length;
    const width = heightmap[0].length;
    const riverCount = count ?? Math.max(minCount, Math.round(Math.sqrt(width * height) * density));

    const rng = createRng(seed);
    const sources = pickSourcePoints(heightmap, riverCount, minSourceElevation, rng);
    const rivers = [];

    // riverId is assigned per successfully-traced river (not per source,
    // since a source can fail to produce a long-enough path) and is what a
    // later river's `.mergesInto` (see findNearbyRiverPoint/traceRiver)
    // refers back to. `rivers` itself is passed as `existingRivers` while
    // it's still being built, so river N can only merge into rivers
    // 0..N-1 traced before it, never into one traced after it.
    for (const source of sources) {
        const path = traceRiver(heightmap, source, {
            seaLevel,
            escapeRadius,
            maxLength,
            estuaryLevel,
            estuarySlack,
            existingRivers: rivers,
            tributaryMergeDistance
        });
        if (path.length > 3) {
            path.riverId = rivers.length;
            rivers.push(path);
        }
    }

    return rivers;
}

// ==========================================
// 3. River -> Terrain Application
// ==========================================
// ==========================================================================
// widthCurve / estuaryWidthBoost / tributaryWidthBoost
//
// widthCurve (default 1, i.e. Math.pow(progress, 1) === progress, so
// omitting it reproduces the previous plain-linear widening exactly)
// lets width growth be concentrated near the river's mouth instead of
// spread evenly along its whole length - values > 1 keep the river
// closer to `riverWidth` for most of its course and only widen sharply
// near the end. estuaryWidthBoost (default 1 = no boost) multiplies
// width further for any point traceRiver marked `inEstuaryZone`, and
// tributaryWidthBoost (default 1 = no boost) does the same for the last
// few points of a path traceRiver marked `isTributary` (the point range
// closest to where it actually merges into its parent river), so the
// join reads as a confluence widening rather than a tributary just
// vanishing into a same-width parent stream. All three are fully
// optional and no-op at their defaults, so any existing call site that
// doesn't pass an options object behaves identically to before.
// ==========================================================================
export function applyRiverToTerrain(terrainGrid, riverPath, riverWidth = 1, widthGrowth = 0, options = {}) {
    const { widthCurve = 1, estuaryWidthBoost = 1, tributaryWidthBoost = 1 } = options;
    const total = riverPath.length;
    const tributaryTailLength = Math.min(5, total);

    for (let i = 0; i < total; i++) {
        const point = riverPath[i];
        const progress = total > 1 ? i / (total - 1) : 0;
        const curvedProgress = widthCurve === 1 ? progress : Math.pow(progress, widthCurve);
        let w = riverWidth + curvedProgress * riverWidth * widthGrowth;

        if (point.inEstuaryZone) w *= estuaryWidthBoost;
        if (riverPath.isTributary && i >= total - tributaryTailLength) w *= tributaryWidthBoost;

        const r = Math.ceil(w);

        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                const x = point.x + dx;
                const y = point.y + dy;
                if (Math.hypot(dx, dy) <= w && terrainGrid[y] && terrainGrid[y][x] !== undefined) {
                    terrainGrid[y][x] = 'river';
                }
            }
        }
    }
    return terrainGrid;
}

export function applyRiversToTerrain(terrainGrid, rivers, riverWidth = 1, widthGrowth = 0, options = {}) {
    for (const river of rivers) {
        applyRiverToTerrain(terrainGrid, river, riverWidth, widthGrowth, options);
    }
    return terrainGrid;
}