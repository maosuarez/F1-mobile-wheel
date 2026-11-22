import type { RaceChoice } from '../storage';
import { TRACKS, trackById } from '../../shared/tracks';

// Menú de modo (b14 D7): Modo, Dificultad y Rivales (1–9). La lógica (modelo, acciones de teclado/mando/volante) es pura
// y testeable; RaceMenu solo pinta el DOM y resuelve la promesa con la elección.

export type MenuRow = 'track' | 'mode' | 'ai' | 'rivals' | 'players';
// prev/next: cambia de fila; dec/inc: cambia el valor de la fila (con vuelta en modo y dificultad); cycle: siguiente valor con vuelta;
// confirm: empezar
export type MenuAction = 'prev' | 'next' | 'dec' | 'inc' | 'cycle' | 'confirm';
export interface MenuModel { choice: MenuChoice; row: number }
// Resultado del menú: la elección, u `online` si se pulsó "Online" (b16 D7: abre el vestíbulo)
export type MenuResult = MenuChoice & { online?: boolean };
// Elección del menú: la de carrera más el circuito (b17 D4; no se guarda en RaceChoice, se recarga con ?track=)
export type MenuChoice = RaceChoice & { track?: string };

// Online y pantalla dividida no se combinan: con 2 jugadores la opción Online está deshabilitada
export function menuOnlineEnabled(c: RaceChoice): boolean { return c.players !== 2; }

export const MODES: readonly RaceChoice['mode'][] = ['practice', 'race'];
export const LEVELS: readonly RaceChoice['ai'][] = ['easy', 'medium', 'hard'];
export const PLAYER_OPTIONS = [1, 2] as const;
export const MIN_RIVALS = 1, MAX_RIVALS = 9;
const MODE_LABEL: Record<RaceChoice['mode'], string> = { practice: 'Práctica', race: 'Carrera 5 vueltas' };
const LEVEL_LABEL: Record<RaceChoice['ai'], string> = { easy: 'Fácil', medium: 'Media', hard: 'Difícil' };

