// ==========================================================================
// HISTOGRAPH - WORLD CORE (4-Buffer SoA Engine)
//
// This module serves as the primary data interface for the simulation grid.
// It implements a highly optimized Structure-of-Arrays (SoA) architecture, 
// where geographic data is distributed across four specialized 16-bit 
// TypedArrays. This design bypasses the performance bottlenecks 
// of BigInt and BigUint64Array, utilizing plain 32-bit Numbers and bitwise 
// operators for maximum execution speed in the JavaScript environment.
//
// DATA ARCHITECTURE & ZERO-COPY INTEGRATION:
// The WorldCore does not allocate its own geographic memory. Instead, it 
// receives pre-mapped TypedArray views from the GeoManager, which function 
// as direct windows into the WebAssembly (WASM) linear memory heap. 
// This facilitates a "Zero-Copy" pipeline where data changes in C++ are 
// instantly accessible to JavaScript, enabling complex real-time simulations.
//
// SCHEMA DEFINITIONS (4-BUFFER SYSTEM):
// 1. Elevation (Int16Array): Signed 16-bit altitude (-32,768 to 32,767).
// 2. Climate (Uint16Array): 
//    [0-7] Temperature (Signed 8-bit, manual sign-extension).
//    [8-15] Moisture (Unsigned 8-bit).
// 3. Visuals (Uint16Array): 
//    [0-7] Normal/Slope magnitude; [8-15] Biome ID.
// 4. Logic (Uint16Array): 
//    [0] Water flag; [1-3] Flow direction; [4-15] Reserved (Geo-logic).
//
// TEMPERATURE HANDLING:
// Since JavaScript lacks a native 8-bit signed integer type within a wider 
// buffer, the low byte of the Climate buffer is read and converted using 
// signExtend8 logic. This allows for realistic processing of negative 
// environmental temperatures.
// ==========================================================================

import { CLIMATE_BITS, VISUALS_BITS, LOGIC_BITS } from './constants.js';

function signExtend8(value) {
    return value > 127 ? value - 256 : value;
}

export class WorldCore {
    constructor(width, height, elevation, climate, visuals, logic) {
        this.width = width;
        this.height = height;
        this.size = width * height;

        this.elevation = elevation;
        this.climate = climate;
        this.visuals = visuals;
        this.logic = logic;

        this.polBuffer = new Uint16Array(this.size);
    }

    getIdx(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
        return (y * this.width) + x;
    }

    getGeo(x, y) {
        const i = this.getIdx(x, y);
        if (i === -1) return null;

        const climate = this.climate[i];
        const visuals = this.visuals[i];
        const logic = this.logic[i];

        return {
            elevation: this.elevation[i],
            temp: signExtend8(climate & CLIMATE_BITS.TEMP_MASK),
            moist: (climate >> CLIMATE_BITS.MOISTURE_SHIFT) & CLIMATE_BITS.MOISTURE_MASK,
            normal: visuals & VISUALS_BITS.NORMAL_MASK,
            biome: (visuals >> VISUALS_BITS.BIOME_SHIFT) & VISUALS_BITS.BIOME_MASK,
            isWater: (logic & LOGIC_BITS.WATER_MASK) === 1,
            flow: (logic >> LOGIC_BITS.FLOW_SHIFT) & LOGIC_BITS.FLOW_MASK
        };
    }

    setGeo(x, y, data) {
        const i = this.getIdx(x, y);
        if (i === -1) return;

        this.elevation[i] = data.elevation;

        this.climate[i] =
            (data.temp & CLIMATE_BITS.TEMP_MASK) |
            ((data.moist & CLIMATE_BITS.MOISTURE_MASK) << CLIMATE_BITS.MOISTURE_SHIFT);

        this.visuals[i] =
            (data.normal & VISUALS_BITS.NORMAL_MASK) |
            ((data.biome & VISUALS_BITS.BIOME_MASK) << VISUALS_BITS.BIOME_SHIFT);

        this.logic[i] =
            ((data.isWater ? 1 : 0) & LOGIC_BITS.WATER_MASK) |
            ((data.flow & LOGIC_BITS.FLOW_MASK) << LOGIC_BITS.FLOW_SHIFT);
    }

    updateProperty(x, y, property, value) {
        const i = this.getIdx(x, y);
        if (i === -1) return;

        switch (property.toLowerCase()) {
            case 'elevation':
                this.elevation[i] = value;
                break;
            case 'temp':
                this.climate[i] = (this.climate[i] & ~CLIMATE_BITS.TEMP_MASK) | (value & CLIMATE_BITS.TEMP_MASK);
                break;
            case 'moist':
                this.climate[i] =
                    (this.climate[i] & ~(CLIMATE_BITS.MOISTURE_MASK << CLIMATE_BITS.MOISTURE_SHIFT)) |
                    ((value & CLIMATE_BITS.MOISTURE_MASK) << CLIMATE_BITS.MOISTURE_SHIFT);
                break;
            case 'normal':
                this.visuals[i] = (this.visuals[i] & ~VISUALS_BITS.NORMAL_MASK) | (value & VISUALS_BITS.NORMAL_MASK);
                break;
            case 'biome':
                this.visuals[i] =
                    (this.visuals[i] & ~(VISUALS_BITS.BIOME_MASK << VISUALS_BITS.BIOME_SHIFT)) |
                    ((value & VISUALS_BITS.BIOME_MASK) << VISUALS_BITS.BIOME_SHIFT);
                break;
            case 'iswater':
                this.logic[i] = (this.logic[i] & ~LOGIC_BITS.WATER_MASK) | ((value ? 1 : 0) & LOGIC_BITS.WATER_MASK);
                break;
            case 'flow':
                this.logic[i] =
                    (this.logic[i] & ~(LOGIC_BITS.FLOW_MASK << LOGIC_BITS.FLOW_SHIFT)) |
                    ((value & LOGIC_BITS.FLOW_MASK) << LOGIC_BITS.FLOW_SHIFT);
                break;
        }
    }

    setState(x, y, stateId) {
        const i = this.getIdx(x, y);
        if (i !== -1) this.polBuffer[i] = stateId & 0xFFFF;
    }

    getState(x, y) {
        const i = this.getIdx(x, y);
        return i === -1 ? 0 : this.polBuffer[i];
    }
}