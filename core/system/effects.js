// ============================================================
// HISTOGRAPH — COMBAT EFFECTS SYSTEM
// ============================================================
// Single-file pipeline for "what happens visually when a unit
// attacks another unit": what each weapon looks like (WEAPON
// PROFILES, loaded from the split weapons/*.json files), how a
// fired effect instance is generated (createEffect), how the list
// of currently playing effects is tracked over time (EffectsManager),
// and how each one is painted on the canvas every frame
// (EffectPainter). Sound playback itself lives in the standalone
// soundManager.js, imported below.
//
// TABLE OF CONTENTS
//   1. Random helpers
//   2. Sub-effect builders (smoke puffs, shots, pellets, trails...)
//   3. Weapon profiles registry (merged from weapons/*.json)
//   4. Effect factory (createEffect)
//   5. EffectsManager (lifecycle of active effects)
//   6. EffectPainter (canvas rendering, one method per "kind")
//
// KINDS, ROUGHLY EASIEST -> HARDEST TO EXTEND/RUN:
//   tracer < slash < beam < arc < burst < spray < flame < rocket
//   < drone < explosion < nuclear
//   (drone/explosion/rocket/nuclear carry the most per-effect
//   state: fuse timers, smoke trails, multi-stage cloud/shockwave
//   sequences.)
//
// WEAPON DATA FILES
//   All weapon numbers (durationMs, fire rate derived shotCount,
//   colors, radii, damage, audio tuning, etc.) live in
//   content/weapons/*.json, split by category (small_arms,
//   automatic_weapons, melee, tank_shells, artillery, air, naval,
//   special_weapons) instead of one inline object literal. Every
//   weapon key is unique across all 8 files, so they're merged
//   into one flat lookup below with no collisions.
//
//   Import syntax depends on your bundler/runtime:
//     - Webpack / Vite / Rollup / most bundlers: the plain imports
//       below work as-is.
//     - Native ESM (browser / Node with import assertions): add the
//       `with { type: "json" }` clause to each import statement.
//
// FIRE-RATE ACCURACY NOTE
//   For "burst" kind weapons, shotCount is derived from each gun's
//   real-world cyclic rate (RPM) rather than picked by eye:
//     shotCount = round( (realRpm / 60000) * (durationMs * 0.8) )
//   0.8 because buildShots() spreads shots across roughly the
//   first 80% of the effect's normalized timeline (see
//   buildShots() below). The realRpm used for each weapon is kept
//   in that weapon's `meta.realRpm` field for traceability, even
//   though the renderer itself never reads `meta` — it's
//   informational only.
//
// DAMAGE NOTE
//   Each weapon's `damage: { flesh, metal }` field is copied onto
//   every generated effect (effect.damage) via the `...profile`
//   spread in createEffect() below, purely so it's available to
//   whatever combat/hit-resolution code calls into this module.
//   This file itself never reads effect.damage or applies it to
//   anything — there is no hit detection or health logic here,
//   only visuals. Actual damage application belongs in your
//   combat/game-state layer (unitsEngine.js).
//
// AUDIO
//   Sound playback is handled entirely by soundManager.js (a
//   standalone module, no dependency on this file or on the weapon
//   JSON — it just takes weapon keys as strings). EffectsManager.add()
//   below calls soundManager.play(effect.effectType) for every
//   non-silent effect it creates.
//
// HOW TO ADD A NEW WEAPON
//   1. Pick an existing "kind" (tracer/arc/burst/slash/spray/
//      flame/beam/rocket/drone/explosion/nuclear) that matches how
//      you want it to look.
//   2. Add a new entry in the appropriate content/weapons/*.json
//      file, copying a similar weapon's fields and tweaking the
//      numbers/color.
//   3. Export its sound from the Weapon Sound Generator tool and
//      drop it at content/audio/<YOUR_NEW_KEY>.wav (or mark it
//      "silent": true if it shouldn't make noise).
//   4. That's it — createEffect(), EffectPainter, and SoundManager
//      already know how to build/draw/play every kind generically.
//   If you need a genuinely new *look*, add a new "kind": give it
//   a case in createEffect()'s switch (step 4) and a
//   `_render<Kind>Effect` method in EffectPainter (step 6).
// ============================================================

