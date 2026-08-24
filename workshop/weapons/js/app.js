"use strict";

let arsenal = {};
let liveCtx = null;
let currentKey = null;
let currentMode = "dossier";

const jsonUpload = document.getElementById('jsonUpload');
const weaponListContainer = document.getElementById('weaponListContainer');
const searchBox = document.getElementById('searchBox');
const nationFilter = document.getElementById('nationFilter');
const sortSelect = document.getElementById('sortSelect');
const liveScope = document.getElementById('liveScope');
const liveScopeCtx = liveScope.getContext('2d');
const uploadStatus = document.getElementById('uploadStatus');
const registryCount = document.getElementById('registryCount');
const previewEmpty = document.getElementById('previewEmpty');
const tabDossierBtn = document.getElementById('tabDossierBtn');
const tabExportBtn = document.getElementById('tabExportBtn');
const dossierPane = document.getElementById('dossierPane');
const exportPane = document.getElementById('exportPane');
const dossierNav = document.getElementById('dossierNav');
const registryGroup = document.getElementById('registryGroup');
const audioRow = document.getElementById('audioRow');
const audioControls = document.getElementById('audioControls');
const audioNoneMsg = document.getElementById('audioNoneMsg');
const playBtn = document.getElementById('playBtn');
const downloadBtn = document.getElementById('downloadBtn');
const audioFormatSelect = document.getElementById('audioFormatSelect');
const generateAllBtn = document.getElementById('generateAllBtn');
const exportFormatSelect = document.getElementById('exportFormatSelect');
const exportProgress = document.getElementById('exportProgress');
const exportScope = document.getElementById('exportScope');
const exportScopeCtx = exportScope.getContext('2d');
const statTotal = document.getElementById('statTotal');
const statAudible = document.getElementById('statAudible');
const statSilent = document.getElementById('statSilent');

function kindMeta(kind) {
    return KIND_META[kind] || { color: '#7a8177', label: (kind || 'UNCLASSIFIED').toUpperCase() };
}

function formatLabel(key) {
    if (LABELS[key]) return LABELS[key];
    return key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

function parseColorForCSS(raw) {
    if (typeof raw !== 'string') return null;
    const v = raw.trim();
    if (v.startsWith('#')) return v;
    if (v.startsWith('rgb')) return v;
    if (/^\d+,\s*\d+,\s*\d+$/.test(v)) return `rgb(${v})`;
    return null;
}

function jitter(value, pct = 0.08) {
    return value * (1 + (Math.random() * 2 - 1) * pct);
}

function getPreset(profile) {
    const base = SOUND_CLASS_PRESETS[profile.soundClass] || null;
    if (!profile.audio) return base;
    return { ...(base || {}), ...profile.audio };
}

function makeNoiseBuffer(ctx, durationSec) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
}

function applyEnvelope(gainNode, ctx, start, attack, decay, peak) {
    const g = gainNode.gain;
    g.setValueAtTime(0, start);
    g.linearRampToValueAtTime(peak, start + attack);
    g.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}

const _distortionCurveCache = new Map();
function getDistortionCurve(amount) {
    const key = Math.round(amount * 100);
    if (_distortionCurveCache.has(key)) return _distortionCurveCache.get(key);
    const k = amount * 100;
    const n = 4096;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    _distortionCurveCache.set(key, curve);
    return curve;
}

function withRoughness(ctx, dest, roughness) {
    if (!roughness) return dest;
    const shaper = ctx.createWaveShaper();
    shaper.curve = getDistortionCurve(Math.min(1, roughness));
    shaper.oversample = "2x";
    const trim = ctx.createGain();
    trim.gain.value = 1 / (1 + roughness * 0.6);
    shaper.connect(trim).connect(dest);
    return shaper;
}

function noiseBurst(ctx, dest, { start, duration, filterType = "bandpass", freq, freqEnd, Q = 1, attack = 0.002, decay, peak = 1, roughness = 0 }) {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, duration + 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, start);
    if (freqEnd !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + duration);
    }
    filter.Q.value = Q;

    const gain = ctx.createGain();
    applyEnvelope(gain, ctx, start, attack, decay ?? duration, peak);

    src.connect(filter).connect(gain);
    gain.connect(withRoughness(ctx, dest, roughness));
    src.start(start);
    src.stop(start + duration + 0.1);
}

function subBoom(ctx, dest, { start, duration, freqStart, freqEnd, peak = 1, roughness = 0 }) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freqStart, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + duration);

    const gain = ctx.createGain();
    applyEnvelope(gain, ctx, start, 0.004, duration, peak);

    osc.connect(gain);
    gain.connect(withRoughness(ctx, dest, roughness));
    osc.start(start);
    osc.stop(start + duration + 0.1);
}

