// ==========================================================================
// HISTOGRAPH GEO WORKER & CLIENT (Self-Spawning Worker Architecture)
//
// Dual-role module providing non-blocking world and urban generation.
// When imported by the main UI thread, it exports GeoWorkerClient, a
// promise-based facade that spawns this script as a dedicated Web Worker.
// When executed inside the worker context, it orchestrates GeoManager
// (geo.js) and UrbanManager (urban.js) away from the browser's UI thread.
//
// MEMORY PIPELINE:
// Worker instances map TypedArray views directly over WASM linear memory.
// To preserve the worker's live heap while delivering data to the main
// thread, generated buffers are sliced into isolated ArrayBuffers and
// transferred via postMessage, eliminating structural clone overhead while
// keeping worker views stable.
//
// PROTOCOL (Main Thread <-> Worker):
// -> { type: 'init', width, height, customConfig }
// <- { type: 'initDone', config }
// -> { type: 'generateWorld', seed, options }
// <- { type: 'worldDone', buffers: { elevation, climate, visuals, logic } }
// -> { type: 'generateUrban', seed, options }
// <- { type: 'urbanDone', grid, settlements: [{x, y, tier}, ...] }
// ==========================================================================

import { GeoManager } from './geo.js';
import { UrbanManager } from './urban.js';

// ==========================================================================
// 1. WORKER CONTEXT
// ==========================================================================
if (typeof window === 'undefined' && typeof self !== 'undefined') {
    const geoManager = new GeoManager();
    const urbanManager = new UrbanManager();

    self.onmessage = async (event) => {
        const msg = event.data;

        try {
            switch (msg.type) {
                case 'init': {
                    await geoManager.init(msg.width, msg.height, msg.customConfig);
                    const config = geoManager.getConfig();

                    await urbanManager.init(
                        msg.width, msg.height,
                        geoManager.getWasmInstance(),
                        config.urban.maxSettlementsCapacity
                    );

                    self.postMessage({ type: 'initDone', config });
                    break;
                }

                case 'generateWorld': {
                    geoManager.generate(msg.seed, msg.options || {});

                    const core = geoManager.getCore();
                    const elevation = core.elevation.slice().buffer;
                    const climate = core.climate.slice().buffer;
                    const visuals = core.visuals.slice().buffer;
                    const logic = core.logic.slice().buffer;

                    self.postMessage(
                        { type: 'worldDone', buffers: { elevation, climate, visuals, logic } },
                        [elevation, climate, visuals, logic]
                    );
                    break;
                }

                case 'generateUrban': {
                    const config = geoManager.getConfig();
                    urbanManager.generate(msg.seed, msg.options || {}, config.urban);

                    const gridBuffer = urbanManager.grid.slice().buffer;
                    const settlements = urbanManager.getSettlementList();

                    self.postMessage(
                        { type: 'urbanDone', grid: gridBuffer, settlements },
                        [gridBuffer]
                    );
                    break;
                }

                default:
                    self.postMessage({ type: 'error', message: `Unknown message type: ${msg.type}` });
            }
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    };
}

// ==========================================================================
// 2. MAIN THREAD CLIENT
// ==========================================================================
export class GeoWorkerClient {
    constructor(workerUrl = new URL('./geo_worker.js', import.meta.url)) {
        this.worker = new Worker(workerUrl, { type: 'module' });
        this.config = null;
        this._pending = null;

        this.worker.onmessage = (event) => this._handleMessage(event.data);
        this.worker.onerror = (err) => this._reject(err);
    }

    _handleMessage(msg) {
        if (msg.type === 'error') {
            this._reject(new Error(msg.message));
            return;
        }
        this._resolve(msg);
    }

    _resolve(value) {
        if (this._pending) {
            this._pending.resolve(value);
            this._pending = null;
        }
    }

    _reject(error) {
        if (this._pending) {
            this._pending.reject(error);
            this._pending = null;
        }
    }

    _send(message) {
        return new Promise((resolve, reject) => {
            this._pending = { resolve, reject };
            this.worker.postMessage(message);
        });
    }

    async init(width, height, customConfig = null) {
        const result = await this._send({ type: 'init', width, height, customConfig });
        this.config = result.config;
        return this.config;
    }

    async generateWorld(seed, options = {}) {
        const result = await this._send({ type: 'generateWorld', seed, options });
        return {
            elevation: new Int16Array(result.buffers.elevation),
            climate: new Uint16Array(result.buffers.climate),
            visuals: new Uint16Array(result.buffers.visuals),
            logic: new Uint16Array(result.buffers.logic)
        };
    }

    async generateUrban(seed, options = {}) {
        const result = await this._send({ type: 'generateUrban', seed, options });
        return {
            grid: new Uint16Array(result.grid),
            settlements: result.settlements
        };
    }

    dispose() {
        this.worker.terminate();
    }
}