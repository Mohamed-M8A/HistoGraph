import { classifyTerrain } from './generator.js';

// ==========================================
// 1. Image Loading
// ==========================================
export async function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = reject;
        img.src = url;
    });
}

// ==========================================
// 2. Grayscale Heightmap from Image
// ==========================================
export function imageToHeightmap(img, targetWidth, targetHeight) {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight).data;

    const heightmap = Array.from({ length: targetHeight }, () => new Float32Array(targetWidth));

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            const i = (y * targetWidth + x) * 4;
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];

            const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            heightmap[y][x] = (brightness * 2.0) - 1.0;
        }
    }

    return heightmap;
}

// ==========================================
// 3. Satellite-aware Heightmap Extraction
// ==========================================
export function imageToHeightmapFromSatellite(img, targetWidth, targetHeight, options = {}) {
    const {
        waterHueMin = 180,
        waterHueMax = 240,
        vegetationBoost = 0.15
    } = options;

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight).data;

    const heightmap = Array.from({ length: targetHeight }, () => new Float32Array(targetWidth));

    const rgbToHsl = (r, g, b) => {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        const d = max - min;
        if (d !== 0) {
            s = d / (1 - Math.abs(2 * l - 1));
            switch (max) {
                case r: h = ((g - b) / d) % 6; break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h *= 60;
            if (h < 0) h += 360;
        }
        return [h, s, l];
    };

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            const i = (y * targetWidth + x) * 4;
            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];

            const [hue, sat, light] = rgbToHsl(r, g, b);
            const isWater = hue >= waterHueMin && hue <= waterHueMax && sat > 0.15;
            const isVegetation = hue >= 70 && hue <= 160 && sat > 0.1;

            let elevation = (light * 2.0) - 1.0;

            if (isWater) {
                elevation = -0.15 - (1 - light) * 0.5;
            } else if (isVegetation) {
                elevation += vegetationBoost * (1 - light);
            }

            heightmap[y][x] = Math.max(-1, Math.min(1, elevation));
        }
    }

    return heightmap;
}

// ==========================================
// 4. Classification Helper
// ==========================================
export function getTerrainFromHeight(elevation, rules, moisture = 0) {
    return classifyTerrain(elevation, moisture, rules);
}