// ==========================================
// 1. Sun & Normal Vector Computation
// ==========================================
export function calculateSunVector(azimuth, altitude) {
    const azRad = (azimuth - 90) * Math.PI / 180;
    const altRad = altitude * Math.PI / 180;

    return {
        x: Math.cos(altRad) * Math.cos(azRad),
        y: Math.cos(altRad) * Math.sin(azRad),
        z: Math.sin(altRad)
    };
}

export function computeNormal(grid, x, y, width, height, exaggeration = 10.0) {
    const xLeft = Math.max(0, x - 1);
    const xRight = Math.min(width - 1, x + 1);
    const yUp = Math.max(0, y - 1);
    const yDown = Math.min(height - 1, y + 1);

    const dzdx = ((grid[y][xRight] || 0) - (grid[y][xLeft] || 0)) * exaggeration;
    const dzdy = ((grid[yDown][x] || 0) - (grid[yUp][x] || 0)) * exaggeration;

    const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);

    return {
        x: -dzdx / len,
        y: -dzdy / len,
        z: 1 / len
    };
}

// ==========================================
// 2. Hillshade & Elevation Tinting
// ==========================================
export function getHillshade(grid, x, y, width, height, sunVector, options = {}) {
    const { exaggeration = 15, ambient = 0.4, intensity = 0.8 } = options;

    const normal = computeNormal(grid, x, y, width, height, exaggeration);

    const dot = normal.x * sunVector.x +
                normal.y * sunVector.y +
                normal.z * sunVector.z;

    const shadow = Math.max(0, dot);
    const finalShade = ambient + (shadow * intensity);

    return Math.min(1.5, Math.max(0, finalShade)) - 1.0;
}

export function getElevationFactor(elevation) {
    if (elevation > 0.5) return (elevation - 0.5) * 0.2;
    if (elevation < 0) return elevation * 0.1;
    return 0;
}

// ==========================================
// 3. Color Application with Relief
// ==========================================
export function applyRelief(baseColor, shade, elevationTint) {
    const factor = shade + elevationTint;

    const hexToRgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };

    const [r, g, b] = hexToRgb(baseColor);
    const apply = (val) => Math.max(0, Math.min(255, Math.round(val + val * factor)));

    const nr = apply(r);
    const ng = apply(g);
    const nb = apply(b);

    return `rgb(${nr}, ${ng}, ${nb})`;
}
