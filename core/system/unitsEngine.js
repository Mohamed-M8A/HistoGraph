// ============================================================
// HISTOGRAPH — UNITS ENGINE
// ============================================================
// Simulator-side logic for military units: loading unit type
// definitions from data files, spawning/moving/damaging/deleting
// unit instances, parsing and interpreting a tick-based scripting
// language that drives all of the above, and painting units onto
// the canvas. This file has no notion of "game rules" — it is a
// dumb executor of explicit commands (SPAWN/MOV/DEL/RM/FADE/ATK),
// same as effects.js is a dumb renderer of weapon effects. Any
// game-layer logic (AI, player restrictions, victory conditions)
// belongs outside this file and simply emits the same script
// syntax this file already understands.
//
// TABLE OF CONTENTS
//   1. Unit Registry — loading + country-prefixed merging
//   2. State Defaults & Factory
//   3. Unit Mutation Operations (spawn/move/fade/damage/delete)
//   4. Units Script Parsing
//   5. Tick Interpreter
//   6. Unit Painter
//
// ------------------------------------------------------------
// 1. UNIT REGISTRY
// ------------------------------------------------------------
// Unit type data lives under content/units/, split by country/era
// the same way weapons.json was split by category: one JSON file
// per country+era (e.g. content/units/europe/germany/ww2.json),
// referenced by a flat index file at content/units/units.json,
// e.g. { "DE_WW2": "europe/germany/ww2.json", "UK_WW2": "..." }.
//
// Unlike weapon keys (which are globally unique across every
// weapons/*.json file), unit type keys are only unique *within*
// their own country file — "INFANTRY" exists in nearly every
// country's file, each meaning something different. Merging them
// with a flat spread (like weapons.json's files) would silently
// overwrite one country's INFANTRY with another's. To prevent
// that, loadUnitsRegistry() prefixes every local key with its
// country/era code from the index, so the final registry key is
// always "<COUNTRY_ERA_CODE>_<LOCAL_KEY>", e.g. "DE_WW2_INFANTRY"
// or "US_WW2_TANK_BATTALION". This prefixed key is what SPAWN
// commands must reference.
//
// ------------------------------------------------------------
// UNIT TYPE SHAPE (what one entry inside a country file looks like)
// ------------------------------------------------------------
//   {
//     "flag": "<ISO country code, e.g. 'de'>",
//     "parentUnit": "<string or null>",
//     "soldiers": [
//       { "type": "<label>", "count": <n>, "healthPerUnit": <n>,
//         "weapon": "<weapon key>", "speed": <optional, 1-7> }
//     ],
//     "vehicles": [
//       { "type": "<label>", "count": <n>, "healthPerUnit": <n>,
//         "weapon": "<weapon key>", "speed": <optional, 1-7> }
//     ]
//   }
//
// soldiers[] and vehicles[] both use the identical shape on
// purpose (count/healthPerUnit/weapon/speed) so the engine can
// treat "how many distinct sub-types make up this unit" generically
// instead of hardcoding "soldiers behave like X, vehicles like Y".
// A unit can have any number of entries in either array — e.g. a
// tank battalion might list Sherman and Stuart as two separate
// vehicles[] entries with different counts/health/weapons, and a
// ranger battalion might list REGULAR and RANGER as two soldiers[]
// entries with different survivability.
//
// Every entry's optional "speed" (1-7 scale, same scale for both
// soldiers and vehicles) overrides a single hardcoded baseline
// speed constant (DEFAULT_UNIT_SPEED below) that plain infantry
// entries simply omit. A unit's overall movement speed (once wired
// into moveUnit's duration logic — not yet done here) is meant to
// be the *slowest* entry across all its soldiers/vehicles, since a
// formation only moves as fast as its slowest component. unitSpeed()
// below computes that minimum and is exposed for that future use;
// moveUnit() itself still takes an explicit durationMs and does not
// yet auto-compute it from distance/speed.
//
// ------------------------------------------------------------
// DUAL HEALTH POOLS (flesh vs metal)
// ------------------------------------------------------------
// Every spawned unit tracks two independent health pools:
//   health.flesh — total soldier health (sum of every soldiers[]
//                  entry's count * healthPerUnit)
//   health.metal — total vehicle health (sum of every vehicles[]
//                  entry's count * healthPerUnit)
// A pure infantry unit simply has an empty vehicles[] array, so its
// health.metal is 0 from the start — no special-casing needed
// anywhere else in the code.
//
// ------------------------------------------------------------
// COMBAT RESOLUTION (the ATK command)
// ------------------------------------------------------------
// When an ATK command fires without an explicit weapon, the engine
// picks the attacker's "dominant" weapon: whichever single entry
// (across both its soldiers[] and vehicles[] arrays) has the
// highest count. This represents the unit's overall character
// without requiring a separate top-level "defaultWeapon" field
// that would go stale the moment sub-types are added or resized.
//
// Once a weapon is chosen (explicit or dominant) and the effect is
// created (via the EffectsManager passed into UnitsInterpreter),
// two independent random rolls decide the outcome:
//   1. Accuracy roll — the weapon's `accuracy` field (0-1) is
//      rolled against Math.random(). A miss means the shot/effect
//      still plays visually and audibly (nothing about firing the
//      weapon changes), but no damage is applied at all.
//   2. Pool selection roll — on a hit, weaponFleshBias() computes
//      what fraction of the weapon's damage is "flesh-seeking"
//      purely from the weapon's own damage.flesh vs damage.metal
//      ratio (e.g. a rifle with high flesh/low metal damage mostly
//      hits the target's soldier pool; a tank shell with balanced
//      damage is roughly a coin flip). pickDamagePool() then rolls
//      against that bias to decide whether THIS hit's full damage
//      value lands on the target's flesh or metal pool. If one
//      pool is already fully depleted, the roll is skipped and the
//      hit is forced onto whichever pool still has health, so a
//      unit with no soldiers left can't "waste" hits rolling for a
//      pool that no longer exists.
// This means no unit type ever needs to declare its own "how
// exposed are my soldiers vs my vehicles" number — that behavior
// falls naturally out of whatever weapon is actually being fired
// at it.
//
// ------------------------------------------------------------
// PARENT-UNIT SPAWN CLUSTERING
// ------------------------------------------------------------
// A unit type may declare "parentUnit": "<some label>" to mark
// itself as belonging to a larger formation (e.g. several battalion
// types all sharing "US_WW2_3RD_ARMORED_BRIGADE" as their
// parentUnit). This is purely descriptive data owned by each small
// unit file — there is no separate "brigade" JSON schema and no
// brigade-level entry in any registry. The only thing the engine
// does with it is at SPAWN time: computeSpawnPosition() looks at
// how many other currently-active units already share the same
// parentUnit value, and places the new one into the next open slot
// of a simple grid centered on the requested (x, y), spaced
// PARENT_GROUP_SPACING map units apart. Units with no parentUnit
// (or a parentUnit no other active unit currently shares) spawn
// exactly at the requested coordinates, unaffected.
//
// This clustering is the ONLY thing parentUnit affects. Movement
// (MOV) and attacks (ATK) remain strictly per-unit — there is no
// "move the whole brigade" or "attack as a brigade" command, and
// none is planned here; any such orchestration belongs in a layer
// above this file, issuing individual MOV/ATK commands per unit ID
// exactly as it already can today.
//
// ------------------------------------------------------------
// 4-5. SCRIPT SYNTAX AND COMMANDS
// ------------------------------------------------------------
// Scripts are plain text, one or more ticks per line:
//   T<tick> <command> <args>; <command> <args>; ...
// Supported commands:
//   SPAWN <id> <type> <x> <y>
//   MOV <id> <x> <y> [duration]      (duration: e.g. 5S or 500MS)
//   DEL <id>                          (removes the unit)
//   RM <id>                           (identical to DEL — both are
//                                      plain deletions; any semantic
//                                      distinction between "deleted
//                                      in combat" vs "removed by an
//                                      editor" belongs to whichever
//                                      layer emits the script, not
//                                      to this engine)
//   FADE <id> <opacity> [duration]
//   ATK <id> <targetId> [weapon]      (weapon optional — see
//                                      dominant-weapon resolution
//                                      above)
// parseUnitsScript() turns this text into a sorted command list;
// UnitsInterpreter.onTick() walks that list and executes every
// command whose tick has arrived.
//
// ------------------------------------------------------------
// 6. UNIT PAINTER
// ------------------------------------------------------------
// Draws every unit in state.units onto the canvas as an image
// (asset.flag, resolved to content/assets/flags/circular/<flag>.svg)
// at its map position, scaled by UNIT_SCALE relative to one grid
// cell. Loaded images are cached so the same flag is never
// re-requested from the network. A unit whose image has not
// finished loading yet (or has no image) falls back to a plain red
// circle so it still renders on the map instead of being invisible.
// ============================================================

