import { describe, expect, it } from 'vitest';
import { assignSources, keyboardLayoutFor, parsePlayers } from '../src/host/split/players';

describe('assignSources', () => {
  it('volante enlazado > mando con índice = jugador > teclado', () => {
    expect(assignSources(2, 0, ['none', 'none'])).toEqual(['keyboard', 'keyboard']);
    expect(assignSources(2, 1, ['none', 'none'])).toEqual(['gamepad', 'keyboard']);
    expect(assignSources(2, 2, ['none', 'none'])).toEqual(['gamepad', 'gamepad']);
    expect(assignSources(2, 2, ['ok', 'stale'])).toEqual(['wheel', 'wheel']);
    expect(assignSources(2, 2, ['lost', 'ok'])).toEqual(['gamepad', 'wheel']);
    expect(assignSources(2, 0, ['none', 'ok'])).toEqual(['keyboard', 'wheel']);
  });
  it('un jugador y casos límite', () => {
    expect(assignSources(1, 0, ['none'])).toEqual(['keyboard']);
    expect(assignSources(1, 1, [])).toEqual(['gamepad']);
    expect(assignSources(2, 0, [])).toEqual(['keyboard', 'keyboard']);
  });
});

describe('keyboardLayoutFor / parsePlayers', () => {
  it('1 jugador usa both; 2 jugadores p1/p2', () => {
    expect(keyboardLayoutFor(1, 0)).toBe('both');
    expect(keyboardLayoutFor(2, 0)).toBe('p1');
    expect(keyboardLayoutFor(2, 1)).toBe('p2');
  });
  it('players=2 por URL; inválido o ausente es null', () => {
    expect(parsePlayers(new URLSearchParams('players=2'))).toBe(2);
    expect(parsePlayers(new URLSearchParams('players=1'))).toBe(1);
    expect(parsePlayers(new URLSearchParams('players=3'))).toBeNull();
    expect(parsePlayers(new URLSearchParams('players=x'))).toBeNull();
    expect(parsePlayers(new URLSearchParams(''))).toBeNull();
  });
});

import { capQuality, shadowPlan, viewports } from '../src/host/split/layout';
import { config } from '../src/shared/config';

describe('viewports (b15 D3)', () => {
  it('1 jugador: pantalla completa', () => {
    expect(viewports(1, 1920, 1080)).toEqual([{ x: 0, y: 0, w: 1920, h: 1080 }]);
  });
  it('2 jugadores: J1 arriba y J2 abajo (origen abajo a la izquierda), sin huecos ni solapes', () => {
    const [a, b] = viewports(2, 1920, 1080);
    expect(a).toEqual({ x: 0, y: 540, w: 1920, h: 540 });
    expect(b).toEqual({ x: 0, y: 0, w: 1920, h: 540 });
    const [c, d] = viewports(2, 800, 601);
    expect(c.y).toBe(d.h);
    expect(c.h + d.h).toBe(601);
  });
});

describe('capQuality / shadowPlan (b15 D3)', () => {
  it('la calidad no pasa del tope', () => {
    expect(capQuality('high', 'medium')).toBe('medium');
    expect(capQuality('medium', 'medium')).toBe('medium');
    expect(capQuality('low', 'medium')).toBe('low');
    expect(capQuality('software', 'medium')).toBe('software');
  });
  it('a < shareShadowM: sombra centrada entre los dos con encuadre ampliado; más lejos sigue a J1', () => {
    const a = { x: 0, y: 0, z: 0, yaw: 0 };
    const near = shadowPlan(a, { x: 100, y: 2, z: 0, yaw: 1 });
    expect(near.shared).toBe(true);
    expect(near.x).toBe(50);
    expect(near.y).toBe(1);
    expect(near.extentM).toBe(100 + config.split.shadowMarginM);
    const close = shadowPlan(a, { x: 5, y: 0, z: 0, yaw: 0 });
    expect(close.extentM).toBe(config.light.shadowExtentM);
    const far = shadowPlan(a, { x: config.split.shareShadowM + 1, y: 0, z: 0, yaw: 0 });
    expect(far.shared).toBe(false);
    expect(far.x).toBe(0);
    expect(far.extentM).toBe(config.light.shadowExtentM);
  });
});
