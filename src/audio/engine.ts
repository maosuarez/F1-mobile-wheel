import type { GameConfig } from '../shared/config';
import type { CarState, SimEvent } from '../sim/types';
import { engineParams, SHIFT_ATTACK_S } from './engineParams';

// Audio procedural del motor (design D2). Envoltorio fino sobre Web Audio; la lógica está en engineParams.ts.

const MUTE_KEY = 'f1mw.muted';
const FADE_S = 0.1;
const NOISE_SEED = 0x1f1e5eed;

function readMuted(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function writeMuted(m: boolean): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* sin almacenamiento */ }
}
function debugEnabled(): boolean {
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1'; } catch { return false; }
}

/** Ruido blanco determinista (LCG de Numerical Recipes). */
function noiseBuffer(ctx: AudioContext, seconds: number, seed: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return buf;
}

/** Curva de saturación suave (tanh normalizada). */
function softClipCurve(n = 1024, k = 1.5): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

interface Graph {
  ctx: AudioContext;
  saw: OscillatorNode; square: OscillatorNode; sawGain: GainNode; squareGain: GainNode;
  lowpass: BiquadFilterNode; engineGain: GainNode; shiftGain: GainNode; limiterGain: GainNode;
  lfo: OscillatorNode; lfoDepth: GainNode;
  noise: AudioBufferSourceNode; turboFilter: BiquadFilterNode; turboGain: GainNode;
  windFilter: BiquadFilterNode; windGain: GainNode; crackGain: GainNode;
  master: GainNode; analyser: AnalyserNode | null; buf: Float32Array<ArrayBuffer> | null;
}

export class EngineAudio {
  private readonly a: GameConfig['audio'];
  private readonly debugOn: boolean;
  private g: Graph | null = null;
  private paused = false;
  private _muted: boolean;
  private limiterOn = false;

  constructor(cfg: GameConfig) {
    this.a = cfg.audio;
    this.debugOn = debugEnabled();
    this._muted = readMuted();
  }

  get muted(): boolean { return this._muted; }

  /** Crea o reanuda el AudioContext. Llamar solo desde un gesto del usuario. */
  async start(): Promise<void> {
    if (!this.g) this.g = this.build();
    if (this.g.ctx.state !== 'running') await this.g.ctx.resume();
    this.applyMaster();
  }

  update(car: CarState, _dtS: number): void {
    const g = this.g;
    if (!g) return;
    const p = engineParams({ rpm: car.rpm, throttle: car.throttle, speedMs: car.speed, limiter: car.limiter }, this.a);
    const now = g.ctx.currentTime;
    const tau = this.a.paramTauS;
    g.saw.frequency.setTargetAtTime(p.f0Hz, now, tau);
    g.square.frequency.setTargetAtTime(2 * p.f0Hz, now, tau);
    g.sawGain.gain.setTargetAtTime(p.sawGain, now, tau);
    g.squareGain.gain.setTargetAtTime(p.squareGain, now, tau);
    g.lowpass.frequency.setTargetAtTime(Math.min(p.cutoffHz, g.ctx.sampleRate * 0.45), now, tau);
    g.engineGain.gain.setTargetAtTime(p.engineGain, now, tau);
    g.turboFilter.frequency.setTargetAtTime(p.turboHz, now, tau);
    g.turboGain.gain.setTargetAtTime(p.turboGain, now, tau);
    g.windFilter.frequency.setTargetAtTime(p.windCutoffHz, now, tau);
    g.windGain.gain.setTargetAtTime(p.windGain, now, tau);
    if (car.limiter !== this.limiterOn) {
      this.limiterOn = car.limiter;
      const half = this.a.limiterDepth / 2;
      // Rango 1 − depth .. 1 alrededor de 1 − depth/2 (igual que limiterGainAt).
      g.limiterGain.gain.setTargetAtTime(car.limiter ? 1 - half : 1, now, tau);
      g.lfoDepth.gain.setTargetAtTime(car.limiter ? half : 0, now, tau);
    }
  }