import smallArms from "../../content/weapons/small_arms.json";
import automaticWeapons from "../../content/weapons/automatic_weapons.json";
import melee from "../../content/weapons/melee.json";
import tankShells from "../../content/weapons/tank_shells.json";
import artillery from "../../content/weapons/artillery.json";
import air from "../../content/weapons/air.json";
import naval from "../../content/weapons/naval.json";
import specialWeapons from "../../content/weapons/special_weapons.json";
import { soundManager } from "./soundManager.js";

const weaponProfiles = {
  ...smallArms,
  ...automaticWeapons,
  ...melee,
  ...tankShells,
  ...artillery,
  ...air,
  ...naval,
  ...specialWeapons
};

export const DEFAULT_EFFECT_TYPE = "RIFLE";

// ============================================================
// COLOR PALETTE
// ============================================================
export const MUZZLE_COLORS = {
  BLUE:   "#1565c0",
  GREEN:  "#2e7d32",
  RED:    "#ff4444",
  ORANGE: "#ff9900",
  WHITE:  "#f5f5f5"
};

const COLOR_SUFFIX_MAP = {
  R: MUZZLE_COLORS.RED,
  B: MUZZLE_COLORS.BLUE,
  G: MUZZLE_COLORS.GREEN,
  O: MUZZLE_COLORS.ORANGE,
  W: MUZZLE_COLORS.WHITE
};

const SOOT_SMOKE = "40,40,40";
const DEFAULT_SMOKE = "150,150,150";

// ============================================================
// 1. RANDOM HELPERS
// ============================================================

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

// ============================================================
// 2. SUB-EFFECT BUILDERS
// ============================================================

function buildSmokePuffs(count, delayMin = 0, delayMax = 0.2) {
  const windDrift = randRange(-1.5, 1.5);
  return Array.from({ length: count }, () => {
    const isLarge = Math.random() < 0.3;
    return {
      angleJitter: randRange(-0.6, 0.6),
      speed: isLarge ? randRange(1.0, 3.0) : randRange(3.0, 7.0),
      startDelay: randRange(delayMin, delayMax),
      baseRadius: isLarge ? randRange(4, 7) : randRange(1, 3),
      growth: isLarge ? randRange(14, 22) : randRange(5, 10),
      drift: windDrift + randRange(-0.3, 0.3),
      turbulence: randRange(0.8, 1.2)
    };
  });
}

function buildShots(count, spreadAngle) {
  return Array.from({ length: count }, (_, i) => ({
    startDelay: (i / count) * randRange(0.6, 0.8),
    angleJitter: randRange(-spreadAngle, spreadAngle),
    intensity: randRange(0.7, 1.3)
  }));
}

function buildSprayPellets(count, spreadAngle) {
  return Array.from({ length: count }, () => ({
    angleJitter: randRange(-spreadAngle, spreadAngle),
    speedMod: randRange(0.7, 1.3)
  }));
}

function buildFlameParticles(count, coneAngle) {
  return Array.from({ length: count }, () => ({
    angleJitter: randRange(-coneAngle / 2, coneAngle / 2),
    startDelay: randRange(0, 0.5),
    size: randRange(4, 9)
  }));
}

function buildTrail(count) {
  return Array.from({ length: count }, (_, i) => ({
    offset: (i / count) * 0.8,
    size: randRange(3, 7)
  }));
}

function buildShockwaves(count) {
  return Array.from({ length: count }, (_, i) => ({
    delay: (i / count) * 0.4,
    speedMod: randRange(0.9, 1.3)
  }));
}

// ============================================================
// 3. WEAPON PROFILES REGISTRY
// ============================================================
export const effectProfiles = weaponProfiles;

// ============================================================
// 4. EFFECT FACTORY
// ============================================================

