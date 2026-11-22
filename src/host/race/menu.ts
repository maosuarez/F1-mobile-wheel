import type { RaceChoice } from '../storage';

// Menú de modo (b14 D7): Modo, Dificultad y Rivales (1–9). La lógica (modelo, acciones de teclado/mando/volante) es pura
// y testeable; RaceMenu solo pinta el DOM y resuelve la promesa con la elección.

export type MenuRow = 'mode' | 'ai' | 'rivals' | 'players';
// prev/next: cambia de fila; dec/inc: cambia el valor de la fila (con vuelta en modo y dificultad); cycle: siguiente valor con vuelta;
// confirm: empezar
export type MenuAction = 'prev' | 'next' | 'dec' | 'inc' | 'cycle' | 'confirm';
export interface MenuModel { choice: RaceChoice; row: number }

export const MODES: readonly RaceChoice['mode'][] = ['practice', 'race'];
export const LEVELS: readonly RaceChoice['ai'][] = ['easy', 'medium', 'hard'];
export const PLAYER_OPTIONS = [1, 2] as const;
export const MIN_RIVALS = 1, MAX_RIVALS = 9;
const MODE_LABEL: Record<RaceChoice['mode'], string> = { practice: 'Práctica', race: 'Carrera 5 vueltas' };
const LEVEL_LABEL: Record<RaceChoice['ai'], string> = { easy: 'Fácil', medium: 'Media', hard: 'Difícil' };

