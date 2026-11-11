import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { config, type GameConfig } from '../shared/config';
import type { QualitySettings } from './quality';

// Posproceso ligero (design D7): RenderPass → UnrealBloomPass (media resolución) → pasada final propia
// que aplica la viñeta en lineal y después tonos + sRGB como OutputPass. Con post: false, render directo.

// OutputPass con viñeta antes del mapeo de tonos
class VignetteOutputPass extends OutputPass {
  constructor(P: GameConfig['post']) {
    super();
    this.uniforms.uVignette = { value: new THREE.Vector3(P.vignetteStrength, P.vignetteInner, P.vignetteOuter) };
    const src = this.material.fragmentShader;
    const target = 'gl_FragColor = texture2D( tDiffuse, vUv );';
    if (!src.includes(target)) throw new Error('OutputShader inesperado: no se puede insertar la viñeta');
    this.material.fragmentShader = src
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\n\t\tuniform vec3 uVignette;')
      .replace(target, `${target}
			// Viñeta: distancia al centro normalizada (1 en las esquinas)
			float vr = length( vUv - 0.5 ) * 1.41421356;
			gl_FragColor.rgb *= 1.0 - uVignette.x * smoothstep( uVignette.y, uVignette.z, vr );`);
  }
}

export class PostFx {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private samples = 0;
  enabled = false;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera, private readonly cfg: GameConfig = config) {}

  // Activa o desactiva según QualitySettings; el compositor se crea al primer uso
  apply(settings: Pick<QualitySettings, 'post' | 'msaaSamples'>): void {
    this.enabled = settings.post;
    if (!this.enabled) return;
    if (!this.composer) this.build(settings.msaaSamples);
    else if (this.samples !== settings.msaaSamples) {
      this.samples = settings.msaaSamples;
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) { rt.samples = this.samples; rt.dispose(); }
    }
    this.syncSize();
  }

  private build(samples: number): void {
    const P = this.cfg.post;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.samples = samples;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // UnrealBloomPass ya trabaja a media resolución internamente (primer mip = tamaño / 2)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), P.bloomStrength, P.bloomRadius, P.bloomThreshold);
    composer.addPass(this.bloom);
    composer.addPass(new VignetteOutputPass(P));
    this.composer = composer;
  }

  // Sigue el tamaño CSS y el DPR del renderer (llamar tras resize/applyQuality)
  syncSize(): void {
    if (!this.composer) return;
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(s.x, s.y);
  }

  render(): void {
    if (this.enabled && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.bloom?.dispose();
    this.composer?.dispose();
    this.composer = null;
  }
}