const UNITS_INDEX_PATH = "../../content/units/units.json";
const UNITS_BASE_PATH = "../../content/units/";
const UNITS_FLAG_BASE = "../../content/assets/flags/circular/";

// ============================================================
// 1. UNIT REGISTRY
// ============================================================
export let unitsRegistry = {};

export async function loadUnitsRegistry() {
  const indexRes = await fetch(new URL(UNITS_INDEX_PATH, import.meta.url));
  const index = await indexRes.json();

  const merged = {};
  for (const [countryCode, relativePath] of Object.entries(index)) {
    const countryRes = await fetch(new URL(UNITS_BASE_PATH + relativePath, import.meta.url));
    const countryUnits = await countryRes.json();
    for (const [localKey, asset] of Object.entries(countryUnits)) {
      merged[`${countryCode}_${localKey}`] = asset;
    }
  }

  unitsRegistry = merged;
  return unitsRegistry;
}

export function getUnitType(typeCode) {
  return unitsRegistry[typeCode] || null;
}

export function getAllowedTypeCodes() {
  return Object.keys(unitsRegistry);
}

export function getUnitAsset(typeCode) {
  return unitsRegistry[typeCode] || null;
}

// ============================================================
// 2. STATE DEFAULTS & FACTORY
// ============================================================
export const DEFAULT_MAP_WIDTH = 160;
export const DEFAULT_MAP_HEIGHT = 100;
export const DEFAULT_MOVEMENT_MODE = "relative";
export const DEFAULT_SEA_LEVEL = 0;
export const DEFAULT_TICK_DURATION_MS = 1000;
export const DEFAULT_UNIT_WEAPON = "RIFLE";
export const DEFAULT_UNIT_SPEED = 1;
export const PARENT_GROUP_SPACING = 3;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function createUnitsState(options = {}) {
  return {
    tick: 0,
    units: new Map(),
    terrain: null,
    elevation: null,
    mapWidth: options.mapWidth || DEFAULT_MAP_WIDTH,
    mapHeight: options.mapHeight || DEFAULT_MAP_HEIGHT,
    movementMode: options.movementMode || DEFAULT_MOVEMENT_MODE,
    seaLevel: options.seaLevel ?? DEFAULT_SEA_LEVEL,
    tickDurationMs: options.tickDurationMs || DEFAULT_TICK_DURATION_MS,
  };
}

