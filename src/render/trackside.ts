import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { config } from '../shared/config';
import type { KerbType, Track } from '../track/types';
import { BARRIER_CODE, KERB_HEIGHT_M, KERB_WIDTH_M } from '../track/types';
import { inRangeS, sampleAt, wrapS } from '../track/query';
import { Builder, frameAt, GRASS_DROP_M, pt, type Frame } from '../track/mesh';
import type { World } from '../track/world';
import type { TrackMaterials } from './trackMaterials';
import type { QualitySettings } from './quality';

// Kit de borde de pista (b13, design D5): pianos con perfil, barreras por tipo en la posición del muro de la
// simulación (borde + runoff_m), valla de retención, carteles de frenada, puestos de comisarios y líneas de boxes.
// Presupuesto: ≤ 15 draw calls (una malla fusionada o instanciada por elemento).

export interface TracksideMaterials {
  kerb: THREE.MeshStandardMaterial;      // color por vértice: pianos, salchichas y líneas de boxes
  tecpro: THREE.MeshStandardMaterial;    // color por vértice: bloques rojos/azules
  armco: THREE.MeshStandardMaterial;     // color por vértice: ola metálica y postes
  concrete: THREE.MeshStandardMaterial;  // compartido con TrackMaterials (textura de hormigón)
  fence: THREE.MeshStandardMaterial;     // malla con textura alfa
  board: THREE.MeshStandardMaterial;     // atlas 150/100/50
  marshal: THREE.MeshStandardMaterial;   // color por vértice
}

const UVM = config.surfaces.uvMeters;
const BASE_H = -GRASS_DROP_M;        // base de las barreras: a la altura del borde exterior de la escapatoria
const KERB_EDGE_H = -0.01;           // pie del canto exterior del piano (hierba interior 1 cm bajo el asfalto)
const SERRATED_BASE_H = 0.01;        // valle de los dientes del piano dentado
const SUB_PER_TOOTH = 4;             // subdivisiones por diente
const TECPRO_DEPTH_M = 1.0;          // fondo de los bloques Tecpro
const CONCRETE_DEPTH_M = 0.3;        // grosor del muro de hormigón
const FENCE_GAP_M = 0.3;             // valla detrás de la barrera
const FENCE_TILE_M = 0.5;            // metros por repetición de la textura de malla
const FENCE_POST_EVERY = 3;          // un poste cada 3 muestras (~6 m)
const ARMCO_POST_EVERY = 2;          // un poste del guardarraíl cada 2 muestras (~4 m)
// Perfil de doble ola del guardarraíl: (distancia hacia fuera desde la cara interna, altura); las crestas en e = 0
const ARMCO_PROFILE: readonly [number, number][] = [[0.08, 0.75], [0, 0.67], [0.08, 0.55], [0, 0.43], [0.08, 0.35]];
const BOARD_INSET_M = 1.0;           // carteles 1 m por delante de la barrera
const BOARD_BOTTOM_M = 0.5;          // altura del borde inferior de la placa
const MARSHAL_OUT_M = 4;             // casetas 4 m por fuera de la barrera
const PIT_LINE_M = 0.4;              // ancho de las líneas de entrada y salida de boxes
const PIT_LINE_LIFT_M = 0.03;

const C_RED = new THREE.Color('#c8102e'), C_WHITE = new THREE.Color('#ffffff'), C_YELLOW = new THREE.Color('#f2c200');
const C_TEC_RED = new THREE.Color('#c62828'), C_TEC_BLUE = new THREE.Color('#1f4fa8');
const C_RAIL = new THREE.Color('#b8bcc2'), C_POST = new THREE.Color('#6b6e72');
const C_HUT = new THREE.Color('#e9e6df'), C_ROOF = new THREE.Color('#e36414');
const KERB_CODE: Record<KerbType, number> = { flat: 0, serrated: 1, sausage: 2 };
const BOARD_VALUES = [150, 100, 50] as const;

type V3 = [number, number, number];

