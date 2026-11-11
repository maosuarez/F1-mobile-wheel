import { describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { VrSession, isVrAvailable, type ButtonLike, type NavigatorLike } from '../src/host/vr/session';
import { config } from '../src/shared/config';

// Botón simulado (sin DOM): guarda el manejador de click
function fakeButton(): ButtonLike & { click(): void } {
  let fn: (() => void) | null = null;
  return { hidden: false, addEventListener: (_t, f) => { fn = f; }, click: () => fn?.() };
}
const xrNav = (supported: boolean | 'throw'): NavigatorLike => ({
  xr: {
    isSessionSupported: async () => { if (supported === 'throw') throw new Error('x'); return supported; },
    requestSession: vi.fn(() => new Promise<XRSession>(() => { /* pendiente */ })),
  },
});
const renderer = {} as THREE.WebGLRenderer;

describe('disponibilidad del modo VR', () => {
  it('sin navigator.xr: botón oculto', async () => {
    const b = fakeButton();
    const vr = new VrSession(renderer, b, {}, true);
    expect(b.hidden).toBe(true);
    expect(await vr.init()).toBe(false);
    expect(b.hidden).toBe(true);
  });

  it('sin soporte immersive-vr: botón oculto', async () => {
    const b = fakeButton();
    expect(await new VrSession(renderer, b, xrNav(false), true).init()).toBe(false);
    expect(b.hidden).toBe(true);
  });

  it('con soporte pero sin contexto seguro: botón oculto', async () => {
    const b = fakeButton();
    expect(await new VrSession(renderer, b, xrNav(true), false).init()).toBe(false);
    expect(b.hidden).toBe(true);
  });

  it('isSessionSupported que falla cuenta como sin soporte', async () => {
    expect(await isVrAvailable(xrNav('throw'), true)).toBe(false);
  });

  it('con soporte y contexto seguro: botón visible', async () => {
    const b = fakeButton();
    expect(await new VrSession(renderer, b, xrNav(true), true).init()).toBe(true);
    expect(b.hidden).toBe(false);
  });

  it('el click pide immersive-vr de forma síncrona (dentro del gesto)', () => {
    const b = fakeButton();
    const nav = xrNav(true);
    new VrSession(renderer, b, nav, true);
    b.click();
    expect(nav.xr!.requestSession).toHaveBeenCalledTimes(1);
    expect(nav.xr!.requestSession).toHaveBeenCalledWith('immersive-vr');
  });

  it('configura escalado, foveación y vuelve a escritorio al terminar la sesión', async () => {
    const listeners: Record<string, () => void> = {};
    const session = {
      addEventListener: (t: string, f: () => void) => { listeners[t] = f; },
      end: async () => { listeners.end?.(); },
    } as unknown as XRSession;
    const xr = {
      enabled: false,
      setFramebufferScaleFactor: vi.fn(), setReferenceSpaceType: vi.fn(), setFoveation: vi.fn(),
      setSession: vi.fn(async () => {}),
    };
    const r = { xr } as unknown as THREE.WebGLRenderer;
    const nav: NavigatorLike = { xr: { isSessionSupported: async () => true, requestSession: async () => session } };
    const onStart = vi.fn(), onEnd = vi.fn();
    const vr = new VrSession(r, fakeButton(), nav, true, { onStart, onEnd });
    await vr.enter();
    expect(vr.active).toBe(true);
    expect(xr.enabled).toBe(true);
    expect(xr.setFramebufferScaleFactor).toHaveBeenCalledWith(config.vr.framebufferScale);
    expect(xr.setFoveation).toHaveBeenCalledWith(config.vr.foveation);
    expect(xr.setReferenceSpaceType).toHaveBeenCalledWith('local');
    expect(onStart).toHaveBeenCalledTimes(1);
    await vr.exit();
    expect(vr.active).toBe(false);
    expect(xr.enabled).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
