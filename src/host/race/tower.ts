import { TEAMS, driverAt } from '../../shared/teams';
import type { Standing } from '../../sim/race';

// HUD de carrera (b14 D7): "P4/10", "V 2/5", diferencia con delante y detrás y torre izquierda con las posiciones.
// El modelo es puro; Tower solo escribe el DOM, a 5 Hz.

export interface TowerEntry { id: number; code: string; color: string }
export interface TowerRow { pos: number; id: number; code: string; color: string; gap: string; player: boolean }
export interface TowerModel {
  pos: string; lap: string; ahead: string; behind: string; rows: TowerRow[];
}

export const TOWER_HZ = 5;

// "+1.2" / "−0.8" (signo menos U+2212); null → "—"
export function gapText(s: number | null, sign: '+' | '−'): string {
  if (s === null || !Number.isFinite(s)) return '—';
  return `${sign}${Math.max(0, s).toFixed(1)}`;
}

// Etiquetas fijas de cada coche: la escudería es la de la plaza de pilotos (como en RaceController)
export function towerEntries(entries: readonly { id: number; team: number; name: string }[]): TowerEntry[] {
  return entries.map((e) => {
    const drv = TEAMS[e.team].drivers.find((d) => d.name === e.name) ?? driverAt(e.id).driver;
    return { id: e.id, code: drv.code, color: TEAMS[e.team].primary };
  });
}

export function towerModel(standings: readonly Standing[], entries: readonly TowerEntry[], playerId: number, laps: number): TowerModel {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const idx = standings.findIndex((s) => s.id === playerId);
  const me = idx >= 0 ? standings[idx] : null;
  const behind = idx >= 0 ? standings[idx + 1] : undefined;
  const rows = standings.map((s) => {
    const e = byId.get(s.id);
    return { pos: s.pos, id: s.id, code: e?.code ?? '???', color: e?.color ?? '#ffffff',
      gap: s.pos === 1 ? 'LÍDER' : gapText(s.gapToLeaderS, '+'), player: s.id === playerId };
  });
  return {
    pos: me ? `P${me.pos}/${standings.length}` : '',
    lap: me ? `V ${Math.min(laps, me.lapsDone + 1)}/${laps}` : '',
    ahead: me && me.pos > 1 ? gapText(me.gapAheadS, '−') : '—',
    behind: behind ? gapText(behind.gapAheadS, '+') : '—',
    rows,
  };
}

export class Tower {
  private readonly root = document.getElementById('race-hud')!;
  private readonly q = (id: string) => this.root.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  private readonly el = { pos: this.q('race-pos'), lap: this.q('race-lap'), ahead: this.q('race-gap-ahead'), behind: this.q('race-gap-behind'), list: this.q('race-tower') };
  private readonly cache = new Map<string, string>();
  private lastMs = -1e9;

  show(v: boolean): void { this.root.hidden = !v; }

  private text(key: string, e: HTMLElement, v: string): void {
    if (this.cache.get(key) !== v) { this.cache.set(key, v); e.textContent = v; }
  }

  update(standings: () => readonly Standing[], entries: readonly TowerEntry[], playerId: number, laps: number, nowMs: number): void {
    if (this.root.hidden || nowMs - this.lastMs < 1000 / TOWER_HZ) return;
    this.lastMs = nowMs;
    const m = towerModel(standings(), entries, playerId, laps);
    this.text('pos', this.el.pos, m.pos);
    this.text('lap', this.el.lap, m.lap);
    this.text('ahead', this.el.ahead, `▲ ${m.ahead}`);
    this.text('behind', this.el.behind, `▼ ${m.behind}`);
    const list = this.el.list;
    while (list.children.length < m.rows.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="tw-pos"></span><i class="tw-dot"></i><span class="tw-code"></span><span class="tw-gap"></span>';
      list.appendChild(li);
    }
    while (list.children.length > m.rows.length) list.lastElementChild!.remove();
    m.rows.forEach((r, i) => {
      const li = list.children[i] as HTMLElement;
      const key = `${r.id}|${r.gap}|${r.player}`;
      if (this.cache.get(`row${i}`) === key) return;
      this.cache.set(`row${i}`, key);
      li.dataset.player = r.player ? '1' : '0';
      li.children[0].textContent = String(r.pos);
      (li.children[1] as HTMLElement).style.background = r.color;
      li.children[2].textContent = r.code;
      li.children[3].textContent = r.gap;
    });
  }
}
