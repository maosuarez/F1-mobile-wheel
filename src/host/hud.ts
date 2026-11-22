import { hudModel, LED_COUNT, type HudModel } from './hudModel';
import type { SimState } from '../sim/types';

// HUD de un jugador sobre su contenedor (#hud-p1, #hud-p2; b15 D4). DOM solo cuando cambia el valor mostrado
export class HudView {
  private readonly el: {
    speed: HTMLElement; gear: HTMLElement; leds: HTMLElement; drs: HTMLElement; ers: HTMLElement; ersPct: HTMLElement;
    ot: HTMLElement; auto: HTMLElement; warn: HTMLElement; lap: HTMLElement; lapTime: HTMLElement; last: HTMLElement;
    best: HTMLElement; delta: HTMLElement; sectors: HTMLElement[]; racePos: HTMLElement | null;
  };
  private readonly leds: HTMLElement[];
  private readonly cache = new Map<string, string>();

  constructor(private readonly root: HTMLElement) {
    const q = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    this.el = {
      speed: q('hud-speed'), gear: q('hud-gear'), leds: q('hud-leds'), drs: q('hud-drs'), ers: q('hud-ers'), ersPct: q('hud-ers-pct'),
      ot: q('hud-ot'), auto: q('hud-auto'), warn: q('hud-warn'),
      lap: q('hud-lap'), lapTime: q('hud-laptime'), last: q('hud-last'), best: q('hud-best'), delta: q('hud-delta'),
      sectors: [q('hud-sector-0'), q('hud-sector-1'), q('hud-sector-2')],
      racePos: root.querySelector<HTMLElement>('[data-testid="hud-racepos"]'),
    };
    this.leds = Array.from(this.el.leds.querySelectorAll<HTMLElement>('.led'));
  }

  show(v: boolean): void { this.root.hidden = !v; }

  // Posición y vuelta propias en pantalla dividida ("P4/10 · V 2/5"); null la oculta
  setRace(text: string | null): void {
    const e = this.el.racePos;
    if (!e) return;
    if (e.hidden !== (text === null)) e.hidden = text === null;
    if (text !== null) this.text('racePos', e, text);
  }

  private text(key: string, e: HTMLElement, v: string): void {
    if (this.cache.get(key) !== v) { this.cache.set(key, v); e.textContent = v; }
  }
  private attr(key: string, e: HTMLElement, name: string, v: string): void {
    if (this.cache.get(key) !== v) { this.cache.set(key, v); e.setAttribute(name, v); }
  }
  private cls(key: string, e: HTMLElement, name: string, on: boolean): void {
    const v = on ? '1' : '0';
    if (this.cache.get(key) !== v) { this.cache.set(key, v); e.classList.toggle(name, on); }
  }

  update(state: SimState, warn: string, bestSectors: readonly (number | null)[], autoShift = true): void {
    this.render(hudModel(state, warn, bestSectors, autoShift));
  }

  render(m: HudModel): void {
    const e = this.el;
    this.text('speed', e.speed, m.speed);
    this.text('gear', e.gear, m.gear);
    if (this.cache.get('ledsOn') !== String(m.ledsOn)) {
      this.cache.set('ledsOn', String(m.ledsOn));
      for (let i = 0; i < LED_COUNT; i++) this.leds[i]?.classList.toggle('on', i < m.ledsOn);
    }
    this.cls('blink', e.leds, 'blink', m.blink);
    this.attr('drs', e.drs, 'data-state', String(m.drs));
    this.text('drsTxt', e.drs, m.drs === 2 ? 'DRS ABIERTO' : m.drs === 1 ? 'DRS LISTO' : 'DRS');
    if (this.cache.get('ers') !== String(m.ersPct)) { this.cache.set('ers', String(m.ersPct)); e.ers.style.width = `${m.ersPct}%`; }
    this.text('ersPct', e.ersPct, m.ersText);
    this.attr('ot', e.ot, 'data-on', m.overtake ? '1' : '0');
    this.attr('auto', e.auto, 'data-on', m.auto ? '1' : '0');
    this.text('autoTxt', e.auto, m.auto ? 'AUTO' : 'MANUAL');
    this.text('warn', e.warn, m.warn);
    this.cls('warnOn', e.warn, 'show', m.warn !== '');
    this.text('lap', e.lap, m.lap);
    this.text('lapTime', e.lapTime, m.lapTime);
    this.cls('lapTimeInv', e.lapTime, 'invalid', m.lapTimeInvalid);
    this.text('last', e.last, m.last);
    this.cls('lastInv', e.last, 'invalid', m.lastInvalid);
    this.text('best', e.best, m.best);
    this.text('delta', e.delta, m.delta);
    this.attr('deltaTone', e.delta, 'data-tone', m.deltaTone);
    m.sectors.forEach((s, i) => this.attr(`sec${i}`, e.sectors[i]!, 'data-state', s));
  }
}
