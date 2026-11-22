import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import bahrainRaw from '../public/track/bahrain.json';
import bahrainWorldRaw from '../public/track/bahrain.world.json';
import interlagosRaw from '../public/track/interlagos.json';
import interlagosWorldRaw from '../public/track/interlagos.world.json';
import manifestJson from '../public/assets/manifest.json';
import { config } from '../src/shared/config';
import { trackById, type TrackInfo } from '../src/shared/tracks';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';
import { parseWorldJson } from '../src/track/world';
import { buildTrackMeshes } from '../src/track/mesh';
import { applyNight, polePositions, poolFactor, postConfigFor } from '../src/render/night';
import { createScene, objectCost } from '../src/render/scene';
import { createTrackMaterials, loadTrackTextures, type AssetManifest, type TextureLoaderLike } from '../src/render/trackMaterials';
import { QUALITY } from '../src/render/quality';

const bahrain = buildTrack(parseTrackJson(bahrainRaw));
const bahrainWorld = parseWorldJson(bahrainWorldRaw);
const interlagos = buildTrack(parseTrackJson(interlagosRaw));
const interlagosWorld = parseWorldJson(interlagosWorldRaw);
const BH = trackById('bahrain')!;
const IL = trackById('interlagos')!;
const settings = { trees: QUALITY.high.trees, trackMaps: false };

const meshCount = (root: THREE.Object3D) => { let n = 0; root.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };
const named = (root: THREE.Object3D, prefix: string) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.startsWith(prefix)) out.push(o as THREE.Mesh); });
  return out;
};

describe('catálogo con iluminación y suelo (b18 D2)', () => {
  it('Interlagos y Spa de día con hierba; Bahréin de noche con arena', () => {
    for (const id of ['interlagos', 'spa']) {
      const t = trackById(id)!;
      expect([t.lighting, t.hdri, t.ground]).toEqual(['day', config.assets.hdriId, 'grass']);
    }
    expect([BH.lighting, BH.hdri, BH.ground]).toEqual(['night', 'qwantani_night_puresky', 'sand']);
    const ids = (manifestJson as AssetManifest).assets.map((a) => a.id);
    expect(ids).toContain(BH.hdri);
    expect(ids).toContain(config.sand.textureId);
  });
});