// ============================================================
// 3. UNIT MUTATION OPERATIONS
// ============================================================
function sumPoolHealth(entries) {
  return (entries || []).reduce((sum, e) => sum + (e.count ?? 0) * (e.healthPerUnit ?? 1), 0);
}

function computeSpawnPosition(state, x, y, parentUnit) {
  if (!parentUnit) return { x, y };

  const siblings = [...state.units.values()].filter((u) => u.asset.parentUnit === parentUnit);
  const index = siblings.length;
  const cols = Math.ceil(Math.sqrt(index + 1));
  const row = Math.floor(index / cols);
  const col = index % cols;
  const offsetX = (col - (cols - 1) / 2) * PARENT_GROUP_SPACING;
  const offsetY = row * PARENT_GROUP_SPACING;

  return { x: x + offsetX, y: y + offsetY };
}

export function spawnUnit(state, id, typeCode, x, y) {
  const asset = getUnitAsset(typeCode);
  if (!asset) return false;
  if (state.units.has(id)) return false;

  const { x: spawnX, y: spawnY } = computeSpawnPosition(state, x, y, asset.parentUnit);
  const maxHealth = {
    flesh: sumPoolHealth(asset.soldiers),
    metal: sumPoolHealth(asset.vehicles),
  };

  state.units.set(id, {
    id,
    asset,
    x: clamp(spawnX, 0, state.mapWidth),
    y: clamp(spawnY, 0, state.mapHeight),
    targetX: spawnX,
    targetY: spawnY,
    moving: false,
    moveInit: false,
    requestedDurationMs: null,
    opacity: 1,
    targetOpacity: 1,
    fading: false,
    fadeInit: false,
    requestedFadeDurationMs: null,
    maxHealth,
    health: { flesh: maxHealth.flesh, metal: maxHealth.metal },
  });
  return true;
}