const METAL_RATIOS = [1, 1.79, 2.76, 4.32];
function metallicRing(ctx, dest, { start, basePitch, decay, peak = 0.3 }) {
    METAL_RATIOS.forEach((ratio, i) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = jitter(basePitch * ratio, 0.03);
        const gain = ctx.createGain();
        const partialPeak = peak * (1 / (i + 1));
        const partialDecay = decay * (1 - i * 0.15);
        applyEnvelope(gain, ctx, start, 0.001, Math.max(0.02, partialDecay), partialPeak);
        osc.connect(gain).connect(dest);
        osc.start(start);
        osc.stop(start + partialDecay + 0.05);
    });
}

function boomEcho(ctx, dest, { start, freqStart, freqEnd, duration, peak, roughness, repeats = 2 }) {
    for (let i = 1; i <= repeats; i++) {
        const delay = i * jitter(0.14, 0.2);
        subBoom(ctx, dest, {
            start: start + delay,
            duration: duration * (1 - i * 0.12),
            freqStart: freqStart * 0.85,
            freqEnd,
            peak: peak * Math.pow(0.45, i),
            roughness: roughness * 0.6
        });
    }
}

function tone(ctx, dest, { start, duration, freqStart, freqEnd, type = "sawtooth", peak = 0.5, filterFreq }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, start);
    if (freqEnd !== undefined) osc.frequency.linearRampToValueAtTime(freqEnd, start + duration);

    let node = osc;
    if (filterFreq) {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = filterFreq;
        osc.connect(filter);
        node = filter;
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.02);
    gain.gain.setValueAtTime(peak, start + Math.max(0, duration - 0.05));
    gain.gain.linearRampToValueAtTime(0.0001, start + duration);

    node.connect(gain).connect(dest);
    osc.start(start);
    osc.stop(start + duration + 0.05);
}

function crackClick(ctx, dest, { start, peak = 0.5, roughness = 0 }) {
    noiseBurst(ctx, dest, {
        start, duration: 0.006, filterType: "highpass",
        freq: jitter(1600, 0.15), Q: 0.4,
        attack: 0.0004, decay: 0.006, peak, roughness
    });
}

function fuseTick(ctx, dest, { start, peak = 0.15 }) {
    noiseBurst(ctx, dest, {
        start, duration: 0.012, filterType: "highpass",
        freq: jitter(2200, 0.1), Q: 0.7,
        attack: 0.0003, decay: 0.01, peak
    });
}

function synthTracer(ctx, dest, profile) {
    if (profile.silent) return 0;
    const preset = getPreset(profile);
    const caliber = profile.lineWidth ?? 1.5;

    const dur = jitter(preset ? preset.dur : 0.1 + caliber * 0.05);
    const freq = jitter(preset ? preset.crackFreq : 3200 - caliber * 500, 0.06);
    const crackIsPistol = profile.soundClass === "pistol" || profile.soundClass === "pistol_magnum" || profile.soundClass === "bow";
    crackClick(ctx, dest, { start: 0, peak: crackIsPistol ? 0.55 : 0.65, roughness: (preset?.roughness ?? 0) * 0.6 });
    noiseBurst(ctx, dest, { start: 0, duration: dur, freq, freqEnd: freq * 0.3, Q: jitter(0.7, 0.15), decay: dur * 0.8, peak: 1, roughness: preset?.roughness ?? 0 });

    const wantsBoom = preset ? preset.subBoom : caliber >= 2.2;
    if (wantsBoom) {
        const boomFreq = jitter(preset?.subBoomFreq ?? 140, 0.1);
        const isPistolClass = profile.soundClass === "pistol" || profile.soundClass === "pistol_magnum";
        const boomPeak = isPistolClass ? 0.6 : 0.85;
        subBoom(ctx, dest, { start: 0, duration: dur * 1.4, freqStart: boomFreq, freqEnd: boomFreq * 0.32, peak: boomPeak, roughness: (preset?.roughness ?? 0) * 0.5 });
    }
    return dur + 0.05;
}

