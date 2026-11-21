import { config as defaultConfig } from '../shared/config';
import type { GameConfig } from '../shared/config';
import { deltaS, sampleAt, wrapS } from '../track/query';
import type { Track } from '../track/types';
import { gripAccel, maxSteerRad } from './car';
import type { RacePhase } from './race';
import { mulberry32 } from './rng';
import type { DriverCommand, DriverInput, SimState } from './types';

// Piloto rival (b14 D3): perfil de velocidad sobre la trazada ideal, persecución pura hacia la trazada desplazada,
// seguimiento y adelantamiento simples, salida con tiempo de reacción, DRS/ERS e inconsistencia sembrada por vuelta.
// Puro y determinista; read() se llama una vez por paso de simulación.

export interface RivalSkill { gripUse: number; brakeUse: number; reactionS: number; aggression: number; consistency: number }
export interface CarSnapshot { id: number; s: number; d: number; speed: number; lapsDone: number }
export type AiLevel = keyof GameConfig['ai']['levels'];

const LINE_SPAN = 3;         // vecinos (muestras) para la curvatura de Menger de la trazada
const LINE_SMOOTH = 3;       // semiancho (muestras) de la media móvil de la curvatura
const LAT_CLEAR_M = 2.2;     // |Δd| por debajo del cual dos coches se solapan lateralmente (D3)
const PASS_SEP_M = 2.6;      // separación lateral buscada al ponerse al lado
const ALONGSIDE_M = 6;       // |Δs| para considerar un coche "al lado"
const SIDE_MIN_M = 1.0;      // |Δd| mínimo para tratar un coche cercano como "al lado" y no en fila
const CORNER_SCAN_M = 300;   // distancia de búsqueda de la próxima curva para elegir el interior
const STRAIGHT_K = 0.002;    // |k| de la trazada por debajo del cual se considera recta (1/m)
const ERS_MIN_CHARGE = 0.3;  // carga mínima para usar el adelantamiento (D3)
const OVERTAKE_GAP_S = 0.6;  // diferencia máxima con el de delante para usar el adelantamiento (D3)
const FOLLOW_DEC = 0.5;      // fracción de la frenada disponible para anticipar el seguimiento (deja agarre para girar)
const TRAFFIC_BRAKE_MIN = 0.2; // freno mínimo permitido por tráfico aunque la curva pida todo el agarre
const INCONSISTENCY = 0.03;  // variación máxima de gripUse por vuelta con consistency = 0 (D3)

// Habilidad de un rival sembrada a partir del nivel (D3).
export function rivalSkill(level: AiLevel, seed: number, cfg: GameConfig = defaultConfig): RivalSkill {
  const r = mulberry32(seed);
  const base = cfg.ai.levels[level];
  const j = () => (r() * 2 - 1) * 0.015;
  return {
    gripUse: base.gripUse + j(), brakeUse: base.brakeUse + j(),
    reactionS: 0.15 + r() * 0.2, aggression: 0.3 + r() * 0.5, consistency: 0.85 + r() * 0.13,
  };
}

// Geometría de la trazada: curvatura suavizada y longitud de cada segmento i → i+1 sobre la trazada.
interface LineGeom { k: Float64Array; seg: Float64Array }
const lineCache = new WeakMap<Track, LineGeom>();

function lineGeom(t: Track): LineGeom {
  const cached = lineCache.get(t);
  if (cached) return cached;
  const n = t.n;
  const px = new Float64Array(n), pz = new Float64Array(n);
  for (let i = 0; i < n; i++) { px[i] = t.x[i] + t.rl[i] * t.nx[i]; pz[i] = t.z[i] + t.rl[i] * t.nz[i]; }
  const idx = (i: number) => (t.closed ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1));
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = idx(i - LINE_SPAN), b = idx(i + LINE_SPAN);
    const ax = px[i] - px[a], az = pz[i] - pz[a], bx = px[b] - px[i], bz = pz[b] - pz[i];
    const cx = px[b] - px[a], cz = pz[b] - pz[a];
    const den = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz);
    raw[i] = den > 1e-9 ? Math.abs(2 * (ax * bz - az * bx)) / den : 0;
  }
  const k = new Float64Array(n), seg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let o = -LINE_SMOOTH; o <= LINE_SMOOTH; o++) sum += raw[idx(i + o)];
    k[i] = sum / (2 * LINE_SMOOTH + 1);
    const j = idx(i + 1);
    seg[i] = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
  }
  const g = { k, seg };
  lineCache.set(t, g);
  return g;
}