describe('iluminación nocturna (b18 D4)', () => {
  const dayInfo: TrackInfo = { ...BH, lighting: 'day' };
  const night = createScene(bahrain, settings, bahrainWorld, BH);
  const day = createScene(bahrain, settings, bahrainWorld, dayInfo);

  it('la noche añade ≤ 6 mallas y ≤ 6 draw calls', () => {
    const dm = meshCount(night.scene) - meshCount(day.scene);
    const dd = objectCost(night.scene).drawCalls - objectCost(day.scene).drawCalls;
    console.info(`noche: +${dm} mallas, +${dd} draw calls, ${polePositions(bahrain).length} postes`);
    expect(dm).toBeGreaterThan(0);
    expect(dm).toBeLessThanOrEqual(6);
    expect(dd).toBeLessThanOrEqual(6);
  });

  it('luces, niebla, entorno y postes de noche', () => {
    const N = config.night;
    expect(night.night).not.toBeNull();
    expect(night.scene.getObjectByName('night-poles')).toBeTruthy();
    expect(night.scene.environmentIntensity).toBeCloseTo(N.envIntensity);
    expect(night.sun.intensity).toBeCloseTo(N.sunIntensity);
    expect(night.sunDir.toArray()).toEqual(new THREE.Vector3(...N.sunDir).normalize().toArray());
    expect((night.scene.fog as THREE.Fog).color.getHexString()).toBe(new THREE.Color(N.fog).getHexString());
    const heads = night.scene.getObjectByName('night-heads') as THREE.InstancedMesh;
    expect((heads.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(N.headEmissive);
    expect(postConfigFor(BH).post.bloomStrength).toBe(N.bloomStrength);
    expect(postConfigFor(BH).post.bloomThreshold).toBe(N.bloomThreshold);
  });

  it('ventanas emisivas en los edificios (no en las gradas)', () => {
    const lit = named(night.env, 'buildings-').filter((m) => (m.material as THREE.MeshStandardMaterial).emissiveMap);
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.some((m) => m.name === 'buildings-grandstand')).toBe(false);
    for (const m of named(day.env, 'buildings-')) expect((m.material as THREE.MeshStandardMaterial).emissiveMap).toBeNull();
  });

  it('charcos de luz: asfalto más oscuro entre postes, igual junto a ellos (asfalto ×roadGain, líneas ×lineGain)', () => {
    const N = config.night;
    expect(poolFactor(0)).toBeCloseTo(1);
    expect(poolFactor(N.poleEveryM / 2)).toBeCloseTo(1 - N.poolDepth);
    const col = (gs: typeof night) => (gs.meshes.group.getObjectByName('road-0') as THREE.Mesh).geometry.getAttribute('color');
    const cn = col(night), cd = col(day);
    const r = { asphalt: [1, 0], line: [1, 0] };
    for (let v = 0; v < cn.count; v++) {
      if (cd.getX(v) <= 0) continue;
      const isLine = cd.getX(v) > 0.5, q = cn.getX(v) / cd.getX(v) / (isLine ? N.lineGain : N.roadGain), b = isLine ? r.line : r.asphalt;
      b[0] = Math.min(b[0], q); b[1] = Math.max(b[1], q);
    }
    // Las líneas siguen más claras que el asfalto iluminado
    expect(0.8 * N.lineGain).toBeGreaterThan(new THREE.Color('#2b2b2e').r * N.roadGain);
    for (const [lo, hi] of [r.asphalt, r.line]) {
      expect(lo).toBeGreaterThan(1 - N.poolDepth - 1e-3);
      expect(lo).toBeLessThan(1 - N.poolDepth * 0.9);
      expect(hi).toBeCloseTo(1, 2);
    }
  });

  it('con lighting "day" no se aplica nada', () => {
    const L = config.light;
    const gs = createScene(interlagos, settings, interlagosWorld, IL);
    const before = meshCount(gs.scene);
    expect(applyNight(gs, IL, interlagos)).toBe(false);
    expect(meshCount(gs.scene)).toBe(before);
    expect(gs.night).toBeNull();
    expect(gs.scene.getObjectByName('night-poles')).toBeUndefined();
    expect(gs.sun.intensity).toBe(L.sunIntensity);
    expect(gs.scene.environmentIntensity).toBe(L.envIntensity);
    expect(gs.sunDir.toArray()).toEqual(new THREE.Vector3(...L.sunDir).normalize().toArray());
    expect(postConfigFor(IL)).toBe(config);
    // Mismo coste y mismos colores de asfalto que sin TrackInfo (escena de antes de b18)
    const legacy = createScene(interlagos, settings, interlagosWorld);
    expect(objectCost(gs.scene)).toEqual(objectCost(legacy.scene));
    const a = (gs.meshes.group.getObjectByName('road-0') as THREE.Mesh).geometry.getAttribute('color').array;
    const b = (buildTrackMeshes(interlagos, createTrackMaterials(false)).group.getObjectByName('road-0') as THREE.Mesh).geometry.getAttribute('color').array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('suelo de desierto (b18 D5)', () => {
  it('con arena no se instancian árboles; con hierba sí', () => {
    const sand = createScene(bahrain, settings, bahrainWorld, BH);
    expect(named(sand.env, 'tree-')).toHaveLength(0);
    const grass = createScene(interlagos, settings, interlagosWorld, IL);
    expect(named(grass.env, 'tree-').length).toBeGreaterThan(0);
  });

  it('el terreno usa la textura de arena (CC0 o respaldo procedural) sin teñir', async () => {
    const mats = createTrackMaterials(true, 'sand');
    expect(mats.grass.userData.ground).toBe('sand');
    const urls: string[] = [];
    const loader: TextureLoaderLike = { loadAsync: async (u) => { urls.push(u); return new THREE.Texture(); } };
    const r = await loadTrackTextures(mats, { normals: true, anisotropy: 1, ground: 'sand' }, manifestJson as AssetManifest, loader);
    expect(r.loaded).toContain('grass');
    expect(mats.grass.userData.textureSource).toBe(config.sand.textureId);
    expect(mats.grass.userData.grassTint).toBeUndefined();
    expect(urls.some((u) => u.includes('leafy_grass'))).toBe(false);
    // La escena con arena comparte ese material en terreno y escapatoria de hierba
    const gs = createScene(bahrain, settings, bahrainWorld, BH);
    const terrain = gs.env.getObjectByName('terrain-0') as THREE.Mesh;
    expect((terrain.material as THREE.Material).userData.ground).toBe('sand');
    expect(terrain.material).toBe(gs.meshes.materials.grass);
  });
});
