import * as THREE from 'three';
import type { GameConfig } from '../shared/config';
import { engineParams } from './engineParams';

// Motores de los rivales más cercanos (b14 D7): como mucho `audio.rivalVoices` voces a < `audio.rivalMaxM`, cada una
// un motor procedural reducido (sierra + cuadrada → paso bajo) con PannerNode HRTF, sobre el contexto y el bus maestro
// del motor del jugador (pausa y silencio compartidos). La selección es pura y testeable.

export interface RivalSound { id: number; cur: { x: number; y: number; z: number }; rpm: number; throttle: number; speed: number; limiter: boolean }

// Ids de los `count` rivales más cercanos a (x, z) a menos de maxM, del más cercano al más lejano (desempate por id).
export function nearestRivals(x: number, z: number, rivals: readonly { id: number; cur: { x: number; z: number } }[],
                              maxM: number, count: number): number[] {
  const near: { id: number; d2: number }[] = [];
  for (const r of rivals) {
    const dx = r.cur.x - x, dz = r.cur.z - z, d2 = dx * dx + dz * dz;
    if (d2 < maxM * maxM) near.push({ id: r.id, d2 });
  }
  near.sort((a, b) => a.d2 - b.d2 || a.id - b.id);
  return near.slice(0, count).map((n) => n.id);
}

// Igual que nearestRivals con varios oyentes (pantalla dividida, b15 D5): distancia al jugador más cercano de cada rival.
export function nearestRivalsMulti(from: readonly { x: number; z: number }[], rivals: readonly { id: number; cur: { x: number; z: number } }[],
                                   maxM: number, count: number): number[] {
  const near: { id: number; d2: number }[] = [];
  for (const r of rivals) {
    let d2 = Infinity;
    for (const p of from) { const dx = r.cur.x - p.x, dz = r.cur.z - p.z; d2 = Math.min(d2, dx * dx + dz * dz); }
    if (d2 < maxM * maxM) near.push({ id: r.id, d2 });
  }
  near.sort((a, b) => a.d2 - b.d2 || a.id - b.id);
  return near.slice(0, count).map((n) => n.id);
}

// Asigna ids a voces conservando la voz de los que ya sonaban (sin saltos de una voz a otra). null = voz libre.
export function assignVoices(current: readonly (number | null)[], wanted: readonly number[]): (number | null)[] {
  const out: (number | null)[] = current.map((id) => (id !== null && wanted.includes(id) ? id : null));
  for (const id of wanted) {
    if (out.includes(id)) continue;
    const free = out.indexOf(null);
    if (free >= 0) out[free] = id;
  }
  return out;
}

interface Voice { saw: OscillatorNode; square: OscillatorNode; lowpass: BiquadFilterNode; gain: GainNode; panner: PannerNode }

interface Listener { x: number; y: number; z: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number }

export class RivalAudio {
  private readonly a: GameConfig['audio'];
  private ctx: AudioContext | null = null;
  private voicesG: Voice[] = [];
  private ids: (number | null)[];
  private readonly lp = new THREE.Vector3();
  private readonly lf = new THREE.Vector3();
  private readonly lu = new THREE.Vector3();

  constructor(cfg: GameConfig) {
    this.a = cfg.audio;
    this.ids = new Array(cfg.audio.rivalVoices).fill(null);
  }

  // Ids que suenan ahora (para depuración).
  voices(): number[] { return this.ids.filter((id): id is number => id !== null); }