  onEvent(e: SimEvent): void {
    const g = this.g;
    if (!g || e.type !== 'shift') return;
    const a = this.a;
    const now = g.ctx.currentTime;
    const sg = g.shiftGain.gain;
    sg.cancelScheduledValues(now);
    sg.setValueAtTime(sg.value, now);
    sg.linearRampToValueAtTime(a.shiftDipGain, now + SHIFT_ATTACK_S);
    sg.setValueAtTime(a.shiftDipGain, now + a.shiftDipS);
    sg.linearRampToValueAtTime(1, now + a.shiftDipS + a.paramTauS);
    const cg = g.crackGain.gain;
    cg.cancelScheduledValues(now);
    cg.setValueAtTime(a.crackGain, now);
    cg.linearRampToValueAtTime(0, now + a.crackS);
  }

  setPaused(p: boolean): void { this.paused = p; this.applyMaster(); }

  setMuted(m: boolean): void { this._muted = m; writeMuted(m); this.applyMaster(); }

  debug(): { state: string; f0Hz: number; rms: number; peak: number } | null {
    const g = this.g;
    if (!this.debugOn || !g) return null;
    let rms = 0;
    let peak = 0;
    if (g.analyser && g.buf) {
      g.analyser.getFloatTimeDomainData(g.buf);
      let sum = 0;
      for (const v of g.buf) { sum += v * v; const av = Math.abs(v); if (av > peak) peak = av; }
      rms = Math.sqrt(sum / g.buf.length);
    }
    return { state: g.ctx.state, f0Hz: g.saw.frequency.value, rms, peak };
  }

  private applyMaster(): void {
    const g = this.g;
    if (!g) return;
    const target = this.paused || this._muted ? 0 : this.a.masterGain;
    const now = g.ctx.currentTime;
    const mg = g.master.gain;
    mg.cancelScheduledValues(now);
    mg.setValueAtTime(mg.value, now);
    mg.linearRampToValueAtTime(target, now + FADE_S);
  }

  private build(): Graph {
    const ctx = new AudioContext();
    const gain = (v: number): GainNode => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const filter = (type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f;
    };

    // Motor: sierra (f0) + cuadrada (2·f0) → mezcla → waveshaper → paso bajo → engine → shift → limiter → master.
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 200;
    const square = ctx.createOscillator(); square.type = 'square'; square.frequency.value = 400;
    const sawGain = gain(1 - this.a.squareMix);
    const squareGain = gain(this.a.squareMix);
    const mix = gain(1);
    const shaper = ctx.createWaveShaper(); shaper.curve = softClipCurve(); shaper.oversample = '2x';
    const lowpass = filter('lowpass', this.a.cutoffMinHz);
    const engineGain = gain(0);
    const shiftGain = gain(1);
    const limiterGain = gain(1);
    const master = gain(0);
    saw.connect(sawGain).connect(mix);
    square.connect(squareGain).connect(mix);
    mix.connect(shaper).connect(lowpass).connect(engineGain).connect(shiftGain).connect(limiterGain).connect(master);

    // LFO del limitador sumado a la ganancia del limitador (profundidad 0 fuera del limitador).
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = this.a.limiterHz;
    const lfoDepth = gain(0);
    lfo.connect(lfoDepth).connect(limiterGain.gain);

    // Ruido en bucle (LCG sembrado) → turbo (pasa banda), viento (paso bajo) y chasquido de cambio.
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx, 2, NOISE_SEED); noise.loop = true;
    const turboFilter = filter('bandpass', 1800, 6);
    const turboGain = gain(0);
    const windFilter = filter('lowpass', 300);
    const windGain = gain(0);
    const crackFilter = filter('bandpass', 2500, 1.2);
    const crackGain = gain(0);
    noise.connect(turboFilter).connect(turboGain).connect(master);
    noise.connect(windFilter).connect(windGain).connect(master);
    noise.connect(crackFilter).connect(crackGain).connect(master);

    // Limitador de salida.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.knee.value = 0; comp.ratio.value = 20;
    comp.attack.value = 0.003; comp.release.value = 0.1;
    master.connect(comp).connect(ctx.destination);

    let analyser: AnalyserNode | null = null;
    let buf: Float32Array<ArrayBuffer> | null = null;
    if (this.debugOn) {
      analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      buf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      comp.connect(analyser);
    }

    saw.start(); square.start(); lfo.start(); noise.start();
    return { ctx, saw, square, sawGain, squareGain, lowpass, engineGain, shiftGain, limiterGain, lfo, lfoDepth,
      noise, turboFilter, turboGain, windFilter, windGain, crackGain, master, analyser, buf };
  }
}
