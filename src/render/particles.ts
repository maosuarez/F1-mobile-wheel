import * as THREE from 'three';
import { config, type GameConfig } from '../shared/config';
import type { CarState } from '../sim/types';

// Partículas de pista (design D6): tierra en la hierba y humo al deslizar. Un único THREE.Points con
// ShaderMaterial; la animación se calcula en el vertex shader desde uTime, la CPU solo escribe al emitir.

export type EmitCar = Pick<CarState, 'surface' | 'speed' | 'slip'>;
export interface ParticlePose { x: number; y: number; z: number; yaw: number }

// Emisor lógico puro: qué tipos emite el coche en este estado
export function shouldEmit(car: EmitCar, cfg: GameConfig = config): { dirt: boolean; smoke: boolean } {
  const P = cfg.particles;
  return {
    dirt: car.surface === 'grass' && car.speed > P.dirtMinMs,
    smoke: car.slip > P.smokeSlip && car.speed > P.smokeMinMs,
  };
}

const DEAD = -1e6;
const TYPE_DIRT = 0, TYPE_SMOKE = 1;

const vertexShader = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aVel;
  attribute float aBirth;
  attribute float aType;
  uniform float uTime;
  uniform vec2 uLife;
  uniform vec2 uSize;
  uniform float uGrowth;
  uniform float uPxPerM;
  varying float vType;
  varying float vFade;
  void main() {
    float life = aType < 0.5 ? uLife.x : uLife.y;
    float age = uTime - aBirth;
    if (age < 0.0 || age >= life) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vFade = 0.0;
      vType = aType;
      return;
    }
    float k = age / life;
    // Tierra: balística con gravedad; humo: sube a velocidad constante y crece
    vec3 p = aStart + aVel * age;
    float size = uSize.x;
    if (aType < 0.5) {
      p.y += -4.9 * age * age;
      p.y = max(p.y, aStart.y - 0.1);
    } else {
      size = uSize.y * (1.0 + uGrowth * k);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uPxPerM / max(-mv.z, 0.1), 0.0, 256.0);
    vFade = aType < 0.5 ? 1.0 - k * k : (1.0 - k) * smoothstep(0.0, 0.15, k);
    vType = aType;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uDirtColor;
  uniform vec3 uSmokeColor;
  uniform vec2 uAlpha;
  varying float vType;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0 || vFade <= 0.0) discard;
    bool dirt = vType < 0.5;
    float soft = dirt ? 1.0 - smoothstep(0.6, 1.0, r) : 1.0 - smoothstep(0.0, 1.0, r);
    float a = (dirt ? uAlpha.x : uAlpha.y) * soft * vFade;
    gl_FragColor = vec4(dirt ? uDirtColor : uSmokeColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Generador sembrado (mulberry32) para la dispersión
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TrackParticles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private geometry = new THREE.BufferGeometry();
  private start = new Float32Array(0);
  private vel = new Float32Array(0);
  private birth = new Float32Array(0);
  private type = new Float32Array(0);
  private capacity = 0;
  private head = 0;
  private lastT: number | null = null;
  private accDirt = 0;
  private accSmoke = 0;
  private readonly rand: () => number;
  // Ruedas en ejes del coche (x adelante, z lateral): fl, fr, rl, rr
  private readonly wheels: [number, number][];

  constructor(capacity: number, private readonly cfg: GameConfig = config) {
    const P = cfg.particles;
    this.rand = rng(P.seed);
    const L = cfg.car.wheelbaseM / 2, cv = cfg.carVisual;
    const fz = cv.halfTrackM - cv.tireFrontW / 2, rz = cv.halfTrackM - cv.tireRearW / 2;
    this.wheels = [[L, -fz], [L, fz], [-L, -rz], [-L, rz]];
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: new THREE.Vector2(P.dirtLifeS, P.smokeLifeS) },
        uSize: { value: new THREE.Vector2(P.dirtSizeM, P.smokeSizeM) },
        uGrowth: { value: P.smokeGrowth },
        uPxPerM: { value: 800 },
        uDirtColor: { value: new THREE.Color(P.dirtColor) },
        uSmokeColor: { value: new THREE.Color(P.smokeColor) },
        uAlpha: { value: new THREE.Vector2(P.dirtAlpha, P.smokeAlpha) },
      },
      vertexShader, fragmentShader,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'track-particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.setCapacity(capacity);
  }

  // Tamaño del anillo = QualitySettings.particles; al cambiarlo se vacía
  setCapacity(n: number): void {
    n = Math.max(0, Math.floor(n));
    if (n === this.capacity && this.geometry.getAttribute('aBirth')) return;
    this.capacity = n;
    this.head = 0;
    this.start = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.birth = new Float32Array(n).fill(DEAD);
    this.type = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(this.start, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aType', new THREE.BufferAttribute(this.type, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.dispose();
    this.geometry = g;
    this.points.geometry = g;
  }

  // Escala de tamaño en píxeles: altura del búfer de dibujo y FOV vertical de la cámara
  setView(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uPxPerM.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  // tS: tiempo de simulación inyectado (s). Con el juego en pausa tS no avanza y no se emite nada
  update(car: EmitCar, pose: ParticlePose, tS: number): void {
    this.material.uniforms.uTime.value = tS;
    if (this.lastT === null || tS < this.lastT) {
      if (this.lastT !== null) this.clear();
      this.lastT = tS;
      return;
    }
    const dt = tS - this.lastT;
    this.lastT = tS;
    if (dt <= 0 || this.capacity === 0) return;
    const P = this.cfg.particles;
    const e = shouldEmit(car, this.cfg);
    if (e.dirt) {
      this.accDirt += P.dirtRatePerWheel * Math.min(1, car.speed / P.dirtRefMs) * dt;
      while (this.accDirt >= 1) { this.accDirt -= 1; for (let w = 0; w < 4; w++) this.emit(TYPE_DIRT, w, car, pose, tS, dt); }
    } else this.accDirt = 0;
    if (e.smoke) {
      this.accSmoke += P.smokeRatePerWheel * car.slip * dt;
      while (this.accSmoke >= 1) { this.accSmoke -= 1; for (let w = 2; w < 4; w++) this.emit(TYPE_SMOKE, w, car, pose, tS, dt); }
    } else this.accSmoke = 0;
  }

  private emit(type: number, wheel: number, car: EmitCar, pose: ParticlePose, tS: number, dt: number): void {
    const P = this.cfg.particles, r = this.rand;
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    const [lx, lz] = this.wheels[wheel];
    // Rotación Y por yaw: x' = x cos + z sin; z' = −x sin + z cos. Adelante = (cos, 0, −sin)
    const dirt = type === TYPE_DIRT;
    const back = dirt ? -0.3 : -0.1;                        // nace en el borde trasero de la rueda
    const wx = pose.x + c * (lx + back) + s * lz, wz = pose.z - s * (lx + back) + c * lz;
    const spread = dirt ? P.dirtSpreadMs : P.smokeSpreadMs;
    const carry = car.speed * (dirt ? P.dirtBackFrac : P.smokeBackFrac);
    const vx = c * carry + (r() - 0.5) * 2 * spread, vz = -s * carry + (r() - 0.5) * 2 * spread;
    const vy = dirt ? P.dirtUpMs * (0.5 + r()) : P.smokeUpMs * (0.5 + r());
    this.start[i * 3] = wx; this.start[i * 3 + 1] = pose.y + 0.1; this.start[i * 3 + 2] = wz;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    // Nacimiento repartido dentro del paso para no emitir en ráfagas
    this.birth[i] = tS - r() * dt;
    this.type[i] = type;
    this.markDirty();
  }

  private markDirty(): void {
    for (const n of ['aStart', 'aVel', 'aBirth', 'aType']) (this.geometry.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.birth.fill(DEAD);
    this.accDirt = this.accSmoke = 0;
    this.markDirty();
  }

  // Partículas vivas en el instante actual, por tipo
  debug(): { active: number; dirt: number; smoke: number } {
    const t = this.material.uniforms.uTime.value as number, P = this.cfg.particles;
    let dirt = 0, smoke = 0;
    for (let i = 0; i < this.capacity; i++) {
      const age = t - this.birth[i];
      if (age < 0) continue;
      if (this.type[i] === TYPE_DIRT) { if (age < P.dirtLifeS) dirt++; } else if (age < P.smokeLifeS) smoke++;
    }
    return { active: dirt + smoke, dirt, smoke };
  }

  // Posiciones de nacimiento y tipo de las partículas vivas (diagnóstico y tests)
  alive(): { x: number; y: number; z: number; type: 'dirt' | 'smoke'; birth: number }[] {
    const t = this.material.uniforms.uTime.value as number, P = this.cfg.particles, out = [];
    for (let i = 0; i < this.capacity; i++) {
      const age = t - this.birth[i], dirt = this.type[i] === TYPE_DIRT;
      if (age >= 0 && age < (dirt ? P.dirtLifeS : P.smokeLifeS)) {
        out.push({ x: this.start[i * 3], y: this.start[i * 3 + 1], z: this.start[i * 3 + 2], type: dirt ? 'dirt' as const : 'smoke' as const, birth: this.birth[i] });
      }
    }
    return out;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