// Quad con normal explícita; el orden de los triángulos se ajusta para que la cara frontal mire hacia `n`
function quadN(B: Builder, a0: V3, b0: V3, a1: V3, b1: V3, n: ArrayLike<number>, c: THREE.Color | null, uv: [number, number][]): void {
  const i = [a0, b0, a1, b1].map((p, k) => B.vert(p, n, c, uv[k][0], uv[k][1]));
  // Normal geométrica del triángulo (a0, a1, b0)
  const ux = a1[0] - a0[0], uy = a1[1] - a0[1], uz = a1[2] - a0[2];
  const vx = b0[0] - a0[0], vy = b0[1] - a0[1], vz = b0[2] - a0[2];
  const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
  if (gx * n[0] + gy * n[1] + gz * n[2] >= 0) B.idx.push(i[0], i[2], i[1], i[1], i[2], i[3]);
  else B.idx.push(i[0], i[1], i[2], i[1], i[3], i[2]);
}

function lerpFrame(a: Frame, b: Frame, u: number): Frame {
  const l = (x: number, y: number) => x + (y - x) * u;
  let nx = l(a.nx, b.nx), nz = l(a.nz, b.nz);
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  return { x: l(a.x, b.x), y: l(a.y, b.y), z: l(a.z, b.z), nx, nz, tb: l(a.tb, b.tb), wl: l(a.wl, b.wl), wr: l(a.wr, b.wr), s: l(a.s, b.s),
    normal: [l(a.normal[0], b.normal[0]), l(a.normal[1], b.normal[1]), l(a.normal[2], b.normal[2])] };
}

// Normal horizontal hacia fuera de la pista en el lado dado
const outN = (f: Frame, side: number): V3 => [side * f.nx, 0, side * f.nz];
const inN = (f: Frame, side: number): V3 => [-side * f.nx, 0, -side * f.nz];
// d del borde del asfalto y del muro de la simulación
const edgeD = (f: Frame, side: number) => (side > 0 ? f.wl : -f.wr);
const wallD = (t: Track, f: Frame, side: number) => edgeD(f, side) + side * t.runoff;

// Tipo de piano por muestra y lado (misma inclusión de extremos que computeKerbFlags)
export function kerbTypeTables(t: Track): { L: Uint8Array; R: Uint8Array } {
  const L = new Uint8Array(t.n), R = new Uint8Array(t.n);
  for (const kb of t.kerbs) {
    const tab = kb.side === 'left' ? L : R, code = KERB_CODE[kb.type ?? 'flat'];
    for (let i = 0; i < t.n; i++) if (inRangeS(t, t.s[i], kb.s0, kb.s1) || t.s[i] === kb.s1) tab[i] = code;
  }
  return { L, R };
}

function buildFrames(t: Track): Frame[] {
  const F: Frame[] = [];
  for (let r = 0; r <= t.n; r++) F.push(frameAt(t, r));
  return F;
}

// --- Pianos ---

