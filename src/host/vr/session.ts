import type * as THREE from 'three';
import { config, type GameConfig } from '../../shared/config';

// Sesión WebXR inmersiva (b7, spec "Disponibilidad" y "Sesión inmersiva"; design D4).
// Tipos estructurales mínimos para poder probarlo en Node con navigator.xr simulado.
export interface XrSystemLike {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  requestSession(mode: XRSessionMode, init?: XRSessionInit): Promise<XRSession>;
}
export interface NavigatorLike { xr?: XrSystemLike }
export interface ButtonLike { hidden: boolean | string; addEventListener(type: 'click', fn: () => void): void }
export interface VrHooks {
  onStart?(): void;            // antes de presentar: aplicar perfil VR y montar la cámara en el ancla
  onEnd?(): void;              // tras salir (el renderer ya restauró tamaño y DPR): volver al escritorio
  onError?(e: unknown): void;
}

// Solo hay VR con contexto seguro y soporte de 'immersive-vr'
export async function isVrAvailable(nav: NavigatorLike, secure: boolean): Promise<boolean> {
  if (!secure || !nav.xr) return false;
  try { return await nav.xr.isSessionSupported('immersive-vr'); } catch { return false; }
}

export class VrSession {
  private session: XRSession | null = null;
  private pending = false;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly button: ButtonLike,
    private readonly nav: NavigatorLike, private readonly secure: boolean,
    private readonly hooks: VrHooks = {}, private readonly cfg: GameConfig = config) {
    button.hidden = true;                                       // oculto hasta confirmar soporte
    button.addEventListener('click', () => { void this.enter(); });
  }

  get active(): boolean { return this.session !== null; }

  // Muestra el botón solo si hay soporte; devuelve la disponibilidad
  async init(): Promise<boolean> {
    const ok = await isVrAvailable(this.nav, this.secure);
    this.button.hidden = !ok;
    return ok;
  }

  async enter(): Promise<void> {
    if (this.session || this.pending || !this.nav.xr) return;
    this.pending = true;
    // requestSession se llama de forma síncrona dentro del gesto del usuario (sin await previo)
    // Espacio 'local' (design D11): el origen es la cabeza al entrar; 'local' va incluido en immersive-vr
    const req = this.nav.xr.requestSession('immersive-vr');
    const xr = this.renderer.xr;
    let started = false;
    let session: XRSession | null = null;
    try {
      session = await req;
      xr.enabled = true;
      // El escalado del framebuffer solo se puede fijar antes de presentar
      xr.setFramebufferScaleFactor(this.cfg.vr.framebufferScale);
      xr.setReferenceSpaceType('local');
      started = true;
      this.hooks.onStart?.();
      await xr.setSession(session);
      xr.setFoveation(this.cfg.vr.foveation);
      this.session = session;
      // Registrado después de setSession: three restaura tamaño y DPR antes de este callback
      session.addEventListener('end', () => this.finish());
    } catch (e) {
      if (session) void session.end().catch(() => { /* ya cerrada */ });
      xr.enabled = false;
      if (started) this.hooks.onEnd?.();
      this.hooks.onError?.(e);
    } finally {
      this.pending = false;
    }
  }

  // Sale de la sesión; la página no se recarga y la sala del volante sigue abierta
  exit(): Promise<void> { return this.session ? this.session.end() : Promise.resolve(); }

  private finish(): void {
    this.session = null;
    this.renderer.xr.enabled = false;
    this.hooks.onEnd?.();
  }
}
