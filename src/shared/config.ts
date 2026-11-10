// Configuración global del juego (design D2). Objeto mutable para poder clonarlo y alterarlo en tests.
export const config = {
  sim:   { dt: 1/120, maxSubSteps: 8, g: 9.81, rho: 1.2, startOffsetM: 20 },
  car:   { massKg: 800, wheelbaseM: 3.6, halfWidthM: 1.0, powerKw: 680,   // 560 combustión + 120 ERS; el bloque 4 lo separa
           mu: 1.7, rearLoadFraction: 0.6, brakeGripFactor: 0.85, rollingCoef: 0.015,
           steerMaxLowDeg: 16, steerMaxHighDeg: 3.5, steerSpeedRefMs: 85, steerTauS: 0.06,
           pedalTauS: 0.03, alignRate: 10, oversteerGain: 0.6, minSpeedForSlipMs: 3 },
  aero:  { cdA: 1.5, clA: 4.0 },
  surface: { asphalt: { mu: 1.0, rolling: 1 }, kerb: { mu: 0.85, rolling: 1, yawNoise: 0.02 },
             grass: { mu: 0.45, rolling: 6 },
             wall: { restitution: 0.3, speedLoss: 0.15, yawKickRad: 0.12 } },
  timing: { traceStepM: 10 },
  keyboard: { steerRiseS: 0.18, steerFallS: 0.12, pedalRiseS: 0.08, pedalFallS: 0.05 },
  autopilot: { lookaheadBaseM: 8, lookaheadPerMs: 0.35, latGripUse: 0.72, brakeGripUse: 0.65,
               speedPreviewS: 0.25, throttleGain: 0.25, brakeGain: 0.35, maxSpeedMs: 95 },
  render: { maxDpr: 1.5, trackChunks: 20, fovDeg: 70, near: 0.3, far: 2500,
            chase: { distM: 7.5, heightM: 2.6, lookAheadM: 6, stiffness: 8 } },
  // Red y emparejamiento con el volante (b3, design D4)
  net:   { telHz: 20, inputStaleMs: 250, inputLostMs: 1000 },
  race:  { countdownS: 3 },
  // Volante móvil (b3, design D5)
  wheel: { steerSign: 1, rangeDeg: 60, deadzoneDeg: 1.5, curveK: 0.35, flatThreshold: 3,
           oneEuro: { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 }, sendHz: 60,
           pedalMode: 'analog' as 'analog' | 'digital', pedalRampMs: 120,
           haptics: { minGapMs: 80, patterns: { shift: [12], kerb: [25], grass: [40, 30, 40], limits: [120], limiter: [8] } } },
};

export type GameConfig = typeof config;
