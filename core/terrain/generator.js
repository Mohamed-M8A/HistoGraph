// ==========================================
// 1. Seeded Random Number Generator
// ==========================================
export function createRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

// ==========================================
// 2. Perlin-style Noise Generation
// ==========================================
function buildPermutation(rng) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    return [...p, ...p];
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

function grad(hash, x, y) {
    switch (hash & 3) {
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        default: return -x - y;
    }
}

export function makeNoise2D(seed) {
    const p = buildPermutation(createRng(seed));
    return (x, y) => {
        const xi = Math.floor(x) & 255;
        const yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);
        const u = fade(xf);
        const v = fade(yf);

        const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1], ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];

        return lerp(
            lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
            lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
            v
        );
    };
}

// ==========================================
// 3. Heightmap Generation 
// ==========================================
export function generateHeightmap(width, height, seed, options = {}) {
    const {
        octaves = 5,
        persistence = 0.5,
        warpStrength = 0.15,
        warpFrequency = 1.5,
        mountainFrequency = 1.2,
        mountainBias = 0.45,
        mountainBoost = 1.6
    } = options;

    const noise = makeNoise2D(seed);
    const warpNoiseX = makeNoise2D(seed + 101);
    const warpNoiseY = makeNoise2D(seed + 202);
    const mountainNoise = makeNoise2D(seed + 303);

    const grid = Array.from({ length: height }, () => new Float32Array(width));

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const nx = x / width;
            const ny = y / height;

            const warpX = warpNoiseX(nx * warpFrequency, ny * warpFrequency) * warpStrength;
            const warpY = warpNoiseY(nx * warpFrequency, ny * warpFrequency) * warpStrength;

            let amp = 1, freq = 1, total = 0, max = 0;
            for (let i = 0; i < octaves; i++) {
                total += noise((nx + warpX) * 4 * freq, (ny + warpY) * 4 * freq) * amp;
                max += amp;
                amp *= persistence;
                freq *= 2;
            }
            let h = total / max;

            if (h > 0) {
                const mask = mountainNoise(nx * mountainFrequency, ny * mountainFrequency);
                const mountainFactor = Math.max(0, (mask - mountainBias) / (1 - mountainBias));
                h += h * mountainFactor * mountainBoost;
            }

            grid[y][x] = Math.max(-1, Math.min(1, h));
        }
    }
    return grid;
}

// ==========================================
// 4. Moisture Map
// ==========================================
export function generateMoistureMap(width, height, seed, octaves = 4, persistence = 0.55, frequency = 3) {
    const noise = makeNoise2D(seed + 777);
    const grid = Array.from({ length: height }, () => new Float32Array(width));

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let amp = 1, freq = 1, total = 0, max = 0;
            for (let i = 0; i < octaves; i++) {
                total += noise((x / width) * frequency * freq, (y / height) * frequency * freq) * amp;
                max += amp;
                amp *= persistence;
                freq *= 2;
            }
            grid[y][x] = total / max;
        }
    }
    return grid;
}

// ==========================================
// 5. Terrain Classification
// ==========================================
const DEFAULT_THRESHOLDS = {
    deepWater: -0.22,
    shallowWater: 0,
    plainsMax: 0.52,
    hillsMax: 0.74,
    mountainMax: 0.9,
    desertMoisture: -0.12,
    forestMoisture: 0.18
};

export function classifyTerrain(elevation, moisture = 0, thresholds = {}, seaLevel = 0) {
    const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const e = elevation - seaLevel;

    if (e < t.deepWater) return "water_deep";
    if (e < t.shallowWater) return "water_shallow";
    if (e < t.plainsMax) {
        if (moisture < t.desertMoisture) return "desert";
        if (moisture > t.forestMoisture) return "forest";
        return "plains";
    }
    if (e < t.hillsMax) return "hills";
    if (e < t.mountainMax) return "mountain";
    return "snow";
}
