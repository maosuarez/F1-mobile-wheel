import QRCode from 'qrcode';
import { config as defaultConfig, type GameConfig } from '../../shared/config';
import { RACE_NAME_MAX, type NetCfg, type NetResRow } from '../../shared/protocol';
import { driverAt } from '../../shared/teams';
import { trackById } from '../../shared/tracks';
import type { Standing } from '../../sim/race';
import { loadOnlineName, saveOnlineName } from '../storage';
import {
  OnlineClient, generateRaceCode, isRaceCode, sanitizeRaceInput,
  type OnlineGrid, type OnlinePlayer, type OnlineStatus,
} from './client';

// Vestíbulo online (b16 D7): nombre recordado, "Crear sala" (código de 6) o "Unirse" (código saneado), lista de
// jugadores con plaza y nombre; el propietario elige rivales de IA y dificultad y pulsa "Empezar". El modelo es puro
// (testeable); LobbyView pinta el DOM, crea el OnlineClient y resuelve con él al recibir `start`.
//
// Parámetros de URL para automatizar (E2E):
//   online=create|join   abre el vestíbulo directamente y crea la sala o se une a `code`
//   code=XXXXXX          código de la sala (join)
//   name=N               nombre del piloto (si no, el recordado)
//   rivals=N             rivales de IA del propietario (0..gridMax − humanos)
//   ai=easy|medium|hard  dificultad de la IA
//   laps=N               vueltas de la carrera (propietario; por defecto config.race.laps)
//   autostart=N          el propietario empieza solo en cuanto hay N jugadores en la sala
//   dropst=N             pruebas: descarta 1 de cada N mensajes `st` recibidos

export type AiLevel = NetCfg['ai'];
const AI_LEVELS: readonly AiLevel[] = ['easy', 'medium', 'hard'];
const AI_LABEL: Record<AiLevel, string> = { easy: 'Fácil', medium: 'Media', hard: 'Difícil' };
export const DEFAULT_NAME = 'Piloto';
const MAX_LAPS = 50;

export interface OnlineParams {
  action: 'create' | 'join'; code: string | null; name: string | null;
  rivals: number | null; ai: AiLevel | null; laps: number | null; autostart: number; dropSt: number;
}

const intParam = (params: URLSearchParams, k: string, min: number, max: number): number | null => {
  if (!params.has(k)) return null;
  const n = Math.round(Number(params.get(k)));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// Parámetros `online=…` de la URL; null si la URL no pide online.
export function parseOnlineParams(params: URLSearchParams): OnlineParams | null {
  const a = params.get('online');
  if (a !== 'create' && a !== 'join') return null;
  const code = sanitizeRaceInput(params.get('code') ?? '');
  const name = params.has('name') ? sanitizeName(params.get('name') ?? '') : null;
  const ai = params.get('ai') as AiLevel | null;
  return {
    action: a, code: isRaceCode(code) ? code : null, name: name || null,
    rivals: intParam(params, 'rivals', 0, 9), ai: ai && AI_LEVELS.includes(ai) ? ai : null,
    laps: intParam(params, 'laps', 1, MAX_LAPS), autostart: intParam(params, 'autostart', 1, 6) ?? 0,
    dropSt: intParam(params, 'dropst', 0, 1000) ?? 0,
  };
}

// Nombre: sin espacios sobrantes ni caracteres de control, máx. RACE_NAME_MAX.
export function sanitizeName(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, RACE_NAME_MAX).trim();
}

// Rivales de IA permitidos con `humans` jugadores: la parrilla no pasa de net.gridMax y como mucho 9 IA.
export function maxLobbyRivals(humans: number, cfg: GameConfig = defaultConfig): number {
  return Math.max(0, Math.min(9, cfg.net.gridMax - Math.max(1, humans)));
}
export function clampLobbyRivals(r: number, humans: number, cfg: GameConfig = defaultConfig): number {
  return Math.max(0, Math.min(maxLobbyRivals(humans, cfg), Math.round(r) || 0));
}

export interface LobbyRow { slot: number; name: string; owner: boolean; you: boolean }
export function lobbyRows(players: readonly OnlinePlayer[], owner: number, you: number): LobbyRow[] {
  return [...players].sort((a, b) => a.slot - b.slot)
    .map((p) => ({ slot: p.slot, name: p.name || `Jugador ${p.slot + 1}`, owner: p.slot === owner, you: p.slot === you }));
}