export function moveUnit(state, id, a, b, durationMs) {
  const unit = state.units.get(id);
  if (!unit) return false;
  const targetX = state.movementMode === "relative" ? unit.x + a : a;
  const targetY = state.movementMode === "relative" ? unit.y + b : b;
  unit.targetX = clamp(targetX, 0, state.mapWidth);
  unit.targetY = clamp(targetY, 0, state.mapHeight);
  unit.requestedDurationMs = durationMs ?? null;
  unit.moving = true;
  unit.moveInit = false;
  return true;
}

export function fadeUnit(state, id, targetOpacity, durationMs) {
  const unit = state.units.get(id);
  if (!unit) return false;
  unit.targetOpacity = clamp(targetOpacity, 0, 1);
  unit.requestedFadeDurationMs = durationMs ?? null;
  unit.fading = true;
  unit.fadeInit = false;
  return true;
}

export function damageUnit(state, id, pool, amount) {
  const unit = state.units.get(id);
  if (!unit) return false;
  unit.health[pool] = clamp(unit.health[pool] - amount, 0, unit.maxHealth[pool]);
  return true;
}

export function deleteUnit(state, id) {
  if (!state.units.has(id)) return false;
  state.units.delete(id);
  return true;
}

export function getSiblingUnits(state, parentUnit) {
  return [...state.units.values()].filter((u) => u.asset.parentUnit === parentUnit);
}

function allComponents(asset) {
  return [...(asset.soldiers || []), ...(asset.vehicles || [])];
}

export function dominantWeapon(asset) {
  const entries = allComponents(asset);
  if (entries.length === 0) return DEFAULT_UNIT_WEAPON;
  const dominant = entries.reduce((a, b) => (b.count > a.count ? b : a));
  return dominant.weapon || DEFAULT_UNIT_WEAPON;
}

export function unitSpeed(asset) {
  const entries = allComponents(asset);
  if (entries.length === 0) return DEFAULT_UNIT_SPEED;
  return Math.min(...entries.map((e) => e.speed ?? DEFAULT_UNIT_SPEED));
}

function weaponFleshBias(weaponDamage) {
  const flesh = weaponDamage?.flesh ?? 0;
  const metal = weaponDamage?.metal ?? 0;
  const total = flesh + metal;
  return total > 0 ? flesh / total : 0.5;
}

