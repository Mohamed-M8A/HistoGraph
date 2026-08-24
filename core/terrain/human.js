// ==========================================================================
// SECTION 1: Core Utilities and Data Structures
//
// This block groups the low-level helpers shared by every other section of
// this file: a seeded PRNG (mulberry32) so settlement/road/building layouts
// are fully reproducible from a single seed, a binary MinHeap used by the
// A* pathfinder as its open-set priority queue, a small geometry helper
// (distSq), and color-selection helpers used when a settlement's base or
// keep color is picked from a palette array. None of this logic is
// specific to settlements, roads, or rendering on its own - it exists
// purely to be reused by the sections below without duplicating arithmetic
// or object bookkeeping in multiple places.
//
// hexToRgb itself - previously defined locally in this file with its own
// cache - now comes from the shared `colorUtils.js` module instead.
// terrainManager.js needed the exact same cached hex-parsing logic for its
// own rendering pipeline, and having it import this file's local copy
// would have created a dependency running the wrong way (a terrain-
// rendering module reaching into this settlements/buildings module purely
// to parse a color), while duplicating the function byte-for-byte in both
// files just to avoid that left two copies of the same cache-and-parse
// logic to keep in sync. colorUtils.js is a neutral, dependency-free home
// both modules can import from without depending on each other.
// ==========================================================================

import { hexToRgb } from './colorUtils.js';

function pickColor(rng, source) {
    if (Array.isArray(source)) return source[Math.floor(rng() * source.length)];
    return source;
}

function pickKeepPalette(rng, cityPalette) {
    if (Array.isArray(cityPalette.keeps) && cityPalette.keeps.length) {
        return cityPalette.keeps[Math.floor(rng() * cityPalette.keeps.length)];
    }
    return { primary: cityPalette.keep, secondary: cityPalette.keepSecondary };
}