function kerbGeometry(t: Track, F: Frame[]): THREE.BufferGeometry {
  const B = new Builder();
  const types = kerbTypeTables(t);
  const T = config.trackside;
  for (let r = 0; r < t.n; r++) {
    const i0 = r, i1 = (r + 1) % t.n, f0 = F[r], f1 = F[r + 1];
    for (const side of [1, -1]) {
      const flags = side > 0 ? t.kerbL : t.kerbR;
      if (!flags[i0] || !flags[i1]) continue;
      const type = (side > 0 ? types.L : types.R)[i0];
      const color = Math.floor((f0.s + f1.s) / 2 / T.kerbStripeM) % 2 === 0 ? C_RED : C_WHITE;
      const dIn = (f: Frame) => edgeD(f, side), dOut = (f: Frame) => edgeD(f, side) + side * KERB_WIDTH_M;
      const uv = (f: Frame, d: number): [number, number] => [d / UVM, f.s / UVM];
      if (type === KERB_CODE.serrated) {
        // Dientes de serratedH cada serratedToothM (onda triangular sobre s)
        const m = Math.max(1, Math.round(((f1.s - f0.s) / T.serratedToothM) * SUB_PER_TOOTH));
        const h = (s: number) => {
          const u = (s / T.serratedToothM) % 1;
          return SERRATED_BASE_H + (T.serratedH - SERRATED_BASE_H) * (u < 0.5 ? 2 * u : 2 - 2 * u);
        };
        for (let k = 0; k < m; k++) {
          const g0 = lerpFrame(f0, f1, k / m), g1 = lerpFrame(f0, f1, (k + 1) / m);
          quadN(B, pt(g0, dIn(g0), h(g0.s)), pt(g0, dOut(g0), h(g0.s)), pt(g1, dIn(g1), h(g1.s)), pt(g1, dOut(g1), h(g1.s)), g0.normal, color,
            [uv(g0, dIn(g0)), uv(g0, dOut(g0)), uv(g1, dIn(g1)), uv(g1, dOut(g1))]);
        }
      } else {
        // Plano de 3 cm con canto exterior
        quadN(B, pt(f0, dIn(f0), KERB_HEIGHT_M), pt(f0, dOut(f0), KERB_HEIGHT_M), pt(f1, dIn(f1), KERB_HEIGHT_M), pt(f1, dOut(f1), KERB_HEIGHT_M),
          f0.normal, color, [uv(f0, dIn(f0)), uv(f0, dOut(f0)), uv(f1, dIn(f1)), uv(f1, dOut(f1))]);
        quadN(B, pt(f0, dOut(f0), KERB_EDGE_H), pt(f0, dOut(f0), KERB_HEIGHT_M), pt(f1, dOut(f1), KERB_EDGE_H), pt(f1, dOut(f1), KERB_HEIGHT_M),
          outN(f0, side), color, [[0, 0], [0, 0], [0, 0], [0, 0]]);
      }
      if (type === KERB_CODE.sausage) {
        // Salchicha amarilla por fuera del piano: media elipse de sausageW × sausageH
        const prof: [number, number, V3][] = [];
        const N = 6;
        for (let k = 0; k <= N; k++) {
          const th = (k / N) * Math.PI;
          prof.push([(T.sausageW / 2) * (1 - Math.cos(th)), KERB_EDGE_H + (T.sausageH - KERB_EDGE_H) * Math.sin(th), [-Math.cos(th), Math.sin(th), 0]]);
        }
        for (let k = 0; k < N; k++) {
          const [e0, h0, n0] = prof[k], [e1, h1] = prof[k + 1];
          const nm = (f: Frame): V3 => [n0[0] * side * f.nx, n0[1], n0[0] * side * f.nz];
          const P = (f: Frame, e: number, h: number) => pt(f, dOut(f) + side * e, h);
          quadN(B, P(f0, e0, h0), P(f0, e1, h1), P(f1, e0, h0), P(f1, e1, h1), nm(f0), C_YELLOW, [[0, 0], [0, 0], [0, 0], [0, 0]]);
        }
      }
    }
  }
  return B.build(true, true);
}

// --- Barreras y valla ---

interface BarrierGeos { tecpro: THREE.BufferGeometry; armco: THREE.BufferGeometry; concrete: THREE.BufferGeometry; fence: THREE.BufferGeometry }

