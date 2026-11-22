import { TEAMS } from '../../shared/teams';
import type { Standing } from '../../sim/race';
import { formatLapTime } from '../format';
import { PLAYER_LABELS } from '../split/players';

// Tabla de resultados (b14 D7): pos, piloto, escudería, tiempo total o diferencia, mejor vuelta y "+N V".
// El modelo es puro; ResultsView pinta el DOM con los botones Reiniciar y Menú.

export interface ResultEntry { id: number; name: string; team: number }
export interface ResultRow {
  pos: number; name: string; team: string; color: string; time: string; best: string; bestFastest: boolean; player: boolean;
  local: number;   // 0 = J1, 1 = J2, −1 = rival
}

export function resultsModel(standings: readonly Standing[], entries: readonly ResultEntry[], playerId: number, laps: number,
  localIds: readonly number[] = [playerId]): ResultRow[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const bests = standings.map((s) => s.bestLapS).filter((b): b is number => b !== null);
  const fastest = bests.length ? Math.min(...bests) : null;
  return standings.map((s) => {
    const e = byId.get(s.id)!;
    const down = Math.max(1, laps - s.lapsDone);
    // Ganador: tiempo total; el resto de los que acabaron: diferencia; sin acabar: vueltas de retraso; retirado: DNF
    const time = s.dnf ? 'DNF' : s.totalTimeS === null ? `+${down} V`
      : s.pos === 1 ? formatLapTime(s.totalTimeS) : `+${(s.gapToLeaderS ?? 0).toFixed(3)}`;
    const local = localIds.indexOf(s.id);
    return { pos: s.pos, name: e.name, team: TEAMS[e.team].name, color: TEAMS[e.team].primary, time,
      best: formatLapTime(s.bestLapS), bestFastest: fastest !== null && s.bestLapS === fastest, player: local >= 0, local };
  });
}

export class ResultsView {
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly root: HTMLElement) {}

  // Muestra la tabla; Enter reinicia y M vuelve al menú
  show(rows: readonly ResultRow[], onRestart: () => void, onMenu: () => void): void {
    const split = rows.some((r) => r.local > 0);
    const tag = (r: ResultRow) => (split && r.local >= 0 ? `<b class="res-tag" data-local="${r.local}">${PLAYER_LABELS[r.local]}</b>` : '');
    const body = rows.map((r) => `<tr data-player="${r.player ? 1 : 0}" data-local="${r.local}"><td>${r.pos}</td>
      <td><i style="background:${r.color}"></i>${tag(r)}${r.name}</td><td>${r.team}</td><td>${r.time}</td>
      <td${r.bestFastest ? ' class="fastest"' : ''}>${r.best}</td></tr>`).join('');
    this.root.innerHTML = `<div class="results-card" data-testid="results">
      <div class="results-title">Resultados</div>
      <table class="results-table${split ? ' split' : ''}" data-testid="results-table"><thead><tr><th>Pos</th><th>Piloto</th><th>Escudería</th><th>Tiempo</th><th>Mejor vuelta</th></tr></thead>
      <tbody>${body}</tbody></table>
      <div class="results-actions"><button type="button" data-testid="results-restart">Reiniciar</button><button type="button" data-testid="results-menu">Menú</button></div></div>`;
    this.root.querySelector('[data-testid="results-restart"]')!.addEventListener('click', () => { this.hide(); onRestart(); });
    this.root.querySelector('[data-testid="results-menu"]')!.addEventListener('click', () => { this.hide(); onMenu(); });
    this.onKey = (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); this.hide(); onRestart(); }
      else if (e.code === 'KeyM') { e.preventDefault(); this.hide(); onMenu(); }
    };
    window.addEventListener('keydown', this.onKey);
  }

  hide(): void {
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    this.onKey = null;
  }
}
