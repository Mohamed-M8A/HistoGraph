// ==========================================================================
// HISTOGRAPH - RENDERER UTILITIES & MATH PIPELINE
//
// Consolidated helper module providing color transformations, coordinate
// projection, and celestial environmental calculations for the renderer.
// ==========================================================================

// ==========================================================================
// 1. TIME & ENVIRONMENTAL CONSTANTS
// ==========================================================================
export const TIME_CONSTANTS = {
    TICKS_PER_DAY: 1200,
    DAWN_THRESHOLD: 0.25,
    NOON_THRESHOLD: 0.50,
    DUSK_THRESHOLD: 0.75
};

// ==========================================================================
// 2. COORDINATE PROJECTION
// ==========================================================================
export function toPixel(x, y, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    return [(x / mapWidth) * canvasWidth, (y / mapHeight) * canvasHeight];
}

// ==========================================================================
// 3. COLOR MATH & CACHED PARSERS
// ==========================================================================
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const hexToRgbCache = new Map();

export function isValidHexColor(token) {
    return HEX_RE.test(token) || token === '*';
}

export function hexToRgb(hex) {
    if (!hex) return [0, 0, 0];
    if (hexToRgbCache.has(hex)) return hexToRgbCache.get(hex);

    const clean = hex.replace('#', '');
    const n = parseInt(clean, 16);
    
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgb.r = rgb[0];
    rgb.g = rgb[1];
    rgb.b = rgb[2];

    hexToRgbCache.set(hex, rgb);
    return rgb;
}

export function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return "#" + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function colorStringToRgb(colorStr) {
    if (!colorStr) return [0, 0, 0];
    if (colorStr[0] === '#') return hexToRgb(colorStr);

    const nums = colorStr.match(/\d+/g);
    if (!nums || nums.length < 3) return [0, 0, 0];

    const rgb = [Number(nums[0]), Number(nums[1]), Number(nums[2])];
    rgb.r = rgb[0];
    rgb.g = rgb[1];
    rgb.b = rgb[2];
    return rgb;
}

export function adjustColor(hex, factor) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor);
}

export function shadeColor(hex, factor) {
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

// ==========================================================================
// 4. CELESTIAL & SUN TRIGONOMETRY
// ==========================================================================
export function calculateSunVector(azimuth, altitude) {
    const azRad = (azimuth - 90) * Math.PI / 180;
    const altRad = altitude * Math.PI / 180;

    return {
        x: Math.cos(altRad) * Math.cos(azRad),
        y: Math.cos(altRad) * Math.sin(azRad),
        z: Math.sin(altRad)
    };
}

export class CelestialEngine {
    constructor(ticksPerDay = TIME_CONSTANTS.TICKS_PER_DAY) {
        this.tpd = ticksPerDay;
    }

    getEnvironmentState(tick, config = {}) {
        const dayProgress = (tick % this.tpd) / this.tpd;
        const azimuth = dayProgress * 360; 
        const altitude = Math.sin(dayProgress * Math.PI) * 90;

        const sunVector = calculateSunVector(azimuth, altitude);
        const timeKey = this._getTimeKey(dayProgress);
        const profile = config[timeKey] || config.default || {
            sunColor: "#ffffff",
            ambientColor: "#333333",
            intensity: 1.0
        };

        return {
            sunVector,
            sunColor: profile.sunColor,
            ambientColor: profile.ambientColor,
            intensity: profile.intensity,
            isNight: altitude < 0
        };
    }

    _getTimeKey(progress) {
        if (progress < TIME_CONSTANTS.DAWN_THRESHOLD) return "dawn";
        if (progress < TIME_CONSTANTS.NOON_THRESHOLD) return "noon";
        if (progress < TIME_CONSTANTS.DUSK_THRESHOLD) return "dusk";
        return "night";
    }
}