  // out: contexto y bus del motor del jugador (null si el audio no ha arrancado); from: posición del coche del jugador.
  // from: posición del jugador, o de cada jugador local con pantalla dividida.
  update(out: { ctx: AudioContext; bus: AudioNode } | null, rivals: readonly RivalSound[],
         from: { x: number; z: number } | readonly { x: number; z: number }[], camera: THREE.Object3D): void {
    const wanted = Array.isArray(from) ? nearestRivalsMulti(from, rivals, this.a.rivalMaxM, this.a.rivalVoices)
      : nearestRivals((from as { x: number }).x, (from as { z: number }).z, rivals, this.a.rivalMaxM, this.a.rivalVoices);
    this.ids = assignVoices(this.ids, wanted);
    if (!out) return;
    if (this.ctx !== out.ctx) this.build(out.ctx, out.bus);
    const ctx = out.ctx, now = ctx.currentTime, tau = this.a.paramTauS;
    camera.getWorldPosition(this.lp);
    camera.getWorldDirection(this.lf);
    const u = this.lu.set(0, 1, 0).transformDirection(camera.matrixWorld);
    setListener(ctx.listener, { x: this.lp.x, y: this.lp.y, z: this.lp.z, fx: this.lf.x, fy: this.lf.y, fz: this.lf.z, ux: u.x, uy: u.y, uz: u.z }, now, tau);
    for (let v = 0; v < this.voicesG.length; v++) {
      const voice = this.voicesG[v], id = this.ids[v];
      const r = id === null ? undefined : rivals.find((o) => o.id === id);
      if (!r) { voice.gain.gain.setTargetAtTime(0, now, tau); continue; }
      const p = engineParams({ rpm: r.rpm, throttle: r.throttle, speedMs: r.speed, limiter: r.limiter }, this.a);
      voice.saw.frequency.setTargetAtTime(p.f0Hz, now, tau);
      voice.square.frequency.setTargetAtTime(2 * p.f0Hz, now, tau);
      voice.lowpass.frequency.setTargetAtTime(Math.min(p.cutoffHz, ctx.sampleRate * 0.45), now, tau);
      voice.gain.gain.setTargetAtTime(p.engineGain * this.a.rivalGain, now, tau);
      setPos(voice.panner, r.cur.x, r.cur.y, r.cur.z, now, tau);
    }
  }

  private build(ctx: AudioContext, bus: AudioNode): void {
    this.ctx = ctx;
    this.voicesG = this.ids.map(() => {
      const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 200;
      const square = ctx.createOscillator(); square.type = 'square'; square.frequency.value = 400;
      const sawGain = ctx.createGain(); sawGain.gain.value = 1 - this.a.squareMix;
      const squareGain = ctx.createGain(); squareGain.gain.value = this.a.squareMix;
      const lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = this.a.cutoffMinHz;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = this.a.rivalRefM; panner.maxDistance = this.a.rivalMaxM; panner.rolloffFactor = 1;
      saw.connect(sawGain).connect(lowpass);
      square.connect(squareGain).connect(lowpass);
      lowpass.connect(gain).connect(panner).connect(bus);
      saw.start(); square.start();
      return { saw, square, lowpass, gain, panner };
    });
  }
}

function setPos(p: PannerNode, x: number, y: number, z: number, now: number, tau: number): void {
  if (p.positionX) { p.positionX.setTargetAtTime(x, now, tau); p.positionY.setTargetAtTime(y, now, tau); p.positionZ.setTargetAtTime(z, now, tau); }
  else p.setPosition(x, y, z);
}

function setListener(l: AudioListener, v: Listener, now: number, tau: number): void {
  if (l.positionX) {
    l.positionX.setTargetAtTime(v.x, now, tau); l.positionY.setTargetAtTime(v.y, now, tau); l.positionZ.setTargetAtTime(v.z, now, tau);
    l.forwardX.setTargetAtTime(v.fx, now, tau); l.forwardY.setTargetAtTime(v.fy, now, tau); l.forwardZ.setTargetAtTime(v.fz, now, tau);
    l.upX.setTargetAtTime(v.ux, now, tau); l.upY.setTargetAtTime(v.uy, now, tau); l.upZ.setTargetAtTime(v.uz, now, tau);
  } else {
    l.setPosition(v.x, v.y, v.z);
    l.setOrientation(v.fx, v.fy, v.fz, v.ux, v.uy, v.uz);
  }
}
