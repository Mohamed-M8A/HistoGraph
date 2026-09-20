// ==========================================================================
// HISTOGRAPH - TERRAIN GENERATION MODULE (implementation)
//
// Implements base elevation, domain warping, mountain boost, normal
// estimation, and biome classification declared in terrain.hpp.
// Contains a self-contained 2D Perlin noise implementation for multi-octave
// height, moisture, and temperature sampling.
// ==========================================================================

#include "geo.hpp"
#include <cmath>
#include <algorithm>
#include <cstdlib>

namespace {

struct Rng {
    int64_t s;
    explicit Rng(int64_t seed) {
        s = seed % 2147483647;
        if (s <= 0) s += 2147483646;
    }
    double next() {
        s = (s * 16807) % 2147483647;
        return static_cast<double>(s - 1) / 2147483646.0;
    }
};

struct Perm {
    uint8_t p[512];
    explicit Perm(Rng& rng) {
        uint8_t source[256];
        for (int i = 0; i < 256; i++) source[i] = static_cast<uint8_t>(i);
        for (int i = 255; i > 0; i--) {
            int j = static_cast<int>(rng.next() * (i + 1));
            std::swap(source[i], source[j]);
        }
        for (int i = 0; i < 512; i++) p[i] = source[i & 255];
    }
};

inline double fade(double t) { return t * t * t * (t * (t * 6 - 15) + 10); }
inline double lerp(double a, double b, double t) { return a + t * (b - a); }
inline double grad(uint8_t hash, double x, double y) {
    switch (hash & 3) {
        case 0: return  x + y;
        case 1: return -x + y;
        case 2: return  x - y;
        default: return -x - y;
    }
}

class Noise2D {
public:
    explicit Noise2D(int64_t seed) : rng_(seed), perm_(rng_) {}
    double sample(double x, double y) const {
        int xi = static_cast<int>(std::floor(x)) & 255;
        int yi = static_cast<int>(std::floor(y)) & 255;
        double xf = x - std::floor(x);
        double yf = y - std::floor(y);
        double u = fade(xf);
        double v = fade(yf);
        const uint8_t* p = perm_.p;
        uint8_t aa = p[p[xi] + yi],     ab = p[p[xi] + yi + 1];
        uint8_t ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
        return lerp(
            lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
            lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
            v
        );
    }
private:
    Rng rng_;
    Perm perm_;
};

inline uint8_t clamp255(double v) {
    if (v < 0) return 0;
    if (v > 255) return 255;
    return static_cast<uint8_t>(v);
}

inline int8_t clampTemp(double v) {
    if (v < -128) return -128;
    if (v > 127) return 127;
    return static_cast<int8_t>(v);
}

}

namespace terrain {

void generate_terrain(
    const geo::GeoBuffers& buf,
    int64_t seed,
    int octaves,
    double persistence,
    double warpStrength,
    double warpFrequency,
    double mountainBias,
    double mountainBoost,
    double baseScale
) {
    Noise2D noise(seed);
    Noise2D warpNoiseX(seed + 101);
    Noise2D warpNoiseY(seed + 202);
    Noise2D mountainNoise(seed + 303);
    Noise2D moistureNoise(seed + 777);
    Noise2D tempNoise(seed + 444);

    for (int y = 0; y < buf.height; y++) {
        for (int x = 0; x < buf.width; x++) {

            double nx = static_cast<double>(x) / baseScale;
            double ny = static_cast<double>(y) / baseScale;

            double wx = warpNoiseX.sample(nx * warpFrequency, ny * warpFrequency) * warpStrength;
            double wy = warpNoiseY.sample(nx * warpFrequency, ny * warpFrequency) * warpStrength;

            double amp = 1.0, freq = 1.0, total = 0.0, maxAmp = 0.0;
            for (int i = 0; i < octaves; i++) {
                total += noise.sample((nx + wx) * freq, (ny + wy) * freq) * amp;
                maxAmp += amp;
                amp *= persistence;
                freq *= 2;
            }

            double h = (total / maxAmp + 1.0) / 2.0;

            if (h > 0.5) {
                double mask = (mountainNoise.sample(nx * 1.2, ny * 1.2) + 1.0) / 2.0;
                double mFactor = std::max(0.0, (mask - mountainBias) / (1 - mountainBias));
                h += h * mFactor * mountainBoost;
            }
            h = std::min(1.0, h);

            double signedElev = (h - 0.5) * 2.0 * 32767.0;
            int16_t elev = static_cast<int16_t>(std::round(std::clamp(signedElev, -32767.0, 32767.0)));

            double moistRaw = (moistureNoise.sample(nx * 3, ny * 3) + 1) / 2;
            uint8_t moist = clamp255(moistRaw * 255.0);

            double tempRaw = tempNoise.sample(nx * 1.5, ny * 1.5) * 127.0;
            int8_t temp = clampTemp(tempRaw);

            int idx = buf.idx(x, y);
            buf.elevation[idx] = elev;
            buf.climate[idx] = geo::packClimate(temp, moist);
        }
    }
}

void mark_ocean(const geo::GeoBuffers& buf, int16_t seaLevel) {
    for (int y = 0; y < buf.height; y++) {
        for (int x = 0; x < buf.width; x++) {
            int idx = buf.idx(x, y);
            if (buf.elevation[idx] <= seaLevel) {
                buf.logic[idx] = geo::setWater(buf.logic[idx], 1);
            }
        }
    }
}

void compute_normals(const geo::GeoBuffers& buf, double exaggeration) {
    for (int y = 0; y < buf.height; y++) {
        for (int x = 0; x < buf.width; x++) {
            int xL = std::max(x - 1, 0), xR = std::min(x + 1, buf.width - 1);
            int yU = std::max(y - 1, 0), yD = std::min(y + 1, buf.height - 1);

            double dx = static_cast<double>(buf.elevation[buf.idx(xR, y)]) -
                        static_cast<double>(buf.elevation[buf.idx(xL, y)]);
            double dy = static_cast<double>(buf.elevation[buf.idx(x, yD)]) -
                        static_cast<double>(buf.elevation[buf.idx(x, yU)]);

            double slope = std::sqrt(dx * dx + dy * dy) * exaggeration / 65534.0;
            uint8_t normal = clamp255(slope * 255.0);

            int idx = buf.idx(x, y);
            buf.visuals[idx] = geo::setNormal(buf.visuals[idx], normal);
        }
    }
}

void classify_biomes(const geo::GeoBuffers& buf) {
    for (int y = 0; y < buf.height; y++) {
        for (int x = 0; x < buf.width; x++) {
            int idx = buf.idx(x, y);
            bool isWater = geo::getWater(buf.logic[idx]) == 1;
            int16_t elev = buf.elevation[idx];
            int8_t temp = geo::getTemp(buf.climate[idx]);
            uint8_t moist = geo::getMoisture(buf.climate[idx]);

            uint8_t biome;

            if (isWater) {
                biome = (elev <= 0) ? 0 : 1;
            } else if (elev > 20000) {
                biome = (temp < -20) ? 13 : 12;
            } else if (elev > 10000) {
                biome = 11;
            } else if (elev < 500 && elev > 0) {
                biome = 2;
            } else if (temp < -30) {
                biome = (moist > 140) ? 10 : 9;
            } else if (temp > 30) {
                biome = (moist > 150) ? 6 : (moist > 70 ? 7 : 3);
            } else {
                if (moist > 190) biome = 8;
                else if (moist > 110) biome = 5;
                else biome = 4;
            }

            buf.visuals[idx] = geo::setBiome(buf.visuals[idx], biome);
        }
    }
}

}
