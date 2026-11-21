import * as THREE from 'three';
import type { Track } from './types';
import { KERB_WIDTH_M, KERB_HEIGHT_M, EDGE_LINE_M } from './types';
import { config } from '../shared/config';
import { deltaS, sampleAt, wrapS } from './query';
import { createTrackMaterials, type TrackMaterials } from '../render/trackMaterials';

export interface TrackMeshes {
  group: THREE.Group;
  materials: TrackMaterials;
  chunks: number;
  triangles: number;
}

const LINE_LIFT_M = 0.005;      // franjas blancas 5 mm sobre el asfalto
export const GRASS_DROP_M = 0.05;      // hierba exterior 5 cm por debajo del asfalto
const GRASS_INNER_DROP_M = 0.01;
const RING_VERTS = 6;           // asfalto (2) + franjas (4)
const KERB_VERTS = 4;           // kR_out, kR_in, kL_in, kL_out

const UVM = config.surfaces.uvMeters;   // metros por repetición de textura
const C_ASPHALT = new THREE.Color('#2b2b2e');
const C_LINE = new THREE.Color('#e8e8e8');
const C_KERB_WHITE = new THREE.Color('#ffffff');
const C_WHITE = new THREE.Color('#ffffff');

export interface Frame { x: number; y: number; z: number; nx: number; nz: number; tb: number; wl: number; wr: number; s: number; normal: [number, number, number] }

// Marco de la muestra i (con envoltura). `ringIndex === n` es el anillo 0 al cerrar el bucle.
export function frameAt(t: Track, ringIndex: number): Frame {
  const n = t.n;
  const i = ((ringIndex % n) + n) % n;
  const ip = (i + 1) % n, im = (i - 1 + n) % n;
  const tb = Math.tan(t.bank[i]);
  // Tangente 3D con la pendiente de la línea central
  let ds = t.s[ip] - t.s[im]; if (ds <= 0) ds += t.length;
  const dydz = (t.y[ip] - t.y[im]) / (ds || 1);
  const f = [t.tx[i], dydz, t.tz[i]];
  const l = [t.nx[i], tb, t.nz[i]];
  // normal hacia arriba = f × l
  let ux = f[1] * l[2] - f[2] * l[1];
  let uy = f[2] * l[0] - f[0] * l[2];
  let uz = f[0] * l[1] - f[1] * l[0];
  const len = Math.hypot(ux, uy, uz) || 1;
  ux /= len; uy /= len; uz /= len;
  return { x: t.x[i], y: t.y[i], z: t.z[i], nx: t.nx[i], nz: t.nz[i], tb, wl: t.wl[i], wr: t.wr[i],
    s: ringIndex === n ? t.length : t.s[i], normal: [ux, uy, uz] };
}

// Punto de la sección a distancia lateral d (izquierda positiva) y altura h sobre el asfalto
export function pt(f: Frame, d: number, h: number): [number, number, number] {
  return [f.x + f.nx * d, f.y + d * f.tb + h, f.z + f.nz * d];
}

// Sección transversal de la muestra i: 6 vértices de asfalto/franjas y 4 de piano (colapsados si no hay piano).
// Orden: aR, aL, lR_out, lR_in, lL_in, lL_out | kR_out, kR_in, kL_in, kL_out.
export function buildRingPositions(track: Track, i: number): Float32Array {
  const f = frameAt(track, i);
  const idx = ((i % track.n) + track.n) % track.n;
  const out = new Float32Array((RING_VERTS + KERB_VERTS) * 3);
  const put = (k: number, p: [number, number, number]) => { out[k * 3] = p[0]; out[k * 3 + 1] = p[1]; out[k * 3 + 2] = p[2]; };
  put(0, pt(f, -f.wr, 0));
  put(1, pt(f, f.wl, 0));
  put(2, pt(f, -f.wr, LINE_LIFT_M));
  put(3, pt(f, -f.wr + EDGE_LINE_M, LINE_LIFT_M));
  put(4, pt(f, f.wl - EDGE_LINE_M, LINE_LIFT_M));
  put(5, pt(f, f.wl, LINE_LIFT_M));
  const hasR = track.kerbR[idx] === 1, hasL = track.kerbL[idx] === 1;
  put(6, hasR ? pt(f, -f.wr - KERB_WIDTH_M, KERB_HEIGHT_M) : pt(f, -f.wr, 0));
  put(7, hasR ? pt(f, -f.wr, KERB_HEIGHT_M) : pt(f, -f.wr, 0));
  put(8, hasL ? pt(f, f.wl, KERB_HEIGHT_M) : pt(f, f.wl, 0));
  put(9, hasL ? pt(f, f.wl + KERB_WIDTH_M, KERB_HEIGHT_M) : pt(f, f.wl, 0));
  return out;
}

