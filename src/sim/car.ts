import type { GameConfig } from '../shared/config';
import { locate } from '../track/query';
import type { Surface, Track, TrackLocation } from '../track/types';
import type { CarState, DriverInput, SimEvent } from './types';

// Dinámica arcade del monoplaza (design D5, skill f1-car-feel §2–§3, §7). Sin three ni DOM.

const DEG = Math.PI / 180;
const MIN_IMPACT_MS = 1.0;     // velocidad normal mínima hacia el muro para contar como impacto
const SLIP_ANGLE_REF = 0.2;    // ángulo de deriva (rad) que corresponde a slip = 1

// --- Ruido de piano: LCG sembrado guardado por instancia de coche ---
const noiseSeeds = new WeakMap<CarState, number>();

export function seedCarNoise(car: CarState, seed = 0x2545f491): void {
  noiseSeeds.set(car, seed >>> 0);
}

function nextNoise(car: CarState): number {
  let x = noiseSeeds.get(car) ?? 0x2545f491;
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  noiseSeeds.set(car, x);
  return x / 4294967296 * 2 - 1;   // [-1, 1)
}

// Agarre disponible (m/s²): μ·(g + Fl/m)·μSuperficie.
export function gripAccel(speed: number, surfaceMu: number, cfg: GameConfig): number {
  const fl = 0.5 * cfg.sim.rho * cfg.aero.clA * speed * speed;
  return cfg.car.mu * (cfg.sim.g + fl / cfg.car.massKg) * surfaceMu;
}

// Ángulo máximo de rueda (rad) según la velocidad.
export function maxSteerRad(speed: number, cfg: GameConfig): number {
  const u = Math.min(Math.max(speed / cfg.car.steerSpeedRefMs, 0), 1);
  return (cfg.car.steerMaxLowDeg + (cfg.car.steerMaxHighDeg - cfg.car.steerMaxLowDeg) * u) * DEG;
}

function surfaceParams(surface: Surface, cfg: GameConfig): { mu: number; rolling: number } {
  return cfg.surface[surface];
}

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Copia la localización de pista en el estado del coche.
function applyLocation(car: CarState, loc: TrackLocation): void {
  car.s = loc.s; car.d = loc.d; car.trackIndex = loc.i;
  car.surface = loc.surface; car.kerbSide = loc.kerbSide;
}