function resolveEffectType(rawType) {
  const match = /^(.+)_([RBGOW])$/.exec(rawType);
  if (match && effectProfiles[match[1]]) {
    return { type: match[1], colorOverride: COLOR_SUFFIX_MAP[match[2]] };
  }
  const type = effectProfiles[rawType] ? rawType : DEFAULT_EFFECT_TYPE;
  return { type, colorOverride: null };
}

export function createEffect(rawEffectType, fromX, fromY, toX, toY) {
  const { type, colorOverride } = resolveEffectType(rawEffectType);
  const profile = effectProfiles[type];
  const angle = Math.atan2(toY - fromY, toX - fromX);

  const effect = {
    ...profile,
    color: colorOverride ?? profile.color,
    effectType: type,
    fromX,
    fromY,
    toX,
    toY,
    angle,
    createdAt: performance.now(),
    flashScale: randRange(0.7, 1.4),
    flashBrightness: randRange(0.85, 1.0),
    seed: Math.random()
  };

  switch (profile.kind) {
    case "tracer":
      effect.smokePuffs = buildSmokePuffs(profile.smokePuffCount ?? 0, profile.smokeDelayMin ?? 0, profile.smokeDelayMax ?? 0.2);
      effect.smokeColor = profile.smokeColor ?? DEFAULT_SMOKE;
      effect.flashSpikes = 5 + randInt(0, 5);
      effect.flashRotation = randRange(0, Math.PI * 2);
      break;

    case "arc":
      effect.arcHeight = profile.arcHeight * randRange(0.9, 1.1);
      effect.impactRadius = profile.impactRadius * randRange(0.8, 1.2);
      effect.projectileColor = profile.projectileColor ?? "#333333";
      effect.projectileSize = profile.projectileSize ?? 3;
      effect.smokePuffs = buildSmokePuffs(profile.smokePuffCount ?? 0, profile.smokeDelayMin ?? 0, profile.smokeDelayMax ?? 0.2);
      effect.smokeColor = profile.smokeColor ?? DEFAULT_SMOKE;
      break;

    case "burst":
      effect.shots = buildShots(profile.shotCount, profile.spreadAngle);
      effect.flashSpikes = 5 + randInt(0, 5);
      effect.flashRotation = randRange(0, Math.PI * 2);
      break;

    case "slash":
      effect.slashRotation = randRange(-0.5, 0.5);
      break;

    case "spray":
      effect.pellets = buildSprayPellets(profile.pelletCount, profile.spreadAngle);
      effect.flashSpikes = 5 + randInt(0, 5);
      effect.flashRotation = randRange(0, Math.PI * 2);
      break;

    case "flame":
      effect.particles = buildFlameParticles(profile.particleCount, profile.coneAngle);
      break;

    case "beam":
      break;

    case "rocket":
      effect.arcHeight = profile.arcHeight * randRange(0.9, 1.1);
      effect.blastRadius = profile.blastRadius * randRange(0.9, 1.1);
      effect.trail = buildTrail(profile.trailCount ?? 10);
      effect.shockwaves = buildShockwaves(profile.ringCount ?? 3);
      break;

    case "explosion":
      effect.blastRadius = profile.blastRadius * randRange(0.9, 1.1);
      effect.shockwaves = buildShockwaves(profile.ringCount ?? 3);
      break;

    case "drone":
      effect.approach = profile.approach ?? 0.7;
      effect.bodyColor = profile.bodyColor ?? "#2b2b2b";
      effect.blastRadius = profile.blastRadius * randRange(0.9, 1.1);
      effect.shockwaves = buildShockwaves(profile.ringCount ?? 4);
      effect.rotorPhase = randRange(0, Math.PI * 2);
      effect.bobSeed = randRange(0, Math.PI * 2);
      break;

    case "nuclear":
      effect.blastRadius = profile.blastRadius * randRange(0.95, 1.05);
      effect.shockwaves = buildShockwaves(profile.ringCount ?? 5);
      effect.cloudColor = profile.cloudColor ?? "40,40,40";
      effect.flashMs = profile.flashMs ?? 300;
      effect.cloudWobble = randRange(-0.15, 0.15);
      break;
  }

  return effect;
}

