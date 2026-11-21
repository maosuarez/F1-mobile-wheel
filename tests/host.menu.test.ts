import { describe, expect, it } from 'vitest';
import {
  keyMenuAction, menuInitial, menuRows, menuSet, menuStep, padMenuActions, wheelMenuActions, type MenuModel,
} from '../src/host/race/menu';

const base: MenuModel = menuInitial(null, { mode: 'race', ai: 'medium', rivals: 9 });

describe('menú de modo (b14 D7)', () => {
  it('filas: práctica solo modo; carrera modo, dificultad y rivales', () => {
    expect(menuRows({ mode: 'practice', ai: 'medium', rivals: 9 })).toEqual(['mode']);
    expect(menuRows(base.choice)).toEqual(['mode', 'ai', 'rivals']);
  });
  it('navegación: fila con vuelta y valor con límites (rivales 1–9, dificultad con vuelta)', () => {
    let m = menuStep(base, 'prev');
    expect(m.row).toBe(2);
    m = menuStep(m, 'inc');
    expect(m.choice.rivals).toBe(9);
    for (let i = 0; i < 12; i++) m = menuStep(m, 'dec');
    expect(m.choice.rivals).toBe(1);
    m = menuStep(menuStep(base, 'next'), 'inc');
    expect(m.choice.ai).toBe('hard');
    expect(menuStep(m, 'inc').choice.ai).toBe('easy');
  });
  it('cambiar a práctica oculta filas y ajusta la fila activa', () => {
    const m = menuStep({ ...base, row: 2 }, 'cycle');           // rivales 9 → 1 (vuelta)
    expect(m.choice.rivals).toBe(1);
    const p = menuSet({ ...base, row: 2 }, 'mode', 'practice');
    expect(p.choice.mode).toBe('practice');
    expect(p.row).toBe(0);
    expect(menuStep({ choice: p.choice, row: 0 }, 'next').row).toBe(0);
  });
  it('clic fija valores concretos y los acota', () => {
    expect(menuSet(base, 'rivals', 5).choice.rivals).toBe(5);
    expect(menuSet(base, 'rivals', 40).choice.rivals).toBe(9);
    expect(menuSet(base, 'ai', 'hard').choice.ai).toBe('hard');
    expect(menuSet(base, 'ai', 'xx').choice.ai).toBe('medium');
  });
  it('teclado: flechas y Enter', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'KeyA'].map(keyMenuAction))
      .toEqual(['prev', 'next', 'dec', 'inc', 'confirm', 'confirm', null]);
  });
  it('volante: up = siguiente fila, down = cambia valor, restart confirma', () => {
    expect(wheelMenuActions(['shiftUp', 'shiftDown', 'drs'], ['restart', 'cam'])).toEqual(['next', 'cycle', 'confirm']);
  });
  it('mando: solo flancos de subida de la cruceta y Cruz/Options', () => {
    const pressed = (...i: number[]) => { const a: boolean[] = []; for (const k of i) a[k] = true; return a; };
    expect(padMenuActions([], pressed(12))).toEqual(['prev']);
    expect(padMenuActions(pressed(12), pressed(12))).toEqual([]);
    expect(padMenuActions([], pressed(13, 15, 0))).toEqual(['next', 'inc', 'confirm']);
    expect(padMenuActions([], pressed(9, 14))).toEqual(['dec', 'confirm']);
  });
});
