// ==========================================================================
// HISTOGRAPH GEO-CONSTANTS (5-Buffer SoA Schema)
//
// This file defines the bitwise shifts and masks for the 5-buffer Structure-
// of-Arrays (SoA) engine. By spreading geographic and urban data across five 
// independent 16-bit TypedArrays (Elevation, Climate, Visuals, Logic, Urban), 
// the engine achieves maximum memory alignment and execution performance 
// using plain 32-bit JS Numbers, avoiding any BigInt overhead.
//
// BUFFER SCHEMATICS & DOMAIN SEPARATION:
//
// 1. Buffer_Elevation (Int16Array): 
//    Stores signed altitude data (-32768 to 32767).
//
// 2. Buffer_Climate (Uint16Array): 
//    - Bits [0-7]:  Temperature. Signed 8-bit (int8), range -128 to 127.
//    - Bits [8-15]: Moisture. Unsigned 8-bit, range 0 to 255.
//
// 3. Buffer_Visuals (Uint16Array):
//    - Bits [0-7]:  Normal/Slope magnitude (0-255).
//    - Bits [8-15]: Biome ID. Identifies the terrain category (0-255).
//
// 4. Buffer_Logic (Uint16Array - GEO DOMAIN):
//    - Bit  [0]:    Water Flag (1: Water, 0: Land).
//    - Bits [1-3]:  Flow Direction (0-7 compass directions).
//    - Bits [4-15]: Reserved for future geo-logical flags (e.g., Fog of War).
//
// 5. Buffer_Urban (Uint16Array - HUMAN DOMAIN):
//    - Bits [0-5]:  Object ID (6-bit, 64 types). Defines buildings or crops.
//    - Bits [6-8]:  Color Variant (3-bit, 8 types). Visual diversity jitter.
//    - Bits [9-11]: Damage State (3-bit, 8 levels). Pixel degradation status.
//    - Bits [12-15]: Reserved for future human-layer simulation flags.
// ==========================================================================

export const CLIMATE_BITS = {
    TEMP_SHIFT: 0,
    TEMP_MASK: 0xFF,
    MOISTURE_SHIFT: 8,
    MOISTURE_MASK: 0xFF
};

export const VISUALS_BITS = {
    NORMAL_SHIFT: 0,
    NORMAL_MASK: 0xFF,
    BIOME_SHIFT: 8,
    BIOME_MASK: 0xFF
};

export const LOGIC_BITS = {
    WATER_SHIFT: 0,
    WATER_MASK: 0x1,
    FLOW_SHIFT: 1,
    FLOW_MASK: 0x7
};

export const URBAN_BITS = {
    OBJECT_SHIFT: 0,
    OBJECT_MASK: 0x3F,
    VARIANT_SHIFT: 6,
    VARIANT_MASK: 0x7,
    DAMAGE_SHIFT: 9,
    DAMAGE_MASK: 0x7
};

export const WORLD_LIMITS = {
    ELEVATION_MIN: -32768,
    ELEVATION_MAX: 32767,
    TEMP_MIN: -128,
    TEMP_MAX: 127,
    MOISTURE_MAX: 255,
    NORMAL_MAX: 255,
    BIOME_MAX: 255,
    OBJECT_MAX: 63,
    VARIANT_MAX: 7,
    DAMAGE_MAX: 7,
    FLOW_MAX: 7
};

export const FLOW_DIRECTIONS = {
    N: 0, NE: 1, E: 2, SE: 3, S: 4, SW: 5, W: 6, NW: 7
};