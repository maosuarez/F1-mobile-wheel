import { formatDelta, formatLapTime } from './format';
import type { TimingState } from '../sim/types';

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const set = (el: HTMLElement, v: string) => { if (el.textContent !== v) el.textContent = v; };

export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly speed = q('hud-speed');
  private readonly lap = q('hud-lap');
  private readonly lapTime = q('hud-laptime');
  private readonly last = q('hud-last');
  private readonly best = q('hud-best');
  private readonly delta = q('hud-delta');

  show(v: boolean): void { this.root.hidden = !v; }

  update(speedKmh: number, t: TimingState): void {
    set(this.speed, String(Math.round(speedKmh)));
    set(this.lap, String(t.lap));
    set(this.lapTime, formatLapTime(t.lapTimeS));
    set(this.last, formatLapTime(t.lastLapS));
    set(this.best, formatLapTime(t.bestLapS));
    set(this.delta, formatDelta(t.deltaS));
  }
}