function synthBurst(ctx, dest, profile) {
    const preset = getPreset(profile);
    const totalSec = (profile.durationMs / 1000) * 0.8;
    const shotCount = profile.shotCount ?? 6;
    const caliber = (profile.shotLength ?? 14) / 14;
    const baseCrackFreq = preset ? preset.crackFreq : 2600 - caliber * 400;
    const bodyFreq = preset?.bodyFreq ?? null;
    const roughness = preset?.roughness ?? 0;
    const boomPeak = preset?.boomPeak ?? 0.3;
    const boomRoughnessMult = preset?.boomRoughnessMult ?? 0.5;
    const crackDurBoost = preset?.crackDurBoost ?? 1;

    if (shotCount > 24) {
        const src = ctx.createBufferSource();
        src.buffer = makeNoiseBuffer(ctx, totalSec + 0.05);
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = jitter(bodyFreq ? baseCrackFreq * 0.7 : 1800, 0.08);
        filter.Q.value = jitter(0.8, 0.2);

        const lfo = ctx.createOscillator();
        lfo.type = "square";
        lfo.frequency.value = jitter(Math.min(90, shotCount / totalSec), 0.05);
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.5;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, 0);
        gain.gain.linearRampToValueAtTime(0.7, 0.01);
        gain.gain.setValueAtTime(0.7, Math.max(0.01, totalSec - 0.05));
        gain.gain.linearRampToValueAtTime(0.0001, totalSec);

        lfo.connect(lfoGain).connect(gain.gain);
        src.connect(filter).connect(gain);
        gain.connect(withRoughness(ctx, dest, roughness));
        lfo.start(0); lfo.stop(totalSec + 0.05);
        src.start(0); src.stop(totalSec + 0.1);
        return totalSec + 0.1;
    }

    const interval = totalSec / shotCount;
    const crackDur = Math.min(interval * 0.9, (0.09 + caliber * 0.03) * crackDurBoost);
    for (let i = 0; i < shotCount; i++) {
        const start = i * interval;
        const freq = jitter(baseCrackFreq, 0.07);
        crackClick(ctx, dest, { start, peak: 0.4, roughness: roughness * 0.5 });
        noiseBurst(ctx, dest, {
            start, duration: crackDur,
            freq, freqEnd: 700, Q: jitter(0.8, 0.2),
            decay: crackDur * 0.7, peak: jitter(0.85, 0.06),
            roughness
        });
        if (bodyFreq) {
            if (preset?.mechanical) {
                subBoom(ctx, dest, { start, duration: crackDur * 1.3, freqStart: jitter(bodyFreq, 0.1), freqEnd: bodyFreq * 0.4, peak: boomPeak * 0.93, roughness: roughness * boomRoughnessMult });
                subBoom(ctx, dest, { start: start + crackDur * 0.35, duration: crackDur, freqStart: jitter(bodyFreq * 0.7, 0.1), freqEnd: bodyFreq * 0.3, peak: boomPeak * 0.53 });
            } else {
                subBoom(ctx, dest, { start, duration: crackDur * 1.3, freqStart: jitter(bodyFreq, 0.1), freqEnd: bodyFreq * 0.4, peak: boomPeak, roughness: roughness * boomRoughnessMult });
            }
        }
    }
    return totalSec + crackDur;
}

function synthSpray(ctx, dest, profile) {
    const preset = getPreset(profile);
    const dur = jitter(0.32);
    const freq = jitter(preset?.freq ?? 1600, 0.08);
    crackClick(ctx, dest, { start: 0, peak: 0.6 });
    noiseBurst(ctx, dest, { start: 0, duration: dur, freq, freqEnd: 200, Q: jitter(0.6, 0.15), decay: dur, peak: 1, roughness: preset?.roughness ?? 0 });
    const boomFreq = jitter(preset?.subBoomFreq ?? 110, 0.1);
    subBoom(ctx, dest, { start: 0, duration: dur * 1.2, freqStart: boomFreq, freqEnd: boomFreq * 0.36, peak: 0.7 });
    return dur + 0.1;
}

function synthSlash(ctx, dest, profile) {
    const preset = getPreset(profile);
    const dur = jitter((profile.radius ?? 20) / 60);
    const freqStart = jitter(preset?.freqStart ?? 900, 0.1);
    const freqEnd = jitter(preset?.freqEnd ?? 3200, 0.08);
    const q = jitter(preset?.q ?? 3, 0.15);
    noiseBurst(ctx, dest, { start: 0, duration: dur, filterType: "bandpass", freq: freqStart, freqEnd, Q: q, decay: dur, peak: 0.35 });

    let tail = dur;
    if (preset?.metallic) {
        const ringStart = dur * 0.65;
        const ringDecay = jitter(preset.ringDecay ?? 0.2, 0.15);
        metallicRing(ctx, dest, { start: ringStart, basePitch: jitter(preset.ringPitch ?? 1200, 0.06), decay: ringDecay, peak: 0.32 });
        tail = ringStart + ringDecay;
    }
    return tail + 0.05;
}

function synthArc(ctx, dest, profile) {
    const preset = getPreset(profile);
    const totalSec = profile.durationMs / 1000;
    const radius = profile.impactRadius ?? 30;
    const boomFreqBase = preset?.boomFreq ?? Math.max(30, 90 - radius * 0.6);

    const launchDur = Math.min(0.35, totalSec * 0.25);
    if (preset?.mutedLaunch) {
        subBoom(ctx, dest, { start: 0, duration: launchDur, freqStart: jitter(200, 0.15), freqEnd: jitter(90, 0.15), peak: 0.35 });
    } else {
        noiseBurst(ctx, dest, { start: 0, duration: launchDur, freq: jitter(500, 0.1), freqEnd: jitter(1800, 0.1), Q: jitter(0.8, 0.15), decay: launchDur, peak: 0.5 });
    }

    const impactAt = totalSec * 0.8;
    const boomDur = jitter((0.3 + radius / 60) * (preset?.crackBoost ?? 1));
    const boomFreq = jitter(boomFreqBase, 0.1);
    const roughness = Math.max(preset?.roughness ?? 0, 0.15);
    const boomPeak = Math.min(1, 0.65 + radius / 100);
    subBoom(ctx, dest, { start: impactAt, duration: boomDur, freqStart: boomFreq * 2.2, freqEnd: boomFreq * 0.5, peak: boomPeak, roughness });
    noiseBurst(ctx, dest, { start: impactAt, duration: boomDur * 0.7, freq: 900, freqEnd: 150, Q: 0.6, decay: boomDur * 0.6, peak: Math.min(1, 0.55 + radius / 80), roughness });
    if (preset?.echo) {
        boomEcho(ctx, dest, { start: impactAt, freqStart: boomFreq * 2.2, freqEnd: boomFreq * 0.5, duration: boomDur, peak: boomPeak, roughness });
    }
    return impactAt + boomDur + (preset?.echo ? 0.4 : 0.1);
}