function mulberry32(a) {
    return function() {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class MinHeap {
    constructor() { this.heap = []; }
    push(node) {
        this.heap.push(node);
        let i = this.heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.heap[p].f <= this.heap[i].f) break;
            [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
            i = p;
        }
    }
    pop() {
        if (this.heap.length === 1) return this.heap.pop();
        const min = this.heap[0];
        this.heap[0] = this.heap.pop();
        let i = 0;
        while (true) {
            const l = i * 2 + 1, r = l + 1;
            let smallest = i;
            if (l < this.heap.length && this.heap[l].f < this.heap[smallest].f) smallest = l;
            if (r < this.heap.length && this.heap[r].f < this.heap[smallest].f) smallest = r;
            if (smallest === i) break;
            [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
            i = smallest;
        }
        return min;
    }
    get size() { return this.heap.length; }
}

function distSq(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
}

// ==========================================================================
// SECTION 2: Building Shape Selection and Footprint Geometry
//
// This block is the entirely new piece of logic that decouples "what shape
// does a single building take" from "where inside the settlement is it
// placed" (the latter stays the job of the existing layout system in
// Section 4). The problem being solved here is visual monotony: every
// settlement in the original file rendered nothing but plain rectangles
// regardless of how large or important the city was. The rule implemented
// below is driven purely by settlement population: settlements below the
// small threshold keep the original rectangle-only behavior unchanged
// (this was already correct for rural hamlets and should not be touched),
// settlements in the medium band get a light sprinkle of circular/oval
// buildings on top of rectangles, and settlements above the large
// threshold get a full weighted-random shape palette (rectangle, circle,
// oval, an L-shaped two-rectangle silhouette, and three genuinely rare
// shapes - hexagon, pentagon, triangle) so a big city reads as a varied
// skyline instead of a uniform grid of boxes, while rectangles still
// dominate so the city silhouette does not turn into visual noise.
//
// Every shape is expressed as a "footprint": a plain object describing the
// exact geometry (either a polygon vertex list, or circle/oval radii) that
// was already rolled using the settlement's rng, plus a `boundingRadius`
// field (the true maximum distance from the footprint's center to any of
// its edges/vertices). That boundingRadius is the single value Section 3's
// collision system relies on, so every shape added here MUST compute it
// honestly - underestimating it would let non-rectangular buildings overlap
// their neighbors, which defeats the purpose of Section 3 entirely. Rare
// shapes (hexagon/pentagon/triangle) are capped per-settlement by the
// caller (Section 6) using the `rareUsed`/`rareLimits` bookkeeping objects
// passed into chooseBuildingShape, so a "large city" cannot end up entirely
// covered in exotic polygons.
// ==========================================================================

const BUILDING_SHAPE_SMALL_THRESHOLD = 60;
const BUILDING_SHAPE_LARGE_THRESHOLD = 150;

const LARGE_CITY_SHAPE_WEIGHTS = [
    ['rect', 0.55],
    ['circle', 0.15],
    ['oval', 0.12],
    ['lshape', 0.10],
    ['hexagon', 0.04],
    ['pentagon', 0.02],
    ['triangle', 0.02]
];

function pickWeighted(rng, table) {
    let roll = rng();
    for (const [shape, weight] of table) {
        if (roll < weight) return shape;
        roll -= weight;
    }
    return table[0][0];
}

function chooseBuildingShape(rng, population, thresholds, rareUsed, rareLimits) {
    const small = thresholds?.small ?? BUILDING_SHAPE_SMALL_THRESHOLD;
    const large = thresholds?.large ?? BUILDING_SHAPE_LARGE_THRESHOLD;

    if (population <= small) return 'rect';

    if (population <= large) {
        const roll = rng();
        if (roll < 0.82) return 'rect';
        if (roll < 0.93) return 'circle';
        return 'oval';
    }

    let shape = pickWeighted(rng, LARGE_CITY_SHAPE_WEIGHTS);
    const isRare = shape === 'hexagon' || shape === 'pentagon' || shape === 'triangle';
    if (isRare && rareUsed[shape] >= rareLimits[shape]) {
        shape = 'rect';
    }
    return shape;
}

function computeRareShapeLimits(population) {
    return {
        hexagon: Math.min(3, Math.max(1, Math.floor(population / 120))),
        pentagon: Math.min(2, Math.max(1, Math.floor(population / 220))),
        triangle: Math.min(2, Math.max(1, Math.floor(population / 200)))
    };
}

function regularPolygonVertices(sides, radius) {
    const verts = [];
    for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        verts.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return verts;
}

function polygonBoundingRadius(vertices) {
    let max = 0;
    for (const [x, y] of vertices) {
        const d = Math.hypot(x, y);
        if (d > max) max = d;
    }
    return max;
}

function createBuildingFootprint(shape, baseSize, rng) {
    const rotation = rng() * Math.PI;

    switch (shape) {
        case 'circle': {
            const radius = baseSize * (0.35 + rng() * 0.25);
            return { shape, radius, boundingRadius: radius, rotation };
        }
        case 'oval': {
            const rx = baseSize * (0.4 + rng() * 0.3);
            const ry = baseSize * (0.25 + rng() * 0.25);
            return { shape, rx, ry, boundingRadius: Math.max(rx, ry), rotation };
        }
        case 'hexagon': {
            const vertices = regularPolygonVertices(6, baseSize * (0.45 + rng() * 0.25));
            return { shape, vertices, boundingRadius: polygonBoundingRadius(vertices), rotation };
        }
        case 'pentagon': {
            const vertices = regularPolygonVertices(5, baseSize * (0.45 + rng() * 0.25));
            return { shape, vertices, boundingRadius: polygonBoundingRadius(vertices), rotation };
        }
        case 'triangle': {
            const vertices = regularPolygonVertices(3, baseSize * (0.5 + rng() * 0.3));
            return { shape, vertices, boundingRadius: polygonBoundingRadius(vertices), rotation };
        }
        case 'lshape': {
            const w = baseSize * (0.5 + rng() * 0.4);
            const h = baseSize * (0.5 + rng() * 0.4);
            const notchW = w * (0.35 + rng() * 0.25);
            const notchH = h * (0.35 + rng() * 0.25);
            const vertices = [
                [-w / 2, -h / 2],
                [w / 2, -h / 2],
                [w / 2, -notchH / 2],
                [w / 2 + notchW, -notchH / 2],
                [w / 2 + notchW, notchH / 2],
                [w / 2, notchH / 2],
                [w / 2, h / 2],
                [-w / 2, h / 2]
            ];
            return { shape, vertices, boundingRadius: polygonBoundingRadius(vertices), rotation };
        }
        case 'rect':
        default: {
            const w = baseSize * (0.4 + rng() * 0.5);
            const h = baseSize * (0.4 + rng() * 0.5);
            const vertices = [
                [-w / 2, -h / 2],
                [w / 2, -h / 2],
                [w / 2, h / 2],
                [-w / 2, h / 2]
            ];
            return { shape: 'rect', vertices, boundingRadius: polygonBoundingRadius(vertices), rotation };
        }
    }
}

function drawBuildingFootprint(ctx, cx, cy, r, g, b, footprint, rng) {
    const jitter = Math.floor(rng() * 40) - 20;
    const fill = `rgb(${Math.max(0, Math.min(255, r + jitter))},${Math.max(0, Math.min(255, g + jitter))},${Math.max(0, Math.min(255, b + jitter))})`;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(footprint.rotation);
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;

    if (footprint.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, footprint.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    } else if (footprint.shape === 'oval') {
        ctx.beginPath();
        ctx.ellipse(0, 0, footprint.rx, footprint.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    } else {
        const verts = footprint.vertices;
        ctx.beginPath();
        ctx.moveTo(verts[0][0], verts[0][1]);
        for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i][0], verts[i][1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
}

// ==========================================================================
// SECTION 3: Building Placement Collision Guard
//
// This solves the primary bug reported against the original file: buildings
// inside a settlement were placed purely from a random offset formula and
// drawn immediately, with no check against buildings already placed in that
// same settlement, so dense settlements routinely rendered piles of
// overlapping rectangles. BuildingOccupancyGrid is a small spatial hash,
// scoped to a single settlement and rebuilt from scratch for every
// settlement (it must NOT persist across settlements, since buildings in
// different settlements are expected to be far apart and checking against
// unrelated buildings would only waste time). The cell size is derived from
// the settlement's expected average building size so that a candidate
// building only ever needs to inspect its own cell and the immediate ring
// of neighboring cells - checking every previously placed building directly
// would be O(n^2) per settlement, which becomes a real cost once a large
// city places hundreds of buildings. hasCollision takes the candidate
// building's true bounding radius (from Section 2's footprint objects) plus
// a small safety margin, so non-rectangular shapes are checked exactly as
// strictly as rectangles are.
// ==========================================================================

class BuildingOccupancyGrid {
    constructor(cellSize) {
        this.cellSize = Math.max(1, cellSize);
        this.buckets = new Map();
    }

    _key(cx, cy) {
        return `${cx},${cy}`;
    }

    _cellOf(x, y) {
        return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
    }

    hasCollision(x, y, radius, margin = 0) {
        const [cx, cy] = this._cellOf(x, y);
        const range = Math.max(1, Math.ceil((radius + margin) / this.cellSize));
        for (let gx = cx - range; gx <= cx + range; gx++) {
            for (let gy = cy - range; gy <= cy + range; gy++) {
                const bucket = this.buckets.get(this._key(gx, gy));
                if (!bucket) continue;
                for (const existing of bucket) {
                    const dx = existing.x - x, dy = existing.y - y;
                    const minDist = existing.radius + radius + margin;
                    if (dx * dx + dy * dy < minDist * minDist) return true;
                }
            }
        }
        return false;
    }

    commit(x, y, radius) {
        const [cx, cy] = this._cellOf(x, y);
        const key = this._key(cx, cy);
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push({ x, y, radius });
    }
}

// ==========================================================================
// SECTION 4: Settlement Generation
//
// Scans the heightmap/terrain grid and probabilistically drops settlements
// (ordinary population clusters, and fortified "keep" markers on hills),
// rejecting any candidate that falls too close to an existing settlement
// via a coarse spatial hash keyed on `minDist`. This is the same algorithm
// as the original file; the only behavioral addition for cluster
// settlements is that each one still carries its `layout` and size data
// through unchanged, which Section 6 (rendering) uses together with
// Section 2's population thresholds to decide building-shape variety -
// generation itself does not need to know anything about shapes, it only
// needs to keep producing an honest `size` (population) field, which it
// already did.
//
// Keep settlements ('type: keep') get one new field here: `rank`, an
// integer from 1 to 3 rolled from the same deterministic `rng` used for
// everything else in this function. The original file gave every keep a
// fixed `size: 1` with no other way to distinguish a minor watchtower from
// a major stronghold, so every keep rendered visually identical. `rank` is
// additive - it does not replace or repurpose `size`, so any existing code
// that reads a keep's `size` (there is none in this file, but the field is
// left untouched for safety) keeps working exactly as before. Section 8's
// `_drawKeep` reads `rank` to scale the keep's body, tower count, and flag
// height, giving fortresses visual weight proportional to their rolled
// importance instead of every keep looking the same.
// ==========================================================================

const CITY_LAYOUTS = ['circular', 'organic', 'linear', 'triangular', 'grid', 'ridge', 'semi'];
const WALL_SHAPES = ['circular', 'polygonal', 'star'];

function getCoastalDirection(x, y, heightmap, seaLevel, sampleRadius = 6) {
    const height = heightmap.length;
    const width = heightmap[0].length;
    let sumX = 0, sumY = 0, count = 0;

    for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
        for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (heightmap[ny][nx] <= seaLevel) {
                sumX += dx;
                sumY += dy;
                count++;
            }
        }
    }

    if (count === 0) return null;

    const len = Math.hypot(sumX, sumY) || 1;
    const towardWater = { x: sumX / len, y: sumY / len };
    return Math.atan2(-towardWater.x, towardWater.y);
}

function pickLayout(h, t, isCoast, population, rng) {
    if (t === 'hills') {
        return population > 80 ? 'ridge' : (rng() < 0.5 ? 'triangular' : 'ridge');
    }
    if (isCoast) {
        if (population > 120) return rng() < 0.6 ? 'semi' : 'linear';
        return rng() < 0.5 ? 'semi' : 'linear';
    }
    if (population > 150) {
        const r = rng();
        return r < 0.4 ? 'grid' : (r < 0.7 ? 'circular' : 'organic');
    }
    if (population > 60) {
        const r = rng();
        return r < 0.3 ? 'grid' : (r < 0.6 ? 'circular' : 'organic');
    }
    const r = rng();
    return r < 0.35 ? 'organic' : (r < 0.7 ? 'triangular' : 'circular');
}

function pickWallShape(rng, population) {
    if (population > 200) return rng() < 0.5 ? 'star' : 'polygonal';
    if (population > 120) {
        const r = rng();
        if (r < 0.4) return 'polygonal';
        if (r < 0.75) return 'circular';
        return 'star';
    }
    return rng() < 0.6 ? 'circular' : 'polygonal';
}

export function generateSettlements(heightmap, terrainGrid, settings = {}) {
    const {
        settlementDensity = 0.0012,
        castleDensity = 0.00015,
        forestDensityFactor = 0.3,
        minDist = 25,
        seed = 12345,
        seaLevel = 0,
        cityPalette = {
            large: ['#EBEBEB'],
            medium: ['#D2B48C'],
            small: ['#A0522D'],
            keeps: [{ primary: '#4A4A4A', secondary: '#2B2B2B' }]
        }
    } = settings;

    const width = heightmap[0].length;
    const height = heightmap.length;
    const rng = mulberry32(seed);
    const settlements = [];

    const spatialGrid = new Map();
    const cellSize = minDist * 2;
    const gridKey = (cx, cy) => `${cx},${cy}`;
    const cellOf = (x, y) => [Math.floor(x / cellSize), Math.floor(y / cellSize)];

    function isTooClose(x, y, dist) {
        const [cx, cy] = cellOf(x, y);
        const d2 = dist * dist;
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
            for (let gy = cy - 1; gy <= cy + 1; gy++) {
                const bucket = spatialGrid.get(gridKey(gx, gy));
                if (!bucket) continue;
                for (const s of bucket) {
                    const dx = s.x - x, dy = s.y - y;
                    if (dx * dx + dy * dy < d2) return true;
                }
            }
        }
        return false;
    }

    function addSettlement(s) {
        settlements.push(s);
        const [cx, cy] = cellOf(s.x, s.y);
        const k = gridKey(cx, cy);
        if (!spatialGrid.has(k)) spatialGrid.set(k, []);
        spatialGrid.get(k).push(s);
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const h = heightmap[y][x];
            const t = terrainGrid[y][x];
            const roll = rng();

            if (h <= seaLevel || h > 0.75) continue;

            if (t === 'hills' && roll < castleDensity) {
                if (!isTooClose(x, y, minDist * 3)) {
                    const keepPalette = pickKeepPalette(rng, cityPalette);
                    const rank = 1 + Math.floor(rng() * 3);
                    addSettlement({
                        x, y, type: 'keep',
                        color: keepPalette.primary,
                        secondaryColor: keepPalette.secondary,
                        size: 1, isFortified: true,
                        layout: 'circular',
                        rank
                    });
                }
            } else {
                const density = t === 'forest' ? settlementDensity * forestDensityFactor : settlementDensity;
                if (roll < density) {
                    const isCoast = h < 0.15 && (t === 'plains' || t === 'desert');
                    const isNearWater = h < 0.22 && (t === 'plains' || t === 'forest');
                    const dLimit = isCoast ? minDist * 1.8 : (isNearWater ? minDist * 1.3 : minDist);

                    if (!isTooClose(x, y, dLimit)) {
                        let population;
                        const sizeRoll = rng();

                        if (isCoast && sizeRoll < 0.15) {
                            population = Math.floor(rng() * 100) + 150;
                        } else if (sizeRoll < 0.4) {
                            population = Math.floor(rng() * 50) + 40;
                        } else {
                            population = Math.floor(rng() * 25) + 8;
                        }

                        const isFortified = population > 190 || (population > 120 && rng() > 0.85);
                        const layout = pickLayout(h, t, isCoast || isNearWater, population, rng);
                        const wallShape = isFortified ? pickWallShape(rng, population) : null;
                        const coastAngle = (isCoast || isNearWater)
                            ? getCoastalDirection(x, y, heightmap, seaLevel)
                            : null;

                        const baseColor = population > 150
                            ? pickColor(rng, cityPalette.large)
                            : (population > 60 ? pickColor(rng, cityPalette.medium) : pickColor(rng, cityPalette.small));

                        addSettlement({
                            x, y, type: 'cluster',
                            size: population,
                            isFortified,
                            wallShape,
                            coastAngle,
                            color: baseColor,
                            secondaryColor: '#333333',
                            layout
                        });
                    }
                }
            }
        }
    }

    return settlements;
}