function barrierGeometries(t: Track, F: Frame[], posts: boolean): BarrierGeos {
  const T = config.trackside;
  const tec = new Builder(), arm = new Builder(), con = new Builder(), fen = new Builder();
  const zeroUv: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  for (let r = 0; r < t.n; r++) {
    const i0 = r, f0 = F[r], f1 = F[r + 1];
    for (const side of [1, -1]) {
      const code = (side > 0 ? t.barrierL : t.barrierR)[i0];
      // Punto a e metros por fuera de la cara interna (en el muro de la simulación) y altura h
      const P = (f: Frame, e: number, h: number) => pt(f, wallD(t, f, side) + side * e, h);
      const box = (B: Builder, depth: number, height: number, c: THREE.Color | null) => {
        const uvV = (h0: number, h1: number): [number, number][] => [[f0.s / UVM, h0 / UVM], [f0.s / UVM, h1 / UVM], [f1.s / UVM, h0 / UVM], [f1.s / UVM, h1 / UVM]];
        quadN(B, P(f0, 0, BASE_H), P(f0, 0, height), P(f1, 0, BASE_H), P(f1, 0, height), inN(f0, side), c, uvV(BASE_H, height));
        quadN(B, P(f0, 0, height), P(f0, depth, height), P(f1, 0, height), P(f1, depth, height), f0.normal, c,
          [[f0.s / UVM, 0], [f0.s / UVM, depth / UVM], [f1.s / UVM, 0], [f1.s / UVM, depth / UVM]]);
        quadN(B, P(f0, depth, BASE_H), P(f0, depth, height), P(f1, depth, BASE_H), P(f1, depth, height), outN(f0, side), c, uvV(BASE_H, height));
      };
      let fenceE = -1;
      if (code === BARRIER_CODE.tecpro) {
        box(tec, TECPRO_DEPTH_M, T.tecproH, Math.floor(f0.s / T.kerbStripeM) % 2 === 0 ? C_TEC_RED : C_TEC_BLUE);
        fenceE = TECPRO_DEPTH_M + FENCE_GAP_M;
      } else if (code === BARRIER_CODE.concrete) {
        box(con, CONCRETE_DEPTH_M, T.concreteH, null);
        fenceE = CONCRETE_DEPTH_M + FENCE_GAP_M;
      } else {
        // Guardarraíl: doble ola (ambas caras visibles con DoubleSide) y postes cada ARMCO_POST_EVERY muestras
        const top = T.armcoH / 0.75;   // el perfil está definido para 0,75 m
        for (let k = 0; k < ARMCO_PROFILE.length - 1; k++) {
          const [e0, h0] = ARMCO_PROFILE[k], [e1, h1] = ARMCO_PROFILE[k + 1];
          quadN(arm, P(f0, e1, h1 * top), P(f0, e0, h0 * top), P(f1, e1, h1 * top), P(f1, e0, h0 * top), inN(f0, side), C_RAIL, zeroUv);
        }
        if (posts && r % ARMCO_POST_EVERY === 0) {
          const g = lerpFrame(f0, f1, 0.08 / Math.max(f1.s - f0.s, 0.1));
          quadN(arm, P(f0, 0.12, BASE_H), P(f0, 0.12, T.armcoH - 0.05), P(g, 0.12, BASE_H), P(g, 0.12, T.armcoH - 0.05), inN(f0, side), C_POST, zeroUv);
          quadN(arm, P(f0, 0.12, BASE_H), P(f0, 0.12, T.armcoH - 0.05), P(f0, 0.27, BASE_H), P(f0, 0.27, T.armcoH - 0.05), [-f0.nz, 0, f0.nx], C_POST, zeroUv);
        }
      }
      if (fenceE > 0) {
        const uv = (f: Frame, h: number): [number, number] => [f.s / FENCE_TILE_M, h / FENCE_TILE_M];
        quadN(fen, P(f0, fenceE, BASE_H), P(f0, fenceE, T.fenceH), P(f1, fenceE, BASE_H), P(f1, fenceE, T.fenceH), inN(f0, side), null,
          [uv(f0, BASE_H), uv(f0, T.fenceH), uv(f1, BASE_H), uv(f1, T.fenceH)]);
        if (posts && r % FENCE_POST_EVERY === 0) {
          // Poste: UV en un píxel opaco de la malla
          const g = lerpFrame(f0, f1, 0.08 / Math.max(f1.s - f0.s, 0.1));
          quadN(fen, P(f0, fenceE, BASE_H), P(f0, fenceE, T.fenceH), P(g, fenceE, BASE_H), P(g, fenceE, T.fenceH), inN(f0, side), null,
            [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]]);
        }
      }
    }
  }
  return { tecpro: tec.build(true, true), armco: arm.build(true, true), concrete: con.build(false, true), fence: fen.build(false, true) };
}