function synthRocket(ctx, dest, profile) {
    const preset = getPreset(profile);
    const totalSec = profile.durationMs / 1000;
    const flightDur = totalSec * 0.75;
    const flightFreqStart = preset?.whine ? 1200 : 700;
    tone(ctx, dest, { start: 0, duration: flightDur, freqStart: jitter(flightFreqStart, 0.06), freqEnd: jitter(300, 0.1), type: preset?.whine ? "square" : "sawtooth", peak: 0.22, filterFreq: 1200 });
    noiseBurst(ctx, dest, { start: 0, duration: flightDur, filterType: "highpass", freq: jitter(2000, 0.1), Q: 0.5, decay: flightDur, peak: 0.25 });

    const blast = profile.blastRadius ?? 40;
    const boomFreqBase = preset?.boomFreq ?? Math.max(28, 80 - blast * 0.5);
    const boomDur = jitter((0.35 + blast / 55) * (preset?.crackBoost ?? 1));
    const boomFreq = jitter(boomFreqBase, 0.1);
    const roughness = preset?.roughness ?? 0;
    const boomPeak = Math.min(1, 0.55 + blast / 100);
    subBoom(ctx, dest, { start: flightDur, duration: boomDur, freqStart: boomFreq * 2.5, freqEnd: boomFreq * 0.5, peak: boomPeak, roughness });
    noiseBurst(ctx, dest, { start: flightDur, duration: boomDur * 0.7, freq: 1000, freqEnd: 150, Q: 0.6, decay: boomDur * 0.6, peak: Math.min(1, 0.45 + blast / 90), roughness });
    if (preset?.echo) {
        boomEcho(ctx, dest, { start: flightDur, freqStart: boomFreq * 2.5, freqEnd: boomFreq * 0.5, duration: boomDur, peak: boomPeak, roughness });
    }
    return flightDur + boomDur + (preset?.echo ? 0.4 : 0.15);
}

function synthExplosion(ctx, dest, profile) {
    const preset = getPreset(profile);
    const fuseSec = (profile.fuseMs ?? 150) / 1000;
    for (let t = 0; t < fuseSec; t += 0.08) {
        fuseTick(ctx, dest, { start: t, peak: 0.15 });
    }
    const blast = profile.blastRadius ?? 45;
    const boomFreqBase = preset?.boomFreq ?? Math.max(28, 85 - blast * 0.5);
    const boomDur = jitter((0.4 + blast / 50) * (preset?.crackBoost ?? 1));
    const boomFreq = jitter(boomFreqBase, 0.1);
    const roughness = preset?.roughness ?? 0;
    subBoom(ctx, dest, { start: fuseSec, duration: boomDur, freqStart: boomFreq * 2.5, freqEnd: boomFreq * 0.5, peak: Math.min(1, 0.55 + blast / 90), roughness });
    noiseBurst(ctx, dest, { start: fuseSec, duration: boomDur * 0.8, freq: 1100, freqEnd: 140, Q: 0.6, decay: boomDur * 0.7, peak: Math.min(1, 0.5 + blast / 80), roughness });
    return fuseSec + boomDur + 0.15;
}

function synthDrone(ctx, dest, profile) {
    const preset = getPreset(profile);
    const totalSec = profile.durationMs / 1000;
    const approach = (profile.approach ?? 0.7) * totalSec;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = "triangle"; oscB.type = "triangle";
    oscA.frequency.value = jitter(preset?.humFreqA ?? 220, 0.04);
    oscB.frequency.value = jitter(preset?.humFreqB ?? 226, 0.04);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.18, 0.15);
    gain.gain.setValueAtTime(0.18, Math.max(0.15, approach - 0.1));
    gain.gain.linearRampToValueAtTime(0.0001, approach);
    oscA.connect(gain); oscB.connect(gain); gain.connect(dest);
    oscA.start(0); oscB.start(0);
    oscA.stop(approach + 0.05); oscB.stop(approach + 0.05);

    const blast = profile.blastRadius ?? 50;
    const boomFreqBase = preset?.boomFreq ?? Math.max(28, 80 - blast * 0.5);
    const boomDur = jitter(0.35 + blast / 55);
    const boomFreq = jitter(boomFreqBase, 0.1);
    const roughness = preset?.roughness ?? 0;
    subBoom(ctx, dest, { start: approach, duration: boomDur, freqStart: boomFreq * 2.5, freqEnd: boomFreq * 0.5, peak: Math.min(1, 0.55 + blast / 100), roughness });
    noiseBurst(ctx, dest, { start: approach, duration: boomDur * 0.7, freq: 1000, freqEnd: 150, Q: 0.6, decay: boomDur * 0.6, peak: Math.min(1, 0.45 + blast / 90), roughness });
    return approach + boomDur + 0.15;
}