// ==========================================================================
// SECTION 5: Pathfinding (A*)
//
// Standard grid A* over the heightmap, with movement cost inflated by
// elevation and terrain type (forest/mountain multipliers, a fixed bridge
// cost for shallow water, and impassable deep water). The result path is
// simplified by smoothPath before being returned, which is what keeps
// rendered roads from being pixel-staircase jagged. The one intentional
// addition here versus the original is that the returned path array now
// also carries a `cost` property (the accumulated A* g-score of the goal
// node) attached directly to the array object; this does not change how
// existing callers consume the path (they still get a plain array of
// {x,y} points indexable exactly as before), but it gives any caller that
// wants it - such as a future road-classification step in
// terrainManager.js - a ready-made distance/effort figure without having
// to re-walk the path and recompute it.
// ==========================================================================

function heuristic(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function getMovementCost(x, y, heightmap, terrainGrid, options) {
    const { deepWaterLevel = -0.3, bridgeCost = 10, forestCost = 2.5, mountainCost = 5 } = options;
    const h = heightmap[y][x];
    const t = terrainGrid?.[y]?.[x];

    if (h < deepWaterLevel) return Infinity;
    if (h < 0) return bridgeCost;

    let cost = 1 + (h * 8);
    if (t === 'forest') cost *= forestCost;
    if (t === 'mountain') cost *= mountainCost;

    return cost;
}

export function findRoadPath(start, end, heightmap, terrainGrid, options = {}) {
    const {
        deepWaterLevel = -0.3,
        bridgeCost = 10,
        maxSteps = 20000,
        allowDiagonal = true,
        forestCost = 2.5,
        mountainCost = 5
    } = options;

    const h = heightmap.length;
    const w = heightmap[0].length;
    const key = (x, y) => y * w + x;

    const open = new MinHeap();
    const closed = new Set();
    const gScore = new Map();

    const startNode = {
        x: start.x, y: start.y,
        g: 0,
        f: heuristic(start, end),
        parent: null
    };

    open.push(startNode);
    gScore.set(key(start.x, start.y), 0);

    let steps = 0;
    const neighbors = allowDiagonal
        ? [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]
        : [[0,1],[1,0],[0,-1],[-1,0]];

    while (open.size > 0 && steps++ < maxSteps) {
        const current = open.pop();
        const ck = key(current.x, current.y);

        if (closed.has(ck)) continue;

        if (distSq(current, end) < 2.25) {
            const path = [];
            let n = current;
            while (n) {
                path.unshift({ x: n.x, y: n.y });
                n = n.parent;
            }
            const smoothed = smoothPath(path);
            smoothed.cost = current.g;
            return smoothed;
        }

        closed.add(ck);

        for (const [dx, dy] of neighbors) {
            const nx = current.x + dx;
            const ny = current.y + dy;

            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

            const nk = key(nx, ny);
            if (closed.has(nk)) continue;

            const moveCost = getMovementCost(nx, ny, heightmap, terrainGrid, { deepWaterLevel, bridgeCost, forestCost, mountainCost });
            if (!isFinite(moveCost)) continue;

            const dist = allowDiagonal && dx !== 0 && dy !== 0 ? 1.414 : 1;
            const g = current.g + moveCost * dist;

            const existingG = gScore.get(nk);
            if (existingG !== undefined && g >= existingG) continue;

            gScore.set(nk, g);
            open.push({
                x: nx, y: ny,
                g: g,
                f: g + heuristic({ x: nx, y: ny }, end),
                parent: current
            });
        }
    }

    return [];
}

function smoothPath(path) {
    if (path.length < 3) return path;

    const smoothed = [path[0]];
    let i = 0;

    while (i < path.length - 1) {
        let furthest = i + 1;
        for (let j = Math.min(i + 4, path.length - 1); j > i; j--) {
            if (Math.abs(path[i].x - path[j].x) <= 2 || Math.abs(path[i].y - path[j].y) <= 2) {
                furthest = j;
                break;
            }
        }
        smoothed.push(path[furthest]);
        i = furthest;
    }

    return smoothed;
}

// ==========================================================================
// SECTION 6: Road Network Planning
//
// Builds the settlement-to-settlement road graph: every settlement connects
// to its `neighborsPerSettlement` nearest neighbors (one extra for large
// settlements), then a minimum-spanning-tree pass over ALL pairs guarantees
// the whole network stays connected even if the nearest-neighbor step left
// isolated clusters, and finally the edge count is capped at
// `maxTotalRoads` while always keeping the MST-required edges. This logic
// itself was already correct and is unchanged. The addition here is purely
// informational: each returned edge is still the same `[settlementA,
// settlementB]` pair shape existing callers rely on (so indexing edge[0]/
// edge[1] keeps working unmodified), but now also carries `distance`,
// `importance` (the larger of the two settlements' population, which
// Section 8's road renderer uses to make major roads visibly thicker than
// minor ones), and a simple `roadType` classification ('main' vs
// 'secondary'). Attaching these as extra properties on the pair array
// rather than changing its shape is what keeps this a non-breaking change
// for any code - including terrainManager.js - that only ever destructured
// the two endpoints.
// ==========================================================================

export function buildRoadNetwork(settlements, options = {}) {
    const {
        neighborsPerSettlement = 2,
        maxDistance = Infinity,
        maxTotalRoads = Infinity
    } = options;

    const n = settlements.length;
    if (n < 2) return [];

    const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
    const distanceBetween = (a, b) => Math.sqrt(distSq(settlements[a], settlements[b]));

    const candidateEdges = new Map();
    for (let i = 0; i < n; i++) {
        const ranked = [];
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const dist = distanceBetween(i, j);
            if (dist <= maxDistance) ranked.push({ j, dist });
        }
        ranked.sort((p, q) => p.dist - q.dist);

        const count = settlements[i].size > 120 ? neighborsPerSettlement + 1 : neighborsPerSettlement;
        for (let k = 0; k < Math.min(count, ranked.length); k++) {
            const { j, dist } = ranked[k];
            candidateEdges.set(edgeKey(i, j), { a: i, b: j, dist });
        }
    }

    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (x, y) => {
        const rx = find(x), ry = find(y);
        if (rx !== ry) parent[rx] = ry;
    };

    for (const edge of candidateEdges.values()) union(edge.a, edge.b);

    const allPairs = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            allPairs.push({ a: i, b: j, dist: distanceBetween(i, j) });
        }
    }
    allPairs.sort((p, q) => p.dist - q.dist);

    const requiredEdges = new Map();
    for (const edge of allPairs) {
        if (find(edge.a) !== find(edge.b)) {
            union(edge.a, edge.b);
            requiredEdges.set(edgeKey(edge.a, edge.b), edge);
        }
    }

    const merged = new Map(candidateEdges);
    for (const [key, edge] of requiredEdges) merged.set(key, edge);
    let edges = [...merged.values()];

    if (edges.length > maxTotalRoads) {
        const required = edges.filter(e => requiredEdges.has(edgeKey(e.a, e.b)));
        const optional = edges
            .filter(e => !requiredEdges.has(edgeKey(e.a, e.b)))
            .sort((p, q) => p.dist - q.dist);
        edges = [...required, ...optional].slice(0, Math.max(maxTotalRoads, required.length));
    }

    return edges.map(edge => {
        const a = settlements[edge.a];
        const b = settlements[edge.b];
        const pair = [a, b];
        const importance = Math.max(a.size, b.size);
        pair.distance = edge.dist;
        pair.importance = importance;
        pair.roadType = importance > BUILDING_SHAPE_LARGE_THRESHOLD ? 'main' : 'secondary';
        return pair;
    });
}

