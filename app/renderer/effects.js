// ==========================================================================
// HISTOGRAPH — EFFECT LAYER PAINTER
//
// Canvas2D rendering for every active combat effect produced by
// core/war/effects.js's EffectsManager, one method per weapon "kind":
// tracers, arcs, bursts, slashes, sprays, flames, beams, rockets,
// explosions, drones, and nuclear mushroom clouds. draw() is called once
// per frame with the manager's current active-effect list; each effect
// carries its own createdAt/durationMs, so _renderEffect() derives a
// normalized progress value t (0-1) and skips anything outside that
// window instead of relying on any external animation clock.
// ==========================================================================

import { toPixel } from "./utils.js";

const DEFAULT_SMOKE = "150,150,150";

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

    const [fx, fy] = toPixel(effect.fromX, effect.fromY, mapWidth, mapHeight, canvasWidth, canvasHeight);
    const [tx, ty] = toPixel(effect.toX, effect.toY, mapWidth, mapHeight, canvasWidth, canvasHeight);

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
