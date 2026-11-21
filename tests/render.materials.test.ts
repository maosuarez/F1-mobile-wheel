import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import manifestJson from '../public/assets/manifest.json';
import { config } from '../src/shared/config';
import { createCarMaterials } from '../src/render/carMaterials';
import { assetUrl, createTrackMaterials, fetchAssetManifest, loadTrackTextures, type AssetManifest, type TextureLoaderLike } from '../src/render/trackMaterials';

const manifest = manifestJson as AssetManifest;

// Cargador falso: falla en las URL que contienen alguno de los ids bloqueados
function fakeLoader(blocked: string[]): TextureLoaderLike & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    loadAsync: async (url: string) => {
      urls.push(url);
      if (blocked.some((b) => url.includes(b))) throw new Error(`404 ${url}`);
      return new THREE.Texture();
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Materiales fotoescaneados con respaldo (b13, design D7)', () => {
  it('manifiesto: id, licencia CC0 y URL de origen', () => {
    expect(manifest.assets.length).toBeGreaterThanOrEqual(6);
    for (const a of manifestJson.assets) {
      expect(a.id).toBeTruthy();
      expect(a.license).toBe('CC0');
      expect(a.source).toMatch(/^https:\/\//);
    }
    expect(assetUrl(manifest, 'asphalt_track', 'Diffuse')).toBe('/assets/asphalt_track/asphalt_track_diff_2k.jpg');
    expect(assetUrl(manifest, 'nope', 'Diffuse')).toBeNull();
  });

  it('carga correcta: todos los materiales pasan a las texturas CC0 con normal map', async () => {
    const mats = createTrackMaterials(true);
    const loader = fakeLoader([]);
    const r = await loadTrackTextures(mats, { normals: true, anisotropy: 8 }, manifest, loader);
    expect(r.failed).toEqual([]);
    expect(r.loaded.sort()).toEqual(['concrete', 'grass', 'gravel', 'road', 'runoff']);
    expect(mats.road.userData.textureSource).toBe('asphalt_track');
    expect(mats.road.normalMap).not.toBeNull();
    expect(mats.road.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mats.road.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(mats.road.map!.anisotropy).toBe(8);
    expect(loader.urls.some((u) => u.includes('nor_gl'))).toBe(true);
  });

  it('fallo de carga: se mantiene la procedural, solo un aviso y sin lanzar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mats = createTrackMaterials(true);
    const procedural = mats.road.map;
    const r = await loadTrackTextures(mats, { normals: true, anisotropy: 8 }, manifest, fakeLoader(['asphalt_track']));
    expect(r.failed).toEqual(['road']);
    expect(mats.road.map).toBe(procedural);
    expect(mats.road.userData.textureSource).toBe('procedural');
    expect(mats.gravel.userData.textureSource).toBe('gravel_floor');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('perfil software: sin normal maps; sin manifiesto: todo procedural sin lanzar', async () => {
    const mats = createTrackMaterials(false);
    const loader = fakeLoader([]);
    await loadTrackTextures(mats, { normals: false, anisotropy: 1 }, manifest, loader);
    expect(loader.urls.some((u) => u.includes('nor_gl'))).toBe(false);
    expect(mats.grass.normalMap).toBeNull();

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m2 = createTrackMaterials(true);
    const r = await loadTrackTextures(m2, { normals: true, anisotropy: 8 }, null, fakeLoader([]));
    expect(r.loaded).toEqual([]);
    expect(r.failed).toHaveLength(5);
    const bad = await fetchAssetManifest((async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(bad).toBeNull();
  });
});

describe('Ajustes de color (b13)', () => {
  it('la hierba CC0 lleva el tinte y el coche la intensidad de reflejos', async () => {
    const mats = createTrackMaterials(true);
    await loadTrackTextures(mats, { normals: false, anisotropy: 1 }, manifest, fakeLoader([]));
    expect((mats.grass.userData.grassTint as THREE.Color).getHexString()).toBe(new THREE.Color(config.surfaces.grassTint).getHexString());
    const shader = { uniforms: {} as Record<string, { value: unknown }>, fragmentShader: '#include <map_fragment>', vertexShader: '' };
    mats.grass.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('uGrassTint');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    const car = createCarMaterials(config);
    expect(car.body.envMapIntensity).toBe(config.light.carEnvIntensity);
    expect(car.carbon.envMapIntensity).toBe(config.light.carEnvIntensity);
    expect(car.screen.emissiveIntensity).toBe(0.7);
  });
});