function synthNuclear(ctx, dest, profile) {
    const preset = getPreset(profile);
    const totalSec = profile.durationMs / 1000;
    const fuseSec = (profile.fuseMs ?? 300) / 1000;
    const flashSec = (profile.flashMs ?? 350) / 1000;

    for (let t = 0; t < fuseSec; t += 0.1) {
        fuseTick(ctx, dest, { start: t, peak: 0.12 });
    }

    const flashAt = fuseSec;
    noiseBurst(ctx, dest, { start: flashAt, duration: flashSec, filterType: "highpass", freq: 1500, Q: 0.4, decay: flashSec, peak: 1 });

    const rumbleAt = flashAt + flashSec * 0.3;
    const blast = profile.blastRadius ?? 150;
    const rumbleDur = Math.max(1.2, totalSec - rumbleAt) * (preset?.crackBoost ?? 1);
    const rumbleFreqBase = preset?.boomFreq ?? Math.max(18, 55 - blast * 0.12);
    const rumbleFreq = jitter(rumbleFreqBase, 0.08);
    const roughness = preset?.roughness ?? 0;
    subBoom(ctx, dest, { start: rumbleAt, duration: rumbleDur, freqStart: rumbleFreq * 3, freqEnd: rumbleFreq * 0.4, peak: 1, roughness });
    noiseBurst(ctx, dest, { start: rumbleAt, duration: rumbleDur, filterType: "lowpass", freq: 300, freqEnd: 60, Q: 0.5, decay: rumbleDur, peak: 0.85, roughness });
    subBoom(ctx, dest, { start: rumbleAt + rumbleDur * 0.35, duration: rumbleDur * 0.6, freqStart: rumbleFreq * 1.6, freqEnd: rumbleFreq * 0.3, peak: 0.5, roughness: roughness * 0.7 });
    if (preset?.echo) {
        boomEcho(ctx, dest, { start: rumbleAt, freqStart: rumbleFreq * 3, freqEnd: rumbleFreq * 0.4, duration: rumbleDur * 0.6, peak: 0.7, roughness, repeats: 3 });
    }

    return rumbleAt + rumbleDur + (preset?.echo ? 0.6 : 0.2);
}

function synthBeam(ctx, dest, profile) {
    const preset = getPreset(profile);
    const dur = profile.durationMs / 1000;
    const width = profile.beamWidth ?? 3;
    const baseFreq = jitter(preset?.toneFreq ?? 900 + width * 60, 0.05);
    tone(ctx, dest, { start: 0, duration: dur, freqStart: baseFreq, freqEnd: baseFreq * 0.6, type: "sawtooth", peak: 0.3, filterFreq: 2200 });
    tone(ctx, dest, { start: 0, duration: dur, freqStart: 1400, freqEnd: 1100, type: "square", peak: 0.08, filterFreq: 3000 });
    return dur + 0.1;
}

function synthFlame(ctx, dest, profile) {
    const preset = getPreset(profile);
    const dur = profile.durationMs / 1000;
    const base = jitter(preset?.baseFreq ?? 700, 0.06);
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, dur + 0.1);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(base, 0);
    filter.frequency.linearRampToValueAtTime(base * 1.28, dur);

    const lfo = ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 7;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.15;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.5, 0.08);
    gain.gain.setValueAtTime(0.5, Math.max(0.08, dur - 0.1));
    gain.gain.linearRampToValueAtTime(0.0001, dur);

    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(filter).connect(gain).connect(dest);
    lfo.start(0); lfo.stop(dur + 0.1);
    src.start(0); src.stop(dur + 0.15);
    return dur + 0.2;
}

const SYNTH_BY_KIND = {
    tracer: synthTracer,
    burst: synthBurst,
    spray: synthSpray,
    slash: synthSlash,
    arc: synthArc,
    rocket: synthRocket,
    explosion: synthExplosion,
    drone: synthDrone,
    nuclear: synthNuclear,
    beam: synthBeam,
    flame: synthFlame
};

function weaponHasAudio(data) {
    return !!data && !data.silent && !!SYNTH_BY_KIND[data.kind];
}

function estimateTailSeconds(profile) {
    const base = (profile.durationMs ?? 800) / 1000;
    if (profile.kind === "nuclear") return base + 3.2;
    if (profile.kind === "explosion" || profile.kind === "rocket" || profile.kind === "drone" || profile.kind === "arc") return base + 1.8;
    return base + 0.6;
}

