import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { config } from '../src/shared/config';
import { createCarState } from '../src/sim/car';
import type { CarState } from '../src/sim/types';
import { makeStraightTrack } from '../src/track/synthetic';
import { CameraRig, type CarPose } from '../src/render/cameras/rig';
import { terrainBlocks, type GroundFn } from '../src/render/cameras/math';

const G = config.sim.g;
const DEG = Math.PI / 180;
const DT = 1 / 60;
const track = makeStraightTrack({ lengthM: 5000 });

function setup() {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.3, 2500);
  const rig = new CameraRig(camera, track, config);
  const car = createCarState();
  const pose: CarPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  return { camera, rig, car, pose };
}

// Mueve el coche en línea recta con velocidad (vx, vz) y actualiza el rig durante `seconds`.
function drive(rig: CameraRig, car: CarState, pose: CarPose, seconds: number, t0: number, each?: (t: number) => void): number {
  const n = Math.round(seconds / DT);
  let t = t0;
  for (let i = 0; i < n; i++) {
    pose.x += car.vx * DT; pose.z += car.vz * DT; t += DT;
    car.x = pose.x; car.z = pose.z; car.s = pose.x;
    rig.update(pose, car, DT, t);
    each?.(t);
  }
  return t;
}

function setVelocity(car: CarState, kmh: number, angleDeg: number) {
  const v = kmh / 3.6, a = angleDeg * DEG;
  car.speed = v; car.vx = v * Math.cos(a); car.vz = -v * Math.sin(a);
}

describe('Cambio de cámara', () => {
  it('Primera persona por defecto', () => {
    const { rig } = setup();
    expect(rig.mode).toBe('helmet');
    expect(rig.debug().mode).toBe('helmet');
  });

  it('Ciclo completo', () => {
    const { rig } = setup();
    expect([rig.next(), rig.next(), rig.next()]).toEqual(['chase', 'tv', 'helmet']);
  });

  it('Corte limpio: de TV a persecución', () => {
    const { rig, car, pose } = setup();
    rig.next(); rig.next();
    expect(rig.mode).toBe('tv');
    setVelocity(car, 300, 0);
    let t = drive(rig, car, pose, 2, 0);
    expect(rig.debug().tvIndex).toBeGreaterThanOrEqual(0);
    rig.next(); rig.next();   // tv → casco → persecución antes del siguiente fotograma
    expect(rig.mode).toBe('chase');
    t = drive(rig, car, pose, DT, t);
    const ideal = new THREE.Vector3(pose.x - config.camera.chase.distM, pose.y + config.camera.chase.heightM, pose.z);
    expect(new THREE.Vector3(...rig.debug().pos).distanceTo(ideal)).toBeLessThan(0.5);
  });
});

describe('Cámara de persecución', () => {
  it('Velocidad constante a 300 km/h: distancia estable y coche centrado', () => {
    const { rig, car, pose, camera } = setup();
    rig.next();
    setVelocity(car, 300, 0);
    let dMin = Infinity, dMax = -Infinity, ndcMax = 0, hMin = Infinity, hMax = -Infinity;
    const p = new THREE.Vector3();
    drive(rig, car, pose, 3, 0, () => {   // 3 s completos desde el primer update
      const d = camera.position.distanceTo(p.set(pose.x, pose.y, pose.z));
      dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
      const h = Math.hypot(camera.position.x - pose.x, camera.position.z - pose.z);
      hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
      p.project(camera);
      ndcMax = Math.max(ndcMax, Math.abs(p.x));
    });
    expect(dMax - dMin).toBeLessThan(0.1);
    expect(Math.abs(hMin - config.camera.chase.distM)).toBeLessThan(0.05);
    expect(Math.abs(hMax - config.camera.chase.distM)).toBeLessThan(0.05);
    expect(ndcMax).toBeLessThan(0.02);
  });

  it('Derrape: la mirada está más cerca de la velocidad que del rumbo', () => {
    const { rig, car, pose, camera } = setup();
    rig.next();
    setVelocity(car, 150, 15);   // velocidad 15° a la izquierda del rumbo (yaw = 0)
    drive(rig, car, pose, 2, 0);
    const f = camera.getWorldDirection(new THREE.Vector3());
    const lookDeg = Math.atan2(-f.z, f.x) / DEG;
    expect(Math.abs(lookDeg - 15)).toBeLessThan(Math.abs(lookDeg - 0));
  });
});

describe('Cámara de casco', () => {
  const rollDeg = (cam: THREE.PerspectiveCamera) => Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).y) / DEG;
  const pitchDeg = (cam: THREE.PerspectiveCamera) => Math.asin(cam.getWorldDirection(new THREE.Vector3()).y) / DEG;

  it('Balanceo en curva: 4 g laterales a la izquierda y vuelta a recta', () => {
    const { rig, car, pose, camera } = setup();
    setVelocity(car, 200, 0);
    car.aLat = 4 * G;
    let t = drive(rig, car, pose, 1, 0);
    expect(Math.abs(rollDeg(camera))).toBeGreaterThanOrEqual(2);
    expect(Math.abs(rollDeg(camera))).toBeLessThanOrEqual(6);
    expect(camera.near).toBe(0.1);
    car.aLat = 0;
    t = drive(rig, car, pose, 1, t);
    expect(Math.abs(rollDeg(camera))).toBeLessThan(0.2);
  });

  it('Frenada a 4 g: cabeceo hacia delante entre 1° y 4°', () => {
    const { rig, car, pose, camera } = setup();
    setVelocity(car, 250, 0);
    car.aLong = -4 * G;
    drive(rig, car, pose, 1, 0);
    const p = pitchDeg(camera);
    expect(p).toBeLessThanOrEqual(-1);
    expect(p).toBeGreaterThanOrEqual(-4);
  });
});

