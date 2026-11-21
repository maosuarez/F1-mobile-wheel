import * as THREE from 'three';
import type { Track } from '../track/types';
import { config } from '../shared/config';
import { locateGlobal } from '../track/query';
import { BUILDING_KINDS, terrainHeight, type BuildingKind, type World } from '../track/world';
import { mulberry32 } from './trackMaterials';
import { createTreeMeshes, type TreePlacement } from './environment';
import type { QualitySettings } from './quality';

// Entorno real (b12, design D6): terreno por trozos, edificios extruidos fusionados por tipo, agua,
// calle de boxes y árboles instanciados en los bosques de OSM. Presupuesto: ≤ 12 draw calls.

export interface WorldMaterials { grass: THREE.Material; road: THREE.Material }

const BASE_SINK_M = 1.5;      // las paredes bajan bajo la base para no flotar en laderas
const WATER_LIFT_M = 0.1;     // agua sobre el terreno, sin z-fighting
const PITLANE_LIFT_M = 0.02;  // calle de boxes sobre la hierba de la pista
const STEEP_COLOR = new THREE.Color('#b8a07a');   // tierra en taludes (multiplica la textura de hierba)
const CROWD_TEXEL_M = 0.5;    // tamaño de un "espectador" en la textura de público
const ASPHALT = new THREE.Color('#ffffff');       // el tono lo da el material de escapatoria de asfalto (b13)

// Distancia por fuera del muro (negativa dentro de la zona de carrera)
function beyondWall(track: Track, x: number, z: number): number {
  const l = locateGlobal(track, x, z);
  return l.d >= 0 ? l.d - l.wallL : -l.d - l.wallR;
}

function ringArea(r: number[]): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
  }
  return a / 2;
}

