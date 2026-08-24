import { generateHeightmap, generateMoistureMap, createRng, classifyTerrain } from "./generator.js";
import { generateRivers, applyRiversToTerrain, applyWaterVisuals, applyRiverVisuals } from "./water.js";
import { generateSettlements, findRoadPath, buildRoadNetwork } from "./human.js";
import { calculateSunVector, getHillshade, getElevationFactor, applyRelief } from "./elevation.js";
import { hexToRgb, colorStringToRgb } from "./colorUtils.js";

// ==========================================================================
// Shared Color Parsing Helpers
//
// Two different pieces of this file need to turn a color into raw [r, g, b]
// numbers: findNearestTerrain (matching a sampled pixel back to a terrain
// type) and TerrainPainter.setTerrain (writing raw pixel bytes instead of
// using fillRect - see the block comment above setTerrain for why). Both
// now get hexToRgb and colorStringToRgb from the shared `colorUtils.js`
// module rather than each maintaining its own copy. Earlier revisions of
// this file and human.js each carried a byte-for-byte identical local
// hexToRgb implementation (with the same caching pattern) - importing
// human.js's copy directly was rejected at the time because human.js is
// the settlements/buildings module and hexToRgb there was a private
// implementation detail of building-color jitter with no conceptual tie to
// terrain rendering, so reaching into it would have been coupling in the
// wrong direction. Extracting both functions into this neutral,
// dependency-free utility module resolves that properly: neither human.js
// nor terrainManager.js depends on the other for color math, both depend
// downward on colorUtils.js, and the duplicated logic (and the risk of the
// two copies silently drifting apart) is gone.
// ==========================================================================

// ==========================================
// 1. Terrain Registry & Configuration
// ==========================================

export let terrainRegistry = {};
export let generationSettings = {};

export async function loadTerrainData() {
    const res = await fetch(new URL('./terrain.json', import.meta.url));
    const data = await res.json();
    terrainRegistry = data.terrainTypes || {};
    generationSettings = data;
    return data;
}

export function getTerrainConfig(type) {
    return terrainRegistry[type] || terrainRegistry['plains'];
}

export function findNearestTerrain(r, g, b) {
    let bestType = 'plains';
    let bestDist = Infinity;

    for (const [type, data] of Object.entries(terrainRegistry)) {
        if (!data.color) continue;
        const [tr, tg, tb] = hexToRgb(data.color);

        const dist = Math.pow(tr - r, 2) + Math.pow(tg - g, 2) + Math.pow(tb - b, 2);
        if (dist < bestDist) {
            bestDist = dist;
            bestType = type;
        }
    }
    return { type: bestType, distance: Math.sqrt(bestDist) };
}

// ==========================================
// 2. Full Terrain Generation Pipeline
// ==========================================