function pickDamagePool(unit, weaponDamage) {
  const fleshAlive = unit.health.flesh > 0;
  const metalAlive = unit.health.metal > 0;
  if (fleshAlive && !metalAlive) return "flesh";
  if (metalAlive && !fleshAlive) return "metal";
  if (!fleshAlive && !metalAlive) return null;
  return Math.random() < weaponFleshBias(weaponDamage) ? "flesh" : "metal";
}

// ============================================================
// 4. UNITS SCRIPT PARSING
// ============================================================
function isNumeric(v) {
  return v !== "" && !Number.isNaN(Number(v));
}

function parseDuration(token) {
  const m = token.match(/^(\d+(?:\.\d+)?)(MS|S)$/i);
  if (!m) return { error: true };
  const value = Number(m[1]);
  return { error: false, ms: m[2].toUpperCase() === "S" ? value * 1000 : value };
}

function parseCommand(segment) {
  const parts = segment.split(/\s+/);
  const command = (parts[0] || "").toUpperCase();
  const args = parts.slice(1);

  switch (command) {
    case "SPAWN": {
      if (args.length !== 4) return { error: "SPAWN requires 4 arguments: id, type, x, y" };
      const [id, type, x, y] = args;
      if (!isNumeric(x) || !isNumeric(y)) return { error: "Coordinates must be numeric values" };
      return { command, args: { id, type: type.toUpperCase(), x: Number(x), y: Number(y) } };
    }
    case "MOV": {
      if (args.length !== 3 && args.length !== 4) return { error: "MOV requires 3 or 4 arguments: id, x, y, [duration]" };
      const [id, x, y, durationToken] = args;
      if (!isNumeric(x) || !isNumeric(y)) return { error: "Coordinates must be numeric values" };
      let durationMs = null;
      if (durationToken !== undefined) {
        const parsed = parseDuration(durationToken);
        if (parsed.error) return { error: "Invalid duration format. Use S or MS (e.g., 5S, 500MS)" };
        durationMs = parsed.ms;
      }
      return { command, args: { id, x: Number(x), y: Number(y), durationMs } };
    }
    case "DEL": {
      if (args.length !== 1) return { error: "DEL requires unit id" };
      return { command, args: { id: args[0] } };
    }
    case "RM": {
      if (args.length !== 1) return { error: "RM requires unit id" };
      return { command, args: { id: args[0] } };
    }
    case "FADE": {
      if (args.length !== 2 && args.length !== 3) return { error: "FADE requires 2 or 3 arguments: id, opacity, [duration]" };
      const [id, opacityToken, durationToken] = args;
      if (!isNumeric(opacityToken)) return { error: "Opacity must be a numeric value" };
      const opacity = Number(opacityToken);
      let durationMs = null;
      if (durationToken !== undefined) {
        const parsed = parseDuration(durationToken);
        if (parsed.error) return { error: "Invalid duration format. Use S or MS (e.g., 5S, 500MS)" };
        durationMs = parsed.ms;
      }
      return { command, args: { id, opacity, durationMs } };
    }
    case "ATK": {
      if (args.length !== 2 && args.length !== 3) return { error: "ATK requires 2 or 3 arguments: id, targetId, [effect]" };
      const [id, targetId, effectTypeToken] = args;
      return { command, args: { id, targetId, effectType: effectTypeToken ? effectTypeToken.toUpperCase() : null } };
    }
    default:
      return { error: "Unknown unit command: " + command };
  }
}

export function parseUnitsScript(text) {
  const lines = text.split("\n");
  const commands = [];
  const errors = [];

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//")) return;

    const tickMatch = line.match(/^(T\d+)\s+(.*)$/i);
    if (!tickMatch) {
      errors.push({ line: lineNumber, message: "Line must start with a tick (e.g., T1)" });
      return;
    }

    const tick = parseInt(tickMatch[1].slice(1), 10);
    const body = tickMatch[2].trim();

    if (!body.endsWith(";")) {
      errors.push({ line: lineNumber, message: "Line must end with a semicolon (;)" });
      return;
    }

    const segments = body.slice(0, -1).split(";").map((s) => s.trim()).filter((s) => s !== "");

    for (const segment of segments) {
      const parsed = parseCommand(segment);
      if (parsed.error) {
        errors.push({ line: lineNumber, message: parsed.error });
      } else {
        commands.push({ ...parsed, tick, line: lineNumber });
      }
    }
  });

  commands.sort((a, b) => a.tick - b.tick);
  return { commands, errors };
}