// Acumulador de geometría
export class Builder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; idx: number[] = [];
  get count() { return this.pos.length / 3; }
  vert(p: ArrayLike<number>, n: ArrayLike<number>, c: THREE.Color | null, u: number, v: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    if (c) this.col.push(c.r, c.g, c.b);
    this.uv.push(u, v);
    return this.count - 1;
  }
  // Quad con a = lado de d menor, b = lado de d mayor; 0 = anillo i, 1 = anillo i+1 (arriba al mirar adelante)
  quad(a0: number, b0: number, a1: number, b1: number) {
    this.idx.push(a0, a1, b0, b0, a1, b1);
  }
  build(withColor: boolean, withNormals: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (withNormals) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    if (!withNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function roadChunk(t: Track, a: number, b: number): THREE.BufferGeometry {
  const B = new Builder();
  const width = (f: Frame) => f.wl + f.wr;
  // Anillos compartidos (bloque inicial de vértices)
  const base: number[] = [];
  const frames: Frame[] = [];
  for (let r = a; r <= b; r++) {
    const f = frameAt(t, r);
    frames.push(f);
    base.push(B.count);
    const p = buildRingPositions(t, r);
    const cols = [C_ASPHALT, C_ASPHALT, C_LINE, C_LINE, C_LINE, C_LINE];
    const ds = [-f.wr, f.wl, -f.wr, -f.wr + EDGE_LINE_M, f.wl - EDGE_LINE_M, f.wl];
    for (let k = 0; k < RING_VERTS; k++) B.vert(p.subarray(k * 3, k * 3 + 3), f.normal, cols[k], ds[k] / UVM, f.s / UVM);
  }
  // Estaciones intermedias del asfalto para la banda de goma (gaussiana centrada en la trazada rl, design D6);
  // van tras los anillos compartidos. Más oscura con curvatura alta y en las marcas de frenada (D5)
  const S = config.surfaces, sigma = S.rubberWidthM / 2;
  const offsets = [-S.rubberWidthM, -sigma, 0, sigma, S.rubberWidthM];
  const mid: number[][] = [];
  for (let r = a; r <= b; r++) {
    const f = frames[r - a], i = ((r % t.n) + t.n) % t.n, row: number[] = [];
    const rl = t.rl[i];
    const darken = S.rubberDarken + (S.rubberDarkenMax - S.rubberDarken) * Math.min(Math.abs(t.k[i]) / S.rubberKRef, 1);
    const mark = brakeMarkAt(t, f.s);
    offsets.forEach((o, k) => {
      const dd = Math.min(Math.max(rl + o, -f.wr), f.wl);
      const g = Math.exp(-((dd - rl) ** 2) / (2 * sigma * sigma));
      // Rodadas de frenada: las estaciones ±σ (ruedas) de la trazada
      const m = k === 1 || k === 3 ? mark * config.trackside.brakeMarkDarken : 0;
      const c = C_ASPHALT.clone().multiplyScalar((1 - darken * g) * (1 - m));
      row.push(B.vert(pt(f, dd, 0), f.normal, c, dd / UVM, f.s / UVM));
    });
    mid.push(row);
  }
  for (let r = 0; r < b - a; r++) {
    const o0 = base[r], o1 = base[r + 1];
    // asfalto: aR → estaciones → aL
    const row0 = [o0 + 0, ...mid[r], o0 + 1], row1 = [o1 + 0, ...mid[r + 1], o1 + 1];
    for (let k = 0; k < row0.length - 1; k++) B.quad(row0[k], row0[k + 1], row1[k], row1[k + 1]);
    B.quad(o0 + 2, o0 + 3, o1 + 2, o1 + 3);   // franja derecha
    B.quad(o0 + 4, o0 + 5, o1 + 4, o1 + 5);   // franja izquierda
  }
  // Los pianos con perfil se dibujan en render/trackside.ts (b13, design D5)
  return B.build(true, true);
}

// Intensidad (0–1) de las marcas de frenada en s: desde el punto de frenada (cartel de 100 m + 100 m)
// durante brakeMarkLenM, con entrada y salida suaves de 10 m
export function brakeMarkAt(t: Track, s: number): number {
  const len = config.trackside.brakeMarkLenM, fade = 10;
  let v = 0;
  for (const bd of t.boards) {
    if (bd.m !== 100) continue;
    const u = deltaS(t, wrapS(t, bd.s + 100), s);
    if (u < 0 || u > len) continue;
    v = Math.max(v, Math.min(1, u / fade, (len - u) / fade));
  }
  return v;
}

// Escapatoria entre el borde del asfalto y la barrera, separada por material según runoffL/R (design D5):
// 0 hierba, 1 asfalto, 2 grava. Una geometría por material para toda la pista (3 draw calls)
export function buildRunoffGeometries(t: Track): THREE.BufferGeometry[] {
  const B = [new Builder(), new Builder(), new Builder()];
  const n = t.n;
  const F: Frame[] = [];
  for (let r = 0; r <= n; r++) F.push(frameAt(t, r));
  for (let r = 0; r < n; r++) {
    const i0 = r, f0 = F[r], f1 = F[r + 1];
    // Franjas de siega alternas por s (solo se notan en la hierba)
    const stripe = Math.floor(f0.s / config.surfaces.stripeLenM) % 2 === 0 ? 1 + config.surfaces.stripeDarken : 1 - config.surfaces.stripeDarken;
    for (const side of [-1, 1] as const) {
      const code = side > 0 ? t.runoffL[i0] : t.runoffR[i0];
      const b = B[code] ?? B[0];
      const c = code === 0 ? new THREE.Color(stripe, stripe, stripe) : C_WHITE;
      const v = (f: Frame, outer: boolean) => {
        const d = side > 0 ? f.wl + (outer ? t.runoff : 0) : -f.wr - (outer ? t.runoff : 0);
        return b.vert(pt(f, d, outer ? -GRASS_DROP_M : -GRASS_INNER_DROP_M), f.normal, c, d / UVM, f.s / UVM);
      };
      // a = lado de d menor
      const in0 = v(f0, false), out0 = v(f0, true), in1 = v(f1, false), out1 = v(f1, true);
      if (side > 0) b.quad(in0, out0, in1, out1); else b.quad(out0, in0, out1, in1);
    }
  }
  return B.map((b) => b.build(true, false));
}

// Línea de meta ajedrezada de 1 m, 2 filas
function startLine(t: Track, mat: THREE.Material): THREE.Mesh {
  const B = new Builder();
  const up: [number, number, number] = [0, 1, 0];
  const cols = 12, rows = 2, len = 1.0;
  const sp = sampleAt(t, t.startS);
  const w = sp.wl + sp.wr;
  const P = (row: number, col: number): [number, number, number] => {
    const along = -len / 2 + (row / rows) * len;
    const d = -sp.wr + (col / cols) * w;
    return [sp.x + sp.tx * along + sp.nx * d, sp.y + 0.01, sp.z + sp.tz * along + sp.nz * d];
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const color = (r + c) % 2 === 0 ? C_KERB_WHITE : new THREE.Color('#111111');
    const u0 = (-sp.wr + (c / cols) * w) / UVM, u1 = (-sp.wr + ((c + 1) / cols) * w) / UVM;
    const a0 = B.vert(P(r, c), up, color, u0, 0), b0 = B.vert(P(r, c + 1), up, color, u1, 0);
    const a1 = B.vert(P(r + 1, c), up, color, u0, len / UVM), b1 = B.vert(P(r + 1, c + 1), up, color, u1, len / UVM);
    B.quad(a0, b0, a1, b1);
  }
  // Cajones de parrilla: rectángulos blancos (4 líneas finas) detrás de la meta, alternando izquierda/derecha
  const S = config.surfaces, white = C_KERB_WHITE;
  const rect = (along0: number, along1: number, d0: number, d1: number) => {
    const q = (al: number, d: number) => B.vert([sp.x + sp.tx * al + sp.nx * d, sp.y + 0.012, sp.z + sp.tz * al + sp.nz * d], up, white, d / UVM, al / UVM);
    const a0 = q(along0, d0), b0 = q(along0, d1), a1 = q(along1, d0), b1 = q(along1, d1);
    B.quad(a0, b0, a1, b1);
  };
  const lw = S.gridLineM;
  for (let k = 0; k < S.gridSlots; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const al1 = -(S.gridSpacingM * (k + 1));
    const al0 = al1 - S.gridBoxLenM;
    const dc = side * S.gridOffsetM, d0 = dc - S.gridBoxWidthM / 2, d1 = dc + S.gridBoxWidthM / 2;
    rect(al0, al0 + lw, d0, d1); rect(al1 - lw, al1, d0, d1);
    rect(al0, al1, d0, d0 + lw); rect(al0, al1, d1 - lw, d1);
  }
  const m = new THREE.Mesh(B.build(true, true), mat);
  m.name = 'start-line';
  return m;
}

export function buildTrackMeshes(track: Track, materials: TrackMaterials = createTrackMaterials(), chunks: number = config.render.trackChunks): TrackMeshes {
  const { road, grass, gravel, runoff } = materials;
  const group = new THREE.Group();
  group.name = 'track';
  let triangles = 0;
  const add = (name: string, g: THREE.BufferGeometry, m: THREE.Material) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    group.add(mesh);
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  };

  const n = track.n;
  for (let c = 0; c < chunks; c++) {
    const a = Math.floor((c * n) / chunks);
    const b = c === chunks - 1 ? n : Math.floor(((c + 1) * n) / chunks);   // el último incluye el anillo 0
    add(`road-${c}`, roadChunk(track, a, b), road);
  }
  // Escapatoria por material; el muro antiguo lo sustituyen las barreras de render/trackside.ts
  const [rg, ra, rv] = buildRunoffGeometries(track);
  for (const [name, g, m] of [['runoff-grass', rg, grass], ['runoff-asphalt', ra, runoff], ['runoff-gravel', rv, gravel]] as const) {
    if (g.getAttribute('position').count > 0) add(name, g, m); else g.dispose();
  }

  // Suelo grande bajo la pista y línea de meta
  let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, track.y[i]);
    minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]);
  }
  const size = Math.max(maxX - minX, maxZ - minZ) + 2 * track.runoff + 1000;
  const gg = new THREE.PlaneGeometry(size, size);
  gg.rotateX(-Math.PI / 2);
  // UV en metros y color blanco (el material de hierba usa color por vértice)
  const guv = gg.getAttribute('uv');
  for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * size / UVM, guv.getY(i) * size / UVM);
  gg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(guv.count * 3).fill(1), 3));
  gg.translate((minX + maxX) / 2, minY - GRASS_DROP_M - 0.45, (minZ + maxZ) / 2);
  gg.computeBoundingSphere();
  add('ground', gg, grass);
  const sl = startLine(track, road);
  group.add(sl);
  triangles += (sl.geometry.index as THREE.BufferAttribute).count / 3;

  return { group, materials, chunks, triangles };
}