// --- Carteles de frenada ---

// Atlas 4 × 1: 150, 100, 50 y una celda gris para el resto de caras. CanvasTexture en el navegador; en Node, blanco
export function createBoardAtlas(): THREE.Texture {
  const W = 512, H = 96;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (ctx) {
      for (let k = 0; k < 3; k++) {
        const x = k * 128;
        ctx.fillStyle = '#f4f4f0'; ctx.fillRect(x, 0, 128, H);
        ctx.fillStyle = '#111111'; ctx.fillRect(x, 0, 128, 8); ctx.fillRect(x, H - 8, 128, 8);
        ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(BOARD_VALUES[k]), x + 64, H / 2 + 2);
      }
      ctx.fillStyle = '#5c6066'; ctx.fillRect(384, 0, 128, H);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      return tex;
    }
  }
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Placa boardW × boardH sobre un poste; la cara +Z lleva la celda `cell` del atlas y el resto la celda gris
function boardGeometry(cell: number): THREE.BufferGeometry {
  const T = config.trackside;
  const plate = new THREE.BoxGeometry(T.boardW, T.boardH, 0.04);
  plate.translate(0, BOARD_BOTTOM_M + T.boardH / 2, 0);
  const post = new THREE.BoxGeometry(0.08, BOARD_BOTTOM_M + 0.05, 0.06);
  post.translate(0, (BOARD_BOTTOM_M + 0.05) / 2 + BASE_H, -0.05);
  const remap = (g: THREE.BufferGeometry, front: boolean) => {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      // BoxGeometry: caras en orden +x, −x, +y, −y, +z, −z, 4 vértices cada una
      const isFront = front && Math.floor(i / 4) === 4;
      if (isFront) uv.setXY(i, (cell + uv.getX(i)) / 4, uv.getY(i));
      else uv.setXY(i, 3.5 / 4, 0.5);
    }
  };
  remap(plate, true); remap(post, false);
  const g = mergeGeometries([plate, post])!;
  plate.dispose(); post.dispose();
  return g;
}

