import { describe, expect, it } from 'vitest';
import interlagos from '../public/track/interlagos.json';
import spa from '../public/track/spa.json';
import bahrain from '../public/track/bahrain.json';
import { menuRows, menuSet, menuStep, type MenuModel } from '../src/host/race/menu';
import {
  DEFAULT_TRACK_ID, TRACKS, loadTrackChoice, resolveTrackId, saveTrackChoice, trackById, trackUrl,
} from '../src/shared/tracks';

// Almacenamiento en memoria (sin DOM) y uno que siempre falla
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
  };
}
const broken = (): Storage => { throw new Error('SecurityError'); };

describe('catálogo de circuitos (b17 D4)', () => {
  it('Interlagos, Spa y Bahréin, ids únicos y coherentes con sus track.json', () => {
    expect(TRACKS.map((t) => t.id)).toEqual(['interlagos', 'spa', 'bahrain']);
    expect(trackById('bahrain')?.id).toBe(bahrain.id);
    expect(trackById('bahrain')?.name).toBe('Bahréin');
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
    expect(trackById('interlagos')?.id).toBe(interlagos.id);
    expect(trackById('spa')?.id).toBe(spa.id);
    expect(trackById('spa')?.name).toBe('Spa-Francorchamps');
    expect(trackById('xyz')).toBeUndefined();
    expect(DEFAULT_TRACK_ID).toBe('interlagos');
  });

  it('resolución: ?track > recordado > interlagos; ?track desconocido se conserva para el error', () => {
    expect(resolveTrackId('spa', 'interlagos')).toBe('spa');
    expect(resolveTrackId('xyz', 'spa')).toBe('xyz');
    expect(resolveTrackId(null, 'spa')).toBe('spa');
    expect(resolveTrackId(null, 'xyz')).toBe('interlagos');
    expect(resolveTrackId(null, null)).toBe('interlagos');
  });

  it('elección recordada con try/catch: guarda, descarta ids desconocidos e ignora fallos', () => {
    const st = memStorage();
    expect(loadTrackChoice(() => st)).toBeNull();
    saveTrackChoice('spa', () => st);
    expect(loadTrackChoice(() => st)).toBe('spa');
    st.setItem('f1mw.track', 'xyz');
    expect(loadTrackChoice(() => st)).toBeNull();
    expect(loadTrackChoice(broken)).toBeNull();
    expect(() => saveTrackChoice('spa', broken)).not.toThrow();
  });

  it('URL de recarga: fija ?track y conserva/añade/quita parámetros', () => {
    const u = new URL(trackUrl('http://h:5173/?debug=1&track=interlagos&autostart=2', 'spa', { online: 'join', code: 'ABC123', autostart: null }));
    expect(u.searchParams.get('track')).toBe('spa');
    expect(u.searchParams.get('debug')).toBe('1');
    expect(u.searchParams.get('online')).toBe('join');
    expect(u.searchParams.get('code')).toBe('ABC123');
    expect(u.searchParams.has('autostart')).toBe(false);
  });
});

describe('fila Circuito del menú (b17 D4)', () => {
  const m: MenuModel = { choice: { mode: 'race', ai: 'medium', rivals: 9, players: 1, track: 'interlagos' }, row: 0 };

  it('va primero solo si la elección define el circuito', () => {
    expect(menuRows(m.choice)).toEqual(['track', 'mode', 'ai', 'rivals', 'players']);
    expect(menuRows({ mode: 'practice', ai: 'medium', rivals: 9 })).toEqual(['mode']);
  });

  it('flechas y clic cambian de circuito; ids desconocidos se ignoran', () => {
    expect(menuStep(m, 'inc').choice.track).toBe('spa');
    expect(menuStep(m, 'dec').choice.track).toBe('bahrain');
    expect(menuStep(menuStep(m, 'inc'), 'cycle').choice.track).toBe('bahrain');
    expect(menuSet(m, 'track', 'spa').choice.track).toBe('spa');
    expect(menuSet(m, 'track', 'xyz').choice.track).toBe('interlagos');
  });
});