async function renderWeaponBuffer(profile) {
    if (!weaponHasAudio(profile)) return null;
    const synthFn = SYNTH_BY_KIND[profile.kind];

    const sampleRate = 44100;
    const lengthSec = estimateTailSeconds(profile);
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(sampleRate * lengthSec), sampleRate);

    const limiter = offlineCtx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.15;
    limiter.connect(offlineCtx.destination);

    synthFn(offlineCtx, limiter, profile);
    return await offlineCtx.startRendering();
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const numFrames = buffer.length;
    const dataSize = numFrames * blockAlign;

    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    function writeString(offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channelData = [];
    for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));

    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
}

function floatTo16BitPCM(channelData) {
    const out = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
}

function audioBufferToMp3(buffer, kbps = 128) {
    const samples = floatTo16BitPCM(buffer.getChannelData(0));
    const encoder = new lamejs.Mp3Encoder(1, buffer.sampleRate, kbps);
    const blockSize = 1152;
    const chunks = [];
    for (let i = 0; i < samples.length; i += blockSize) {
        const chunk = samples.subarray(i, i + blockSize);
        const mp3buf = encoder.encodeBuffer(chunk);
        if (mp3buf.length > 0) chunks.push(mp3buf);
    }
    const finalBuf = encoder.flush();
    if (finalBuf.length > 0) chunks.push(finalBuf);
    return new Blob(chunks, { type: "audio/mp3" });
}

function encodeAudio(buffer, format) {
    return format === "mp3" ? audioBufferToMp3(buffer) : audioBufferToWav(buffer);
}

function getLiveContext() {
    if (!liveCtx) liveCtx = new (window.AudioContext || window.webkitAudioContext)();
    return liveCtx;
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function setMode(mode) {
    currentMode = mode;
    const isDossier = mode === 'dossier';
    tabDossierBtn.classList.toggle('active', isDossier);
    tabExportBtn.classList.toggle('active', !isDossier);
    dossierPane.style.display = isDossier ? 'flex' : 'none';
    exportPane.style.display = isDossier ? 'none' : 'flex';
    dossierNav.style.display = isDossier ? 'block' : 'none';
    registryGroup.style.display = isDossier ? 'flex' : 'none';
}
tabDossierBtn.addEventListener('click', () => setMode('dossier'));
tabExportBtn.addEventListener('click', () => setMode('export'));

jsonUpload.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    const failed = [];
    const overwritten = new Set();

    for (const file of files) {
        const text = await file.text();
        try {
            const data = JSON.parse(text);
            const validEntries = Object.entries(data).filter(([, p]) => p && typeof p === 'object' && p.kind);
            if (validEntries.length === 0) {
                failed.push(file.name);
                continue;
            }
            for (const [key, profile] of validEntries) {
                if (arsenal[key]) overwritten.add(key);
                arsenal[key] = profile;
            }
        } catch (err) {
            failed.push(file.name);
        }
    }

    let statusLines = [];
    if (failed.length) statusLines.push(`Rejected invalid JSON: ${failed.join(', ')}`);
    if (overwritten.size) statusLines.push(`Overwritten keys: ${Array.from(overwritten).join(', ')}`);
    uploadStatus.className = 'upload-status' + (failed.length || overwritten.size ? ' warn' : '');
    uploadStatus.innerHTML = statusLines.join('<br>');

    populateNationFilter();
    renderRegistry();
    updateExportStats();
});

function populateNationFilter() {
    const current = nationFilter.value;
    const nations = [...new Set(Object.values(arsenal).map(w => w.meta?.nation).filter(Boolean))].sort();
    nationFilter.innerHTML = '<option value="">All Nations</option>' + nations.map(n => `<option value="${n}">${n}</option>`).join('');
    if (nations.includes(current)) nationFilter.value = current;
}

function renderRegistry() {
    const query = searchBox.value.toLowerCase();
    const nation = nationFilter.value;
    const sortMode = sortSelect.value;
    weaponListContainer.innerHTML = '';

    const allKeys = Object.keys(arsenal);
    const keys = allKeys.filter(key => {
        const note = (arsenal[key].meta?.note || '').toLowerCase();
        const matchesQuery = key.toLowerCase().includes(query) || note.includes(query);
        const matchesNation = !nation || arsenal[key].meta?.nation === nation;
        return matchesQuery && matchesNation;
    });

    if (sortMode === 'flesh') {
        keys.sort((a, b) => (arsenal[b].damage?.flesh ?? -Infinity) - (arsenal[a].damage?.flesh ?? -Infinity));
    } else if (sortMode === 'metal') {
        keys.sort((a, b) => (arsenal[b].damage?.metal ?? -Infinity) - (arsenal[a].damage?.metal ?? -Infinity));
    } else if (sortMode === 'accuracy') {
        keys.sort((a, b) => (arsenal[b].accuracy ?? -Infinity) - (arsenal[a].accuracy ?? -Infinity));
    } else {
        keys.sort();
    }

    registryCount.textContent = allKeys.length
        ? `${keys.length} of ${allKeys.length} units shown`
        : '';

    if (!allKeys.length) {
        weaponListContainer.innerHTML = '<p class="empty-note">No data loaded.<br>Upload one or more JSON files to begin.</p>';
        return;
    }

    if (!keys.length) {
        weaponListContainer.innerHTML = '<p class="empty-note">No units match this filter.</p>';
        return;
    }

    keys.forEach(key => {
        const km = kindMeta(arsenal[key].kind);
        const div = document.createElement('div');
        div.className = 'weapon-item';
        div.style.setProperty('--kind', km.color);
        div.innerHTML = `<span class="w-name">${key.replace(/_/g, ' ')}</span><span class="w-kind">${arsenal[key].kind || ''}</span>`;
        div.onclick = () => {
            document.querySelectorAll('.weapon-item').forEach(i => i.classList.remove('active'));
            div.classList.add('active');
            inspectWeapon(key);
        };
        weaponListContainer.appendChild(div);
    });
}

