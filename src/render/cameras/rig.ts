import * as THREE from 'three';
import type { GameConfig } from '../../shared/config';
import { maxSteerRad } from '../../sim/car';
import type { CarState } from '../../sim/types';
import type { Track } from '../../track/types';
import { activeTvCamera, buildTvCameras, CriticalSpring, fovFor, shakeAmplitude, shakeOffset, tvFovDeg, type TvCamera } from './math';

// Rig de cámaras (design D3): casco, persecución y TV sobre una THREE.PerspectiveCamera.

export type CameraMode = 'chase' | 'helmet' | 'tv';
export interface CarPose { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }

const ORDER: CameraMode[] = ['helmet', 'chase', 'tv'];
const DEG = Math.PI / 180;
const HELMET_NEAR = 0.1;
const MIN_CHASE_SPEED_MS = 5;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class CameraRig {
  mode: CameraMode;
  private readonly sx: CriticalSpring;
  private readonly sy: CriticalSpring;
  private readonly sz: CriticalSpring;
  private readonly sRoll: CriticalSpring;
  private readonly sPitch: CriticalSpring;
  private readonly tvCams: TvCamera[];
  private needSnap = true;
  private tvIndex = -1;
  private fovDeg: number;
  private shakeM = 0;
  // Temporales reutilizados (sin asignaciones por fotograma)
  private readonly v = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly qCar = new THREE.Quaternion();
  private readonly qLocal = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly mLook = new THREE.Matrix4();
  // Objeto que recibe la pose del rig (design D2): en escritorio la propia cámara; en VR un ancla padre de la cámara
  readonly anchor: THREE.Object3D;

  constructor(readonly camera: THREE.PerspectiveCamera, private readonly track: Track, private readonly cfg: GameConfig, anchor?: THREE.Object3D) {
    this.anchor = anchor ?? camera;
    const c = cfg.camera;
    this.mode = c.defaultMode;
    this.sx = new CriticalSpring(c.chase.omega);
    this.sy = new CriticalSpring(c.chase.omega);
    this.sz = new CriticalSpring(c.chase.omega);
    this.sRoll = new CriticalSpring(c.helmet.omega);
    this.sPitch = new CriticalSpring(c.helmet.omega);
    this.tvCams = buildTvCameras(track, c);
    this.fovDeg = camera.fov;
  }

  // Avanza al siguiente modo (helmet → chase → tv → helmet); corte inmediato en el próximo update.
  next(): CameraMode {
    this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length];
    this.needSnap = true;
    return this.mode;
  }

  update(pose: CarPose, car: CarState, dtS: number, tS: number): void {
    const c = this.cfg.camera;
    const cam = this.camera;
    const a = this.anchor;
    const snap = this.needSnap;
    this.needSnap = false;
    const kmh = car.speed * 3.6;
    let fov: number;
    let near = this.cfg.render.near;
    this.tvIndex = -1;

    if (this.mode === 'chase') {
      const hx = Math.cos(pose.yaw), hz = -Math.sin(pose.yaw);   // rumbo
      let vdx = hx, vdz = hz;                                    // dirección de la velocidad
      if (car.speed > MIN_CHASE_SPEED_MS) {
        const vl = Math.hypot(car.vx, car.vz);
        if (vl > 1e-6) { vdx = car.vx / vl; vdz = car.vz / vl; }
      }
      const b = c.chase.velocityBlend;
      let dx = hx + (vdx - hx) * b, dz = hz + (vdz - hz) * b;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      // Resortes sobre el desplazamiento cámara−coche (ejes de mundo): retraso 0 en recta
      const ox = -dx * c.chase.distM, oy = c.chase.heightM, oz = -dz * c.chase.distM;
      if (snap) { this.sx.snap(ox); this.sy.snap(oy); this.sz.snap(oz); }
      else { this.sx.step(ox, dtS); this.sy.step(oy, dtS); this.sz.step(oz, dtS); }
      a.position.set(pose.x + this.sx.x, pose.y + this.sy.x, pose.z + this.sz.x);
      this.look.set(pose.x + vdx * c.chase.lookAheadM, pose.y, pose.z + vdz * c.chase.lookAheadM);
      this.lookAt(this.look);
      fov = fovFor(kmh, c);
    } else if (this.mode === 'helmet') {
      const h = c.helmet, g = this.cfg.sim.g;
      const rollT = clamp(-car.aLat / g * h.rollDegPerG, -h.maxDeg, h.maxDeg);
      const pitchT = clamp(-car.aLong / g * h.pitchDegPerG, -h.maxDeg, h.maxDeg);
      if (snap) { this.sRoll.snap(rollT); this.sPitch.snap(pitchT); }
      else { this.sRoll.step(rollT, dtS); this.sPitch.step(pitchT, dtS); }
      const steer = clamp(car.steerAngle / maxSteerRad(car.speed, this.cfg), -1, 1);   // >0 ⇒ derecha
      // Orientación del coche como en main.ts (orden 'YZX', cabeceo sobre Z, balanceo sobre X)
      this.euler.set(pose.roll, pose.yaw, pose.pitch, 'YZX');
      this.qCar.setFromEuler(this.euler);
      a.position.set(h.offset[0], h.offset[1], h.offset[2]).applyQuaternion(this.qCar);
      a.position.x += pose.x; a.position.y += pose.y; a.position.z += pose.z;
      // Cámara (−Z) hacia +X del coche; guiñada por la dirección, cabeceo (>0 ⇒ hacia delante) y balanceo
      this.euler.set(-this.sPitch.x * DEG, -Math.PI / 2 - steer * h.lookSteerDeg * DEG, this.sRoll.x * DEG, 'YXZ');
      this.qLocal.setFromEuler(this.euler);
      a.quaternion.copy(this.qCar).multiply(this.qLocal);
      fov = fovFor(kmh, c);
      near = HELMET_NEAR;
    } else {
      const i = activeTvCamera(this.tvCams, this.track, car.s);
      const tv = this.tvCams[i];
      this.tvIndex = i;
      a.position.set(tv.x, tv.y, tv.z);
      this.look.set(pose.x, pose.y, pose.z);
      this.lookAt(this.look);
      fov = tvFovDeg(a.position.distanceTo(this.look), c);
    }

    // Temblor en el espacio de la cámara (solo cámaras a bordo/persecución)
    this.shakeM = 0;
    if (this.mode !== 'tv') {
      const amp = shakeAmplitude(car, c);
      this.shakeM = amp;
      if (amp > 0) {
        const [ox, oy] = shakeOffset(amp, tS, c);
        this.right.set(1, 0, 0).applyQuaternion(a.quaternion);
        this.up.set(0, 1, 0).applyQuaternion(a.quaternion);
        a.position.addScaledVector(this.right, ox).addScaledVector(this.up, oy);
      }
    }

    if (cam.fov !== fov || cam.near !== near) {
      cam.fov = fov;
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    this.fovDeg = fov;
    a.updateMatrixWorld();
  }

  // Orienta el ancla con la convención de cámara (−Z hacia el objetivo), también si el ancla no es una cámara
  private lookAt(target: THREE.Vector3): void {
    const a = this.anchor;
    a.up.set(0, 1, 0);
    if (a === this.camera) { a.lookAt(target); return; }
    this.mLook.lookAt(a.position, target, a.up);
    a.quaternion.setFromRotationMatrix(this.mLook);
  }

  debug(): { mode: CameraMode; fovDeg: number; shakeM: number; pos: [number, number, number]; tvIndex: number } {
    const p = this.anchor.position;
    return { mode: this.mode, fovDeg: this.fovDeg, shakeM: this.shakeM, pos: [p.x, p.y, p.z], tvIndex: this.tvIndex };
  }
}
