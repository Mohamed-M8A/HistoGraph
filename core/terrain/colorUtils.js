// ==========================================================================
// Shared Color Parsing Utilities
//
// hexToRgb and colorStringToRgb are pure, stateless color-math helpers with
// no dependency on settlements, terrain, or any other domain concept - all
// they do is turn a color string into [r, g, b] numbers, with a small
// cache so a given hex string (a settlement palette entry, a terrain-type
// base color, etc. - both of which repeat heavily across a single map) is
// only parsed once no matter how many times it is looked up. This file
// exists specifically so human.js (settlements/buildings) and
// terrainManager.js (terrain rendering) can both depend on the same
// implementation without either one depending on the other. Before this
// file existed, the two modules carried byte-for-byte identical copies of
// hexToRgb, and having either module import it from the other would have
// created a dependency running the wrong direction - a rendering-layer
// module reaching into an unrelated settlement-layer module (or vice
// versa) just to parse a color string. A neutral, dependency-free utility
// module is the correct fix: both callers depend downward on this file,
// and neither depends sideways on the other.
//
// colorStringToRgb sits next to hexToRgb and handles the second format
// this project's rendering code deals with - the "rgb(r, g, b)" strings
// produced by water.js's applyWaterVisuals/applyRiverVisuals and by
// elevation.js's applyRelief - by dispatching to hexToRgb for '#'-prefixed
// input and doing a plain numeric parse otherwise, so any caller that
// might receive either format can go through one function regardless of
// which one it was actually given.
// ==========================================================================

const hexToRgbCache = new Map();

export function hexToRgb(hex) {
    if (hexToRgbCache.has(hex)) return hexToRgbCache.get(hex);
    const n = parseInt(hex.replace('#', ''), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    hexToRgbCache.set(hex, rgb);
    return rgb;
}

export function colorStringToRgb(colorStr) {
    if (colorStr[0] === '#') return hexToRgb(colorStr);
    const nums = colorStr.match(/\d+/g);
    return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
}