// ============================================================
// 5. TICK INTERPRETER
// ============================================================
export class UnitsInterpreter {
  constructor(state, commands, effectsManager) {
    this.state = state;
    this.commands = commands;
    this.cursor = 0;
    this.effects = effectsManager;
  }

  onTick(tick) {
    this.state.tick = tick;
    while (
      this.cursor < this.commands.length &&
      this.commands[this.cursor].tick <= tick
    ) {
      this._execute(this.commands[this.cursor]);
      this.cursor += 1;
    }
  }

  _execute(cmd) {
    switch (cmd.command) {
      case "SPAWN":
        spawnUnit(this.state, cmd.args.id, cmd.args.type, cmd.args.x, cmd.args.y);
        break;
      case "MOV":
        moveUnit(this.state, cmd.args.id, cmd.args.x, cmd.args.y, cmd.args.durationMs);
        break;
      case "DEL":
      case "RM":
        deleteUnit(this.state, cmd.args.id);
        break;
      case "FADE":
        fadeUnit(this.state, cmd.args.id, cmd.args.opacity, cmd.args.durationMs);
        break;
      case "ATK": {
        const attacker = this.state.units.get(cmd.args.id);
        const target = this.state.units.get(cmd.args.targetId);
        if (!attacker || !target) break;
        const weapon = cmd.args.effectType || dominantWeapon(attacker.asset);
        if (this.effects) {
          const effect = this.effects.add(weapon, attacker.x, attacker.y, target.x, target.y);
          const accuracy = effect?.accuracy ?? 1;
          if (Math.random() <= accuracy) {
            const pool = pickDamagePool(target, effect?.damage);
            if (pool) {
              damageUnit(this.state, target.id, pool, effect?.damage?.[pool] ?? 0);
            }
          }
        }
        break;
      }
    }
  }

  isDone() {
    return this.cursor >= this.commands.length;
  }
}

// ============================================================
// 6. UNIT PAINTER
// ============================================================
const UNIT_SCALE = 1.5;

export class UnitPainter {
  constructor() {
    this.images = new Map();
  }

  getUnitImage(asset) {
    const src = UNITS_FLAG_BASE + asset.flag + ".svg";
    if (!this.images.has(src)) {
      const img = new Image();
      img.src = src;
      this.images.set(src, img);
    }
    return this.images.get(src);
  }

  draw(ctx, units, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    for (const unit of units.values()) {
      this._drawUnit(ctx, unit, mapWidth, mapHeight, canvasWidth, canvasHeight);
    }
  }

  _toPixel(x, y, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    return [(x / mapWidth) * canvasWidth, (y / mapHeight) * canvasHeight];
  }

  _drawUnit(ctx, unit, mapWidth, mapHeight, canvasWidth, canvasHeight) {
    const [px, py] = this._toPixel(unit.x, unit.y, mapWidth, mapHeight, canvasWidth, canvasHeight);
    const size = (canvasWidth / mapWidth) * UNIT_SCALE;
    const img = this.getUnitImage(unit.asset);

    ctx.save();
    ctx.translate(px, py);
    ctx.globalAlpha = unit.opacity ?? 1;

    if (img?.complete && img.naturalWidth > 0) {
      const aspectRatio = img.naturalHeight / img.naturalWidth;
      const h = size * aspectRatio;
      ctx.drawImage(img, -size / 2, -h / 2, size, h);
    } else {
      ctx.fillStyle = "#ff0000";
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}