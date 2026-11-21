import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { config, type GameConfig } from '../shared/config';
import { buildCar } from './car';
import { createCarMaterials } from './carMaterials';

// Rivales instanciados (b14 D6): 4 InstancedMesh (pintura con color primario por instancia, acentos con el color de
// acento, carbono + halo + alerón, ruedas ×4 por coche). Sin habitáculo interior ni volante. Pose interpolada entre el
// paso anterior y el actual; ruedas que giran con la velocidad y delanteras que viran; ocultos a > rivalCullM detrás.

export interface RivalPose { x: number; y: number; z: number; yaw: number }
export interface RivalRenderState {
  team: number; prev: RivalPose; cur: RivalPose; pitch: number; vLong: number; steerAngle: number;
}
export interface TeamColors { primary: string; accent: string }

const MAX_RIVALS = 9;
const WHEELS = 4;

// Separa una geometría no indexada con color por vértice en triángulos de color ≈ `c` y el resto.
function splitByColor(g: THREE.BufferGeometry, c: THREE.Color): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), col = g.getAttribute('color');
  const a: number[][] = [[], []], b: number[][] = [[], []];
  for (let t = 0; t < pos.count; t += 3) {
    const same = Math.abs(col.getX(t) - c.r) + Math.abs(col.getY(t) - c.g) + Math.abs(col.getZ(t) - c.b) < 1e-3;
    const [P, N] = same ? a : b;
    for (let v = t; v < t + 3; v++) { P.push(pos.getX(v), pos.getY(v), pos.getZ(v)); N.push(nor.getX(v), nor.getY(v), nor.getZ(v)); }
  }
  const mk = ([P, N]: number[][]) => {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    out.computeBoundingSphere();
    return out;
  };
  return [mk(a), mk(b)];
}