function buildStatEntries(data) {
    const entries = [];

    if (data.damage?.flesh !== undefined) entries.push({ label: 'Flesh Damage', val: data.damage.flesh });
    if (data.damage?.metal !== undefined) entries.push({ label: 'Metal Damage', val: data.damage.metal });
    if (data.accuracy !== undefined) entries.push({ label: 'Accuracy', val: (data.accuracy * 100).toFixed(0) + '%' });
    if (data.durationMs !== undefined) entries.push({ label: 'Duration', val: data.durationMs + ' ms' });

    const EXCLUDE = new Set(['kind', 'meta', 'audio', 'damage', 'accuracy', 'durationMs']);

    Object.keys(data).forEach(key => {
        if (EXCLUDE.has(key)) return;
        const raw = data[key];
        if (raw === null || raw === undefined || raw === '') return;

        let val = raw;
        let swatch = null;

        if (typeof raw === 'boolean') {
            val = raw ? 'Yes' : 'No';
        } else if (typeof raw === 'number' && /Ms$/.test(key)) {
            val = raw + ' ms';
        } else if (/color/i.test(key)) {
            swatch = parseColorForCSS(raw);
        }

        entries.push({ label: formatLabel(key), val, swatch });
    });

    return entries;
}

function inspectWeapon(key) {
    const data = arsenal[key];
    const km = kindMeta(data.kind);
    currentKey = key;

    previewEmpty.style.display = 'none';
    document.getElementById('headerArea').style.opacity = 1;
    document.getElementById('mainToken').style.opacity = 1;
    document.getElementById('metaSection').style.display = 'block';

    document.getElementById('displayName').innerText = key.replace(/_/g, ' ');
    document.getElementById('weaponKind').innerText = data.kind || 'GENERAL';
    document.getElementById('eyebrowText').innerText = `Unit ${key}`.replace(/_/g, ' ');

    const pill = document.getElementById('kindPill');
    pill.innerText = data.kind || 'UNCLASSIFIED';
    pill.style.setProperty('--kind', km.color);

    const stamp = document.getElementById('stampTag');
    stamp.innerText = km.label;

    const mainToken = document.getElementById('mainToken');
    mainToken.style.setProperty('--kind', km.color);
    mainToken.classList.toggle('hazard', data.kind === 'nuclear');

    const readout = document.getElementById('readoutRow');
    readout.innerHTML = '';
    if (data.damage?.flesh !== undefined) {
        readout.innerHTML += `<div class="dmg-block"><div class="dmg-val">${data.damage.flesh}</div><div class="dmg-label">Flesh</div></div>`;
    }
    if (data.damage?.metal !== undefined) {
        readout.innerHTML += `<div class="dmg-block"><div class="dmg-val secondary">${data.damage.metal}</div><div class="dmg-label">Metal</div></div>`;
    }

    audioRow.style.display = 'flex';
    if (weaponHasAudio(data)) {
        audioControls.style.display = 'flex';
        audioNoneMsg.style.display = 'none';
    } else {
        audioControls.style.display = 'none';
        audioNoneMsg.style.display = 'inline';
    }

    const grid = document.getElementById('propGrid');
    grid.innerHTML = '';
    buildStatEntries(data).forEach(p => {
        const swatchHtml = p.swatch ? `<span class="swatch" style="background:${p.swatch}"></span>` : '';
        grid.innerHTML += `<div class="prop-box" style="--kind:${km.color}"><small>${p.label}</small><span>${swatchHtml}${p.val}</span></div>`;
    });

    const metaDiv = document.getElementById('metaContent');
    metaDiv.innerHTML = '';

    if (data.meta) {
        Object.entries(data.meta).forEach(([mKey, mVal]) => {
            metaDiv.innerHTML += `<div class="meta-row"><strong>${formatLabel(mKey)}</strong><span>${mVal}</span></div>`;
        });
    }

    if (data.audio) {
        Object.entries(data.audio).forEach(([aKey, aVal]) => {
            const val = typeof aVal === 'boolean' ? (aVal ? 'Yes' : 'No') : aVal;
            metaDiv.innerHTML += `<div class="meta-row"><strong>${formatLabel(aKey)}</strong><span>${val}</span></div>`;
        });
    }

    if (!data.meta && !data.audio) {
        metaDiv.innerHTML = '<p class="meta-empty">No dossier notes recorded for this unit.</p>';
    }

    document.getElementById('dossierPane').scrollTop = 0;
}