export function pointInRing(r: number[], x: number, z: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], zi = r[2 * i + 1], xj = r[2 * j], zj = r[2 * j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Triangulación de un anillo con normales hacia arriba (+Y): índices locales
function capIndices(r: number[]): number[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < r.length; i += 2) pts.push(new THREE.Vector2(r[i], r[i + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const out: number[] = [];
  for (const [a, b, c] of tris) {
    // componente y de (b−a)×(c−a) en el plano xz: dz1·dx2 − dx1·dz2
    const dx1 = r[2 * b] - r[2 * a], dz1 = r[2 * b + 1] - r[2 * a + 1];
    const dx2 = r[2 * c] - r[2 * a], dz2 = r[2 * c + 1] - r[2 * a + 1];
    if (dz1 * dx2 - dx1 * dz2 >= 0) out.push(a, b, c); else out.push(a, c, b);
  }
  return out;
}

class GeoBuilder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; idx: number[] = [];
  get count(): number { return this.pos.length / 3; }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, u = 0, v = 0): number {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(c.r, c.g, c.b); this.uv.push(u, v);
    return this.count - 1;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// --- Terreno ---

function buildTerrain(world: World, grass: THREE.Material): THREE.Mesh[] {
  const T = world.terrain, UVM = config.surfaces.uvMeters;
  const n = Math.max(1, Math.floor(config.world.terrainChunks));
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const H = (i: number, j: number) => T.h[Math.min(Math.max(j, 0), T.nz - 1) * T.nx + Math.min(Math.max(i, 0), T.nx - 1)];
  const white = new THREE.Color(1, 1, 1), c = new THREE.Color(), nrm = new THREE.Vector3();
  const meshes: THREE.Mesh[] = [];
  let k = 0;
  for (let cr = 0; cr < rows; cr++) {
    for (let cc = 0; cc < cols && k < n; cc++, k++) {
      // Rango de celdas del trozo (los vértices del borde se comparten con el vecino)
      const i0 = Math.floor((cc * (T.nx - 1)) / cols), i1 = Math.floor(((cc + 1) * (T.nx - 1)) / cols);
      const j0 = Math.floor((cr * (T.nz - 1)) / rows), j1 = Math.floor(((cr + 1) * (T.nz - 1)) / rows);
      const w = i1 - i0 + 1;
      const B = new GeoBuilder();
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          // Normal por diferencias centrales; color según pendiente (1 − ny)
          nrm.set(H(i - 1, j) - H(i + 1, j), 2 * T.cell, H(i, j - 1) - H(i, j + 1)).normalize();
          const slope = Math.min(1, Math.max(0, (1 - nrm.y) / 0.13));   // ~30° → tierra
          c.copy(white).lerp(STEEP_COLOR, slope);
          const x = T.x0 + i * T.cell, z = T.z0 + j * T.cell;
          B.vert(x, H(i, j), z, nrm.x, nrm.y, nrm.z, c, x / UVM, z / UVM);
        }
      }
      for (let j = 0; j < j1 - j0; j++) {
        for (let i = 0; i < w - 1; i++) {
          const a = j * w + i, b = a + 1, d = a + w, e = d + 1;
          B.idx.push(a, d, b, b, d, e);
        }
      }
      const mesh = new THREE.Mesh(B.build(), grass);
      mesh.name = `terrain-${k}`;
      mesh.receiveShadow = true;
      mesh.userData.sharedMaterial = true;
      meshes.push(mesh);
    }
  }
  return meshes;
}

// --- Edificios ---

// Textura de público con la fila 0 lisa (blanca): las caras que no miran a la pista muestrean esa fila
function standTexture(rnd: () => number): THREE.DataTexture {
  const E = config.environment, px = E.crowdTexPx;
  const pal = E.crowdPalette.map((col) => new THREE.Color(col));
  const data = new Uint8Array(px * px * 4).fill(255);
  for (let i = px; i < px * px; i++) {
    const lin = pal[Math.floor(rnd() * pal.length)].clone().multiplyScalar(0.55 + rnd() * 0.45).convertLinearToSRGB();
    data[i * 4] = Math.round(lin.r * 255); data[i * 4 + 1] = Math.round(lin.g * 255); data[i * 4 + 2] = Math.round(lin.b * 255);
  }
  const t = new THREE.DataTexture(data, px, px, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Paredes (una cara plana por arista) + tapa triangulada; color por edificio con ligera variación
function addBuilding(B: GeoBuilder, track: Track, r: number[], y: number, h: number, base: THREE.Color, crowd: boolean, rnd: () => number): void {
  const n = r.length / 2, ccw = ringArea(r) > 0;
  const c = base.clone().multiplyScalar(0.88 + rnd() * 0.2);
  const y0 = y - BASE_SINK_M, y1 = y + h;
  const px = config.environment.crowdTexPx, plain = 0.5 / px;   // v del centro de la fila lisa
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * j], bz = r[2 * j + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    // Normal exterior en el plano xz
    let ox = dz / len, oz = -dx / len;
    if (!ccw) { ox = -ox; oz = -oz; }
    // Grada: la cara cuya normal apunta a la pista lleva público
    let face = false;
    if (crowd) {
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const k = locateGlobal(track, mx, mz).i;
      const tx = track.x[k] - mx, tz = track.z[k] - mz, tl = Math.hypot(tx, tz) || 1;
      face = (ox * tx + oz * tz) / tl > 0.5;
    }
    const vc = crowd && !face ? c : (crowd ? white : c);
    const su = face ? len / (px * CROWD_TEXEL_M) : 0, sv0 = face ? 1.5 / px : plain, sv1 = face ? sv0 + h / (px * CROWD_TEXEL_M) : plain;
    const a0 = B.vert(ax, y0, az, ox, 0, oz, vc, 0, sv0), b0 = B.vert(bx, y0, bz, ox, 0, oz, vc, su, sv0);
    const b1 = B.vert(bx, y1, bz, ox, 0, oz, vc, su, sv1), a1 = B.vert(ax, y1, az, ox, 0, oz, vc, 0, sv1);
    // (b0−a0)×(b1−a0) apunta a (−dz, dx): coincide con la exterior si el anillo es horario
    if (ccw) B.idx.push(a0, b1, b0, a0, a1, b1); else B.idx.push(a0, b0, b1, a0, b1, a1);
  }
  const first = B.count;
  for (let i = 0; i < n; i++) B.vert(r[2 * i], y1, r[2 * i + 1], 0, 1, 0, c, 0, plain);
  for (const k of capIndices(r)) B.idx.push(first + k);
}

function buildBuildings(world: World, track: Track, rnd: () => number): THREE.Mesh[] {
  const W = config.world, out: THREE.Mesh[] = [];
  for (const kind of BUILDING_KINDS) {
    const list = world.buildings.filter((b) => b.kind === kind);
    if (!list.length) continue;
    const crowd = kind === 'grandstand';
    const base = new THREE.Color(W.buildingColors[kind as BuildingKind]);
    const B = new GeoBuilder();
    for (const b of list) addBuilding(B, track, b.ring, b.y, b.h, base, crowd, rnd);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, map: crowd ? standTexture(rnd) : null });
    const mesh = new THREE.Mesh(B.build(), mat);
    mesh.name = `buildings-${kind}`;
    mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}

// --- Agua y calle de boxes ---

function buildWater(world: World): THREE.Mesh | null {
  if (!world.water.length) return null;
  const B = new GeoBuilder(), c = new THREE.Color(1, 1, 1);
  for (const w of world.water) {
    const first = B.count;
    for (let i = 0; i < w.ring.length; i += 2) B.vert(w.ring[i], w.y + WATER_LIFT_M, w.ring[i + 1], 0, 1, 0, c);
    for (const k of capIndices(w.ring)) B.idx.push(first + k);
  }
  const g = B.build();
  g.deleteAttribute('color'); g.deleteAttribute('uv');
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: config.world.waterColor, roughness: 0.1, metalness: 0 }));
  mesh.name = 'water';
  mesh.receiveShadow = true;
  return mesh;
}

