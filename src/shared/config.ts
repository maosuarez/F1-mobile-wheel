// Configuración global del juego (design D2). Objeto mutable para poder clonarlo y alterarlo en tests.
export const config = {
  sim:   { dt: 1/120, maxSubSteps: 8, g: 9.81, rho: 1.2, startOffsetM: 20 },
  car:   { massKg: 800, wheelbaseM: 3.6, halfWidthM: 1.0, icePowerKw: 560,
           mu: 1.7, rearLoadFraction: 0.6, brakeGripFactor: 0.85, rollingCoef: 0.015,
           steerMaxLowDeg: 16, steerMaxHighDeg: 3.5, steerSpeedRefMs: 85, steerTauS: 0.06,
           pedalTauS: 0.03, alignRate: 10, oversteerGain: 0.6, minSpeedForSlipMs: 3 },
  gears: { limiterRpm: 12500, idleRpm: 4000, topSpeedKmh: [95, 130, 160, 190, 225, 260, 300, 350], reverseTopKmh: 60,
           reverseMaxEntryKmh: 5, shiftCutS: 0.04, downshiftMarginRpm: 500,
           powerCurve: [[4000, 0.45], [7000, 0.78], [9000, 1], [12000, 1], [12500, 0.88]] as [number, number][],
           engineBrakeMs2: 0.3, wheelspinRpm: 1500, neutralRevRate: 6,
           ledStartFrac: 0.75, ledFullFrac: 0.96,
           auto: { upFrac: 0.96, downFrac: 0.78 },
           overheat: { heatPerS: 0.25, coolPerS: 0.1, threshold: 1.0, recover: 0.6, max: 1.2, powerFactor: 0.8 } },
  drs:   { cdaFactor: 0.86, claFactor: 0.95, brakeClose: 0.1 },
  ers:   { capacityMJ: 4, baseDeployKw: 120, overtakeExtraKw: 60, overtakeDrainMult: 3, overtakeMinCharge: 0.05,
           fullThrottle: 0.95, regenMaxKw: 250, regenFraction: 0.3, lapBonus: 0.03, lapDeployLimitMJ: 3.5 },
  limits: { marginM: 1.0, warnS: 3 },
  hud:   { warnShiftRejectedS: 1 },
  aero:  { cdA: 1.5, clA: 4.0 },
  surface: { asphalt: { mu: 1.0, rolling: 1 }, kerb: { mu: 0.85, rolling: 1, yawNoise: 0.02 },
             grass: { mu: 0.45, rolling: 6 },
             // b13 design D4: grava y escapatoria de asfalto
             gravel: { mu: 0.4, rolling: 14 }, runoff: { mu: 0.95, rolling: 1 },
             wall: { restitution: 0.3, speedLoss: 0.15, yawKickRad: 0.12 } },
  timing: { traceStepM: 10 },
  // Kit de borde de pista (b13, design D8). Medidas en metros. Marcas de frenada: desde el punto de frenada que anuncia
  // el cartel de 100 m (s + 100), brakeMarkLenM de largo, oscureciendo brakeMarkDarken las rodadas de la trazada
  trackside: { kerbStripeM: 2, serratedToothM: 1, serratedH: 0.05, sausageH: 0.15, sausageW: 0.3, tecproH: 1.2, armcoH: 0.75,
               concreteH: 1.0, fenceH: 2.5, marshalEveryM: 250, boardW: 1.2, boardH: 0.9, brakeMarkLenM: 60, brakeMarkDarken: 0.3 },
  // Assets CC0 (b13, design D7)
  assets: { base: '/assets/', anisotropy: 8, hdriId: 'kloofendal_48d_partly_cloudy_puresky' },
  keyboard: { steerRiseS: 0.18, steerFallS: 0.12, pedalRiseS: 0.08, pedalFallS: 0.05 },
  autopilot: { lookaheadBaseM: 8, lookaheadPerMs: 0.35, latGripUse: 0.72, brakeGripUse: 0.65,
               speedPreviewS: 0.25, throttleGain: 0.25, brakeGain: 0.35, maxSpeedMs: 95 },
  render: { maxDpr: 1.5, trackChunks: 20, fovDeg: 70, near: 0.3, far: 2500 },
  // Calidad adaptativa (b6, design D1): baja un nivel si la media de fps < downFps durante windowS
  quality: { downFps: 50, windowS: 3, meterFrames: 7200, softwareGl: ['SwiftShader', 'llvmpipe'] },
  // Luz y cielo (b6, design D2). sunDir apunta hacia el sol (b13: alineado con el sol del HDRI); colores en sRGB
  light: { exposure: 1.0, sunDir: [0.554, 0.742, 0.378] as [number, number, number], sunColor: '#fff1dc', sunIntensity: 2.6,
           hemiSky: '#bcd6f2', hemiGround: '#5a5440', hemiIntensity: 0.45, envIntensity: 0.55, carEnvIntensity: 0.4,
           shadowExtentM: 60, shadowAheadM: 15, shadowDistM: 150, shadowNear: 1, shadowFar: 320,
           shadowBias: -0.0004, shadowNormalBias: 0.03 },
  sky:   { radiusM: 2000, zenith: '#3f78c4', horizon: '#c9dcec', ground: '#9fb3c2', exponent: 0.55,
           haloColor: '#fff4dd', haloPower: 180, haloGain: 1.6, glowPower: 6, glowGain: 0.25,
           fogNearFrac: 0.3, fogFarFrac: 0.95,
           // HDRI (b13, design D7): intensidad del fondo y radiancia máxima del entorno PMREM (sin el disco solar)
           hdriBackgroundIntensity: 1.0, hdriEnvClamp: 8 },
  // Iluminación nocturna (b18, design D4): solo en circuitos con lighting 'night'. Colores sRGB, medidas en metros.
  // Postes cada poleEveryM junto a la barrera alternando lados (desde s = 0); charcos de luz en el color de vértice del
  // asfalto: 1 − poolDepth·(1 − cos²(π·d/poleEveryM)), el asfalto ×roadGain (líneas ×lineGain, siguen más claras) para que se lea bajo los
  // focos: el color de vértice de día (#2b2b2e) es muy oscuro, de noche falta la luz del cielo y el tono ACES aplasta
  // los oscuros (con ×1 la franja de asfalto queda en ~0,06; subir la exposición aclararía también el cielo); ventanas en rejilla windowW × windowH con windowLit encendidas
  // backgroundIntensity: los HDRI nocturnos de Poly Haven vienen normalizados a brillo de día (horizonte ~2 lineal):
  // se escalan para que el cielo quede oscuro; el entorno PMREM no usa este factor
  night: { envIntensity: 0.25, fog: '#0b1020', backgroundIntensity: 0.02,
           sunDir: [0.1, 1, 0.15] as [number, number, number], sunColor: '#f2f4ff', sunIntensity: 2.0,
           hemiSky: '#1d2540', hemiGround: '#0a0a0a', hemiIntensity: 0.25,
           skyZenith: '#03050b', skyHorizon: '#0b1020', skyGround: '#05060a',
           poleEveryM: 30, poleOffsetM: 1.5, poleH: 14, poleR: 0.18, poleSinkM: 2, armM: 3, headLenM: 1.4, headH: 0.35,
           poleColor: '#5a5d63', headColor: '#fff4e0', headEmissive: 6, poolDepth: 0.35, roadGain: 40, lineGain: 1.5,
           windowW: 3, windowH: 3.2, windowLit: 0.35, windowSeed: 1811, windowColor: '#ffd9a0', windowIntensity: 1.5,
           bloomStrength: 0.6, bloomThreshold: 0.8 },
  // Suelo de desierto (b18, design D5): color de talud y respaldo procedural de la arena
  sand: { steepColor: '#a08060', procColor: '#c9a877', textureId: 'coast_sand_01' },
  // Coche visual (b6, design D3). Medidas en metros, ángulos en grados, colores sRGB de la escudería ficticia
  carVisual: { wheelRadiusM: 0.36, tireFrontW: 0.305, tireRearW: 0.405, halfTrackM: 1.0,
               steerWheelDeg: 120, flapOpenDeg: 35, flapRateDegS: 300,
               tiltMaxDeg: 1.5, tiltDegPerG: 0.4, tiltTauS: 0.12,
               colors: { primary: '#0b5d7a', accent: '#ffb000', carbon: '#16181c', number: '#f4f4f0', rim: '#b9bec6', screen: '#38e8ff' } },
  // Superficies de pista (b6, design D4). Texturas procedurales sembradas; tamaños en px, medidas en metros
  surfaces: { seed: 1301, texPx: 512, maxTexPx: 1024, uvMeters: 4, grassTint: '#4a7a2c', rubberWidthM: 2.2, rubberDarken: 0.15, rubberDarkenMax: 0.22, rubberKRef: 0.03,
              asphaltGrain: 0.14, grassVariation: 0.22, stripeLenM: 18, stripeDarken: 0.09,
              gridSlots: 10, gridSpacingM: 8, gridOffsetM: 2.4, gridBoxLenM: 5, gridBoxWidthM: 1.6, gridLineM: 0.12 },
  // Entorno (b6, design D5). Medidas en metros, colores sRGB; la semilla fija la colocación de árboles
  environment: { seed: 4107, groundDropM: 0.05,
                 stand: { moduleLenM: 12, depthM: 8, heightM: 6, steps: 4, offsetM: 4, backM: 100, spanM: 336, treeClearM: 3 },
                 tree: { minOffM: 3, maxOffM: 60, minGapM: 3, trunkH: 3, trunkR: 0.28, crownH: 7.5, crownR: 2.6,
                         scaleMin: 0.7, scaleMax: 1.4, trunkColor: '#4a3524', crownColors: ['#2f5a2a', '#3a6b30', '#2a4f2d', '#4a7a35'], attemptsPerTree: 40 },
                 skyline: { segments: 96, padM: 700, baseDropM: 6, minH: 25, maxH: 90, color: '#7d95a3' },
                 crowdPalette: ['#c0392b', '#e8e6df', '#2b6cb0', '#f1c40f', '#2d3436', '#27ae60', '#8e44ad'], crowdTexPx: 64 },
  // Entorno real desde OSM y DEM (b12, design D8). Colores sRGB; densidad de árboles por hectárea de bosque
  // cameraClearM: altura mínima de las cámaras exteriores sobre el terreno real (design D9)
  world: { treesPerHa: 120, terrainChunks: 4, waterColor: '#26404a', cameraClearM: 2,
           buildingColors: { pit: '#d9d9d4', grandstand: '#8c9096', tower: '#b7b2a8', generic: '#c9bfae' } },
  // Partículas de pista (b6, design D6). Velocidades en m/s, tiempos en s, tamaños en m, colores sRGB
  particles: { dirtMinMs: 5, smokeMinMs: 16.7, smokeSlip: 0.6,
               dirtRatePerWheel: 40, dirtRefMs: 28, smokeRatePerWheel: 30,
               dirtLifeS: 0.6, smokeLifeS: 1.4, dirtSizeM: 0.12, smokeSizeM: 0.9, smokeGrowth: 2.5,
               dirtUpMs: 2.5, dirtBackFrac: 0.15, dirtSpreadMs: 1.5, smokeUpMs: 0.6, smokeSpreadMs: 0.8, smokeBackFrac: 0.05,
               dirtColor: '#5b4a33', gravelColor: '#9a8c74', smokeColor: '#d8d8d4', dirtAlpha: 0.9, smokeAlpha: 0.35, seed: 9173 },
  // Posproceso (b6, design D7): bloom a media resolución y viñeta en la pasada final
  post: { bloomStrength: 0.35, bloomRadius: 0.4, bloomThreshold: 0.9,
          vignetteStrength: 0.3, vignetteInner: 0.45, vignetteOuter: 1.05 },
  // Sensaciones (b5, design D1)
  audio:  { masterGain: 0.6, cylindersFactor: 3, idleGain: 0.28, fullGain: 0.85, cutoffMinHz: 500, cutoffMaxHz: 5200,
            rpmCutoffBoost: 0.6, squareMix: 0.35, turboGain: 0.12, windGain: 0.35, windRefMs: 90,
            paramTauS: 0.02, shiftDipS: 0.04, shiftDipGain: 0.3, crackS: 0.05, crackGain: 0.5, limiterHz: 15, limiterDepth: 0.5,
            rivalGain: 0.35, rivalMaxM: 80, rivalVoices: 2, rivalRefM: 8 },
  camera: { defaultMode: 'helmet' as 'helmet' | 'chase' | 'tv', fovMinDeg: 70, fovMaxDeg: 84, fovRefKmh: 320,
            chase: { distM: 7.5, heightM: 2.6, lookAheadM: 8, omega: 9, velocityBlend: 0.7 },
            helmet: { offset: [0.15, 0.82, 0] as [number, number, number], rollDegPerG: 1.0, pitchDegPerG: 0.6, maxDeg: 6, lookSteerDeg: 5, omega: 14 },
            tv: { spacingM: 300, heightM: 7, outsideM: 10, leadM: 20, minFovDeg: 6, maxFovDeg: 50, frameWidthM: 14 },
            shake: { kerbM: 0.03, grassM: 0.05, surfaceRefKmh: 100, highSpeedM: 0.012, highSpeedKmh: 250, highSpeedRefKmh: 330, hz: [17, 23, 31] as [number, number, number] } },
  fx:     { minGapMs: 80, kerbRepeatMs: 120, grassRepeatMs: 300, limiterRepeatMs: 100, minSpeedKmh: 20 },
  // Red y emparejamiento con el volante (b3, design D4)
  // Carrera online (b16, design D8): raceHz envío st/ai; interpDelayMs/maxExtrapMs interpolación de remotos; resultsWaitS espera de res
  net:   { telHz: 20, inputStaleMs: 250, inputLostMs: 1000,
           raceHz: 20, interpDelayMs: 100, maxExtrapMs: 250, remoteMassFactor: 1, raceMax: 6, resultsWaitS: 10, clockPings: 5, clockResyncS: 10,
           leaveHideS: 2, gridMax: 10 },   // leaveHideS: coche retirado fuera de escena; gridMax: parrilla online (humanos + IA)
  // Carrera (b14, design D8). Distancias en metros, tiempos en s; colisiones: 2 círculos por coche en ±carHalfLenM
  race:  { countdownS: 3, restartHoldMs: 1000,
           laps: 5, lightsIntervalS: 1, lightsHoldMinS: 0.2, lightsHoldMaxS: 3, gapStepM: 50, finishTimeoutS: 60,
           carRadiusM: 0.95, carHalfLenM: 1.6, restitution: 0.2, hitSpeedLoss: 0.03, hitYawKick: 0.05,
           drsGapS: 1, drsFromLap: 2, playerGridSlot: 6, rivalCullM: 600, defaultRivals: 9 },
  // IA de rivales (b14, design D3). Distancias en m, velocidades en m/s; niveles: uso del agarre lateral y de frenada
  ai:    { followM: 30, overtakeCloseMs: 1.5, offsetRateMs: 1.5, edgeMarginM: 1.2, brakeGapS: 0.6,
           levels: { easy: { gripUse: 0.80, brakeUse: 0.70 }, medium: { gripUse: 0.87, brakeUse: 0.78 },
                     hard: { gripUse: 0.93, brakeUse: 0.85 } } },
  // Minimapa de anticipación (b8, design D1). Distancias en metros; carY = fracción del alto desde arriba
  minimap: { aheadM: 350, behindM: 60, stepM: 5, cornerK: 0.008, redrawHz: 30, carY: 0.72 },
  // Modo VR (b7, design D10). steerRampPerS = 1 / keyboard.steerRiseS (misma rampa que el teclado); distancias en metros
  vr:    { framebufferScale: 0.8, foveation: 1, triggerDeadzone: 0.05, steerRangeRad: 1.05, steerRampPerS: 1 / 0.18,
           hudDistanceM: 1.2, hudSizeM: [0.6, 0.3] as [number, number], hudRedrawHz: 10, minimapSizeM: 0.22,
           stickShiftOn: 0.7, stickShiftOff: 0.3,
           // Índices xr-standard (b9, design D5): agarre y clic de palanca; sin verificar con visor real
           gripButton: 1, stickClickButton: 3 },
  // Pantalla dividida local (b15, design D7). p2Keys: teclas del jugador 2 (códigos KeyboardEvent.code)
  // shareShadowM: distancia entre coches por debajo de la cual comparten la sombra (D3); shadowMarginM: margen del encuadre;
  // contactShadowM: radio del disco de sombra falsa de J2 cuando la sombra sigue solo a J1
  split: { maxPlayers: 2, engineGain: 0.6, maxQuality: 'medium' as 'low' | 'medium' | 'high',
           shareShadowM: 150, shadowMarginM: 30, contactShadowM: 1.6,
           p2Keys: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
                     shiftUp: 'Period', shiftDown: 'Comma', drs: 'Slash', ers: 'ShiftRight' } },
  // Mando USB (b10, design D3)
  gamepad: { stickDeadzone: 0.08, triggerDeadzone: 0.05, steerExpo: 1.4 },
  // Volante móvil (b3, design D5)
  wheel: { steerSign: 1, rangeDeg: 60, deadzoneDeg: 1.5, curveK: 0.35, flatThreshold: 3,
           oneEuro: { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 }, sendHz: 60,
           pedalMode: 'analog' as 'analog' | 'digital', pedalRampMs: 120,
           haptics: { minGapMs: 80, patterns: { shift: [12], kerb: [25], grass: [40, 30, 40], limits: [120], limiter: [8] } },
           // b20 design D2: detector de sacudidas (DRS/ERS)
           shake: { peakMs2: 14, windowMs: 450, peaks: 2, cooldownMs: 900, straightSteer: 0.2, ersOffBrake: 0.3, freezeMs: 350 } },
};

export type GameConfig = typeof config;