describe('Ancla de cámara (design D2)', () => {
  // Recorre los tres modos con aceleraciones y derrape para cubrir resortes, temblor y TV.
  function replay(rig: CameraRig, car: CarState, pose: CarPose, sample: () => number[]): number[][] {
    const out: number[][] = [];
    setVelocity(car, 220, 10);
    car.aLat = 3 * G; car.aLong = -2 * G;
    let t = 0;
    for (let m = 0; m < 3; m++) {
      t = drive(rig, car, pose, 0.5, t, () => out.push(sample()));
      rig.next();
    }
    return out;
  }

  it('Ancla = cámara: misma pose que sin ancla explícita en todos los modos', () => {
    const a = setup();
    const camB = new THREE.PerspectiveCamera(70, 16 / 9, 0.3, 2500);
    const rigB = new CameraRig(camB, track, config, camB);
    const carB = createCarState();
    const poseB: CarPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    expect(rigB.anchor).toBe(camB);
    expect(a.rig.anchor).toBe(a.camera);
    const ra = replay(a.rig, a.car, a.pose, () => [...a.camera.matrixWorld.elements, a.camera.fov, a.camera.near]);
    const rb = replay(rigB, carB, poseB, () => [...camB.matrixWorld.elements, camB.fov, camB.near]);
    expect(rb).toEqual(ra);
  });

  it('Ancla separada: la cámara hija ve igual que la cámara de escritorio', () => {
    const a = setup();
    const anchor = new THREE.Group();
    const camB = new THREE.PerspectiveCamera(70, 16 / 9, 0.3, 2500);
    anchor.add(camB);
    const rigB = new CameraRig(camB, track, config, anchor);
    const carB = createCarState();
    const poseB: CarPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    const ra = replay(a.rig, a.car, a.pose, () => [...a.camera.matrixWorld.elements]);
    const rb = replay(rigB, carB, poseB, () => [...camB.matrixWorld.elements]);
    expect(rb.length).toBe(ra.length);
    for (let i = 0; i < ra.length; i++) for (let j = 0; j < 16; j++) expect(rb[i][j]).toBeCloseTo(ra[i][j], 5);
    expect(camB.position.lengthSq()).toBe(0);
  });
});

describe('Cámaras sobre el relieve (b12, design D9)', () => {
  const CLEAR = config.world.cameraClearM;
  // Coche parado en x = s (pista recta a lo largo de +x, y = 0), rig en el modo pedido
  function at(ground: GroundFn | null, mode: 'chase' | 'tv', x: number) {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.3, 2500);
    const rig = new CameraRig(camera, track, config, undefined, ground);
    while (rig.mode !== mode) rig.next();
    const car = createCarState();
    car.s = x; car.x = x;
    const pose: CarPose = { x, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    rig.update(pose, car, DT, 0);
    return rig.debug();
  }
  const X = 1136;   // 20 m antes de la cámara de TV activa (índice 3, s ≈ 1156)

  it('Sin terreno: mismas cámaras que sin mundo', () => {
    for (const mode of ['chase', 'tv'] as const) expect(at(() => -100, mode, X)).toEqual(at(null, mode, X));
  });

  it('Rampa: TV y persecución quedan ≥ cameraClearM sobre el terreno', () => {
    const ramp: GroundFn = (x, z) => Math.max(-1, (-z - 8) * 1.5) + Math.max(0, X - 3 - x) * 0.8;   // sube hacia la izquierda y hacia atrás
    const tv = at(ramp, 'tv', X);
    expect(tv.pos[1]).toBeGreaterThanOrEqual(ramp(tv.pos[0], tv.pos[2]) + CLEAR - 1e-6);
    expect(terrainBlocks(ramp, tv.pos[0], tv.pos[1], tv.pos[2], X, 1, 0)).toBe(false);
    const ch = at(ramp, 'chase', X);
    expect(ch.pos[1]).toBeGreaterThanOrEqual(ramp(ch.pos[0], ch.pos[2]) + CLEAR - 1e-6);
  });

  it('Loma entre cámara y coche: se eleva (≤ +25 m) hasta despejar', () => {
    const base = at(null, 'tv', X);
    const cz = base.pos[2];
    const hill: GroundFn = (_x, z) => (z < cz * 0.25 && z > cz * 0.75 ? 6 : -1);
    expect(terrainBlocks(hill, base.pos[0], base.pos[1], base.pos[2], X, 1, 0)).toBe(true);
    const tv = at(hill, 'tv', X);
    expect(tv.tvIndex).toBe(base.tvIndex);
    expect(tv.pos[1]).toBeGreaterThan(base.pos[1]);
    expect(tv.pos[1]).toBeLessThanOrEqual(base.pos[1] + 25);
    expect(terrainBlocks(hill, tv.pos[0], tv.pos[1], tv.pos[2], X, 1, 0)).toBe(false);
  });

  it('Loma insalvable junto a la cámara activa: pasa a la siguiente', () => {
    const base = at(null, 'tv', X);
    const cx = base.pos[0], cz = base.pos[2];
    const wall: GroundFn = (x, z) => (Math.abs(x - cx) < 40 && z < cz * 0.5 && z > cz * 0.94 ? 100 : -1);
    const tv = at(wall, 'tv', X);
    expect(tv.tvIndex).toBe(base.tvIndex + 1);
    expect(terrainBlocks(wall, tv.pos[0], tv.pos[1], tv.pos[2], X, 1, 0)).toBe(false);
  });
});
