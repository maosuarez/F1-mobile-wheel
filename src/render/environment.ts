import * as THREE from 'three';
import type { Track } from '../track/types';
import { config } from '../shared/config';
import { locateGlobal, sampleAt, wrapS } from '../track/query';
import { mulberry32 } from './trackMaterials';
import type { QualitySettings } from './quality';

// Entorno (design D5): gradas en la recta principal, árboles y silueta lejana. Todo con instancias, fuera de la pista.

// Textura de público: ruido de color sin figuras
function crowdTexture(rnd: () => number): THREE.DataTexture {
  const E = config.environment, px = E.crowdTexPx;
  const pal = E.crowdPalette.map((c) => new THREE.Color(c));
  const data = new Uint8Array(px * px * 4);
  for (let i = 0; i < px * px; i++) {
    const c = pal[Math.floor(rnd() * pal.length)];
    const k = 0.55 + rnd() * 0.45;
    const lin = new THREE.Color().copy(c).multiplyScalar(k).convertLinearToSRGB();
    data[i * 4] = Math.round(lin.r * 255); data[i * 4 + 1] = Math.round(lin.g * 255); data[i * 4 + 2] = Math.round(lin.b * 255); data[i * 4 + 3] = 255;
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

// Módulo de grada: perfil escalonado (x = fondo, y = altura) extruido a lo largo del tramo (z), centrado en z
function standGeometry(): THREE.BufferGeometry {
  const S = config.environment.stand;
  const dw = S.depthM / S.steps, dh = S.heightM / S.steps;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(S.depthM, 0);
  for (let i = S.steps; i >= 1; i--) {
    sh.lineTo(i * dw, i * dh);
    sh.lineTo((i - 1) * dw, i * dh);
  }
  sh.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: S.moduleLenM, bevelEnabled: false });
  g.translate(0, 0, -S.moduleLenM / 2);
  return g;
}

// Distancia lateral al muro por el lado indicado (+1 izquierda, -1 derecha) en s
function wallDist(track: Track, s: number, side: 1 | -1): { p: ReturnType<typeof sampleAt>; w: number } {
  const p = sampleAt(track, s);
  return { p, w: (side > 0 ? p.wl : p.wr) + track.runoff };
}

