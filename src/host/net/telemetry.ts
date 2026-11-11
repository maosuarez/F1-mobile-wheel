import type { TelHint, TelMsg } from '../../shared/protocol';
import type { SimState } from '../../sim/types';

// Telemetría hacia el volante con los valores reales del coche (los mismos que muestra el HUD)

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const WARN_MAX = 24;

export function buildTel(state: SimState, extra: { warn: string; echo: number; hold: number; dbg?: TelHint }): TelMsg {
  const tel: TelMsg = {
    t: 'tel',
    spd: Math.max(0, state.car.speed * 3.6),
    gear: clamp(Math.round(state.car.gear), -1, 8), rpm: Math.max(0, state.car.rpm), leds: clamp(Math.round(state.car.leds), 0, 16),
    drs: state.car.drs, ers: clamp(state.car.ersCharge, 0, 1), ot: state.car.overtake,
    lap: state.timing.lap,
    delta: state.timing.deltaS,
    warn: extra.warn.slice(0, WARN_MAX),
    echo: extra.echo,
    hold: Math.max(0, extra.hold),
  };
  if (extra.dbg) {
    const d = extra.dbg;
    tel.dbg = { steer: clamp(d.steer, -1, 1), thr: clamp(d.thr, 0, 1), brk: clamp(d.brk, 0, 1), gear: clamp(Math.round(d.gear), -1, 8) };
  }
  return tel;
}
