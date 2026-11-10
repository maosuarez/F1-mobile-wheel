import { config as defaultConfig } from '../shared/config';
import type { GameConfig } from '../shared/config';
import { locate, sampleAt, wrapS } from '../track/query';
import type { Track } from '../track/types';
import { createCarState, seedCarNoise, stepCar } from './car';
import { LapTimer } from './timing';
import type { DriverCommand, DriverInput, SimEvent, SimState } from './types';

// Simulación determinista a paso fijo (design D5).
export class Simulation {
  readonly track: Track;
  readonly cfg: GameConfig;
  readonly state: SimState;
  readonly timer: LapTimer;

  constructor(track: Track, cfg: GameConfig = defaultConfig) {
    this.track = track;
    this.cfg = cfg;
    this.timer = new LapTimer(track, cfg);
    this.state = { t: 0, stepCount: 0, car: createCarState(), timing: this.timer.state };
    this.reset();
  }

  // Avanza exactamente cfg.sim.dt. Los comandos se ignoran en este bloque.
  step(input: DriverInput, _commands?: readonly DriverCommand[]): SimEvent[] {
    const events: SimEvent[] = [];
    const st = this.state;
    const sPrev = st.car.s;
    const tPrev = st.t;
    stepCar(st.car, input, this.track, this.cfg, events);
    st.stepCount++;
    st.t = st.stepCount * this.cfg.sim.dt;
    this.timer.update(sPrev, st.car.s, tPrev, st.t, events);
    return events;
  }

  // Parrilla: s = startS − startOffsetM, d = 0, parado.
  reset(): void {
    const st = this.state;
    st.t = 0;
    st.stepCount = 0;
    Object.assign(st.car, createCarState());
    seedCarNoise(st.car);
    this.placeAt(wrapS(this.track, this.track.startS - this.cfg.sim.startOffsetM));
    this.timer.reset();
  }

  // Tecla R: línea central en el s actual, parado, rumbo de pista.
  recenter(): void {
    this.placeAt(this.state.car.s);
  }

  private placeAt(s: number): void {
    const car = this.state.car;
    const p = sampleAt(this.track, s);
    car.x = p.x; car.z = p.z; car.yaw = p.heading;
    car.vx = 0; car.vz = 0; car.speed = 0; car.vLong = 0; car.vLat = 0; car.yawRate = 0;
    car.steerAngle = 0; car.throttle = 0; car.brake = 0; car.aLong = 0; car.aLat = 0; car.slip = 0;
    const loc = locate(this.track, p.x, p.z, Math.round(wrapS(this.track, s) / this.track.step));
    car.s = loc.s; car.d = loc.d; car.trackIndex = loc.i; car.surface = loc.surface; car.kerbSide = loc.kerbSide;
    car.y = loc.y + loc.bank * loc.d; car.pitch = p.pitch; car.roll = loc.bank;
  }
}