function buildStands(track: Track, rnd: () => number): THREE.InstancedMesh {
  const S = config.environment.stand;
  const n = Math.floor(S.spanM / S.moduleLenM);
  const mat = new THREE.MeshStandardMaterial({ map: crowdTexture(rnd), roughness: 0.9, metalness: 0 });
  mat.map!.repeat.set(0.5, 0.5);
  const mesh = new THREE.InstancedMesh(standGeometry(), mat, n * 2);
  mesh.name = 'stands';
  const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(), P = new THREE.Vector3();
  let k = 0;
  for (const side of [1, -1] as const) {
    for (let i = 0; i < n; i++) {
      const s = track.startS - S.backM + (i + 0.5) * S.moduleLenM;
      const { p, w } = wallDist(track, s, side);
      X.set(p.nx * side, 0, p.nz * side);          // hacia fuera
      Z.crossVectors(X, Y);
      P.set(p.x + p.nx * side * (w + S.offsetM), p.y - config.environment.groundDropM, p.z + p.nz * side * (w + S.offsetM));
      m.makeBasis(X, Y, Z).setPosition(P);
      mesh.setMatrixAt(k++, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// Árboles: posiciones sembradas a muro + minOffM…maxOffM, descartando las cercanas a otro tramo o a las gradas
function treePlacements(track: Track, count: number, rnd: () => number): { x: number; y: number; z: number; sc: number; ry: number }[] {
  const E = config.environment, T = E.tree, S = E.stand;
  const out: { x: number; y: number; z: number; sc: number; ry: number }[] = [];
  const standEnd = S.offsetM + S.depthM + S.treeClearM;
  for (let a = 0; a < count * T.attemptsPerTree && out.length < count; a++) {
    const s = rnd() * track.length, side: 1 | -1 = rnd() < 0.5 ? 1 : -1;
    const { p, w } = wallDist(track, s, side);
    const off = T.minOffM + rnd() * (T.maxOffM - T.minOffM);
    const x = p.x + p.nx * side * (w + off), z = p.z + p.nz * side * (w + off);
    const loc = locateGlobal(track, x, z);
    const out_ = loc.d >= 0 ? loc.d - loc.wallL : -loc.d - loc.wallR;
    if (out_ < T.minGapM) continue;
    const rel = wrapS(track, loc.s - (track.startS - S.backM));
    if (rel <= S.spanM && out_ < standEnd) continue;
    out.push({ x, y: p.y - E.groundDropM, z, sc: T.scaleMin + rnd() * (T.scaleMax - T.scaleMin), ry: rnd() * Math.PI * 2 });
  }
  return out;
}

function buildTrees(track: Track, count: number, rnd: () => number): THREE.InstancedMesh[] {
  const T = config.environment.tree;
  const pts = treePlacements(track, count, rnd);
  const trunkG = new THREE.CylinderGeometry(T.trunkR * 0.7, T.trunkR, T.trunkH, 6).translate(0, T.trunkH / 2, 0);
  const crownG = new THREE.ConeGeometry(T.crownR, T.crownH, 7).translate(0, T.trunkH + T.crownH / 2 - 0.5, 0);
  const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: T.trunkColor, roughness: 1, flatShading: true }), pts.length);
  const crown = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), pts.length);
  trunk.name = 'tree-trunks'; crown.name = 'tree-crowns';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const cols = T.crownColors.map((c) => new THREE.Color(c)), c = new THREE.Color();
  pts.forEach((t, i) => {
    q.setFromEuler(e.set(0, t.ry, 0));
    m.compose(pos.set(t.x, t.y, t.z), q, sc.set(t.sc, t.sc * (0.9 + 0.2 * rnd()), t.sc));
    trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m);
    c.copy(cols[Math.floor(rnd() * cols.length)]).multiplyScalar(0.85 + rnd() * 0.3);
    crown.setColorAt(i, c);
  });
  for (const mesh of [trunk, crown]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
  }
  return [trunk, crown];
}

// Anillo lejano de silueta: una malla de doble cara con borde superior irregular, rodeando el circuito
function buildSkyline(track: Track, rnd: () => number): THREE.Mesh {
  const K = config.environment.skyline;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
  for (let i = 0; i < track.n; i++) {
    minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]); minY = Math.min(minY, track.y[i]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const r = Math.hypot(maxX - minX, maxZ - minZ) / 2 + K.padM;
  const seg = K.segments, y0 = minY - K.baseDropM;
  const pos = new Float32Array((seg + 1) * 2 * 3);
  const idx: number[] = [];
  const hs: number[] = [];
  for (let i = 0; i < seg; i++) hs.push(K.minH + rnd() * (K.maxH - K.minH));
  hs.push(hs[0]);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    pos.set([x, y0, z, x, y0 + hs[i], z], i * 6);
    if (i < seg) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: K.color, side: THREE.DoubleSide }));
  mesh.name = 'skyline';
  return mesh;
}

export function buildEnvironment(track: Track, settings: Pick<QualitySettings, 'trees'>): THREE.Group {
  const rnd = mulberry32(config.environment.seed);
  const group = new THREE.Group();
  group.name = 'environment';
  group.userData.trees = settings.trees;
  const stands = buildStands(track, rnd);
  stands.receiveShadow = true;
  group.add(stands, ...buildTrees(track, settings.trees, rnd), buildSkyline(track, rnd));
  return group;
}

export function disposeEnvironment(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.dispose();
    (m as unknown as THREE.InstancedMesh).dispose?.();
  });
}