// Solo posición y normal (para fusionar geometrías de procedencia distinta).
function bare(g: THREE.BufferGeometry, m?: THREE.Matrix4, color?: THREE.Color): THREE.BufferGeometry {
  const out = (g.index ? g.toNonIndexed() : g.clone());
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (m) out.applyMatrix4(m);
  if (color) {
    const n = out.getAttribute('position').count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

export class RivalsRender {
  readonly group = new THREE.Group();
  readonly meshes: { paint: THREE.InstancedMesh; accent: THREE.InstancedMesh; carbon: THREE.InstancedMesh; wheels: THREE.InstancedMesh };
  private readonly teams: TeamColors[];
  private readonly cfg: GameConfig;
  private readonly wheelPos: THREE.Vector3[];
  private readonly rearScale: number;
  private spin: number[] = [];
  private _visible = 0;
  private count = 0;
  // Temporales
  private readonly m = new THREE.Matrix4();
  private readonly mw = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YZX');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(teams: TeamColors[], cfg: GameConfig = config) {
    this.teams = teams;
    this.cfg = cfg;
    this.group.name = 'rivals';
    const cv = cfg.carVisual;
    const ref = buildCar(cfg);
    const get = (name: string) => ref.group.getObjectByName(name) as THREE.Mesh;
    ref.group.updateMatrixWorld(true);

    // Carrocería: pintura primaria / acentos (incluye el dorsal blanco, que toma el color de acento)
    const [paintG, accentG] = splitByColor(get('body-paint').geometry, new THREE.Color(cv.colors.primary));
    // Carbono + halo + suspensión + plano del alerón (en su posición de reposo)
    const flap = get('rear-wing-flap');
    const carbonG = mergeGeometries([bare(get('carbon').geometry), bare(flap.geometry, flap.matrixWorld)])!;
    // Rueda delantera (neumático + llanta) con color por vértice; las traseras se escalan en anchura
    const wfl = ref.group.getObjectByName('wheel-fl')!;
    const tire = wfl.getObjectByName('tire') as THREE.Mesh, rim = wfl.getObjectByName('rim') as THREE.Mesh;
    const wheelG = mergeGeometries([bare(tire.geometry, undefined, new THREE.Color('#0c0c0e')), bare(rim.geometry, undefined, new THREE.Color(cv.colors.rim))])!;
    this.rearScale = cv.tireRearW / cv.tireFrontW;
    this.wheelPos = ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr'].map((n) => ref.group.getObjectByName(n)!.position.clone());

    const mats = createCarMaterials(cfg);
    const paintMat = new THREE.MeshPhysicalMaterial({ metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08,
      envMapIntensity: cfg.light.carEnvIntensity });
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.7 });
    const inst = (name: string, g: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      const im = new THREE.InstancedMesh(g, mat, n);
      im.name = name;
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;      // las instancias se mueven por todo el circuito
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
      return im;
    };
    this.meshes = {
      paint: inst('rival-paint', paintG, paintMat, MAX_RIVALS),
      accent: inst('rival-accent', accentG, paintMat, MAX_RIVALS),
      carbon: inst('rival-carbon', carbonG, mats.carbon, MAX_RIVALS),
      wheels: inst('rival-wheels', wheelG, wheelMat, MAX_RIVALS * WHEELS),
    };
    // Colores por instancia (se fijan al cambiar la escudería de cada plaza)
    const c = new THREE.Color();
    for (let i = 0; i < MAX_RIVALS; i++) {
      this.meshes.paint.setColorAt(i, c.set('#ffffff'));
      this.meshes.accent.setColorAt(i, c);
    }
  }

  // Draw calls de los rivales (sin sombras): una por malla con instancias.
  get drawCalls(): number {
    return this.count === 0 ? 0 : Object.values(this.meshes).length;
  }
  // Rivales dibujados (no ocultos) en el último update.
  get visible(): number { return this._visible; }

  // alpha: interpolación entre prev y cur; dtS: avance del giro de ruedas; camera: para ocultar los muy lejanos detrás.
  update(rivals: readonly RivalRenderState[], alpha: number, dtS: number, camera: THREE.Camera): void {
    const n = Math.min(rivals.length, MAX_RIVALS);
    const { paint, accent, carbon, wheels } = this.meshes;
    if (n !== this.count) {
      this.count = n;
      paint.count = accent.count = carbon.count = n;
      wheels.count = n * WHEELS;
      this.spin = new Array(n).fill(0);
    }
    const c = new THREE.Color();
    camera.getWorldPosition(this.p);
    camera.getWorldDirection(this.camFwd);
    const cx = this.p.x, cy = this.p.y, cz = this.p.z;
    const cull = this.cfg.race.rivalCullM, R = this.cfg.carVisual.wheelRadiusM;
    this._visible = 0;
    for (let i = 0; i < n; i++) {
      const r = rivals[i];
      const team = this.teams[r.team % this.teams.length];
      paint.setColorAt(i, c.set(team.primary));
      accent.setColorAt(i, c.set(team.accent));
      let dy = r.cur.yaw - r.prev.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const x = r.prev.x + (r.cur.x - r.prev.x) * alpha, y = r.prev.y + (r.cur.y - r.prev.y) * alpha;
      const z = r.prev.z + (r.cur.z - r.prev.z) * alpha, yaw = r.prev.yaw + dy * alpha;
      this.spin[i] = (this.spin[i] + (r.vLong / R) * dtS) % (Math.PI * 2);
      const ox = x - cx, oy = y - cy, oz = z - cz;
      const behind = ox * this.camFwd.x + oy * this.camFwd.y + oz * this.camFwd.z < 0;
      if (behind && ox * ox + oy * oy + oz * oz > cull * cull) {
        paint.setMatrixAt(i, this.zero); accent.setMatrixAt(i, this.zero); carbon.setMatrixAt(i, this.zero);
        for (let w = 0; w < WHEELS; w++) wheels.setMatrixAt(i * WHEELS + w, this.zero);
        continue;
      }
      this._visible++;
      this.e.set(0, yaw, r.pitch, 'YZX');
      this.m.compose(this.s.set(x, y, z), this.q.setFromEuler(this.e), this.p.set(1, 1, 1));
      paint.setMatrixAt(i, this.m); accent.setMatrixAt(i, this.m); carbon.setMatrixAt(i, this.m);
      for (let w = 0; w < WHEELS; w++) {
        const front = w < 2;
        this.e.set(0, front ? -r.steerAngle : 0, -this.spin[i], 'YZX');
        this.mw.compose(this.wheelPos[w], this.q.setFromEuler(this.e), this.p.set(1, 1, front ? 1 : this.rearScale));
        wheels.setMatrixAt(i * WHEELS + w, this.mw.premultiply(this.m));
      }
    }
    for (const im of [paint, accent, carbon, wheels]) im.instanceMatrix.needsUpdate = true;
    if (paint.instanceColor) paint.instanceColor.needsUpdate = true;
    if (accent.instanceColor) accent.instanceColor.needsUpdate = true;
  }
}
