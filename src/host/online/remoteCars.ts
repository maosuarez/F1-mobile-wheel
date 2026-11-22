import { config as defaultConfig, type GameConfig } from '../../shared/config';
import type { NetAiCar, NetCar } from '../../shared/protocol';
import type { RemotePose } from '../../sim/race';

// Coche remoto (b16 D4): búfer de estados recibidos con marca de tiempo del servidor (ms). sample(t) interpola
// linealmente (ángulos por el camino corto, s con vuelta de pista) y extrapola como mucho net.maxExtrapMs con la
// velocidad de los dos últimos estados; más allá queda quieto. El llamador pide sample(nowSrv − net.interpDelayMs).

export interface RemoteSample extends RemotePose { ts: number }

const CAP = 64;                 // estados guardados como máximo
const KEEP_MS = 1000;           // se descartan los estados más viejos que esto respecto a la última consulta
const VEL_MAX_GAP_MS = 500;     // la velocidad de extrapolación solo se estima con estados separados ≤ esto

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpAngle = (a: number, b: number, u: number) => wrapAngle(a + wrapAngle(b - a) * u);

export function sampleFromCar(m: NetCar): RemoteSample {
  return { ts: m.ts, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, roll: m.roll, v: m.v, steer: m.steer,
    s: m.s, d: m.d, laps: m.laps, prog: m.prog, drs: m.drs, fin: m.fin, tt: m.tt, best: m.best };
}

export function sampleFromAi(ts: number, c: NetAiCar): RemoteSample {
  const [x, y, z, yaw, v, steer, s, d, laps, prog, fin, tt, best] = c;
  return { ts, x, y, z, yaw, pitch: 0, roll: 0, v, steer, s, d, laps, prog, drs: 0, fin, tt, best };
}

export class RemoteCar {
  private readonly buf: RemoteSample[] = [];
  private readonly trackLength: number;
  private readonly maxExtrapMs: number;
  /** Instante (ms servidor) del último estado recibido, o null. */
  get lastTs(): number | null { return this.buf.length ? this.buf[this.buf.length - 1].ts : null; }
  get size(): number { return this.buf.length; }

  constructor(trackLength: number, cfg: GameConfig = defaultConfig) {
    this.trackLength = trackLength;
    this.maxExtrapMs = cfg.net.maxExtrapMs;
  }

  // Añade un estado. Los duplicados o desordenados (ts ≤ último) se ignoran.
  push(s: RemoteSample): void {
    const last = this.lastTs;
    if (last !== null && s.ts <= last) return;
    this.buf.push(s);
    if (this.buf.length > CAP) this.buf.shift();
  }

  clear(): void { this.buf.length = 0; }

  // Pose en el instante t (ms servidor) o null si aún no hay estados.
  sample(t: number): RemotePose | null {
    const b = this.buf;
    if (b.length === 0) return null;
    while (b.length > 2 && b[1].ts < t - KEEP_MS) b.shift();
    if (t <= b[0].ts) return this.pose(b[0]);
    const last = b[b.length - 1];
    if (t >= last.ts) return this.extrapolate(t);
    let i = b.length - 2;
    while (i > 0 && b[i].ts > t) i--;
    const a = b[i], c = b[i + 1];
    return this.mix(a, c, (t - a.ts) / (c.ts - a.ts));
  }

  private pose(s: RemoteSample): RemotePose {
    const { ts: _ts, ...p } = s;
    return p;
  }

  private ds(a: number, b: number): number {
    const L = this.trackLength;
    let d = b - a;
    if (L > 0) { if (d > L / 2) d -= L; else if (d < -L / 2) d += L; }
    return d;
  }

  private wrapS(s: number): number {
    const L = this.trackLength;
    return L > 0 ? ((s % L) + L) % L : s;
  }

  // Interpolación entre a y c; los campos discretos se toman de a (c en u = 1).
  private mix(a: RemoteSample, c: RemoteSample, u: number): RemotePose {
    const k = u >= 1 ? c : a;
    return {
      x: lerp(a.x, c.x, u), y: lerp(a.y, c.y, u), z: lerp(a.z, c.z, u),
      yaw: lerpAngle(a.yaw, c.yaw, u), pitch: lerpAngle(a.pitch, c.pitch, u), roll: lerpAngle(a.roll, c.roll, u),
      v: lerp(a.v, c.v, u), steer: lerp(a.steer, c.steer, u),
      s: this.wrapS(a.s + this.ds(a.s, c.s) * u), d: lerp(a.d, c.d, u),
      laps: k.laps, prog: lerp(a.prog, c.prog, u), drs: k.drs, fin: k.fin, tt: k.tt, best: k.best,
    };
  }

  // Extrapolación desde el último estado durante min(t − último, maxExtrapMs).
  private extrapolate(t: number): RemotePose {
    const b = this.buf, last = b[b.length - 1];
    const dt = Math.min(t - last.ts, this.maxExtrapMs);
    const p = this.pose(last);
    if (dt <= 0 || last.fin) return p;
    const prev = b.length >= 2 ? b[b.length - 2] : null;
    if (prev && last.ts - prev.ts <= VEL_MAX_GAP_MS) {
      const u = dt / (last.ts - prev.ts);
      p.x += (last.x - prev.x) * u; p.y += (last.y - prev.y) * u; p.z += (last.z - prev.z) * u;
      p.s = this.wrapS(last.s + this.ds(prev.s, last.s) * u);
      p.prog += (last.prog - prev.prog) * u;
    } else {
      const sec = dt / 1000;
      p.x += Math.cos(last.yaw) * last.v * sec; p.z += -Math.sin(last.yaw) * last.v * sec;
      p.s = this.wrapS(last.s + last.v * sec);
      p.prog += last.v * sec;
    }
    return p;
  }
}