// ============================================================
// 5. EFFECTS MANAGER
// ============================================================
export class EffectsManager {
  constructor() {
    this.active = [];
  }

  add(effectType, fromX, fromY, toX, toY) {
    const effect = createEffect(effectType, fromX, fromY, toX, toY);
    this.active.push(effect);

    if (!effect.silent) {
      soundManager.play(effect.effectType);
    }

    return effect;
  }

  update(now) {
    this.active = this.active.filter((effect) => now - effect.createdAt <= effect.durationMs);
  }

  getActive() {
    return this.active;
  }
}

// ============================================================
// 6. EFFECT PAINTER
// ============================================================
export class EffectPainter {
  draw(ctx, effects, now, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    if (!effects?.length) return;
    for (const effect of effects) {
      this._renderEffect(ctx, effect, now, mapWidth, mapHeight, canvasWidth, canvasHeight);
    }
  }

  _renderEffect(ctx, effect, now, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    const t = (now - effect.createdAt) / effect.durationMs;
    if (t < 0 || t > 1) return;

    const [fx, fy] = this._toPixel(effect.fromX, effect.fromY, mapWidth, mapHeight, canvasWidth, canvasHeight);
    const [tx, ty] = this._toPixel(effect.toX, effect.toY, mapWidth, mapHeight, canvasWidth, canvasHeight);

    switch (effect.kind) {
      case "tracer":    this._renderTracerEffect(ctx, effect, t, fx, fy, tx, ty); break;
      case "arc":       this._renderArcEffect(ctx, effect, t, fx, fy, tx, ty); break;
      case "burst":     this._renderBurstEffect(ctx, effect, t, fx, fy, tx, ty); break;
      case "slash":     this._renderSlashEffect(ctx, effect, t, tx, ty); break;
      case "spray":     this._renderSprayEffect(ctx, effect, t, fx, fy); break;
      case "flame":     this._renderFlameEffect(ctx, effect, t, fx, fy); break;
      case "beam":      this._renderBeamEffect(ctx, effect, t, fx, fy, tx, ty); break;
      case "rocket":    this._renderRocketEffect(ctx, effect, t, fx, fy, tx, ty); break;
      case "explosion": this._renderExplosionEffect(ctx, effect, t, tx, ty); break;
      case "drone":     this._renderDroneEffect(ctx, effect, t, fx, fy, tx, ty); break;
      case "nuclear":   this._renderNuclearEffect(ctx, effect, t, tx, ty); break;
    }
  }

  _toPixel(x, y, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    return [(x / mapWidth) * canvasWidth, (y / mapHeight) * canvasHeight];
  }