export function lobbyCanStart(c: { isOwner: boolean; status: OnlineStatus; players: readonly unknown[] }): boolean {
  return c.isOwner && c.status === 'lobby' && c.players.length >= 1;
}

export function closeText(code: number): string {
  switch (code) {
    case 4001: return 'La sala está llena';
    case 4002: return 'La carrera ya ha empezado';
    case 4400: return 'Código de sala no válido';
    default: return 'No se pudo conectar con la sala';
  }
}

// Humanos con la escudería de su plaza en la parrilla común (driverAt(i)), igual en todos los PCs y distinta de la IA
// (que toma driverAt(grid.length + k)).
export function gridTeams(g: OnlineGrid): OnlineGrid {
  const seats = g.seats.map((s, i) => (s.slot !== null ? { ...s, team: driverAt(i).team } : s));
  return { ...g, seats, entries: g.entries.map((e, i) => ({ ...e, team: seats[i].team })) };
}

// Código de 3 letras de la torre para un humano: iniciales de su nombre en mayúsculas (relleno con X).
export function nameCode(name: string): string {
  const letters = name.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (letters + 'XXX').slice(0, 3);
}

// Tabla `res` (ordenada por posición) como clasificación para resultsModel.
export function resStandings(rows: readonly NetResRow[]): Standing[] {
  const lead = rows[0]?.tt ?? null;
  return rows.map((r, i) => ({
    id: r.id, pos: i + 1, lapsDone: r.laps, progressM: 0,
    gapToLeaderS: r.tt !== null && lead !== null ? r.tt - lead : null,
    finished: r.tt !== null, totalTimeS: r.tt, bestLapS: r.best, ...(r.dnf ? { dnf: true } : {}),
  }) as Standing);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface LobbyResult { client: OnlineClient; cfg: NetCfg; atSrv: number }
export interface LobbyRunOptions {
  params: OnlineParams | null;
  track: string;
  laps: number;
  seed: () => number;                           // semilla de la carrera (una por vestíbulo)
  joinUrl?: (code: string) => string;           // b19 D3: URL del QR para unirse a la sala
  wheelCode: string | null;                     // sala del volante de este PC (se empareja como siempre)
  // b17 D4: el propietario eligió otro circuito (cfg.track ≠ track cargado): recargar con ?track= y volver a la sala
  onTrackMismatch?: (track: string, code: string, name: string) => void;
  makeClient?: (code: string, name: string) => OnlineClient;
}

export class LobbyView {
  private opts: LobbyRunOptions | null = null;
  private done: ((r: LobbyResult | null) => void) | null = null;
  private client: OnlineClient | null = null;
  private offs: (() => void)[] = [];
  private name = '';
  private error = '';
  private rivals = 2;
  private ai: AiLevel = 'medium';
  private cfgSeen: NetCfg | null = null;
  private seed = 1;

  constructor(private readonly root: HTMLElement, private readonly cfg: GameConfig = defaultConfig) {
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.field === 'code') {
        const v = sanitizeRaceInput(el.value);
        if (v !== el.value) el.value = v;
      } else if (el.dataset.field === 'name') this.name = el.value;
    });
    root.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement;
      if (e.key !== 'Enter') return;
      if (el.dataset.field === 'code') this.join();
      else if (el.dataset.field === 'name') this.create();
    });
  }

  // Muestra el vestíbulo; resuelve con el cliente al empezar la carrera, o null si se vuelve al menú.
  run(opts: LobbyRunOptions): Promise<LobbyResult | null> {
    this.opts = opts;
    this.seed = opts.seed();
    const p = opts.params;
    this.name = p?.name ?? loadOnlineName() ?? '';
    this.rivals = p?.rivals ?? this.rivals;
    this.ai = p?.ai ?? this.ai;
    this.error = '';
    this.render();
    return new Promise((resolve) => {
      this.done = resolve;
      if (p?.action === 'create') this.create();
      else if (p?.action === 'join' && p.code) this.join(p.code);
    });
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !this.done) return;
    const act = el.dataset.act;
    if (act === 'create') this.create();
    else if (act === 'join') this.join();
    else if (act === 'back') this.back();
    else if (act === 'start') this.start();
    else if (act === 'rivals') { this.rivals = Number(el.dataset.val) || 0; this.configure(); this.render(); }
    else if (act === 'ai') { const v = el.dataset.val as AiLevel; if (AI_LEVELS.includes(v)) this.ai = v; this.configure(); this.render(); }
  }

  private currentName(): string {
    const input = this.root.querySelector<HTMLInputElement>('[data-field="name"]');
    const n = sanitizeName(input ? input.value : this.name) || DEFAULT_NAME;
    this.name = n;
    saveOnlineName(n);
    return n;
  }

  private create(): void { if (!this.client) this.connect(generateRaceCode()); }

  private join(code?: string): void {
    if (this.client) return;
    const c = code ?? sanitizeRaceInput(this.root.querySelector<HTMLInputElement>('[data-field="code"]')?.value ?? '');
    if (!isRaceCode(c)) { this.error = 'Escribe el código de 6 caracteres'; this.render(); return; }
    this.connect(c);
  }

  private connect(code: string): void {
    const name = this.currentName();
    const c = this.opts?.makeClient ? this.opts.makeClient(code, name)
      : new OnlineClient({ code, name, team: 0, cfg: this.cfg, dropStEvery: this.opts?.params?.dropSt || undefined });
    this.client = c;
    this.error = '';
    this.cfgSeen = null;
    this.offs = [
      c.on('lobby', () => { this.maybeAutostart(); this.render(); }),
      c.on('status', () => this.render()),
      c.on('cfg', (cfg) => { this.cfgSeen = cfg; if (!this.checkTrack(c, cfg.track)) this.render(); }),
      c.on('owner', () => { this.configure(); this.render(); }),
      c.on('close', (code) => { if (this.client === c) { this.detach(); this.error = closeText(code); this.render(); } }),
      c.on('start', (cfg, atSrv) => {
        if (this.checkTrack(c, cfg.track)) return;
        const resolve = this.done;
        this.detach(false);
        this.done = null;
        resolve?.({ client: c, cfg, atSrv });
      }),
    ];
    this.render();
    c.connect();
  }

  // Circuito del propietario distinto del cargado: sale de la sala y pide recargar (o error si el id es desconocido).
  // true si no coincide (el vestíbulo deja de usar este cliente).
  private checkTrack(c: OnlineClient, track: string): boolean {
    const o = this.opts;
    if (!o || track === o.track) return false;
    this.detach();
    if (trackById(track) && o.onTrackMismatch) o.onTrackMismatch(track, c.code, this.name);
    else { this.error = `Circuito desconocido: ${track}`; this.render(); }
    return true;
  }

  // Quita los oyentes del vestíbulo; close: cierra también la conexión
  private detach(close = true): void {
    for (const off of this.offs) off();
    this.offs = [];
    const c = this.client;
    this.client = null;
    if (close && c) c.close();
  }

  private back(): void {
    if (this.client) { this.detach(); this.render(); return; }
    const resolve = this.done;
    this.done = null;
    resolve?.(null);
  }

  private setup() {
    const o = this.opts!;
    const humans = this.client?.players.length ?? 1;
    return { track: o.track, laps: o.params?.laps ?? o.laps, rivals: clampLobbyRivals(this.rivals, humans, this.cfg), ai: this.ai, seed: this.seed };
  }

  // Propietario: difunde la configuración elegida (los demás la ven en su lista)
  private configure(): void {
    const c = this.client;
    if (c && c.isOwner && c.status === 'lobby') this.cfgSeen = c.configure(this.setup());
  }

  private start(): void {
    const c = this.client;
    if (c && lobbyCanStart(c)) c.start(this.setup());
  }

  private maybeAutostart(): void {
    const c = this.client, n = this.opts?.params?.autostart ?? 0;
    if (c && n > 0 && lobbyCanStart(c) && c.players.length >= n) this.start();
    else this.configure();
  }

  private render(): void {
    const c = this.client;
    const wheel = this.opts?.wheelCode ? `<div class="lobby-wheel" data-testid="lobby-wheel">Volante: sala <b>${esc(this.opts.wheelCode)}</b></div>` : '';
    const err = this.error ? `<div class="lobby-error" data-testid="lobby-error">${esc(this.error)}</div>` : '';
    if (!c) {
      this.root.innerHTML = `<div class="menu-card lobby-card" data-testid="lobby">
        <div class="menu-title">Online</div>
        <label class="lobby-field"><span class="menu-k">Nombre</span>
          <input data-field="name" data-testid="lobby-name" maxlength="${RACE_NAME_MAX}" autocomplete="off" spellcheck="false" placeholder="${DEFAULT_NAME}" value="${esc(this.name)}"></label>
        <div class="lobby-split">
          <button type="button" class="menu-start" data-act="create" data-testid="lobby-create">Crear sala</button>
          <div class="lobby-join"><input data-field="code" data-testid="lobby-code" maxlength="6" autocomplete="off" spellcheck="false" placeholder="CÓDIGO">
            <button type="button" class="menu-opt" data-act="join" data-testid="lobby-join">Unirse</button></div>
        </div>${err}${wheel}
        <button type="button" class="menu-opt lobby-back" data-act="back" data-testid="lobby-back">Volver</button></div>`;
      return;
    }
    const rows = lobbyRows(c.players, c.owner, c.you).map((r) => `<li data-testid="lobby-player" data-slot="${r.slot}" data-you="${r.you ? 1 : 0}">
      <b>${r.slot + 1}</b><span>${esc(r.name)}</span>${r.owner ? '<em>Propietario</em>' : ''}${r.you ? '<em>Tú</em>' : ''}</li>`).join('');
    const status = c.status === 'connecting' ? 'Conectando…' : c.status === 'countdown' ? 'Empezando…' : '';
    const joinUrl = this.opts?.joinUrl?.(c.code);
    const qr = joinUrl ? `<div class="lobby-qrbox"><canvas class="lobby-qr" data-testid="lobby-join-qr" width="200" height="200" data-url="${esc(joinUrl)}"></canvas><div class="lobby-wait">Escanea para unirte</div></div>` : '';
    let ctrl: string;
    if (c.isOwner && c.status === 'lobby') {
      const max = maxLobbyRivals(c.players.length, this.cfg), rv = clampLobbyRivals(this.rivals, c.players.length, this.cfg);
      const opt = (act: string, val: string | number, label: string, on: boolean) =>
        `<button type="button" class="menu-opt" data-act="${act}" data-val="${val}" data-testid="lobby-${act}-${val}" aria-pressed="${on}">${label}</button>`;
      ctrl = `<div class="lobby-wait" data-testid="lobby-track">Circuito: ${esc(trackById(this.opts?.track ?? '')?.name ?? this.opts?.track ?? '')}</div>
        <div class="menu-row"><span class="menu-k">Rivales IA</span><div class="menu-opts">${
        Array.from({ length: max + 1 }, (_, i) => opt('rivals', i, String(i), rv === i)).join('')}</div></div>
        <div class="menu-row"><span class="menu-k">Dificultad</span><div class="menu-opts">${
        AI_LEVELS.map((l) => opt('ai', l, AI_LABEL[l], this.ai === l)).join('')}</div></div>
        <button type="button" class="menu-start" data-act="start" data-testid="lobby-start"${lobbyCanStart(c) ? '' : ' disabled'}>Empezar</button>`;
    } else {
      const k = this.cfgSeen;
      ctrl = `<div class="lobby-wait" data-testid="lobby-wait">Esperando al propietario${k ? ` · ${esc(trackById(k.track)?.name ?? k.track)} · ${k.rivals} rivales IA · ${AI_LABEL[k.ai]}` : ''}</div>`;
    }
    this.root.innerHTML = `<div class="menu-card lobby-card" data-testid="lobby">
      <div class="menu-title">Sala <span class="lobby-code" data-testid="lobby-room">${esc(c.code)}</span></div>
      ${status ? `<div class="lobby-wait" data-testid="lobby-status">${status}</div>` : ''}
      <ol class="lobby-players" data-testid="lobby-players">${rows}</ol>${ctrl}${qr}${err}${wheel}
      <button type="button" class="menu-opt lobby-back" data-act="back" data-testid="lobby-leave">Salir de la sala</button></div>`;
    const canvas = this.root.querySelector<HTMLCanvasElement>('.lobby-qr');
    if (canvas && joinUrl) QRCode.toCanvas(canvas, joinUrl, { width: 200, margin: 2 }).catch(() => {});
  }
}
