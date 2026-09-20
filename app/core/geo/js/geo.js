// ==========================================================================
// HISTOGRAPH GEOGRAPHIC MANAGER (4-Buffer SoA Bridge)
//
// Orchestrates the WASM Geo-Engine: loads the compiled module, allocates
// its four SoA buffers via init_world(), maps all four raw pointers into
// zero-copy TypedArray views over the WASM heap, and hands those views to
// a WorldCore instance that reads and writes through them directly. No
// step in this chain copies data; the views created in _mapViews() are
// windows directly into WASM linear memory. Mutating them from JS mutates
// the same bytes the C++ engine reads, requiring no synchronization step
// in either direction.
//
// Elevation is mapped as an Int16Array to interpret its signed values
// correctly (-32768 to 32767), matching Buffer_Elevation's int16_t layout
// on the C++ side. Climate, Visuals, and Logic are mapped as Uint16Array;
// their individual sub-fields (such as temperature's signed 8-bit range)
// are unpacked and interpreted by world_core.js via bitwise operators
// and sign-extension.
//
// The WASM module is compiled with ALLOW_MEMORY_GROWTH enabled. If the
// heap expands, the underlying ArrayBuffer backing wasm.HEAPU8 detaches,
// invalidating existing TypedArray views. generate() automatically
// detects heap reallocations by verifying buffer references and remaps
// all four views onto the active WorldCore instance. Related human-layer
// views are guarded similarly in urban.js via _ensureViews().
//
// CONFIGURATION:
// init() sources its generation parameters from config.js (WORLD_CONFIG)
// by default, or accepts a custom configuration object. Key properties
// such as baseScale (terrain.baseScale) define the spatial frequency of
// procedural noise cycles in absolute pixel dimensions, remaining
// independent of grid dimensions. All tunable generation limits and
// algorithm weights reside in config.js.
// ==========================================================================

import { WorldCore } from './world-core.js';
import { WORLD_CONFIG } from './config.js';
import loadWasmModule from '../wasm/geo_engine.js';

export class GeoManager {
    constructor() {
        this.wasm = null;
        this.core = null;
        this.width = 0;
        this.height = 0;
        this.views = null;
        this.config = null;
    }
    
    async init(width, height, customConfig = null) {
        this.width = width;
        this.height = height;
        this.config = customConfig || WORLD_CONFIG;

        this.wasm = await loadWasmModule();
        this.wasm._init_world(width, height, this.config.urban.maxSettlementsCapacity);

        this._mapViews();

        this.core = new WorldCore(
            width, height,
            this.views.elevation, 
            this.views.climate, 
            this.views.visuals, 
            this.views.logic
        );
    }

    getConfig() {
        return this.config;
    }

    _mapViews() {
        const size = this.width * this.height;

        const elevPtr = this.wasm._get_elevation_ptr();
        const climatePtr = this.wasm._get_climate_ptr();
        const visualsPtr = this.wasm._get_visuals_ptr();
        const logicPtr = this.wasm._get_logic_ptr();

        this.views = {
            elevation: new Int16Array(this.wasm.HEAPU8.buffer, elevPtr, size),
            climate: new Uint16Array(this.wasm.HEAPU8.buffer, climatePtr, size),
            visuals: new Uint16Array(this.wasm.HEAPU8.buffer, visualsPtr, size),
            logic: new Uint16Array(this.wasm.HEAPU8.buffer, logicPtr, size)
        };
    }

    generate(seed, options = {}) {
        if (!this.wasm) return;

        const { terrain, rivers } = this.config;

        const {
            octaves = terrain.octaves,
            persistence = terrain.persistence,
            warpStrength = terrain.warpStrength,
            warpFrequency = terrain.warpFrequency,
            mountainBias = terrain.mountainBias,
            mountainBoost = terrain.mountainBoost,
            baseScale = terrain.baseScale,
            seaLevel = terrain.seaLevel,
            normalExaggeration = terrain.normalExaggeration,
            riverCount = rivers.riverCount,
            riverMinSourceElevation = rivers.riverMinSourceElevation,
            riverEscapeRadius = rivers.riverEscapeRadius,
            riverMaxLength = rivers.riverMaxLength
        } = options;

        this.wasm._generate_world(
            seed, octaves, persistence, warpStrength, warpFrequency,
            mountainBias, mountainBoost, baseScale, seaLevel, normalExaggeration,
            riverCount, riverMinSourceElevation, riverEscapeRadius, riverMaxLength
        );

        if (this.views.elevation.buffer !== this.wasm.HEAPU8.buffer) {
            this._mapViews();
            this.core.elevation = this.views.elevation;
            this.core.climate = this.views.climate;
            this.core.visuals = this.views.visuals;
            this.core.logic = this.views.logic;
        }
    }

    getCore() {
        return this.core;
    }

    getWasmInstance() {
        return this.wasm;
    }

    dispose() {
        if (this.wasm) {
            this.wasm._cleanup();
        }
    }
}