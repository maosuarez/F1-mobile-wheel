import * as THREE from 'three';
import { config, type GameConfig } from '../../shared/config';
import { shadowCenter, type GameScene } from '../../render/scene';
import { shadowPlan, viewports, type Pose2, type ShadowPlan } from './layout';

// Render de la pantalla dividida (b15, design D3): una pasada por jugador con viewport + scissor, sin compositor.
// Sombra única centrada entre los dos coches (encuadre ampliado) si están cerca; si no, sigue a J1 y J2 lleva un disco
// de sombra de contacto falso. El mapa de sombras se dibuja una sola vez por fotograma (en la primera pasada).

export class SplitRenderer {
  readonly contact: THREE.Mesh;
  private readonly size = new THREE.Vector2();
  private readonly center = new THREE.Vector3();
  private readonly sunDir: THREE.Vector3;
  private plan: ShadowPlan | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly gs: GameScene, private readonly cfg: GameConfig = config) {
    this.sunDir = new THREE.Vector3(...cfg.light.sunDir).normalize();
    const disc = new THREE.CircleGeometry(cfg.split.contactShadowM, 24);
    disc.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
    this.contact = new THREE.Mesh(disc, mat);
    this.contact.name = 'contact-shadow';
    this.contact.renderOrder = 1;
    this.contact.visible = false;
    gs.scene.add(this.contact);
  }

  get shadow(): ShadowPlan | null { return this.plan; }

  // Sol y encuadre de sombra para este fotograma; a = J1, b = J2 (poses interpoladas)
  updateShadow(a: Pose2, b: Pose2): void {
    const plan = this.plan = shadowPlan(a, b, this.cfg);
    const sun = this.gs.sun, L = this.cfg.light;
    const c = shadowCenter(plan.x, plan.y, plan.z, plan.yaw, plan.extentM, sun.shadow.mapSize.x, plan.aheadM, this.center);
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(this.sunDir, L.shadowDistM);
    sun.target.updateMatrixWorld();
    const sc = sun.shadow.camera, h = plan.extentM / 2;
    if (sc.right !== h) { sc.left = -h; sc.right = h; sc.top = h; sc.bottom = -h; sc.updateProjectionMatrix(); }
    this.contact.visible = !plan.shared && sun.castShadow;
    this.contact.position.set(b.x, b.y + 0.03, b.z);
  }

  // Una pasada por cámara (arriba J1, abajo J2). before(i, cam) prepara la escena para esa vista (cielo, rivales…)
  render(cams: readonly THREE.PerspectiveCamera[], before: (i: number, cam: THREE.PerspectiveCamera) => void): void {
    const r = this.renderer;
    r.getSize(this.size);
    const vps = viewports(cams.length, this.size.x, this.size.y);
    const autoShadow = r.shadowMap.autoUpdate;
    r.setScissorTest(true);
    cams.forEach((cam, i) => {
      const v = vps[i];
      const aspect = v.w / Math.max(1, v.h);
      if (cam.aspect !== aspect) { cam.aspect = aspect; cam.updateProjectionMatrix(); }
      before(i, cam);
      r.setViewport(v.x, v.y, v.w, v.h);
      r.setScissor(v.x, v.y, v.w, v.h);
      r.render(this.gs.scene, cam);
      r.shadowMap.autoUpdate = false;     // misma sombra para la segunda vista
    });
    r.shadowMap.autoUpdate = autoShadow;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.x, this.size.y);
  }
}