export function generateFullTerrain(width, height, seed, settings = {}, customHeightmap = null, customMoisture = null) {
    const gen = generationSettings.generation || {};
    const water = generationSettings.water || {};
    const settlement = generationSettings.settlements || {};
    const thresholds = generationSettings.thresholds || {};

    const rng = createRng(seed);
    const seaLevel = settings.seaLevel ?? gen.seaLevel ?? 0;

    const elevation = customHeightmap || generateHeightmap(width, height, seed, {
        octaves: gen.octaves ?? 5,
        persistence: gen.persistence ?? 0.5,
        warpStrength: gen.warpStrength ?? 0.18,
        warpFrequency: gen.warpFrequency ?? 1.4,
        mountainFrequency: gen.mountainFrequency ?? 1.1,
        mountainBias: gen.mountainBias ?? 0.5,
        mountainBoost: gen.mountainBoost ?? 1.5
    });

    const moisture = customMoisture || generateMoistureMap(
        width, height, seed,
        gen.moistureOctaves ?? 4,
        gen.moisturePersistence ?? 0.55,
        gen.moistureFrequency ?? 2.6
    );

    const terrain = elevation.map((row, y) =>
        Array.from(row).map((h, x) => classifyTerrain(h, moisture[y][x], thresholds, seaLevel))
    );

    // ==========================================================================
    // River option wiring: generateRivers and applyRiversToTerrain (water.js)
    // gained several new tunable options in a previous pass - estuaryLevel/
    // estuarySlack (how far past sea level a river keeps tracing before it is
    // considered to have fully reached open water, and how much lateral
    // wander it gets while doing so) and tributaryMergeDistance for the
    // first, plus widthCurve/estuaryWidthBoost/tributaryWidthBoost as a
    // fifth options object for the second - but this call site was still
    // only passing the older option set, so every new behavior was silently
    // running on water.js's internal defaults with no way to tune it from
    // terrain.json the way every other river setting already can be. Both
    // calls below now read the same `water` settings object the rest of
    // this function already uses, with `??` fallbacks that reproduce
    // water.js's own defaults exactly - so a terrain.json that does not yet
    // define these keys behaves identically to before, and one that does
    // gets full control. estuaryLevel itself is derived from an offset
    // (`riverEstuaryOffset`) rather than an absolute level, because the
    // offset is meaningful relative to whatever `seaLevel` this call was
    // given, while a fixed absolute level would silently stop making sense
    // if seaLevel were ever overridden via `settings.seaLevel`. The new
    // terrain.json keys this depends on - `riverEstuaryOffset`,
    // `riverEstuarySlack`, `riverTributaryMergeDistance`, `riverWidthCurve`,
    // `riverEstuaryWidthBoost`, and `riverTributaryWidthBoost` - are not
    // present in the current terrain.json and are not added here, since
    // this pass only touches .js files; they should be added under the
    // existing `water` section alongside `riverWidth`/`riverWidthGrowth` so
    // this configurability is actually reachable from the config file.
    // ==========================================================================
    const riverEstuaryOffset = water.riverEstuaryOffset ?? 0.18;

    const rivers = generateRivers(elevation, {
        seed,
        count: settings.riverCount ?? water.riverCount,
        density: water.riverDensity,
        minCount: water.riverMinCount,
        seaLevel,
        estuaryLevel: seaLevel - riverEstuaryOffset,
        estuarySlack: water.riverEstuarySlack ?? 0.02,
        minSourceElevation: water.riverMinSourceElevation ?? 0.6,
        maxLength: water.riverMaxLength ?? 2000,
        escapeRadius: water.riverEscapeRadius,
        tributaryMergeDistance: water.riverTributaryMergeDistance ?? 3
    });

    applyRiversToTerrain(terrain, rivers, water.riverWidth ?? 1, water.riverWidthGrowth ?? 0, {
        widthCurve: water.riverWidthCurve ?? 2.2,
        estuaryWidthBoost: water.riverEstuaryWidthBoost ?? 1.6,
        tributaryWidthBoost: water.riverTributaryWidthBoost ?? 1.35
    });

    const settlements = generateSettlements(elevation, terrain, {
        seed,
        seaLevel,
        settlementDensity: settlement.settlementDensity ?? 0.0012,
        castleDensity: settlement.castleDensity ?? 0.00015,
        forestDensityFactor: settlement.forestDensityFactor ?? 0.3,
        minDist: settlement.minDist ?? 25,
        cityPalette: settlement.cityPalette
    });

    // ==========================================================================
    // Road network wiring: the settlement list can contain both walled
    // 'cluster' settlements and standalone 'keep' markers, and only the
    // former are meant to be linked by roads (a keep is an isolated
    // fortification, not a town with trade routes). The previous version of
    // this pipeline connected `settlements[i]` to `settlements[i + 1]` for a
    // fixed number of iterations - that is just "walk the array in
    // generation order", which has no relationship to actual geography and
    // regularly produced roads crossing straight past closer settlements,
    // or roads between a keep and a town despite keeps never taking wall/
    // building layout data. buildRoadNetwork (human.js) already solves this
    // correctly - nearest-neighbor candidate edges plus a minimum-spanning-
    // tree pass to guarantee full connectivity - so this now calls it on the
    // cluster settlements only, then runs findRoadPath once per returned
    // edge to get the actual walkable path, carrying the edge's `importance`
    // and `roadType` metadata onto that path so HumanPainter's road renderer
    // (which reads `road.importance` when present) draws major routes
    // between large settlements thicker than minor ones without having to
    // re-derive that from scratch.
    // ==========================================================================
    const roads = [];
    const clusterSettlements = settlements.filter(s => s.type === 'cluster');
    if (clusterSettlements.length > 1) {
        const roadOpts = {
            deepWaterLevel: settlement.roadDeepWaterLevel ?? -0.3,
            bridgeCost: settlement.roadBridgeCost ?? 10,
            maxSteps: settlement.roadMaxSteps ?? 20000,
            allowDiagonal: settlement.roadAllowDiagonal ?? true,
            forestCost: settlement.roadForestCost ?? 2.5,
            mountainCost: settlement.roadMountainCost ?? 5
        };
        const networkEdges = buildRoadNetwork(clusterSettlements, {
            neighborsPerSettlement: settlement.roadNeighborsPerSettlement ?? 2,
            maxTotalRoads: settings.roadConnections ?? settlement.roadConnections ?? 10
        });
        for (const edge of networkEdges) {
            const path = findRoadPath(edge[0], edge[1], elevation, terrain, roadOpts);
            if (path.length > 0) {
                path.importance = edge.importance;
                path.roadType = edge.roadType;
                roads.push(path);
            }
        }
    }

    return {
        elevation,
        moisture,
        terrain,
        rivers,
        settlements,
        roads
    };
}