// Perfil de velocidad (m/s) por muestra sobre la trazada, limitado por agarre lateral y por frenada (como el autopiloto).
function lineProfile(t: Track, gripUse: number, brakeUse: number, cfg: GameConfig): Float64Array {
  const { k, seg } = lineGeom(t);
  const n = t.n, mu = cfg.car.mu, g = cfg.sim.g, vMax = cfg.autopilot.maxSpeedMs;
  const kAero = mu * gripUse * cfg.aero.clA * cfg.sim.rho / (2 * cfg.car.massKg);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const den = k[i] - kAero;
    v[i] = den <= 0 ? vMax : Math.min(vMax, Math.sqrt(mu * g * gripUse / den));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let j = n - 1; j >= 0; j--) {
      const next = j + 1 < n ? j + 1 : (t.closed ? 0 : -1);
      if (next < 0) continue;
      const vn = v[next];
      const dec = brakeUse * cfg.car.brakeGripFactor * gripAccel(vn, 1, cfg);
      const vm = Math.sqrt(vn * vn + 2 * dec * seg[j]);
      if (v[j] > vm) v[j] = vm;
    }
  }
  return v;
}

export class RivalDriver {
  readonly skill: RivalSkill;
  private readonly track: Track;
  private readonly cfg: GameConfig;
  private readonly rng: () => number;
  private profile: Float64Array;
  private readonly lineK: Float64Array;
  private lap = -1;
  private greenS = 0;
  private offset = 0;           // desplazamiento lateral respecto a la trazada (m, + izquierda)
  private onStraight = false;
  private useOvertake = false;  // decisión de adelantamiento (ERS) para la recta en curso

  constructor(track: Track, skill: RivalSkill, seed: number, cfg: GameConfig = defaultConfig) {
    this.track = track;
    this.skill = skill;
    this.cfg = cfg;
    this.rng = mulberry32(seed);
    this.lineK = lineGeom(track).k;
    this.profile = lineProfile(track, skill.gripUse, skill.brakeUse, cfg);
  }

  // Desplazamiento lateral actual respecto a la trazada (m, + izquierda).
  get offsetM(): number { return this.offset; }

  // Valor interpolado de una tabla por muestra en s.
  private at(a: Float64Array, s: number): number {
    const t = this.track;
    const pos = wrapS(t, s) / t.step;
    const i = Math.min(Math.floor(pos), t.n - 1);
    const j = i + 1 < t.n ? i + 1 : (t.closed ? 0 : i);
    const u = Math.min(Math.max(pos - i, 0), 1);
    return a[i] + (a[j] - a[i]) * u;
  }

  // Lado interior (+1 izquierda, −1 derecha) de la próxima curva.
  private insideSide(s: number): number {
    const t = this.track;
    let bestK = 0;
    for (let ds = 0; ds <= CORNER_SCAN_M; ds += t.step * 2) {
      const k = this.at(t.k, s + ds);
      if (Math.abs(k) > Math.abs(bestK)) bestK = k;
    }
    return bestK < 0 ? -1 : 1;
  }