// Avanza el coche exactamente cfg.sim.dt.
export function stepCar(car: CarState, input: DriverInput, track: Track, cfg: GameConfig, events: SimEvent[]): void {
  const dt = cfg.sim.dt;
  const g = cfg.sim.g;
  const m = cfg.car.massKg;
  const prevSurface = car.surface;
  const vx0 = car.vx, vz0 = car.vz;

  // 1. Filtrado de entradas
  const v0 = Math.hypot(car.vx, car.vz);
  const kSteer = 1 - Math.exp(-dt / cfg.car.steerTauS);
  const kPedal = 1 - Math.exp(-dt / cfg.car.pedalTauS);
  const steerTarget = clamp(input.steer, -1, 1) * maxSteerRad(v0, cfg);
  car.steerAngle += (steerTarget - car.steerAngle) * kSteer;
  car.throttle += (clamp(input.throttle, 0, 1) - car.throttle) * kPedal;
  car.brake += (clamp(input.brake, 0, 1) - car.brake) * kPedal;

  // 2. Localización y agarre
  let loc = locate(track, car.x, car.z, car.trackIndex);
  const surf = surfaceParams(loc.surface, cfg);
  const aMax = gripAccel(v0, surf.mu, cfg);

  // Dirección de la velocidad (φ) y deriva respecto al rumbo
  const phi = v0 > 1e-6 ? Math.atan2(-car.vz, car.vx) : car.yaw;

  // 3. Fuerzas longitudinales
  const fl = 0.5 * cfg.sim.rho * cfg.aero.clA * v0 * v0;
  const tractionMax = cfg.car.mu * cfg.car.rearLoadFraction * (m * g + fl) * surf.mu;
  const driveDemand = car.throttle * (cfg.car.powerKw * 1000) / Math.max(v0, 5);
  const driveForce = Math.min(driveDemand, tractionMax);
  const aDrive = driveForce / m;
  const aBrake = car.brake * cfg.car.brakeGripFactor * aMax;
  const aTireLong = aDrive - aBrake;
  const aDrag = 0.5 * cfg.sim.rho * cfg.aero.cdA * v0 * v0 / m;
  const aRoll = cfg.car.rollingCoef * g * surf.rolling;
  const slopePitch = loc.pitch * Math.cos(wrapAngle(car.yaw - loc.heading));
  const aSlope = -g * Math.sin(slopePitch);

  // 4. Giro deseado, limitado por el círculo de fricción (subviraje)
  const aLatAvail = Math.sqrt(Math.max(aMax * aMax - aTireLong * aTireLong, 0));
  let r = -v0 * Math.tan(car.steerAngle) / cfg.car.wheelbaseM;   // steer > 0 ⇒ derecha ⇒ yaw decrece
  const rLimit = v0 > 0.5 ? aLatAvail / v0 : Infinity;
  if (Math.abs(r) > rLimit) r = Math.sign(r) * rLimit;

  // 5. Sobreviraje por exceso de tracción
  const excess = tractionMax > 0 ? clamp((driveDemand - tractionMax) / tractionMax, 0, 1) : 0;
  r *= 1 + cfg.car.oversteerGain * excess;

  // Ruido de giro en piano
  let yawNoise = 0;
  if (loc.surface === 'kerb') yawNoise = nextNoise(car) * cfg.surface.kerb.yawNoise;

  // 6. Integrar rumbo
  car.yaw = wrapAngle(car.yaw + r * dt + yawNoise * dt);
  car.yawRate = r + yawNoise;

  // 7. Velocidad: módulo y relajación de la dirección hacia el rumbo
  let v = v0 + (aTireLong - aDrag - aRoll + aSlope) * dt;
  if (v < 0) v = 0;   // sin marcha atrás: parada sin retroceso
  let phiNew = phi;
  if (v > 1e-6) {
    if (v0 <= 1e-6) {
      phiNew = car.yaw;
    } else {
      const rate = cfg.car.alignRate * aMax / (cfg.car.mu * g);
      const beta = wrapAngle(phi - car.yaw);
      // Relajación exponencial, con giro de la velocidad limitado por el agarre lateral disponible
      const maxTurn = aLatAvail / Math.max(v0, 0.5) * dt;
      const dPhi = clamp(-beta * (1 - Math.exp(-rate * dt)), -maxTurn, maxTurn);
      phiNew = wrapAngle(phi + dPhi);
    }
  } else {
    phiNew = car.yaw;
  }
  car.vx = v * Math.cos(phiNew);
  car.vz = -v * Math.sin(phiNew);

  // 8. Integrar posición (Euler semi-implícito)
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // 9. Nueva localización y muros
  loc = locate(track, car.x, car.z, loc.i);
  const hw = cfg.car.halfWidthM;
  const limL = loc.wallL - hw, limR = loc.wallR - hw;
  if (loc.d > limL || loc.d < -limR) {
    const left = loc.d > limL;
    const nSign = left ? 1 : -1;
    const sp = sampleNormalAt(track, loc);
    const nx = sp.nx * nSign, nz = sp.nz * nSign;     // normal hacia el muro
    // Recortar la posición dentro del muro
    const over = left ? loc.d - limL : -limR - loc.d;
    car.x -= nx * over; car.z -= nz * over;
    const vn = car.vx * nx + car.vz * nz;              // velocidad hacia el muro
    if (vn > 0) {
      const speedBefore = Math.hypot(car.vx, car.vz);
      if (vn > MIN_IMPACT_MS) {
        const w = cfg.surface.wall;
        car.vx -= (1 + w.restitution) * vn * nx;
        car.vz -= (1 + w.restitution) * vn * nz;
        car.vx *= 1 - w.speedLoss;
        car.vz *= 1 - w.speedLoss;
        car.yaw = wrapAngle(car.yaw + (left ? -w.yawKickRad : w.yawKickRad));
        events.push({ type: 'wallHit', speedMs: speedBefore });
      } else {
        car.vx -= vn * nx;
        car.vz -= vn * nz;
      }
    }
    loc = locate(track, car.x, car.z, loc.i);
  }
  applyLocation(car, loc);

  // 10. Estado derivado: velocidades y aceleraciones en ejes del coche
  const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);    // adelante
  const lx = -Math.sin(car.yaw), lz = -Math.cos(car.yaw);   // izquierda
  car.speed = Math.hypot(car.vx, car.vz);
  car.vLong = car.vx * fx + car.vz * fz;
  car.vLat = car.vx * lx + car.vz * lz;
  const ax = (car.vx - vx0) / dt, az = (car.vz - vz0) / dt;
  car.aLong = ax * fx + az * fz;
  car.aLat = ax * lx + az * lz;
  const betaNow = car.speed > 1e-6 ? Math.abs(Math.atan2(car.vLat, Math.max(car.vLong, 1e-6))) : 0;
  car.slip = car.speed < cfg.car.minSpeedForSlipMs ? 0 : Math.min(1, Math.max(betaNow / SLIP_ANGLE_REF, excess));

  // 11. Altura y orientación de la pista
  car.y = loc.y + loc.bank * loc.d;
  car.pitch = loc.pitch * Math.cos(wrapAngle(car.yaw - loc.heading));
  car.roll = loc.bank;

  // 12. Eventos de superficie
  if (car.surface !== prevSurface) events.push({ type: 'surface', surface: car.surface });
}

// Normal de pista interpolada en la localización (a partir del rumbo de pista).
function sampleNormalAt(_track: Track, loc: TrackLocation): { nx: number; nz: number } {
  // heading = atan2(−tz, tx) ⇒ t = (cos h, −sin h), n = (tz, −tx) = (−sin h, −cos h)
  return { nx: -Math.sin(loc.heading), nz: -Math.cos(loc.heading) };
}

// Estado inicial vacío del coche.
export function createCarState(): CarState {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
    vx: 0, vz: 0, speed: 0, vLong: 0, vLat: 0, yawRate: 0,
    steerAngle: 0, throttle: 0, brake: 0, aLong: 0, aLat: 0, slip: 0,
    s: 0, d: 0, trackIndex: 0, surface: 'asphalt', kerbSide: null,
  };
}