function buildPitlane(world: World, road: THREE.Material): THREE.Mesh | null {
  const p = world.pitlane;
  if (!p) return null;
  const UVM = config.surfaces.uvMeters, n = p.pts.length / 3, hw = p.w / 2;
  const B = new GeoBuilder();
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let tx = p.pts[3 * b] - p.pts[3 * a], tz = p.pts[3 * b + 2] - p.pts[3 * a + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    if (i > 0) s += Math.hypot(p.pts[3 * i] - p.pts[3 * i - 3], p.pts[3 * i + 2] - p.pts[3 * i - 1]);
    const x = p.pts[3 * i], y = p.pts[3 * i + 1] + PITLANE_LIFT_M, z = p.pts[3 * i + 2];
    // Izquierda = (−tz, tx)
    B.vert(x - tz * hw, y, z + tx * hw, 0, 1, 0, ASPHALT, 0, s / UVM);
    B.vert(x + tz * hw, y, z - tx * hw, 0, 1, 0, ASPHALT, p.w / UVM, s / UVM);
    if (i > 0) {
      const l0 = 2 * (i - 1), r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
      // Orden con normal +Y para cualquier sentido de giro de la polilínea
      B.idx.push(l0, r0, l1, r0, r1, l1);
    }
  }
  const g = B.build();
  // Asegura caras hacia arriba: si el primer triángulo mira abajo, se invierte el orden
  const P = g.getAttribute('position'), I = g.getIndex()!;
  if (I.count >= 3) {
    const [a, b, c] = [I.getX(0), I.getX(1), I.getX(2)];
    const dx1 = P.getX(b) - P.getX(a), dz1 = P.getZ(b) - P.getZ(a), dx2 = P.getX(c) - P.getX(a), dz2 = P.getZ(c) - P.getZ(a);
    if (dz1 * dx2 - dx1 * dz2 < 0) {
      const arr = I.array as Uint32Array | Uint16Array;
      for (let t = 0; t < arr.length; t += 3) { const tmp = arr[t + 1]; arr[t + 1] = arr[t + 2]; arr[t + 2] = tmp; }
    }
  }
  const mesh = new THREE.Mesh(g, road);
  mesh.name = 'pitlane';
  mesh.receiveShadow = true;
  mesh.userData.sharedMaterial = true;
  return mesh;
}

// --- Árboles ---

// Posiciones dentro de los bosques y a ≥ minGapM por fuera del muro; densidad treesPerHa, recortadas a `count`
export function forestPlacements(world: World, track: Track, count: number, rnd: () => number): TreePlacement[] {
  const T = config.environment.tree;
  const polys = world.forest.map((f) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < f.ring.length; i += 2) {
      minX = Math.min(minX, f.ring[i]); maxX = Math.max(maxX, f.ring[i]);
      minZ = Math.min(minZ, f.ring[i + 1]); maxZ = Math.max(maxZ, f.ring[i + 1]);
    }
    return { ring: f.ring, area: Math.abs(ringArea(f.ring)), minX, maxX, minZ, maxZ };
  }).filter((p) => p.area > 0);
  const total = polys.reduce((a, p) => a + p.area, 0);
  const target = Math.min(count, Math.round((total / 10000) * config.world.treesPerHa));
  const out: TreePlacement[] = [];
  if (!target) return out;
  for (let a = 0; a < target * T.attemptsPerTree && out.length < target; a++) {
    // Polígono elegido en proporción a su área
    let pick = rnd() * total, p = polys[0];
    for (const q of polys) { p = q; if ((pick -= q.area) <= 0) break; }
    const x = p.minX + rnd() * (p.maxX - p.minX), z = p.minZ + rnd() * (p.maxZ - p.minZ);
    if (!pointInRing(p.ring, x, z)) continue;
    if (beyondWall(track, x, z) < T.minGapM) continue;
    out.push({ x, y: terrainHeight(world, x, z) - config.environment.groundDropM, z,
      sc: T.scaleMin + rnd() * (T.scaleMax - T.scaleMin), ry: rnd() * Math.PI * 2 });
  }
  return out;
}

export function buildWorld(world: World, track: Track, mats: WorldMaterials, settings: Pick<QualitySettings, 'trees'>): THREE.Group {
  const rnd = mulberry32(config.environment.seed);
  const group = new THREE.Group();
  group.name = 'world';
  group.userData.trees = settings.trees;
  group.add(...buildTerrain(world, mats.grass), ...buildBuildings(world, track, rnd));
  const water = buildWater(world);
  if (water) group.add(water);
  const pit = buildPitlane(world, mats.road);
  if (pit) group.add(pit);
  const trees = forestPlacements(world, track, settings.trees, rnd);
  if (trees.length) group.add(...createTreeMeshes(trees, rnd));
  return group;
}