function boardMeshes(t: Track, mat: THREE.Material): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  BOARD_VALUES.forEach((value, cell) => {
    const boards = t.boards.filter((b) => b.m === value);
    if (!boards.length) return;
    const mesh = new THREE.InstancedMesh(boardGeometry(cell), mat, boards.length);
    boards.forEach((b, k) => {
      const sp = sampleAt(t, b.s), side = b.side === 'left' ? 1 : -1;
      const d = side * ((side > 0 ? sp.wl : sp.wr) + t.runoff - BOARD_INSET_M);
      const i = Math.round(wrapS(t, b.s) / t.step) % t.n;
      p.set(sp.x + sp.nx * d, sp.y + d * Math.tan(t.bank[i]), sp.z + sp.nz * d);
      // La cara +Z mira a los coches que se acercan (−tangente)
      q.setFromAxisAngle(up, Math.atan2(-sp.tx, -sp.tz));
      mesh.setMatrixAt(k, m4.compose(p, q, one));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `boards-${value}`;
    out.push(mesh);
  });
  return out;
}

// --- Comisarios ---

function marshalMesh(t: Track, mat: THREE.Material): THREE.InstancedMesh | null {
  const T = config.trackside;
  const count = Math.floor(t.length / T.marshalEveryM);
  if (count < 1) return null;
  const body = new THREE.BoxGeometry(2, 2.4, 2);
  body.translate(0, 1.2 + BASE_H, 0);
  const roof = new THREE.BoxGeometry(2.4, 0.15, 2.4);
  roof.translate(0, 2.4 + 0.075 + BASE_H, 0);
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };
  paint(body, C_HUT); paint(roof, C_ROOF);
  const g = mergeGeometries([body, roof])!;
  body.dispose(); roof.dispose();
  const mesh = new THREE.InstancedMesh(g, mat, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const s = wrapS(t, (k + 0.5) * T.marshalEveryM);
    const sp = sampleAt(t, s), side = k % 2 === 0 ? 1 : -1;   // exterior alterno
    const d = side * ((side > 0 ? sp.wl : sp.wr) + t.runoff + MARSHAL_OUT_M);
    const i = Math.round(s / t.step) % t.n;
    p.set(sp.x + sp.nx * d, sp.y + d * Math.tan(t.bank[i]), sp.z + sp.nz * d);
    q.setFromAxisAngle(up, sp.heading);
    mesh.setMatrixAt(k, m4.compose(p, q, one));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'marshals';
  return mesh;
}

// --- Líneas de boxes ---

// Líneas blancas transversales en la entrada y la salida de la calle de boxes del mundo real (b12)
function pitLinesGeometry(world: World | null): THREE.BufferGeometry | null {
  const p = world?.pitlane;
  if (!p || p.pts.length < 6) return null;
  const B = new Builder();
  const n = p.pts.length / 3, hw = p.w / 2;
  const line = (i: number, j: number) => {
    const x = p.pts[3 * i], y = p.pts[3 * i + 1] + PIT_LINE_LIFT_M, z = p.pts[3 * i + 2];
    let tx = p.pts[3 * j] - x, tz = p.pts[3 * j + 2] - z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const lx = -tz, lz = tx;   // izquierda
    const P = (al: number, d: number): V3 => [x + tx * al + lx * d, y, z + tz * al + lz * d];
    quadN(B, P(0, -hw), P(0, hw), P(PIT_LINE_M, -hw), P(PIT_LINE_M, hw), [0, 1, 0], C_WHITE, [[0, 0], [0, 0], [0, 0], [0, 0]]);
  };
  line(0, 1);
  line(n - 1, n - 2);
  return B.build(true, true);
}

// --- Materiales ---

// Malla romboidal de 32 px por FENCE_TILE_M; el píxel (0, 0) es opaco (lo usan los postes)
function fenceTexture(): THREE.DataTexture {
  const S = 32, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const on = (x + y) % 16 < 2 || (x - y + 32) % 16 < 2;
    data.set([150, 156, 162, on ? 255 : 0], (y * S + x) * 4);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createTracksideMaterials(track: Pick<TrackMaterials, 'concrete'>): TracksideMaterials {
  return {
    kerb: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }),
    tecpro: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }),
    armco: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide }),
    concrete: track.concrete,
    fence: new THREE.MeshStandardMaterial({ map: fenceTexture(), alphaTest: 0.35, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }),
    board: new THREE.MeshStandardMaterial({ map: createBoardAtlas(), roughness: 0.7, metalness: 0 }),
    marshal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
  };
}

// Grupo con todos los elementos de borde. quality.trackMaps = false (perfil software) omite los postes de guardarraíl y valla
export function buildTrackside(track: Track, mats: TracksideMaterials, quality: Pick<QualitySettings, 'trackMaps'>, world: World | null = null): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trackside';
  const F = buildFrames(track);
  const add = (name: string, g: THREE.BufferGeometry | null, m: THREE.Material) => {
    if (!g) return;
    if (g.getAttribute('position').count === 0) { g.dispose(); return; }
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    group.add(mesh);
  };
  add('kerbs', kerbGeometry(track, F), mats.kerb);
  const b = barrierGeometries(track, F, quality.trackMaps);
  add('barrier-tecpro', b.tecpro, mats.tecpro);
  add('barrier-armco', b.armco, mats.armco);
  add('barrier-concrete', b.concrete, mats.concrete);
  add('fence', b.fence, mats.fence);
  for (const m of boardMeshes(track, mats.board)) group.add(m);
  const marshals = marshalMesh(track, mats.marshal);
  if (marshals) group.add(marshals);
  add('pit-lines', pitLinesGeometry(world), mats.kerb);
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
  return group;
}
