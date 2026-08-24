const KIND_META = {
    arc:        { color: '#d98c3f', label: 'ARC ORDNANCE' },
    rocket:     { color: '#e0542a', label: 'ROCKET ORDNANCE' },
    tracer:     { color: '#6f9bb0', label: 'BALLISTIC' },
    burst:      { color: '#c9a227', label: 'AUTOMATIC FIRE' },
    slash:      { color: '#b9b3a2', label: 'MELEE BLADE' },
    beam:       { color: '#45c9c2', label: 'ENERGY WEAPON' },
    flame:      { color: '#e8712a', label: 'INCENDIARY' },
    drone:      { color: '#4f80c4', label: 'LOITERING MUNITION' },
    explosion:  { color: '#cf4a3a', label: 'CHARGE' },
    nuclear:    { color: '#f2c14e', label: 'STRATEGIC WARHEAD' },
    spray:      { color: '#96683c', label: 'SHOT SPREAD' }
};

const LABELS = {
    accuracy: 'Accuracy', durationMs: 'Duration', arcHeight: 'Arc Height',
    impactRadius: 'Impact Radius', blastRadius: 'Blast Radius',
    smokePuffCount: 'Smoke Puffs', trailCount: 'Trail Count', ringCount: 'Ring Count',
    shotCount: 'Shot Count', spreadAngle: 'Spread Angle', shotLength: 'Shot Length',
    pelletCount: 'Pellet Count', pelletLength: 'Pellet Length', beamWidth: 'Beam Width',
    particleCount: 'Particle Count', coneAngle: 'Cone Angle', range: 'Range',
    fuseMs: 'Fuse Delay', flashMs: 'Flash Duration', approach: 'Approach Speed',
    lineWidth: 'Line Width', projectileSize: 'Projectile Size', radius: 'Radius',
    thrust: 'Thrust Attack', silent: 'Silent', soundClass: 'Sound Class',
    smokeColor: 'Smoke Color', trailColor: 'Trail Color', bodyColor: 'Body Color',
    cloudColor: 'Cloud Color', projectileColor: 'Projectile Color',
    realRpm: 'Real Cyclic Rate', roughness: 'Audio Roughness', echo: 'Echo',
    crackBoost: 'Crack Boost', ringPitch: 'Ring Pitch', ringDecay: 'Ring Decay',
    boomPeak: 'Boom Peak', crackDurBoost: 'Crack Duration Boost', crackFreq: 'Crack Frequency',
    bodyFreq: 'Body Frequency', mechanical: 'Mechanical Action',
    realVelocity_ms: 'Real Velocity (m/s)', realPenetration_mm_at_1000m_APCBC: 'Penetration @1000m (mm)',
    realPenetration_mm_at_2500m: 'Penetration @2500m (mm)'
};

const SOUND_CLASS_PRESETS = {
    pistol:          { crackFreq: 3600, dur: 0.11, subBoom: false },
    pistol_magnum:   { crackFreq: 2900, dur: 0.17, subBoom: true,  subBoomFreq: 150 },
    rifle:           { crackFreq: 2600, dur: 0.14, subBoom: true,  subBoomFreq: 130, roughness: 0.06 },
    rifle_bolt:      { crackFreq: 2200, dur: 0.19, subBoom: true,  subBoomFreq: 125 },
    sniper:          { crackFreq: 1900, dur: 0.24, subBoom: true,  subBoomFreq: 95 },
    anti_materiel:   { crackFreq: 1450, dur: 0.34, subBoom: true,  subBoomFreq: 65 },
    bow:             { crackFreq: 2200, dur: 0.1,  subBoom: false },
    musket:          { crackFreq: 1000, dur: 0.3,  subBoom: true,  subBoomFreq: 70, roughness: 0.3 },

    smg:             { crackFreq: 3000, bodyFreq: 900 },
    assault_rifle:   { crackFreq: 2500, bodyFreq: 750 },
    lmg:             { crackFreq: 2000, bodyFreq: 600, roughness: 0.08, mechanical: true },
    lmg_fast:        { crackFreq: 2450, bodyFreq: 560, roughness: 0.28 },
    gatling:         { crackFreq: 2400, bodyFreq: 700, roughness: 0.15 },
    naval_gatling:   { crackFreq: 2600, bodyFreq: 900, roughness: 0.12 },
    naval_flak:      { crackFreq: 1400, bodyFreq: 500 },
    aircraft_cannon: { crackFreq: 2100, bodyFreq: 650, roughness: 0.22 },

    shotgun:         { freq: 1700, subBoomFreq: 115 },
    shotgun_wide:    { freq: 1300, subBoomFreq: 95 },

    blade:           { freqStart: 900,  freqEnd: 3200, q: 3,   metallic: true, ringPitch: 1400, ringDecay: 0.22 },
    blade_thin:      { freqStart: 1400, freqEnd: 4200, q: 4,   metallic: true, ringPitch: 2100, ringDecay: 0.28 },
    blade_heavy:     { freqStart: 500,  freqEnd: 1800, q: 2,   metallic: true, ringPitch: 850,  ringDecay: 0.16 },
    blade_light:     { freqStart: 1600, freqEnd: 4000, q: 4,   metallic: true, ringPitch: 2400, ringDecay: 0.18 },
    blade_thrust:    { freqStart: 700,  freqEnd: 2400, q: 2.5, metallic: true, ringPitch: 1100, ringDecay: 0.15 },

    cannon:          { boomFreq: 78, roughness: 0.28, echo: true },
    mortar:          { boomFreq: 55, mutedLaunch: true, roughness: 0.22, echo: true },
    howitzer:        { boomFreq: 42, roughness: 0.3,  echo: true },
    flak:            { boomFreq: 90, roughness: 0.22 },
    tank:            { boomFreq: 95, roughness: 0.42, crackBoost: 1.7 },
    naval:           { boomFreq: 38, roughness: 0.28, echo: true },
    grenade:         { boomFreq: 95, roughness: 0.12 },
    bomb_drop:       { boomFreq: 40, roughness: 0.3,  echo: true, crackBoost: 1.8 },

    rocket_light:    { boomFreq: 65, roughness: 0.15 },
    rocket_barrage:  { boomFreq: 50, roughness: 0.15 },
    rocket_guided:   { boomFreq: 45, whine: true, roughness: 0.12 },

    charge:          { boomFreq: 78, roughness: 0.18 },
    drone:           { boomFreq: 68, humFreqA: 220, humFreqB: 226 },
    nuclear_tactical:  { boomFreq: 44, roughness: 0.35, echo: true, crackBoost: 2.0 },
    nuclear_strategic: { boomFreq: 26, roughness: 0.4,  echo: true, crackBoost: 2.2 },

    laser:           { toneFreq: 1000 },
    plasma:          { toneFreq: 700 },

    flamethrower:    { baseFreq: 700 }
};