  _drawSmoke(ctx, effect, t, fx, fy) {
    if (!effect.smokePuffs) return;
    const rgb = effect.smokeColor ?? DEFAULT_SMOKE;
    const scale = effect.smokeScale ?? 1;
    ctx.save();
    for (const p of effect.smokePuffs) {
      const age = (t - p.startDelay) / (1 - p.startDelay);
      if (age <= 0 || age > 1) continue;

      const size = (p.baseRadius + p.growth * age) * p.turbulence * scale;
      const alpha = (1 - age) * 0.4;
      const driftX = p.drift * age * 15;

      ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(fx + driftX, fy - age * 10, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawMuzzleFlash(ctx, effect, fx, fy, t) {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(effect.flashRotation);
    ctx.globalCompositeOperation = "lighter";
    const s = 16 * effect.flashScale * (1 - t * 6);

    ctx.fillStyle = effect.color;
    ctx.globalAlpha = effect.flashBrightness * 0.45;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = effect.flashBrightness;
    ctx.beginPath();
    for (let i = 0; i < effect.flashSpikes; i++) {
      const a = (i / effect.flashSpikes) * Math.PI * 2;
      const r = i % 2 === 0 ? s : s * 0.4;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.fill();
    ctx.restore();
  }

  _drawShockwaves(ctx, effect, blastT, tx, ty) {
    ctx.save();
    for (const ring of effect.shockwaves) {
      const age = (blastT - ring.delay) / (1 - ring.delay);
      if (age <= 0 || age > 1) continue;

      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 3 * (1 - age) + 1;
      ctx.globalAlpha = (1 - age) * 0.9;
      ctx.beginPath();
      ctx.arc(tx, ty, effect.blastRadius * age * ring.speedMod, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = Math.max(0, 1 - blastT * 3);
    ctx.beginPath();
    ctx.arc(tx, ty, effect.blastRadius * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _renderTracerEffect(ctx, effect, t, fx, fy, tx, ty) {
    this._drawSmoke(ctx, effect, t, fx, fy);

    const travelWindow = 0.1;
    const fadeWindow = 0.08;

    if (t <= travelWindow) {
      const headT = t / travelWindow;
      const tailT = Math.max(0, headT - 0.3);
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = effect.lineWidth;
      ctx.beginPath();
      ctx.moveTo(fx + (tx - fx) * tailT, fy + (ty - fy) * tailT);
      ctx.lineTo(fx + (tx - fx) * headT, fy + (ty - fy) * headT);
      ctx.stroke();
    } else if (t <= travelWindow + fadeWindow) {
      const fadeT = (t - travelWindow) / fadeWindow;
      ctx.save();
      ctx.globalAlpha = 1 - fadeT;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = effect.lineWidth;
      ctx.beginPath();
      ctx.moveTo(fx + (tx - fx) * 0.7, fy + (ty - fy) * 0.7);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();
    }

    if (t < travelWindow * 0.4 && !effect.silent) {
      this._drawMuzzleFlash(ctx, effect, fx, fy, t);
    }
  }

  _renderArcEffect(ctx, effect, t, fx, fy, tx, ty) {
    const flightT = Math.min(1, t / 0.8);
    const px = fx + (tx - fx) * flightT;
    const py = fy + (ty - fy) * flightT - Math.sin(flightT * Math.PI) * effect.arcHeight;

    ctx.fillStyle = effect.projectileColor;
    ctx.beginPath();
    ctx.arc(px, py, effect.projectileSize, 0, Math.PI * 2);
    ctx.fill();

    if (t > 0.8) {
      const impactT = (t - 0.8) / 0.2;
      this._drawSmoke(ctx, effect, impactT, tx, ty);
      ctx.save();
      ctx.strokeStyle = effect.color;
      ctx.globalAlpha = 1 - impactT;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(tx, ty, effect.impactRadius * impactT, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  _renderBurstEffect(ctx, effect, t, fx, fy, tx, ty) {
    const dist = Math.hypot(tx - fx, ty - fy);

    ctx.save();
    ctx.translate(fx, fy);

    for (const shot of effect.shots) {
      const shotT = (t - shot.startDelay) / (1 - shot.startDelay);
      if (shotT <= 0 || shotT > 0.5) continue;

      const travel = shotT / 0.5;
      const headDist = travel * dist;

      ctx.save();
      ctx.rotate(effect.angle + shot.angleJitter);
      ctx.fillStyle = effect.color;
      ctx.globalAlpha = (1 - travel) * shot.intensity;
      ctx.fillRect(headDist, -1, effect.shotLength, 2);
      ctx.restore();

      if (shotT < 0.12) this._drawMuzzleFlash(ctx, effect, 0, 0, shotT);
    }
    ctx.restore();
  }

  _renderSlashEffect(ctx, effect, t, tx, ty) {
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(effect.slashRotation);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
    ctx.beginPath();
    if (effect.thrust) {
      const extendT = Math.min(1, t / 0.4);
      const reach = t < 0.4 ? extendT : 1 - Math.min(0.3, (t - 0.4) / 0.6 * 0.3);
      ctx.moveTo(0, 0);
      ctx.lineTo(effect.radius * reach, 0);
    } else {
      const sweepT = Math.min(1, t / 0.55);
      ctx.arc(0, 0, effect.radius, -0.5, -0.5 + sweepT * 1.0);
    }
    ctx.stroke();
    ctx.restore();
  }

  _renderSprayEffect(ctx, effect, t, fx, fy) {
    const spreadT = Math.min(1, t / 0.35);
    const fadeT = Math.max(0, (t - 0.5) / 0.5);

    ctx.save();
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1 - fadeT;
    for (const pellet of effect.pellets) {
      const a = effect.angle + pellet.angleJitter;
      const len = effect.pelletLength * spreadT * pellet.speedMod;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(a) * len, fy + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();

    if (t < 0.08) this._drawMuzzleFlash(ctx, effect, fx, fy, t);
  }

  _renderFlameEffect(ctx, effect, t, fx, fy) {
    ctx.save();
    for (const p of effect.particles) {
      const age = (t - p.startDelay) / (1 - p.startDelay);
      if (age <= 0 || age > 1) continue;

      const dist = effect.range * age;
      const a = effect.angle + p.angleJitter;
      const px = fx + Math.cos(a) * dist;
      const py = fy + Math.sin(a) * dist;
      const size = p.size * (1 - age * 0.4);
      const color = age < 0.4 ? "#fff2a6" : age < 0.7 ? "#ff9933" : "#cc3300";

      ctx.fillStyle = color;
      ctx.globalAlpha = (1 - age) * 0.85;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _renderBeamEffect(ctx, effect, t, fx, fy, tx, ty) {
    const flicker = 0.75 + Math.random() * 0.25;
    const fadeOut = t < 0.9 ? 1 : (1 - t) / 0.1;

    ctx.save();
    ctx.globalAlpha = flicker * fadeOut;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = effect.beamWidth;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    ctx.fillStyle = effect.color;
    ctx.beginPath();
    ctx.arc(tx, ty, effect.beamWidth * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _renderRocketEffect(ctx, effect, t, fx, fy, tx, ty) {
    const flightT = Math.min(1, t / 0.75);
    const px = fx + (tx - fx) * flightT;
    const py = fy + (ty - fy) * flightT - Math.sin(flightT * Math.PI) * effect.arcHeight;

    ctx.save();
    for (const trail of effect.trail) {
      const age = flightT - trail.offset;
      if (age <= 0 || age > 1) continue;

      const trailPx = fx + (tx - fx) * age;
      const trailPy = fy + (ty - fy) * age - Math.sin(age * Math.PI) * effect.arcHeight;

      ctx.fillStyle = effect.trailColor;
      ctx.globalAlpha = (1 - age) * 0.35;
      ctx.beginPath();
      ctx.arc(trailPx, trailPy, trail.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (flightT < 1) {
      ctx.fillStyle = effect.color;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (t > 0.75) {
      const blastT = (t - 0.75) / 0.25;
      this._drawShockwaves(ctx, effect, blastT, tx, ty);
    }
  }

  _renderExplosionEffect(ctx, effect, t, tx, ty) {
    const fuseT = effect.fuseMs / effect.durationMs;

    if (t < fuseT) {
      ctx.save();
      ctx.strokeStyle = effect.color;
      ctx.globalAlpha = 0.4 + Math.sin(t * 40) * 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const blastT = (t - fuseT) / (1 - fuseT);
    this._drawShockwaves(ctx, effect, blastT, tx, ty);
  }

  // ------------------------------------------------------------
  // DRONE — flies in as a small quadcopter shape (body + 4 spinning
  // rotors linked by thin arms), oriented toward its flight
  // direction, then detonates on arrival (loitering-munition style).
  // ------------------------------------------------------------
  _renderDroneEffect(ctx, effect, t, fx, fy, tx, ty) {
    const approach = effect.approach ?? 0.7;

    if (t <= approach) {
      const flightT = t / approach;
      const bob = Math.sin(flightT * Math.PI * 3 + effect.bobSeed) * 4;
      const px = fx + (tx - fx) * flightT;
      const py = fy + (ty - fy) * flightT - bob;
      const angle = Math.atan2((ty - fy), (tx - fx));
      const spin = effect.rotorPhase + t * 90;

      this._drawDroneShape(ctx, px, py, angle, spin, effect);
      return;
    }

    const blastT = (t - approach) / (1 - approach);
    this._drawShockwaves(ctx, effect, blastT, tx, ty);
  }

  _drawDroneShape(ctx, px, py, angle, spin, effect) {
    const armLen = 9;
    const rotorRadius = 3;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);

    ctx.strokeStyle = effect.bodyColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-armLen, -armLen); ctx.lineTo(armLen, armLen);
    ctx.moveTo(-armLen, armLen);  ctx.lineTo(armLen, -armLen);
    ctx.stroke();

    ctx.fillStyle = effect.bodyColor;
    ctx.fillRect(-6, -3, 12, 6);

    const rotorPositions = [
      [-armLen, -armLen], [armLen, -armLen],
      [-armLen, armLen],  [armLen, armLen]
    ];
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    for (const [rx, ry] of rotorPositions) {
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(spin);
      ctx.beginPath();
      ctx.moveTo(-rotorRadius, 0); ctx.lineTo(rotorRadius, 0);
      ctx.moveTo(0, -rotorRadius); ctx.lineTo(0, rotorRadius);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = effect.color;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(8, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ------------------------------------------------------------
  // NUCLEAR — distinct multi-stage sequence: arming flicker, then
  // a blinding flash, then a rising stem + cap (mushroom cloud) in
  // a dark grey/black cloudColor, plus wide ground shockwaves.
  // ------------------------------------------------------------
  _renderNuclearEffect(ctx, effect, t, tx, ty) {
    const fuseT = effect.fuseMs / effect.durationMs;
    const flashT = effect.flashMs / effect.durationMs;

    if (t < fuseT) {
      ctx.save();
      ctx.strokeStyle = effect.color;
      ctx.globalAlpha = 0.4 + Math.sin(t * 40) * 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (t < fuseT + flashT) {
      const flashProgress = (t - fuseT) / flashT;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 1 - flashProgress;
      ctx.beginPath();
      ctx.arc(tx, ty, effect.blastRadius * (0.3 + flashProgress * 0.7), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this._drawShockwaves(ctx, effect, flashProgress * 0.3, tx, ty);
      return;
    }

    const cloudT = (t - fuseT - flashT) / (1 - fuseT - flashT);
    this._drawMushroomCloud(ctx, effect, cloudT, tx, ty);
    this._drawShockwaves(ctx, effect, Math.min(1, 0.3 + cloudT * 0.7), tx, ty);
  }

  _drawMushroomCloud(ctx, effect, cloudT, tx, ty) {
    const rgb = effect.cloudColor;
    const rise = effect.blastRadius * 2.2 * Math.min(1, cloudT * 1.3);
    const stemWidth = effect.blastRadius * 0.35;
    const capRadius = effect.blastRadius * (0.5 + cloudT * 0.6) * (1 + effect.cloudWobble * cloudT);
    const alpha = Math.max(0, 1 - Math.max(0, cloudT - 0.7) / 0.3);

    ctx.save();
    ctx.globalAlpha = alpha * 0.85;

    ctx.fillStyle = `rgba(${rgb}, 0.8)`;
    ctx.beginPath();
    ctx.moveTo(tx - stemWidth * 0.5, ty);
    ctx.lineTo(tx + stemWidth * 0.5, ty);
    ctx.lineTo(tx + stemWidth * 0.25, ty - rise);
    ctx.lineTo(tx - stemWidth * 0.25, ty - rise);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = `rgba(${rgb}, 0.75)`;
    ctx.beginPath();
    ctx.ellipse(tx, ty - rise, capRadius, capRadius * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(tx - capRadius * 0.4, ty - rise + capRadius * 0.2, capRadius * 0.5, capRadius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(tx + capRadius * 0.45, ty - rise + capRadius * 0.15, capRadius * 0.45, capRadius * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