// ==========================================================================
// SECTION 7: Fortification Wall Shape Helpers
//
// Wall silhouettes are expressed as a radial profile: a fixed number of
// angular samples, each giving the wall's distance from the settlement
// center at that angle. wallShapeMultiplier deforms the base radius per
// shape (a smooth per-side bulge for 'polygonal', a repeating cosine ripple
// for 'star', a flat multiplier of 1 for 'circular'), and sampleWallProfile
// interpolates between the two nearest angular samples so any arbitrary
// angle can be queried, not just the discrete sampled ones. Both functions
// are pure geometry and remain exactly as they were before this pass.
//
// What changed around this profile is downstream in Section 8, not here:
// the original file only ever used this radial profile for two things -
// clamping where buildings are allowed to spawn (`sampleWallProfile(...) *
// margin`) and drawing the wall stroke itself - which left the ring of
// space between the last legal building position and the actual wall line
// rendered as plain, undifferentiated ground. That empty ring had no
// visual identity of its own. Section 8's new `_drawWallBuffer` method
// fills exactly that ring (from `margin * profile` out to just inside
// `profile`) with a distinct tone representing an inner bailey road/plaza,
// reusing this same profile data rather than introducing a second shape
// system - so any wall shape or water-carved indentation already computed
// here is automatically reflected in the buffer ring too, with no
// duplicated geometry logic.
// ==========================================================================