playBtn.addEventListener('click', async () => {
    if (!currentKey) return;
    playBtn.disabled = true;
    const buffer = await renderWeaponBuffer(arsenal[currentKey]);
    playBtn.disabled = false;
    if (!buffer) return;
    const ctx = getLiveContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyser.connect(ctx.destination);

    liveScope.style.display = 'block';
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    let rafId;
    function drawLiveScope() {
        analyser.getByteFrequencyData(freqData);
        const w = liveScope.width, h = liveScope.height;
        liveScopeCtx.fillStyle = '#0a0b07';
        liveScopeCtx.fillRect(0, 0, w, h);
        const barWidth = w / freqData.length;
        liveScopeCtx.fillStyle = '#ffb100';
        for (let i = 0; i < freqData.length; i++) {
            const barHeight = (freqData[i] / 255) * h;
            liveScopeCtx.fillRect(i * barWidth, h - barHeight, barWidth - 1, barHeight);
        }
        rafId = requestAnimationFrame(drawLiveScope);
    }
    drawLiveScope();
    src.onended = () => cancelAnimationFrame(rafId);
    src.start();
});

downloadBtn.addEventListener('click', async () => {
    if (!currentKey) return;
    const format = audioFormatSelect.value;
    const buffer = await renderWeaponBuffer(arsenal[currentKey]);
    if (!buffer) return;
    triggerDownload(encodeAudio(buffer, format), `${currentKey}.${format}`);
});

function updateExportStats() {
    const keys = Object.keys(arsenal);
    const total = keys.length;
    const audible = keys.filter(k => weaponHasAudio(arsenal[k])).length;
    statTotal.textContent = total;
    statAudible.textContent = audible;
    statSilent.textContent = total - audible;
    generateAllBtn.disabled = audible === 0;
}

async function generateAllAndZip() {
    const format = exportFormatSelect.value;
    generateAllBtn.disabled = true;

    const zip = new JSZip();
    const folder = zip.folder('weapon-sounds');
    const entries = Object.entries(arsenal).filter(([, p]) => weaponHasAudio(p));
    let done = 0;

    for (const [key, profile] of entries) {
        exportProgress.textContent = `${++done} / ${entries.length} — ${key}`;
        const buffer = await renderWeaponBuffer(profile);
        if (buffer) {
            drawExportScope(buffer);
            folder.file(`${key}.${format}`, encodeAudio(buffer, format));
        }
    }

    exportProgress.textContent = 'Compressing archive...';
    const content = await zip.generateAsync({ type: 'blob' });
    triggerDownload(content, 'weapon-sounds.zip');

    exportProgress.textContent = `Done — ${entries.length} audio files exported.`;
    generateAllBtn.disabled = false;
}
generateAllBtn.addEventListener('click', generateAllAndZip);

function drawExportScope(buffer) {
    const w = exportScope.width, h = exportScope.height;
    exportScopeCtx.fillStyle = '#0a0b07';
    exportScopeCtx.fillRect(0, 0, w, h);
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    exportScopeCtx.strokeStyle = '#ffb100';
    exportScopeCtx.lineWidth = 1;
    exportScopeCtx.beginPath();
    for (let x = 0; x < w; x++) {
        const idx = x * step;
        const v = data[idx] ?? 0;
        const y = h / 2 - v * (h / 2 - 2);
        if (x === 0) exportScopeCtx.moveTo(x, y); else exportScopeCtx.lineTo(x, y);
    }
    exportScopeCtx.stroke();
}
drawExportScope(null);

const DEFAULT_WEAPON_FILES = [
    'small_arms.json', 'automatic_weapons.json', 'melee.json',
    'tank_shells.json', 'artillery.json', 'special_weapons.json',
    'naval.json', 'air.json'
];

async function autoLoad() {
    const attempts = await Promise.all(DEFAULT_WEAPON_FILES.map(async (fname) => {
        try {
            const res = await fetch(`./${fname}`);
            if (!res.ok) return null;
            return { fname, data: await res.json() };
        } catch (e) {
            return null;
        }
    }));

    const loaded = attempts.filter(Boolean);
    if (loaded.length === 0) return;

    for (const { data } of loaded) Object.assign(arsenal, data);
    const names = loaded.map(l => l.fname).join(', ');
    uploadStatus.className = 'upload-status';
    uploadStatus.textContent = `Auto-loaded ${loaded.length}/${DEFAULT_WEAPON_FILES.length} files (${names}) — ${Object.keys(arsenal).length} units.`;
    populateNationFilter();
    renderRegistry();
    updateExportStats();
}

searchBox.addEventListener('input', renderRegistry);
nationFilter.addEventListener('change', renderRegistry);
sortSelect.addEventListener('change', renderRegistry);

autoLoad();
