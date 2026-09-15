// ============================================================
// SOUND MANAGER
// ============================================================
// Loads and plays each weapon's pre-rendered .wav file (exported
// from the separate Weapon Sound Generator tool), keyed off the
// same weapon key used across the weapons/*.json files (e.g.
// content/audio/AK.wav for the "AK" entry). Buffers are lazily
// fetched, decoded, and cached on first play(), or can be warmed
// up ahead of time via preload().
//
// A missing or failed file never throws into caller code — it's
// logged as a warning and playback is silently skipped, so one
// broken audio file can never interrupt combat.
//
// Two limits protect against large battles turning into noise:
// maxVoices caps how many sounds can play at once across all
// weapons, and maxVoicesPerWeapon caps how many copies of the same
// weapon's sound can overlap (e.g. 30 units firing MG42 at once
// still only ever sounds like 4). When a limit is hit, the oldest
// active voice for that scope is stopped to make room for the new
// one. Each playback also gets a small random pitch variation so
// the same weapon firing repeatedly doesn't sound like an identical
// loop.
//
// Browsers suspend a fresh AudioContext until a user gesture
// happens on the page; every call to _getContext() attempts to
// resume() it, which is sufficient once the player has interacted
// with the page at all.
//
// This file has zero dependency on effects.js or weapons.json — it
// only needs weapon keys (plain strings) passed into play()/preload(),
// so it can be imported and used standalone (e.g. a UI click sound
// test) without pulling in the whole effects pipeline.
// ============================================================

const AUDIO_BASE_PATH = "../../content/audio/";

class SoundManager {
  constructor({ maxVoices = 16, maxVoicesPerWeapon = 4 } = {}) {
    this.ctx = null;
    this.buffers = new Map();
    this.loading = new Map();
    this.maxVoices = maxVoices;
    this.maxVoicesPerWeapon = maxVoicesPerWeapon;
    this.activeVoices = [];
  }

  _getContext() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  _load(weaponKey) {
    if (this.buffers.has(weaponKey)) return Promise.resolve(this.buffers.get(weaponKey));
    if (this.loading.has(weaponKey)) return this.loading.get(weaponKey);

    const promise = fetch(`${AUDIO_BASE_PATH}${weaponKey}.wav`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.arrayBuffer(); })
      .then((buf) => this._getContext().decodeAudioData(buf))
      .then((buffer) => { this.buffers.set(weaponKey, buffer); this.loading.delete(weaponKey); return buffer; })
      .catch((err) => {
        console.warn(`[SoundManager] couldn't load sound for "${weaponKey}": ${err.message}`);
        this.loading.delete(weaponKey);
        return null;
      });

    this.loading.set(weaponKey, promise);
    return promise;
  }

  preload(weaponKeys) {
    return Promise.all(weaponKeys.map((key) => this._load(key)));
  }

  _makeRoom(weaponKey) {
    const sameWeapon = this.activeVoices.filter((v) => v.weaponKey === weaponKey);
    if (sameWeapon.length >= this.maxVoicesPerWeapon) this._stopVoice(sameWeapon[0]);
    if (this.activeVoices.length >= this.maxVoices) this._stopVoice(this.activeVoices[0]);
  }

  _stopVoice(voice) {
    try { voice.source.stop(); } catch (e) {}
    this._removeVoice(voice);
  }

  _removeVoice(voice) {
    const i = this.activeVoices.indexOf(voice);
    if (i !== -1) this.activeVoices.splice(i, 1);
  }

  async play(weaponKey, { volume = 1, pitchVariation = 0.03 } = {}) {
    const buffer = await this._load(weaponKey);
    if (!buffer) return;

    this._makeRoom(weaponKey);

    const ctx = this._getContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitchVariation;

    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);

    const voice = { weaponKey, source };
    this.activeVoices.push(voice);
    source.onended = () => this._removeVoice(voice);

    source.start();
  }
}

export const soundManager = new SoundManager({ maxVoices: 16, maxVoicesPerWeapon: 4 });