function wallShapeMultiplier(shape, angle) {
    switch (shape) {
        case 'polygonal': {
            const sides = 5;
            const sector = (Math.PI * 2) / sides;
            const theta = (((angle % sector) + sector) % sector) - sector / 2;
            return 1 / Math.cos(theta);
        }
        case 'star': {
            const points = 6;
            return 1 + 0.22 * Math.cos(angle * points);
        }
        case 'circular':
        default:
            return 1;
    }
}

function sampleWallProfile(profile, angle) {
    const n = profile.length;
    const norm = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const f = (norm / (Math.PI * 2)) * n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const t = f - Math.floor(f);
    return profile[i0] * (1 - t) + profile[i1] * t;
}

// ==========================================================================
// SECTION 8: Human Painter Rendering
//
// HumanPainter owns the actual Canvas output: settlement keeps, cluster
// buildings, fortification walls, and roads, composited onto one offscreen
// layer canvas returned by getLayer(). Its public method surface
// (constructor, setSize, setCanvasSize, setHumanElements, getLayer) keeps
// the same method names as the original file. The one public-facing change
// is that `setHumanElements` now accepts a fifth, optional argument,
// `terrainGrid = null` - existing callers that only ever passed the first
// four arguments are completely unaffected, since the parameter defaults to
// null and every internal check that uses it treats a missing terrainGrid
// exactly like the original file always behaved (heightmap-only water
// detection). Internally, this class now differs from the original in
// four ways:
//   1. _drawCluster runs every candidate building through a per-settlement
//      BuildingOccupancyGrid (Section 3) before drawing it, using the shape
//      chosen by Section 2 to get an accurate bounding radius, and simply
//      stops early (without forcing extra buildings in) if it runs out of
//      placement attempts - a settlement with fewer, non-overlapping
//      buildings reads better than one with the "right" count crammed on
//      top of itself. Building drawing itself is routed through Section
//      2's shape/footprint system instead of always drawing a rectangle.
//   2. Road rendering draws each road as two stacked strokes (a wider,
//      darker base layer establishing an edge, and a narrower, lighter top
//      layer as the road surface, with a very light dash pattern on the top
//      layer for texture) instead of one flat translucent line, and scales
//      both stroke widths by the road's importance (Section 6's data when
//      present, otherwise estimated from the nearest settlements to the
//      road's two endpoints) so roads connecting larger settlements read as
//      more significant than paths between two small hamlets.
//   3. _isWater, the single source of truth every other method in this
//      class calls to decide "is this canvas point water", now also
//      accepts the settlement's terrainGrid and treats any 'river' cell as
//      water alongside the pre-existing heightmap/seaLevel check. Because
//      _buildWallProfile, _drawCluster, and the per-settlement skip check
//      in setHumanElements all route through this one method rather than
//      duplicating the height comparison themselves, fixing it here is
//      enough to stop walls, buildings, and settlement placement from ever
//      being drawn on top of a river - no other method needed its own
//      separate river check.
//   4. _drawKeep now takes the settlement's `rng` and `rank` (Section 4)
//      and varies the keep's body silhouette (square / elongated /
//      two-tier stepped), tower count (3-6, positioned around the body's
//      actual perimeter instead of fixed corners), individual tower sizes
//      (one enlarged "main" tower among smaller ones), and banner height,
//      so keeps of different rank are visually distinguishable instead of
//      all rendering as one fixed template. A new _drawWallBuffer method
//      fills the previously-blank ring between a settlement's building
//      boundary and its actual wall line with a distinct inner-bailey tone,
//      giving that space a deliberate visual identity instead of leaving it
//      as unmarked ground.
// ==========================================================================

