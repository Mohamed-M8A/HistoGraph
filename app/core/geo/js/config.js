// ==========================================================================
// HISTOGRAPH - WORLD GENERATION CONFIGURATION
//
// Tunable parameters for terrain, river generation, and urban settlement
// distribution. Modifying these values alters procedural world generation
// behavior without affecting low-level memory layouts.
// ==========================================================================

export const WORLD_CONFIG = {
    terrain: {
        octaves: 5,
        persistence: 0.5,
        warpStrength: 0.15,
        warpFrequency: 1.5,
        mountainBias: 0.45,
        mountainBoost: 1.6,
        baseScale: 250,
        seaLevel: 0,
        normalExaggeration: 10.0
    },
    rivers: {
        riverCount: 10,
        riverMinSourceElevation: 20000,
        riverEscapeRadius: 20,
        riverMaxLength: 2000
    },
    urban: {
        maxSettlementsCapacity: 512,
        maxSettlements: 100,
        macroGridSize: 64,
        midGridSize: 32,
        microGridSize: 16,
        minSuitabilityScore: 0.0001,
        waterProximityWeight: 1.5
    }
};