// Filas visibles: en práctica no hay rivales ni dificultad
// 'players' (b15) solo aparece si la elección lo define (el menú siempre lo fija)
export function menuRows(c: RaceChoice): MenuRow[] {
  const rows: MenuRow[] = c.mode === 'race' ? ['mode', 'ai', 'rivals'] : ['mode'];
  return c.players === undefined ? rows : [...rows, 'players'];
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;

function shiftValue(c: RaceChoice, row: MenuRow, d: number): RaceChoice {
  switch (row) {
    case 'mode': return { ...c, mode: MODES[wrap(MODES.indexOf(c.mode) + d, MODES.length)] };
    case 'ai': return { ...c, ai: LEVELS[wrap(LEVELS.indexOf(c.ai) + d, LEVELS.length)] };
    case 'rivals': return { ...c, rivals: Math.min(MAX_RIVALS, Math.max(MIN_RIVALS, c.rivals + d)) };
    case 'players': return { ...c, players: c.players === 2 ? 1 : 2 };
  }
}

export function menuInitial(saved: RaceChoice | null, fallback: RaceChoice): MenuModel {
  return { choice: saved ?? fallback, row: 0 };
}

// Fija un valor concreto (clic): vuelve a una fila válida si el modo cambia
export function menuSet(m: MenuModel, row: MenuRow, value: string | number): MenuModel {
  const c = { ...m.choice };
  if (row === 'mode' && (value === 'practice' || value === 'race')) c.mode = value;
  else if (row === 'ai' && (value === 'easy' || value === 'medium' || value === 'hard')) c.ai = value;
  else if (row === 'players') { if (value === 1 || value === 2 || value === '1' || value === '2') c.players = Number(value) as 1 | 2; }
  else if (row === 'rivals') c.rivals = Math.min(MAX_RIVALS, Math.max(MIN_RIVALS, Math.round(Number(value)) || MIN_RIVALS));
  const rows = menuRows(c);
  return { choice: c, row: Math.max(0, Math.min(rows.indexOf(row), rows.length - 1)) };
}

// Aplica una acción de navegación; 'confirm' no cambia el modelo (lo gestiona quien lo llama)
export function menuStep(m: MenuModel, a: MenuAction): MenuModel {
  const rows = menuRows(m.choice);
  const row = Math.min(m.row, rows.length - 1);
  switch (a) {
    case 'prev': return { ...m, row: wrap(row - 1, rows.length) };
    case 'next': return { ...m, row: wrap(row + 1, rows.length) };
    case 'dec': return clampRow({ choice: shiftValue(m.choice, rows[row], -1), row });
    case 'inc': return clampRow({ choice: shiftValue(m.choice, rows[row], 1), row });
    case 'cycle': {
      // Rivales con vuelta (9 → 1); el resto ya da la vuelta
      const r = rows[row];
      if (r === 'rivals' && m.choice.rivals >= MAX_RIVALS) return { ...m, choice: { ...m.choice, rivals: MIN_RIVALS }, row };
      return clampRow({ choice: shiftValue(m.choice, r, 1), row });
    }
    case 'confirm': return { ...m, row };
  }
}
const clampRow = (m: MenuModel): MenuModel => ({ ...m, row: Math.min(m.row, menuRows(m.choice).length - 1) });

// Volante: hacia arriba pasa a la siguiente fila, hacia abajo cambia el valor de la fila y REINICIAR confirma
export function wheelMenuActions(commands: readonly string[], uiEvents: readonly string[]): MenuAction[] {
  const out: MenuAction[] = [];
  for (const c of commands) { if (c === 'shiftUp') out.push('next'); else if (c === 'shiftDown') out.push('cycle'); }
  for (const e of uiEvents) if (e === 'restart') out.push('confirm');
  return out;
}

export function keyMenuAction(code: string): MenuAction | null {
  switch (code) {
    case 'ArrowUp': return 'prev';
    case 'ArrowDown': return 'next';
    case 'ArrowLeft': return 'dec';
    case 'ArrowRight': return 'inc';
    case 'Enter': case 'NumpadEnter': return 'confirm';
    default: return null;
  }
}

// Botones del mando estándar: cruceta (12 arriba, 13 abajo, 14 izquierda, 15 derecha), Cruz/A (0) y Options (9) confirman.
// Solo flancos de subida.
const PAD_BUTTONS = [0, 9, 12, 13, 14, 15] as const;
export function padMenuActions(prev: readonly boolean[], cur: readonly boolean[]): MenuAction[] {
  const out: MenuAction[] = [];
  const edge = (i: number) => cur[i] === true && prev[i] !== true;
  if (edge(12)) out.push('prev');
  if (edge(13)) out.push('next');
  if (edge(14)) out.push('dec');
  if (edge(15)) out.push('inc');
  if (edge(0) || edge(9)) out.push('confirm');
  return out;
}

// Lectura del mando para el menú (independiente de GamepadSource, que no corre en este estado)
export class MenuPad {
  private prev: boolean[] = [];
  constructor(private readonly provider: () => ArrayLike<Gamepad | null>) {}
  poll(): MenuAction[] {
    let pad: Gamepad | null = null;
    try { pad = Array.from(this.provider() ?? []).find((g) => g && g.mapping === 'standard') ?? null; } catch { pad = null; }
    if (!pad) { this.prev = []; return []; }
    const cur: boolean[] = [];
    for (const i of PAD_BUTTONS) cur[i] = pad.buttons[i]?.pressed === true;
    const acts = padMenuActions(this.prev, cur);
    this.prev = cur;
    return acts;
  }
}

const ROW_TITLE: Record<MenuRow, string> = { mode: 'Modo', ai: 'Dificultad', rivals: 'Rivales', players: 'Jugadores' };

export class RaceMenu {
  private model: MenuModel = { choice: { mode: 'practice', ai: 'medium', rivals: 9, players: 1 }, row: 0 };
  private done: ((c: RaceChoice) => void) | null = null;
  private timer = 0;
  private readonly onKey = (e: KeyboardEvent) => {
    const a = keyMenuAction(e.code);
    if (!a) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat || a !== 'confirm') this.apply(a);
  };

  // poll: acciones de volante y mando acumuladas desde la última llamada
  constructor(private readonly root: HTMLElement, private readonly poll: () => MenuAction[]) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row],[data-start]');
      if (!el || !this.done) return;
      if (el.dataset.start !== undefined) { this.apply('confirm'); return; }
      this.model = menuSet(this.model, el.dataset.row as MenuRow, el.dataset.val ?? '');
      this.render();
    });
  }

  // Muestra el menú y resuelve con la elección al confirmar
  choose(initial: RaceChoice): Promise<RaceChoice> {
    this.model = { choice: { ...initial, players: initial.players ?? 1 }, row: 0 };
    this.render();
    return new Promise((resolve) => {
      this.done = resolve;
      window.addEventListener('keydown', this.onKey, true);
      this.timer = window.setInterval(() => { for (const a of this.poll()) this.apply(a); }, 50);
    });
  }

  private apply(a: MenuAction): void {
    if (!this.done) return;
    if (a === 'confirm') {
      const resolve = this.done;
      this.done = null;
      window.removeEventListener('keydown', this.onKey, true);
      window.clearInterval(this.timer);
      resolve({ ...this.model.choice });
      return;
    }
    this.model = menuStep(this.model, a);
    this.render();
  }

  private render(): void {
    const { choice, row } = this.model;
    const rows = menuRows(choice);
    const btn = (r: MenuRow, val: string | number, label: string, on: boolean) =>
      `<button type="button" class="menu-opt" data-row="${r}" data-val="${val}" data-testid="menu-${r}-${val}" aria-pressed="${on}">${label}</button>`;
    const opts: Record<MenuRow, string> = {
      mode: MODES.map((m) => btn('mode', m, MODE_LABEL[m], choice.mode === m)).join(''),
      ai: LEVELS.map((l) => btn('ai', l, LEVEL_LABEL[l], choice.ai === l)).join(''),
      rivals: Array.from({ length: MAX_RIVALS }, (_, i) => btn('rivals', i + 1, String(i + 1), choice.rivals === i + 1)).join(''),
      players: PLAYER_OPTIONS.map((n) => btn('players', n, String(n), choice.players === n)).join(''),
    };
    const rowsHtml = rows.map((r, i) =>
      `<div class="menu-row" data-focus="${i === row}"><span class="menu-k">${ROW_TITLE[r]}</span><div class="menu-opts">${opts[r]}</div></div>`).join('');
    this.root.innerHTML = `<div class="menu-card" data-testid="menu">
      <div class="menu-title">Gran Premio</div>${rowsHtml}
      <button type="button" class="menu-start" data-start data-testid="menu-start">Empezar</button>
      <div class="menu-hint">Flechas y Enter · mando: cruceta y Cruz · volante: ▲ fila, ▼ valor, REINICIAR confirma</div></div>`;
  }
}