export class HumanPainter {
    constructor(canvasWidth, canvasHeight, options = {}) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.mapWidth = 1;
        this.mapHeight = 1;
        this.humanLayer = null;
        this.options = {
            roadColor: 'rgba(90, 80, 70, 0.35)',
            roadWidthBase: 2.2,
            roadTexture: true,
            shadowColor: 'rgba(0, 0, 0, 0.2)',
            enableShadows: true,
            lodThreshold: 0.4,
            seaLevel: -0.1,
            buildingMargin: 0.72,
            referenceCellSize: 2.2,
            buildingShapeThresholds: {
                small: BUILDING_SHAPE_SMALL_THRESHOLD,
                large: BUILDING_SHAPE_LARGE_THRESHOLD
            },
            ...options
        };
    }

    setSize(width, height) {
        this.mapWidth = width;
        this.mapHeight = height;
    }

    setCanvasSize(width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;
    }

    _isWater(px, py, cellW, cellH, heightmap, seaLevel, terrainGrid = null) {
        if (!heightmap) return false;
        const gx = Math.floor(px / cellW);
        const gy = Math.floor(py / cellH);
        if (gy < 0 || gy >= heightmap.length || gx < 0 || gx >= heightmap[0].length) return true;
        if (heightmap[gy][gx] <= seaLevel) return true;
        return !!(terrainGrid && terrainGrid[gy] && terrainGrid[gy][gx] === 'river');
    }

    _buildWallProfile(px, py, desiredR, cellW, cellH, heightmap, seaLevel, shape, terrainGrid = null, segments = 32) {
        const profile = new Array(segments);
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            profile[i] = desiredR * wallShapeMultiplier(shape, angle);
        }

        if (!heightmap || desiredR <= 0) return profile;

        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const maxR = profile[i];
            let r = maxR;
            for (let step = maxR; step > maxR * 0.15; step -= maxR * 0.05) {
                const wx = px + Math.cos(angle) * step;
                const wy = py + Math.sin(angle) * step;
                if (this._isWater(wx, wy, cellW, cellH, heightmap, seaLevel, terrainGrid)) {
                    r = step * 0.9;
                } else {
                    break;
                }
            }
            profile[i] = Math.max(r, maxR * 0.35);
        }

        return profile;
    }

    _drawWallBuffer(ctx, px, py, profile, margin, fort) {
        const n = profile.length;
        const bufferColor = fort.bufferColor || 'rgba(150, 138, 112, 0.4)';

        ctx.save();
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const idx = i % n;
            const angle = (idx / n) * Math.PI * 2;
            const r = profile[idx] * 0.97;
            const x = px + Math.cos(angle) * r;
            const y = py + Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();

        for (let i = 0; i <= n; i++) {
            const idx = i % n;
            const angle = (idx / n) * Math.PI * 2;
            const r = profile[idx] * margin;
            const x = px + Math.cos(angle) * r;
            const y = py + Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();

        ctx.fillStyle = bufferColor;
        ctx.fill('evenodd');
        ctx.restore();
    }

    _drawFortification(ctx, px, py, profile, fort) {
        ctx.save();
        if (this.options.enableShadows) {
            ctx.shadowColor = this.options.shadowColor;
            ctx.shadowBlur = 4;
            ctx.shadowOffsetY = 2;
        }
        ctx.strokeStyle = fort.wallColor || "#555555";
        ctx.lineWidth = fort.wallLineWidth || 2.5;
        ctx.setLineDash(fort.wallDashPattern || [5, 3]);

        const n = profile.length;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const idx = i % n;
            const angle = (idx / n) * Math.PI * 2;
            const r = profile[idx];
            const x = px + Math.cos(angle) * r;
            const y = py + Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = fort.towerColor || "#666666";
        const towers = fort.towerCount || 4;
        for (let i = 0; i < towers; i++) {
            const idx = Math.floor((i / towers) * n);
            const angle = (idx / n) * Math.PI * 2;
            const r = profile[idx];
            const tx = px + Math.cos(angle) * r;
            const ty = py + Math.sin(angle) * r;
            ctx.beginPath();
            ctx.arc(tx, ty, r * (fort.towerSizeRatio || 0.15), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    _drawKeep(ctx, px, py, size, color, secondaryColor, rng, rank = 1) {
        const rankScale = 0.85 + rank * 0.15;
        const bodyRoll = rng();

        let baseW, baseH, hasTier, tierW, tierH, tierOffsetY;
        if (bodyRoll < 0.5) {
            baseW = size * rankScale;
            baseH = size * rankScale;
            hasTier = false;
        } else if (bodyRoll < 0.8) {
            const stretch = 1.3 + rng() * 0.5;
            const stretchX = rng() < 0.5;
            baseW = size * rankScale * (stretchX ? stretch : 1);
            baseH = size * rankScale * (stretchX ? 1 : stretch);
            hasTier = false;
        } else {
            baseW = size * rankScale * 1.15;
            baseH = size * rankScale * 1.15;
            tierW = baseW * 0.55;
            tierH = baseH * 0.55;
            tierOffsetY = -(baseH / 2 + tierH * 0.4);
            hasTier = true;
        }

        ctx.save();
        if (this.options.enableShadows) {
            ctx.shadowColor = this.options.shadowColor;
            ctx.shadowBlur = 6;
            ctx.shadowOffsetY = 3;
        }
        ctx.fillStyle = color;
        ctx.strokeStyle = secondaryColor;
        ctx.lineWidth = 1.2;
        ctx.fillRect(px - baseW / 2, py - baseH / 2, baseW, baseH);
        ctx.strokeRect(px - baseW / 2, py - baseH / 2, baseW, baseH);

        if (hasTier) {
            ctx.fillRect(px - tierW / 2, py + tierOffsetY - tierH / 2, tierW, tierH);
            ctx.strokeRect(px - tierW / 2, py + tierOffsetY - tierH / 2, tierW, tierH);
        }

        const towerCount = 3 + Math.floor(rng() * 4);
        const mainTowerIndex = Math.floor(rng() * towerCount);
        const perimeterW = hasTier ? baseW : baseW;
        const perimeterH = hasTier ? baseH : baseH;
        let mainTX = px, mainTY = py - baseH / 2, mainTowerSize = size * 0.5;

        for (let i = 0; i < towerCount; i++) {
            const angle = (i / towerCount) * Math.PI * 2 + rng() * 0.25;
            const rx = (perimeterW / 2) * (1 + rng() * 0.12);
            const ry = (perimeterH / 2) * (1 + rng() * 0.12);
            const tx = px + Math.cos(angle) * rx;
            const ty = py + Math.sin(angle) * ry;
            const isMain = i === mainTowerIndex;
            const towerSize = size * 0.6 * (isMain ? 1.3 + rng() * 0.3 : 0.7 + rng() * 0.4);

            ctx.fillRect(tx - towerSize / 2, ty - towerSize / 2, towerSize, towerSize);
            ctx.strokeRect(tx - towerSize / 2, ty - towerSize / 2, towerSize, towerSize);

            if (isMain) {
                mainTX = tx;
                mainTY = ty;
                mainTowerSize = towerSize;
            }
        }

        ctx.shadowBlur = 0;
        const poleTop = mainTY - mainTowerSize / 2;
        const poleHeight = size * (1.4 + rank * 0.3);
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mainTX, poleTop);
        ctx.lineTo(mainTX, poleTop - poleHeight);
        ctx.stroke();
        ctx.fillStyle = '#DC143C';
        ctx.beginPath();
        ctx.moveTo(mainTX, poleTop - poleHeight);
        ctx.lineTo(mainTX + size * 0.7, poleTop - poleHeight * 0.8);
        ctx.lineTo(mainTX, poleTop - poleHeight * 0.6);
        ctx.fill();
        ctx.restore();
    }

    _drawCluster(ctx, px, py, population, bSize, baseColor, wallProfile, heightmap, cellW, cellH, seaLevel, rng, layout, coastAngle, terrainGrid = null) {
        const [r, g, b] = hexToRgb(baseColor);
        const margin = this.options.buildingMargin;
        const avgR = wallProfile
            ? wallProfile.reduce((sum, v) => sum + v, 0) / wallProfile.length
            : null;
        const innerR = avgR ? avgR * margin : null;
        const spreadBase = bSize * (1 + population / 40);
        let drawn = 0, attempts = 0;
        const maxAttempts = population * 4;

        const occupancy = new BuildingOccupancyGrid(Math.max(bSize * 3, 6));
        const safetyMargin = bSize * 0.15;
        const shapeThresholds = this.options.buildingShapeThresholds;
        const rareLimits = computeRareShapeLimits(population);
        const rareUsed = { hexagon: 0, pentagon: 0, triangle: 0 };

        while (drawn < population && attempts < maxAttempts) {
            attempts++;
            let bx, by;

            switch (layout) {
                case 'circular': {
                    const ang = rng() * Math.PI * 2;
                    const dist = innerR
                        ? Math.pow(rng(), 0.7) * innerR
                        : Math.pow(rng(), 0.5) * spreadBase;
                    bx = px + Math.cos(ang) * dist;
                    by = py + Math.sin(ang) * dist;
                    break;
                }
                case 'linear': {
                    const len = (innerR || spreadBase) * 1.6;
                    const angle = coastAngle ?? 0;
                    const lx = (rng() * 2 - 1) * len;
                    const ly = (rng() * 2 - 1) * bSize * 0.5;
                    bx = px + lx * Math.cos(angle) - ly * Math.sin(angle);
                    by = py + lx * Math.sin(angle) + ly * Math.cos(angle);
                    break;
                }
                case 'triangular': {
                    const u = rng();
                    const v = rng();
                    const tx = (1 - Math.sqrt(u)) * (innerR || spreadBase) * 1.8;
                    const ty = (v * Math.sqrt(u) - 0.5) * (innerR || spreadBase) * 1.3;
                    bx = px + tx;
                    by = py + ty;
                    break;
                }
                case 'grid': {
                    const cols = Math.ceil(Math.sqrt(population));
                    const idx = drawn;
                    const gx = (idx % cols) - cols / 2;
                    const gy = Math.floor(idx / cols) - cols / 2;
                    bx = px + gx * bSize * 1.2 + (rng() - 0.5) * bSize * 0.4;
                    by = py + gy * bSize * 1.2 + (rng() - 0.5) * bSize * 0.4;
                    break;
                }
                case 'ridge': {
                    const t = rng() * 2 - 1;
                    const ridgeW = bSize * 0.4;
                    bx = px + t * (innerR || spreadBase) * 1.2 + (rng() - 0.5) * ridgeW;
                    by = py + Math.sin(t * Math.PI) * (innerR || spreadBase) * 0.2 + (rng() - 0.5) * ridgeW;
                    break;
                }
                case 'semi': {
                    const baseAngle = coastAngle ?? 0;
                    const ang = baseAngle + rng() * Math.PI;
                    const dist = Math.pow(rng(), 0.7) * (innerR || spreadBase);
                    bx = px + Math.cos(ang) * dist;
                    by = py + Math.sin(ang) * dist;
                    break;
                }
                case 'organic':
                default: {
                    const branches = 3 + Math.floor(rng() * 3);
                    const branchIdx = drawn % branches;
                    const branchAng = (branchIdx / branches) * Math.PI * 2 + (rng() * 0.5);
                    const dist = Math.pow(rng(), 0.5) * (innerR || spreadBase);
                    bx = px + Math.cos(branchAng) * dist + (rng() * bSize * 2 - bSize);
                    by = py + Math.sin(branchAng) * dist + (rng() * bSize * 2 - bSize);
                    break;
                }
            }

            if (this._isWater(bx, by, cellW, cellH, heightmap, seaLevel, terrainGrid)) continue;
            if (wallProfile) {
                const dx = bx - px, dy = by - py;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);
                const limit = sampleWallProfile(wallProfile, angle) * margin;
                if (dist > limit) continue;
            }

            const shape = chooseBuildingShape(rng, population, shapeThresholds, rareUsed, rareLimits);
            const footprint = createBuildingFootprint(shape, bSize, rng);

            if (occupancy.hasCollision(bx, by, footprint.boundingRadius, safetyMargin)) continue;

            drawBuildingFootprint(ctx, bx, by, r, g, b, footprint, rng);
            occupancy.commit(bx, by, footprint.boundingRadius);

            if (shape === 'hexagon' || shape === 'pentagon' || shape === 'triangle') {
                rareUsed[shape]++;
            }

            drawn++;
        }
    }

    _findNearestSettlement(point, settlements) {
        let nearest = null;
        let nearestD2 = Infinity;
        for (const s of settlements) {
            const dx = s.x - point.x, dy = s.y - point.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestD2) {
                nearestD2 = d2;
                nearest = s;
            }
        }
        return nearest;
    }

    _estimateRoadImportance(road, settlements) {
        if (typeof road.importance === 'number') return road.importance;

        const start = road[0];
        const end = road[road.length - 1];
        const startSettlement = this._findNearestSettlement(start, settlements);
        const endSettlement = this._findNearestSettlement(end, settlements);
        const sizes = [startSettlement?.size, endSettlement?.size].filter(v => typeof v === 'number');

        if (!sizes.length) return 0.5 * BUILDING_SHAPE_SMALL_THRESHOLD;
        return Math.max(...sizes);
    }

    _lightenRoadColor(rgbaColor, amount) {
        const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(rgbaColor);
        if (!match) return rgbaColor;

        const clamp255 = (v) => Math.max(0, Math.min(255, v));
        const r = clamp255(parseFloat(match[1]) + amount);
        const g = clamp255(parseFloat(match[2]) + amount);
        const b = clamp255(parseFloat(match[3]) + amount);
        const a = match[4] !== undefined ? Math.min(1, parseFloat(match[4]) + 0.12) : 1;

        return `rgba(${r},${g},${b},${a})`;
    }

    _drawRoad(ctx, road, cellW, cellH, viewScale, importance) {
        const widthScale = Math.max(0.6, Math.min(2.4, 0.65 + importance / 180));
        const baseWidth = this.options.roadWidthBase * viewScale * widthScale;
        const topWidth = baseWidth * 0.55;
        const baseColor = this.options.roadColor;
        const topColor = this._lightenRoadColor(baseColor, 22);

        const buildPath = () => {
            ctx.beginPath();
            ctx.moveTo(road[0].x * cellW + cellW / 2, road[0].y * cellH + cellH / 2);
            for (let i = 1; i < road.length - 1; i++) {
                const xc = (road[i].x + road[i + 1].x) / 2 * cellW + cellW / 2;
                const yc = (road[i].y + road[i + 1].y) / 2 * cellH + cellH / 2;
                ctx.quadraticCurveTo(road[i].x * cellW + cellW / 2, road[i].y * cellH + cellH / 2, xc, yc);
            }
            const last = road[road.length - 1];
            ctx.lineTo(last.x * cellW + cellW / 2, last.y * cellH + cellH / 2);
        };

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (this.options.enableShadows) {
            ctx.shadowColor = 'rgba(0,0,0,0.12)';
            ctx.shadowBlur = 2;
            ctx.shadowOffsetY = 1;
        }
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = baseWidth;
        buildPath();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = topColor;
        ctx.lineWidth = topWidth;
        if (this.options.roadTexture) {
            const dash = Math.max(2, baseWidth * 1.4);
            ctx.setLineDash([dash, dash * 0.35]);
        }
        buildPath();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore();
    }

    setHumanElements(settlements, roads, heightmap = null, rng = null, terrainGrid = null) {
        if (!rng) rng = () => Math.random();

        const layer = document.createElement("canvas");
        layer.width = this.canvasWidth;
        layer.height = this.canvasHeight;
        const ctx = layer.getContext("2d");

        const cellW = layer.width / this.mapWidth;
        const cellH = layer.height / this.mapHeight;
        const viewScale = Math.min(layer.width, layer.height) / 1000;
        const cellScale = Math.max(0.15, Math.min(1, Math.min(cellW, cellH) / this.options.referenceCellSize));
        const bSize = 6.5 * viewScale * cellScale;
        const seaLevel = this.options.seaLevel;
        const fort = this.options.fortification || {};

        const sortedSettlements = [...settlements].sort((a, b) => a.size - b.size);

        for (const road of roads) {
            if (road.length < 2) continue;
            const importance = this._estimateRoadImportance(road, settlements);
            this._drawRoad(ctx, road, cellW, cellH, viewScale, importance);
        }

        for (const s of sortedSettlements) {
            if (this._isWater(
                s.x * cellW + cellW / 2, s.y * cellH + cellH / 2,
                cellW, cellH, heightmap, seaLevel, terrainGrid
            )) continue;

            const px = s.x * cellW + cellW / 2;
            const py = s.y * cellH + cellH / 2;

            if (s.type === 'keep') {
                this._drawKeep(ctx, px, py, bSize * 1.5, s.color, s.secondaryColor, rng, s.rank || 1);
                continue;
            }

            let wallProfile = null;
            if (s.isFortified) {
                const desiredR = bSize * ((fort.wallRadiusBase || 2.2) + s.size / (fort.wallRadiusScale || 70));
                wallProfile = this._buildWallProfile(px, py, desiredR, cellW, cellH, heightmap, seaLevel, s.wallShape || 'circular', terrainGrid);
                this._drawWallBuffer(ctx, px, py, wallProfile, this.options.buildingMargin, fort);
            }

            this._drawCluster(ctx, px, py, s.size, bSize, s.color, wallProfile, heightmap, cellW, cellH, seaLevel, rng, s.layout, s.coastAngle, terrainGrid);

            if (wallProfile) {
                this._drawFortification(ctx, px, py, wallProfile, fort);
            }
        }

        this.humanLayer = layer;
    }

    getLayer() { return this.humanLayer; }
}