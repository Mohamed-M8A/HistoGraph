// ==========================================================================
// HISTOGRAPH URBAN MANAGER (5-Buffer SoA Bridge - Urban Domain)
//
// This module manages the human-geography domain within the shared WASM heap.
// It acts as the sole specialized controller for Buffer_Urban and the 
// settlement record buffers (X, Y, and Tier), which are populated via the 
// hierarchical grid analysis in urban_gen.cpp.
//
// ARCHITECTURAL ROLE:
// Following the Domain Separation principle, the UrbanManager is the 
// exclusive authority over the Urban buffer. It receives the shared WASM 
// instance from GeoManager (geo.js), ensuring zero-copy access to the same 
// linear memory heap while keeping urban logic decoupled from physical 
// geography management.
//
// ZERO-COPY SETTLEMENT ACCESS:
// Maps the per-cell urban grid and three fixed-capacity settlement arrays
// (g_settlementX, g_settlementY, g_settlementTier). This enables direct
// iteration over settlement coordinates for road networks and pathfinding
// without full-map raster scans.
//
// MEMORY & CALIBRATION:
// Settlement capacity is bounded by maxSettlementsCapacity (sourced from
// config.js) to keep JS views aligned with WASM allocation limits.
// Suitability thresholds account for signed 16-bit elevation variance.
//
// BUFFER-SYNC SAFETY:
// WASM heap expansion detaches views over HEAPU8.buffer. Because memory
// growth can be triggered by external systems (such as GeoManager),
// _ensureViews() guards every read method to remap stale views safely.
// ==========================================================================

import { URBAN_BITS } from './constants.js';

export class UrbanManager {
    constructor() {
        this.wasm = null;
        this.width = 0;
        this.height = 0;
        this.maxSettlementsCapacity = 0;
        this.grid = null;
        this.settlements = {
            x: null,
            y: null,
            tier: null
        };
    }

    async init(width, height, wasmInstance, maxSettlementsCapacity) {
        this.wasm = wasmInstance;
        this.width = width;
        this.height = height;
        this.maxSettlementsCapacity = maxSettlementsCapacity;

        this._mapViews();
    }

    _mapViews() {
        const size = this.width * this.height;

        const gridPtr = this.wasm._get_urban_ptr();
        const xPtr = this.wasm._get_settlement_x_ptr();
        const yPtr = this.wasm._get_settlement_y_ptr();
        const tierPtr = this.wasm._get_settlement_tier_ptr();

        this.grid = new Uint16Array(this.wasm.HEAPU8.buffer, gridPtr, size);
        this.settlements.x = new Uint16Array(this.wasm.HEAPU8.buffer, xPtr, this.maxSettlementsCapacity);
        this.settlements.y = new Uint16Array(this.wasm.HEAPU8.buffer, yPtr, this.maxSettlementsCapacity);
        this.settlements.tier = new Uint8Array(this.wasm.HEAPU8.buffer, tierPtr, this.maxSettlementsCapacity);
    }

    _ensureViews() {
        if (this.grid.buffer !== this.wasm.HEAPU8.buffer) {
            this._mapViews();
        }
    }

    getIdx(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
        return y * this.width + x;
    }

    generate(seed, options = {}, urbanConfig = {}) {
        if (!this.wasm) return;

        const {
            maxSettlements = urbanConfig.maxSettlements ?? 100,
            macroGridSize = urbanConfig.macroGridSize ?? 64,
            midGridSize = urbanConfig.midGridSize ?? 32,
            microGridSize = urbanConfig.microGridSize ?? 16,
            minSuitabilityScore = urbanConfig.minSuitabilityScore ?? 0.0001,
            waterProximityWeight = urbanConfig.waterProximityWeight ?? 1.5
        } = options;

        this.wasm._generate_urban(
            seed,
            maxSettlements,
            macroGridSize,
            midGridSize,
            microGridSize,
            minSuitabilityScore,
            waterProximityWeight
        );

        this._ensureViews();
    }

    getUrbanData(x, y) {
        this._ensureViews();

        const i = this.getIdx(x, y);
        if (i === -1) return null;

        const val = this.grid[i];
        return {
            object: val & URBAN_BITS.OBJECT_MASK,
            variant: (val >> URBAN_BITS.VARIANT_SHIFT) & URBAN_BITS.VARIANT_MASK,
            damage: (val >> URBAN_BITS.DAMAGE_SHIFT) & URBAN_BITS.DAMAGE_MASK
        };
    }

    getSettlementList() {
        this._ensureViews();

        const count = this.wasm._get_settlement_count();
        const list = [];
        for (let i = 0; i < count; i++) {
            list.push({
                x: this.settlements.x[i],
                y: this.settlements.y[i],
                tier: this.settlements.tier[i]
            });
        }
        return list;
    }
}