// ==========================================
// 3. Terrain Layer Rendering
// ==========================================

export class TerrainPainter {
    constructor(canvasWidth, canvasHeight) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.terrainLayer = null;
        this.waterMask = null;
        this.elevationGrid = null;

        const elev = generationSettings.elevation || {};
        this.sunVector = calculateSunVector(
            elev.sunAzimuth ?? 315,
            elev.sunAltitude ?? 45
        );
        this.mapWidth = 1;
        this.mapHeight = 1;
    }

    setSize(width, height) {
        this.mapWidth = width;
        this.mapHeight = height;
    }

    setCanvasSize(width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;
    }

    setSun(azimuth, altitude) {
        this.sunVector = calculateSunVector(azimuth, altitude);
    }

    // ==========================================================================
    // Per-pixel rendering via ImageData instead of per-cell fillRect
    //
    // The original loop called ctx.fillStyle = <css string> followed by
    // ctx.fillRect(...) once per terrain-grid cell. Each of those is a real
    // Canvas API call - fillStyle assignment re-parses whatever string it is
    // given, and fillRect is a full rasterization operation with its own
    // internal state changes - and with river surface noise, shoreline foam,
    // and hillshade all now computing a genuinely different color for many
    // neighboring cells, this loop was doing meaningfully more work per cell
    // than it used to while still paying that same per-call Canvas overhead
    // for every one of them. The fix is to compute every cell's color once
    // into a plain RGB lookup table (identical cost to the color-computation
    // half of the old loop - nothing about *what* gets computed changed,
    // only where the result goes), then make a single pass over the actual
    // output canvas pixels, look up which grid cell each one belongs to via
    // integer division, and write raw bytes directly into a
    // Uint8ClampedArray-backed ImageData buffer. That buffer is committed to
    // the canvas with exactly one putImageData call at the end instead of
    // width*height separate fillRect calls.
    //
    // applyWaterVisuals/applyRiverVisuals/applyRelief/config.color all still
    // return CSS color strings, and that public contract is deliberately
    // left unchanged here rather than having those functions return arrays -
    // changing their return type would break any other caller that expects
    // a string (including direct ctx.fillStyle assignment), whereas parsing
    // the string once per cell with colorStringToRgb (defined at the top of
    // this file) is a single cheap regex match and costs nothing extra
    // against the API-call overhead this rewrite removes.
    //
    // Iterating output pixels and mapping each one back to its source grid
    // cell (rather than iterating grid cells and painting a pixel rectangle
    // per cell) is what keeps this correct in both directions: when the
    // grid is smaller than the canvas, cellW/cellH > 1 and many output
    // pixels legitimately map to the same source cell (unchanged from the
    // original upscaling behavior); when the grid is larger than the
    // canvas, cellW/cellH < 1 and several source cells would compete for
    // the same output pixel - this now resolves deterministically via
    // nearest-neighbor (floor division), whereas the old fillRect approach
    // resolved that case arbitrarily based on whichever cell's rectangle
    // happened to paint last. The waterMask that other code reads off this
    // class is still built from the same one-pass-per-cell grid loop with
    // the exact same true/false semantics as before, just interleaved with
    // the color lookup table instead of a live fillRect call.
    // ==========================================================================
    setTerrain(grid, elevationGrid = null, seaLevel = 0) {
        if (!grid) {
            this.terrainLayer = null;
            this.waterMask = null;
            return;
        }

        this.elevationGrid = elevationGrid;
        const layer = document.createElement("canvas");
        layer.width = this.canvasWidth;
        layer.height = this.canvasHeight;
        const ctx = layer.getContext("2d");

        const height = grid.length;
        const width = grid[0].length;
        const cellW = layer.width / width;
        const cellH = layer.height / height;

        const elev = generationSettings.elevation || {};
        const water = generationSettings.water || {};
        const waterMask = new Array(height);
        const cellColors = new Array(height);

        for (let y = 0; y < height; y++) {
            const maskRow = new Array(width);
            const colorRow = new Array(width);

            for (let x = 0; x < width; x++) {
                const type = grid[y][x];
                const config = getTerrainConfig(type);
                let rgb;

                if (config.type === "water" || type === "river") {
                    const elevVal = elevationGrid ? elevationGrid[y][x] : -0.1;
                    const fill = type === "river"
                        ? applyRiverVisuals(elevVal, seaLevel, water, x, y)
                        : applyWaterVisuals(elevVal, seaLevel, water, x, y);
                    rgb = colorStringToRgb(fill);
                    maskRow[x] = true;
                } else {
                    rgb = hexToRgb(config.color);
                    if (elevationGrid && config.shadeable) {
                        const shade = getHillshade(
                            elevationGrid, x, y, width, height, this.sunVector,
                            { exaggeration: elev.exaggeration, ambient: elev.ambient, intensity: elev.intensity }
                        );
                        const tint = getElevationFactor(elevationGrid[y][x]);
                        rgb = colorStringToRgb(applyRelief(config.color, shade, tint));
                    }
                    maskRow[x] = false;
                }

                colorRow[x] = rgb;
            }

            waterMask[y] = maskRow;
            cellColors[y] = colorRow;
        }

        const imageData = ctx.createImageData(layer.width, layer.height);
        const buf = imageData.data;

        for (let py = 0; py < layer.height; py++) {
            const gy = Math.min(height - 1, Math.floor(py / cellH));
            const rowColors = cellColors[gy];
            const rowOffset = py * layer.width * 4;

            for (let px = 0; px < layer.width; px++) {
                const gx = Math.min(width - 1, Math.floor(px / cellW));
                const rgb = rowColors[gx];
                const idx = rowOffset + px * 4;
                buf[idx] = rgb[0];
                buf[idx + 1] = rgb[1];
                buf[idx + 2] = rgb[2];
                buf[idx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);

        this.terrainLayer = layer;
        this.waterMask = waterMask;
    }

    getLayer() {
        return this.terrainLayer;
    }

    getWaterMask() {
        return this.waterMask;
    }
}