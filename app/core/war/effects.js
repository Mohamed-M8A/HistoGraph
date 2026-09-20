// ============================================================
// HISTOGRAPH — COMBAT EFFECTS SYSTEM
// ============================================================
// Headless pipeline for "what happens when a unit attacks another
// unit": what each weapon looks like (WEAPON PROFILES, loaded from
// the split weapons/*.json files) and how a fired effect instance
// is generated (createEffect), plus the list of currently playing
// effects tracked over time (EffectsManager). This module never
// touches the DOM, Canvas, or Web Audio directly; painting an
// effect onto a canvas is the responsibility of renderer/effects.js,
// and playing its sound is delegated to an optional callback (see
// AUDIO below) so this file has zero dependency on any audio API.
//
// TABLE OF CONTENTS
//   1. Random helpers
//   2. Sub-effect builders (smoke puffs, shots, pellets, trails...)
//   3. Weapon profiles registry (merged from weapons/*.json)
//   4. Effect factory (createEffect)
//   5. EffectsManager (lifecycle of active effects)
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
//   though this module never reads `meta` — it's informational
//   only.
//
// DAMAGE NOTE
//   Each weapon's `damage: { flesh, metal }` field is copied onto
//   every generated effect (effect.damage) via the `...profile`
//   spread in createEffect() below, purely so it's available to
//   whatever combat/hit-resolution code calls into this module.
//   This file itself never reads effect.damage or applies it to
//   anything — there is no hit detection or health logic here.
//   Actual damage application belongs in your combat/game-state
//   layer (units.js).
//
// AUDIO
//   Sound playback is not performed by this module. EffectsManager
//   accepts an optional onPlaySound(effectType) callback in its
//   constructor and invokes it for every non-silent effect it
//   creates; the caller is free to wire that callback to
//   soundManager.js or any other audio backend, or to omit it
//   entirely for a silent/headless run (e.g. server-side
//   simulation, automated tests).
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
//   4. That's it — createEffect() and renderer/effects.js already
//      know how to build/draw every kind generically.
//   If you need a genuinely new *look*, add a new "kind": give it
//   a case in createEffect()'s switch (step 4) and a
//   `_render<Kind>Effect` method in renderer/effects.js.
// ============================================================

import smallArms from "../../content/weapons/small_arms.json";
import automaticWeapons from "../../content/weapons/automatic_weapons.json";
import melee from "../../content/weapons/melee.json";
import tankShells from "../../content/weapons/tank_shells.json";
import artillery from "../../content/weapons/artillery.json";
import air from "../../content/weapons/air.json";
import naval from "../../content/weapons/naval.json";
import specialWeapons from "../../content/weapons/special_weapons.json";

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
  constructor(onPlaySound = null) {
    this.active = [];
    this.onPlaySound = onPlaySound;
  }

  add(effectType, fromX, fromY, toX, toY) {
    const effect = createEffect(effectType, fromX, fromY, toX, toY);
    this.active.push(effect);

    if (!effect.silent && this.onPlaySound) {
      this.onPlaySound(effect.effectType);
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