  // others: el resto de coches (sin este). race.gapAheadS: diferencia con el de delante (s).
  read(self: SimState, others: readonly CarSnapshot[], race: { phase: RacePhase; gapAheadS: number | null }): { input: DriverInput; commands: DriverCommand[] } {
    const car = self.car, cfg = this.cfg, ai = cfg.ai, ap = cfg.autopilot, t = this.track, dt = cfg.sim.dt;
    const none = { input: { steer: 0, throttle: 0, brake: 0, ers: false }, commands: [] as DriverCommand[] };
    if (race.phase !== 'green' && race.phase !== 'finishing' && race.phase !== 'finished') return none;
    this.greenS += dt;
    if (this.greenS < this.skill.reactionS) return none;

    // Inconsistencia: gripUse varía cada vuelta
    if (self.timing.lap !== this.lap) {
      this.lap = self.timing.lap;
      const g = this.skill.gripUse + (this.rng() * 2 - 1) * (1 - this.skill.consistency) * INCONSISTENCY;
      this.profile = lineProfile(t, g, this.skill.brakeUse, cfg);
    }

    const v = car.speed;
    const sp = sampleAt(t, car.s);
    const dMax = sp.wl - ai.edgeMarginM, dMin = -(sp.wr - ai.edgeMarginM);
    const rlHere = this.at(t.rl, car.s);
    // Perfil de la trazada corregido por el desplazamiento: hacia el interior el radio es menor (v ∝ √R)
    const sPrev = car.s + v * ap.speedPreviewS;
    const radiusFactor = Math.min(1, Math.max(0.5, 1 - this.offset * this.at(t.k, sPrev)));
    let vTarget = this.at(this.profile, sPrev) * Math.sqrt(radiusFactor);
    const braking = vTarget < v - 0.5;
    const vProfile = vTarget;

    // Tráfico: coche de delante que solapa mi carril actual o el previsto (trazada + desplazamiento en su s)
    const plannedD = (o: CarSnapshot) => this.at(t.rl, o.s) + this.offset;
    let ahead: CarSnapshot | null = null, aheadDs = Infinity;
    for (const o of others) {
      const ds = deltaS(t, car.s, o.s);
      if (ds <= 0 || ds >= ai.followM || ds >= aheadDs) continue;
      if (Math.abs(o.d - car.d) < LAT_CLEAR_M || Math.abs(o.d - plannedD(o)) < LAT_CLEAR_M) { ahead = o; aheadDs = ds; }
    }
    // Carril libre en d desde ALONGSIDE_M por detrás hasta followM por delante (sin contar `skip`)
    const laneFree = (d: number, skip: CarSnapshot | null) => {
      for (const o of others) {
        if (o === skip) continue;
        const ds = deltaS(t, car.s, o.s);
        if (ds > -ALONGSIDE_M && ds < ai.followM && Math.abs(o.d - d) < LAT_CLEAR_M) return false;
      }
      return true;
    };
    let offsetTarget = 0;
    if (ahead) {
      const closing = v - ahead.speed;
      const wantPass = closing > ai.overtakeCloseMs || car.drs >= 1;
      const inside = this.insideSide(car.s);
      let room = false, dPass = 0;
      const spA = sampleAt(t, ahead.s);
      const hiA = Math.min(dMax, spA.wl - ai.edgeMarginM), loA = Math.max(dMin, -(spA.wr - ai.edgeMarginM));
      for (const side of [inside, -inside]) {
        const d = ahead.d + side * PASS_SEP_M;
        if (d <= hiA && d >= loA && laneFree(d, ahead)) { room = true; dPass = d; break; }
      }
      if (wantPass && room) offsetTarget = dPass - rlHere;
      else offsetTarget = this.offset;   // sin hueco: mantiene el carril y sigue
      const minFollow = 4 * (cfg.race.carHalfLenM + cfg.race.carRadiusM);
      if (!wantPass || !room || braking || aheadDs < minFollow) vTarget = Math.min(vTarget, ahead.speed - 1);
      // Evitar alcances (D3): a < brakeGapS sin hueco, como mucho su velocidad; frenada anticipada con su velocidad actual
      if (!room && aheadDs < ai.brakeGapS * Math.max(v, 1)) vTarget = Math.min(vTarget, ahead.speed);
      const dec = FOLLOW_DEC * this.skill.brakeUse * cfg.car.brakeGripFactor * gripAccel(ahead.speed, 1, cfg);
      vTarget = Math.min(vTarget, Math.sqrt(ahead.speed * ahead.speed + 2 * dec * Math.max(0, aheadDs - minFollow)));
    } else if (this.offset !== 0 && !laneFree(rlHere, null)) {
      offsetTarget = this.offset;        // no vuelve a la trazada mientras esté ocupada
    }
    // Hacia el objetivo de desplazamiento a ritmo limitado
    const maxMove = ai.offsetRateMs * dt;
    this.offset += Math.max(-maxMove, Math.min(maxMove, offsetTarget - this.offset));
    this.offset = Math.max(dMin - rlHere, Math.min(dMax - rlHere, this.offset));

    // Dirección: persecución pura hacia la trazada desplazada, sin cerrarse sobre un coche al lado
    const ld = ap.lookaheadBaseM + ap.lookaheadPerMs * v;
    const p = sampleAt(t, car.s + ld);
    let dT = this.at(t.rl, car.s + ld) + this.offset;
    for (const o of others) {
      // Solo coches realmente al lado (no en fila, que los gestiona el seguimiento)
      if (Math.abs(deltaS(t, car.s, o.s)) >= ALONGSIDE_M || Math.abs(o.d - car.d) < SIDE_MIN_M) continue;
      if (o.d >= car.d) dT = Math.min(dT, o.d - PASS_SEP_M);
      else dT = Math.max(dT, o.d + PASS_SEP_M);
    }
    const hw = cfg.car.halfWidthM;
    dT = Math.max(-(p.wr - hw), Math.min(p.wl - hw, dT));
    const dx = p.x + dT * p.nx - car.x, dz = p.z + dT * p.nz - car.z;
    const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
    const lx = -Math.sin(car.yaw), lz = -Math.cos(car.yaw);
    const fwd = dx * fx + dz * fz, left = dx * lx + dz * lz;
    const delta = Math.atan(2 * cfg.car.wheelbaseM * left / Math.max(fwd * fwd + left * left, 1e-6));
    const steer = Math.max(-1, Math.min(1, -delta / maxSteerRad(v, cfg)));

    // Pedales: control proporcional como el autopiloto
    const err = vTarget - v;
    const throttle = err >= 0 ? Math.min(1, err * ap.throttleGain) : 0;
    let brake = err < 0 ? Math.min(1, -err * ap.brakeGain) : 0;
    // Frenada por tráfico en curva: no más de lo que deja el círculo de fricción tras el giro de la trazada
    if (vTarget < vProfile && brake > 0) {
      const aMax = gripAccel(v, 1, cfg);
      const aLat = v * v * Math.abs(this.at(this.lineK, car.s));
      const left = Math.sqrt(Math.max(0, aMax * aMax - aLat * aLat));
      brake = Math.min(brake, Math.max(TRAFFIC_BRAKE_MIN, left / (cfg.car.brakeGripFactor * aMax)));
    }

    // ERS (adelantamiento) en recta persiguiendo de cerca, decidido una vez por recta con probabilidad aggression
    const straight = Math.abs(this.at(this.lineK, car.s)) < STRAIGHT_K && throttle > 0.95;
    if (straight && !this.onStraight) this.useOvertake = this.rng() < this.skill.aggression;
    this.onStraight = straight;
    const ers = straight && this.useOvertake && car.ersCharge > ERS_MIN_CHARGE
      && race.gapAheadS !== null && race.gapAheadS < OVERTAKE_GAP_S;

    const commands: DriverCommand[] = car.drs === 1 && throttle > 0.95 ? ['drs'] : [];
    return { input: { steer, throttle, brake, ers }, commands };
  }
}
