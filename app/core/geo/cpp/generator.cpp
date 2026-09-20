// ==========================================================================
// HISTOGRAPH - GEO ENGINE GATEWAY
//
// Root entry point and C API bridge for WebAssembly (Emscripten).
// Exposes procedural generation pipelines and manages linear memory
// allocations for GeoBuffers (Elevation, Climate, Visuals, Logic)
// alongside human-layer buffers owned by the urban module.
//
// Execution pipeline:
// 1. init_world(): Allocates geographic and urban buffers.
// 2. generate_world(): Runs terrain, ocean, normals, rivers, and biomes.
// 3. generate_urban(): Runs hierarchical settlement search independently.
// ==========================================================================

#include <cstdint>
#include <emscripten/emscripten.h>
#include "geo.hpp"


namespace {

int16_t*  g_elevation = nullptr;
uint16_t* g_climate   = nullptr;
uint16_t* g_visuals   = nullptr;
uint16_t* g_logic     = nullptr;
int g_width = 0;
int g_height = 0;

geo::GeoBuffers current_buffers() {
    return { g_elevation, g_climate, g_visuals, g_logic, g_width, g_height };
}

}

extern "C" {

EMSCRIPTEN_KEEPALIVE
void init_world(int width, int height, int maxSettlementsCapacity) {
    delete[] g_elevation;
    delete[] g_climate;
    delete[] g_visuals;
    delete[] g_logic;

    g_width = width;
    g_height = height;
    int size = width * height;

    g_elevation = new int16_t[size]();
    g_climate   = new uint16_t[size]();
    g_visuals   = new uint16_t[size]();
    g_logic     = new uint16_t[size]();

    urban::init_urban(width, height, maxSettlementsCapacity);
}

EMSCRIPTEN_KEEPALIVE
uint32_t get_elevation_ptr() { return reinterpret_cast<uint32_t>(g_elevation); }

EMSCRIPTEN_KEEPALIVE
uint32_t get_climate_ptr() { return reinterpret_cast<uint32_t>(g_climate); }

EMSCRIPTEN_KEEPALIVE
uint32_t get_visuals_ptr() { return reinterpret_cast<uint32_t>(g_visuals); }

EMSCRIPTEN_KEEPALIVE
uint32_t get_logic_ptr() { return reinterpret_cast<uint32_t>(g_logic); }

EMSCRIPTEN_KEEPALIVE
uint32_t get_urban_ptr() { return reinterpret_cast<uint32_t>(urban::get_urban_buffer()); }

EMSCRIPTEN_KEEPALIVE
uint32_t get_settlement_x_ptr() { return reinterpret_cast<uint32_t>(urban::get_settlement_x()); }

EMSCRIPTEN_KEEPALIVE
uint32_t get_settlement_y_ptr() { return reinterpret_cast<uint32_t>(urban::get_settlement_y()); }

EMSCRIPTEN_KEEPALIVE
uint32_t get_settlement_tier_ptr() { return reinterpret_cast<uint32_t>(urban::get_settlement_tier()); }

EMSCRIPTEN_KEEPALIVE
int get_settlement_count() { return urban::get_settlement_count(); }

EMSCRIPTEN_KEEPALIVE
void generate_world(
    int seed,
    int octaves,
    double persistence,
    double warpStrength,
    double warpFrequency,
    double mountainBias,
    double mountainBoost,
    double baseScale,
    int16_t seaLevel,
    double normalExaggeration,
    int riverCount,
    int16_t riverMinSourceElevation,
    int riverEscapeRadius,
    int riverMaxLength
) {
    if (!g_elevation || !g_climate || !g_visuals || !g_logic) return;

    geo::GeoBuffers buf = current_buffers();
    int64_t seed64 = static_cast<int64_t>(seed);

    terrain::generate_terrain(
        buf, seed64, octaves, persistence, warpStrength, warpFrequency,
        mountainBias, mountainBoost, baseScale
    );

    terrain::mark_ocean(buf, seaLevel);

    terrain::compute_normals(buf, normalExaggeration);

    water::generate_rivers(
        buf, seed64, riverCount, riverMinSourceElevation, seaLevel,
        riverEscapeRadius, riverMaxLength
    );

    terrain::classify_biomes(buf);
}

EMSCRIPTEN_KEEPALIVE
void generate_urban(
    int seed,
    int maxSettlements,
    int macroGridSize,
    int midGridSize,
    int microGridSize,
    double minSuitabilityScore,
    double waterProximityWeight
) {
    if (!g_elevation || !g_climate || !g_visuals || !g_logic) return;

    geo::GeoBuffers buf = current_buffers();
    int64_t seed64 = static_cast<int64_t>(seed);

    urban::generate_urban(
        buf, seed64, maxSettlements, macroGridSize, midGridSize, microGridSize,
        minSuitabilityScore, waterProximityWeight
    );
}

EMSCRIPTEN_KEEPALIVE
void cleanup() {
    delete[] g_elevation; g_elevation = nullptr;
    delete[] g_climate;   g_climate = nullptr;
    delete[] g_visuals;   g_visuals = nullptr;
    delete[] g_logic;     g_logic = nullptr;
    urban::cleanup_urban();
}

}