// Filas visibles: en práctica no hay rivales ni dificultad
// 'players' (b15) solo aparece si la elección lo define (el menú siempre lo fija); 'track' (b17), igual, y va primero
export function menuRows(c: MenuChoice): MenuRow[] {
  const rows: MenuRow[] = c.mode === 'race' ? ['mode', 'ai', 'rivals'] : ['mode'];
  const all: MenuRow[] = c.players === undefined ? rows : [...rows, 'players'];
  return c.track === undefined ? all : ['track', ...all];
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;

function shiftValue(c: MenuChoice, row: MenuRow, d: number): MenuChoice {
  switch (row) {
    case 'track': {
      const i = TRACKS.findIndex((t) => t.id === c.track);
      return { ...c, track: TRACKS[wrap((i < 0 ? 0 : i) + d, TRACKS.length)].id };
    }
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
  if (row === 'track') { if (typeof value === 'string' && trackById(value)) c.track = value; }
  else if (row === 'mode' && (value === 'practice' || value === 'race')) c.mode = value;
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

const MODE_SUB: Record<RaceChoice['mode'], string> = { practice: 'Vuelta libre, sin rivales', race: 'Salida con semáforo y rivales IA' };
const ROW_TITLE: Record<MenuRow, string> = { track: 'Circuito', mode: 'Modo', ai: 'Dificultad', rivals: 'Rivales', players: 'Jugadores' };

export class RaceMenu {
  private model: MenuModel = { choice: { mode: 'practice', ai: 'medium', rivals: 9, players: 1 }, row: 0 };
  private done: ((c: MenuResult) => void) | null = null;
  private timer = 0;
  private readonly onKey = (e: KeyboardEvent) => {
    const a = keyMenuAction(e.code);
    if (!a) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat || a !== 'confirm') this.apply(a);
  };

  private track: string | undefined;
  // poll: acciones de volante y mando acumuladas desde la última llamada
  // onTrack: el jugador eligió otro circuito (b17 D4): quien llama recarga la página con ?track=
  constructor(private readonly root: HTMLElement, private readonly poll: () => MenuAction[],
              private readonly onTrack: (c: MenuChoice) => void = () => {},
              private readonly opts: { phoneWheel?: boolean } = {}) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row],[data-start],[data-online]');
      if (!el || !this.done) return;
      if (el.dataset.start !== undefined) { this.apply('confirm'); return; }
      if (el.dataset.online !== undefined) { if (menuOnlineEnabled(this.model.choice)) this.finish(true); return; }
      this.model = menuSet(this.model, el.dataset.row as MenuRow, el.dataset.val ?? '');
      this.render();
      this.checkTrack();
    });
  }

  // Muestra el menú y resuelve con la elección al confirmar
  choose(initial: MenuChoice): Promise<MenuResult> {
    this.model = { choice: { ...initial, players: initial.players ?? 1 }, row: 0 };
    this.track = initial.track;
    this.render();
    return new Promise((resolve) => {
      this.done = resolve;
      window.addEventListener('keydown', this.onKey, true);
      this.timer = window.setInterval(() => { for (const a of this.poll()) this.apply(a); }, 50);
    });
  }

  private apply(a: MenuAction): void {
    if (!this.done) return;
    if (a === 'confirm') { this.finish(false); return; }
    this.model = menuStep(this.model, a);
    this.render();
    this.checkTrack();
  }

  // Circuito distinto del cargado: se cierra el menú y se avisa (la página se recarga)
  private checkTrack(): void {
    const t = this.model.choice.track;
    if (!this.done || t === undefined || t === this.track) return;
    this.done = null;
    window.removeEventListener('keydown', this.onKey, true);
    window.clearInterval(this.timer);
    this.onTrack({ ...this.model.choice });
  }

  private finish(online: boolean): void {
    const resolve = this.done;
    if (!resolve) return;
    this.done = null;
    window.removeEventListener('keydown', this.onKey, true);
    window.clearInterval(this.timer);
    resolve(online ? { ...this.model.choice, online: true } : { ...this.model.choice });
  }

  private render(): void {
    const { choice, row } = this.model;
    const rows = menuRows(choice);
    const attrs = (r: MenuRow, val: string | number, on: boolean) =>
      `data-row="${r}" data-val="${val}" data-testid="menu-${r}-${val}" aria-pressed="${on}"`;
    const seg = (r: MenuRow, val: string | number, label: string, on: boolean) =>
      `<button type="button" class="menu-opt" ${attrs(r, val, on)}>${label}</button>`;
    const trackCard = (t: (typeof TRACKS)[number]) => {
      const night = t.lighting === 'night';
      return `<button type="button" class="menu-opt gp-track" ${attrs('track', t.id, choice.track === t.id)}>
        <span class="gp-track-name">${t.name}</span><span class="gp-track-country">${t.country}</span>
        <span class="gp-tag" data-light="${t.lighting}">${night ? 'Noche' : 'Día'}</span></button>`;
    };
    const modeCard = (m: RaceChoice['mode']) =>
      `<button type="button" class="menu-opt gp-mode" ${attrs('mode', m, choice.mode === m)}>
        <span class="gp-mode-name">${MODE_LABEL[m]}</span><span class="gp-mode-sub">${MODE_SUB[m]}</span></button>`;
    const opts: Record<MenuRow, string> = {
      track: `<div class="gp-tracks">${TRACKS.map(trackCard).join('')}</div>`,
      mode: `<div class="gp-modes">${MODES.map(modeCard).join('')}</div>`,
      ai: `<div class="gp-seg">${LEVELS.map((l) => seg('ai', l, LEVEL_LABEL[l], choice.ai === l)).join('')}</div>`,
      rivals: `<div class="gp-seg">${Array.from({ length: MAX_RIVALS }, (_, i) => seg('rivals', i + 1, String(i + 1), choice.rivals === i + 1)).join('')}</div>`,
      players: `<div class="gp-seg">${PLAYER_OPTIONS.map((n) => seg('players', n, String(n), choice.players === n)).join('')}</div>`,
    };
    const rowsHtml = rows.map((r, i) =>
      `<div class="menu-row gp-row" data-focus="${i === row}"><span class="menu-k">${ROW_TITLE[r]}</span>${opts[r]}</div>`).join('');
    const activeTrack = trackById(choice.track ?? this.track ?? '');
    const phone = this.opts.phoneWheel
      ? '<a class="gp-phone" data-testid="menu-open-wheel" href="/wheel/">Usar este celular como volante</a>' : '';
    this.root.innerHTML = `<div class="menu-card gp-card" data-testid="menu">
      ${phone}
      <header class="gp-head"><div class="gp-title">Gran Premio</div>${activeTrack ? `<div class="gp-circuit">${activeTrack.name}</div>` : ''}</header>
      ${rowsHtml}
      <div class="menu-actions gp-actions"><button type="button" class="menu-start" data-start data-testid="menu-start">Empezar</button>
      <button type="button" class="menu-online" data-online data-testid="menu-online"${menuOnlineEnabled(choice) ? '' : ' disabled title="No disponible con 2 jugadores"'}>Online</button></div>
      <div class="menu-hint">Flechas y Enter · mando: cruceta y Cruz · volante: ▲ fila, ▼ valor, REINICIAR confirma</div></div>`;
  }
}
