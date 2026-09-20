// ==========================================================================
// HISTOGRAPH - UNIFIED NATIVE GEO INTERFACE
//
// Single header providing memory layout definitions, inline bit-packing
// helpers, and module declarations (Terrain, Water, Urban) for the WASM engine.
// ==========================================================================

#pragma once
#include <cstdint>

// ==========================================================================
// 1. MEMORY LAYOUT & BITWISE SCHEMAS
// ==========================================================================
namespace geo {

inline int8_t getTemp(uint16_t climate) {
    return static_cast<int8_t>(static_cast<uint8_t>(climate & 0xFF));
}

inline uint8_t getMoisture(uint16_t climate) {
    return (climate >> 8) & 0xFF;
}

inline uint16_t packClimate(int8_t temp, uint8_t moisture) {
    uint16_t tempBits = static_cast<uint8_t>(temp);
    return tempBits | (static_cast<uint16_t>(moisture) << 8);
}

inline uint8_t getNormal(uint16_t visuals) {
    return visuals & 0xFF;
}

inline uint8_t getBiome(uint16_t visuals) {
    return (visuals >> 8) & 0xFF;
}

inline uint16_t setNormal(uint16_t visuals, uint8_t normal) {
    return (visuals & 0xFF00) | normal;
}

inline uint16_t setBiome(uint16_t visuals, uint8_t biome) {
    return (visuals & 0x00FF) | (static_cast<uint16_t>(biome) << 8);
}

inline uint8_t getWater(uint16_t logic) {
    return logic & 0x1;
}

inline uint8_t getFlow(uint16_t logic) {
    return (logic >> 1) & 0x7;
}

inline uint16_t setWater(uint16_t logic, uint8_t water) {
    return (logic & ~0x1) | (water & 0x1);
}

inline uint16_t setFlow(uint16_t logic, uint8_t flow) {
    return (logic & ~(0x7 << 1)) | ((flow & 0x7) << 1);
}

enum FlowDirection : uint8_t { N = 0, NE = 1, E = 2, SE = 3, S = 4, SW = 5, W = 6, NW = 7 };

struct GeoBuffers {
    int16_t*  elevation;
    uint16_t* climate;
    uint16_t* visuals;
    uint16_t* logic;
    int width;
    int height;

    inline int idx(int x, int y) const { return y * width + x; }
    inline bool inBounds(int x, int y) const {
        return x >= 0 && y >= 0 && x < width && y < height;
    }
};

inline uint8_t getUrbanObject(uint16_t urban) {
    return urban & 0x3F;
}

inline uint8_t getUrbanVariant(uint16_t urban) {
    return (urban >> 6) & 0x7;
}

inline uint8_t getUrbanDamage(uint16_t urban) {
    return (urban >> 9) & 0x7;
}

inline uint16_t setUrbanObject(uint16_t urban, uint8_t object) {
    return (urban & ~0x3F) | (object & 0x3F);
}

inline uint16_t setUrbanVariant(uint16_t urban, uint8_t variant) {
    return (urban & ~(0x7 << 6)) | ((variant & 0x7) << 6);
}

inline uint16_t setUrbanDamage(uint16_t urban, uint8_t damage) {
    return (urban & ~(0x7 << 9)) | ((damage & 0x7) << 9);
}

enum SettlementTier : uint8_t { HAMLET = 1, VILLAGE = 2, TOWN = 3, CITY = 4, METROPOLIS = 5 };

} // namespace geo

// ==========================================================================
// 2. TERRAIN MODULE INTERFACE
// ==========================================================================
namespace terrain {

void generate_terrain(
    const geo::GeoBuffers& buffers,
    int64_t seed,
    int octaves,
    double persistence,
    double warpStrength,
    double warpFrequency,
    double mountainBias,
    double mountainBoost,
    double baseScale
);

void mark_ocean(const geo::GeoBuffers& buffers, int16_t seaLevel);
void compute_normals(const geo::GeoBuffers& buffers, double exaggeration);
void classify_biomes(const geo::GeoBuffers& buffers);

} // namespace terrain

// ==========================================================================
// 3. WATER MODULE INTERFACE
// ==========================================================================
namespace water {

void generate_rivers(
    const geo::GeoBuffers& buffers,
    int64_t seed,
    int count,
    int16_t minSourceElevation,
    int16_t seaLevel,
    int escapeRadius,
    int maxLength
);

} // namespace water

// ==========================================================================
// 4. URBAN MODULE INTERFACE
// ==========================================================================
namespace urban {

void init_urban(int width, int height, int maxSettlementsCapacity);

void generate_urban(
    const geo::GeoBuffers& geoBuffers,
    int64_t seed,
    int maxSettlements,
    int macroGridSize,
    int midGridSize,
    int microGridSize,
    double minSuitabilityScore,
    double waterProximityWeight
);

uint16_t* get_urban_buffer();
uint16_t* get_settlement_x();
uint16_t* get_settlement_y();
uint8_t*  get_settlement_tier();
int get_settlement_count();

void cleanup_urban();

} // namespace urban
