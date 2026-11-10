import * as THREE from 'three';
import type { Track } from './types';
import { KERB_WIDTH_M, KERB_HEIGHT_M, EDGE_LINE_M, WALL_HEIGHT_M } from './types';
import { config } from '../shared/config';
import { sampleAt } from './query';

export interface TrackMeshes {
  group: THREE.Group;
  materials: { road: THREE.Material; grass: THREE.Material; wall: THREE.Material };
  chunks: number;
  triangles: number;
}

const LINE_LIFT_M = 0.005;      // franjas blancas 5 mm sobre el asfalto
const GRASS_DROP_M = 0.05;      // hierba exterior 5 cm por debajo del asfalto
const GRASS_INNER_DROP_M = 0.01;
const RING_VERTS = 6;           // asfalto (2) + franjas (4)
const KERB_VERTS = 4;           // kR_out, kR_in, kL_in, kL_out

const C_ASPHALT = new THREE.Color('#2b2b2e');
const C_LINE = new THREE.Color('#e8e8e8');
const C_KERB_RED = new THREE.Color('#c8102e');
const C_KERB_WHITE = new THREE.Color('#ffffff');

interface Frame { x: number; y: number; z: number; nx: number; nz: number; tb: number; wl: number; wr: number; s: number; normal: [number, number, number] }

// Marco de la muestra i (con envoltura). `ringIndex === n` es el anillo 0 al cerrar el bucle.
function frameAt(t: Track, ringIndex: number): Frame {
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
function pt(f: Frame, d: number, h: number): [number, number, number] {
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
class Builder {
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
    const us = [0, 1, 0, EDGE_LINE_M / width(f), 1 - EDGE_LINE_M / width(f), 1];
    for (let k = 0; k < RING_VERTS; k++) B.vert(p.subarray(k * 3, k * 3 + 3), f.normal, cols[k], us[k], f.s / 10);
  }
  for (let r = 0; r < b - a; r++) {
    const o0 = base[r], o1 = base[r + 1];
    B.quad(o0 + 0, o0 + 1, o1 + 0, o1 + 1);   // asfalto
    B.quad(o0 + 2, o0 + 3, o1 + 2, o1 + 3);   // franja derecha
    B.quad(o0 + 4, o0 + 5, o1 + 4, o1 + 5);   // franja izquierda
  }
  // Pianos: vértices propios por segmento para bandas rojo/blanco nítidas
  for (let r = a; r < b; r++) {
    const i0 = ((r % t.n) + t.n) % t.n, i1 = ((r + 1) % t.n);
    const band = Math.floor(i0 / 2) % 2 === 0 ? C_KERB_RED : C_KERB_WHITE;
    const f0 = frames[r - a], f1 = frames[r - a + 1];
    const p0 = buildRingPositions(t, r), p1 = buildRingPositions(t, r + 1);
    const side = (flag0: number, flag1: number, ka: number, kb: number) => {
      if (!flag0 || !flag1) return;
      const v = (p: Float32Array, k: number, f: Frame, u: number) =>
        B.vert(p.subarray(k * 3, k * 3 + 3), f.normal, band, u, f.s / 10);
      const a0 = v(p0, ka, f0, 0), b0 = v(p0, kb, f0, 1), a1 = v(p1, ka, f1, 0), b1 = v(p1, kb, f1, 1);
      B.quad(a0, b0, a1, b1);
    };
    side(t.kerbR[i0], t.kerbR[i1], RING_VERTS + 0, RING_VERTS + 1);   // kR_out (d menor) → kR_in
    side(t.kerbL[i0], t.kerbL[i1], RING_VERTS + 2, RING_VERTS + 3);   // kL_in → kL_out
  }
  return B.build(true, true);
}

function grassChunk(t: Track, a: number, b: number): THREE.BufferGeometry {
  const B = new Builder();
  const base: number[] = [];
  for (let r = a; r <= b; r++) {
    const f = frameAt(t, r);
    base.push(B.count);
    const n3 = f.normal;
    B.vert(pt(f, -f.wr - t.runoff, -GRASS_DROP_M), n3, null, 0, f.s / 10);
    B.vert(pt(f, -f.wr, -GRASS_INNER_DROP_M), n3, null, 1, f.s / 10);
    B.vert(pt(f, f.wl, -GRASS_INNER_DROP_M), n3, null, 0, f.s / 10);
    B.vert(pt(f, f.wl + t.runoff, -GRASS_DROP_M), n3, null, 1, f.s / 10);
  }
  for (let r = 0; r < b - a; r++) {
    const o0 = base[r], o1 = base[r + 1];
    B.quad(o0, o0 + 1, o1, o1 + 1);
    B.quad(o0 + 2, o0 + 3, o1 + 2, o1 + 3);
  }
  return B.build(false, false);
}

function wallChunk(t: Track, a: number, b: number): THREE.BufferGeometry {
  const B = new Builder();
  const base: number[] = [];
  const up: [number, number, number] = [0, 1, 0];
  for (let r = a; r <= b; r++) {
    const f = frameAt(t, r);
    base.push(B.count);
    B.vert(pt(f, -f.wr - t.runoff, -GRASS_DROP_M), up, null, 0, f.s / 10);
    B.vert(pt(f, -f.wr - t.runoff, WALL_HEIGHT_M), up, null, 1, f.s / 10);
    B.vert(pt(f, f.wl + t.runoff, -GRASS_DROP_M), up, null, 0, f.s / 10);
    B.vert(pt(f, f.wl + t.runoff, WALL_HEIGHT_M), up, null, 1, f.s / 10);
  }
  for (let r = 0; r < b - a; r++) {
    const o0 = base[r], o1 = base[r + 1];
    // Muro izquierdo mira hacia dentro (+lateral hacia la pista); el derecho con el sentido opuesto
    B.idx.push(o0 + 2, o1 + 2, o0 + 3, o0 + 3, o1 + 2, o1 + 3);
    B.idx.push(o0 + 0, o0 + 1, o1 + 0, o0 + 1, o1 + 1, o1 + 0);
  }
  return B.build(false, false);
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
    const a0 = B.vert(P(r, c), up, color, 0, 0), b0 = B.vert(P(r, c + 1), up, color, 1, 0);
    const a1 = B.vert(P(r + 1, c), up, color, 0, 1), b1 = B.vert(P(r + 1, c + 1), up, color, 1, 1);
    B.quad(a0, b0, a1, b1);
  }
  const m = new THREE.Mesh(B.build(true, true), mat);
  m.name = 'start-line';
  return m;
}

export function buildTrackMeshes(track: Track, chunks: number = config.render.trackChunks): TrackMeshes {
  const road = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const grass = new THREE.MeshStandardMaterial({ color: '#2f6b2f', roughness: 1, metalness: 0 });
  const wall = new THREE.MeshStandardMaterial({ color: '#cfcfcf', roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
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
    add(`grass-${c}`, grassChunk(track, a, b), grass);
    add(`wall-${c}`, wallChunk(track, a, b), wall);
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
  gg.translate((minX + maxX) / 2, minY - GRASS_DROP_M - 0.45, (minZ + maxZ) / 2);
  gg.computeBoundingSphere();
  add('ground', gg, grass);
  const sl = startLine(track, road);
  group.add(sl);
  triangles += (sl.geometry.index as THREE.BufferAttribute).count / 3;

  return { group, materials: { road, grass, wall }, chunks, triangles };
}
