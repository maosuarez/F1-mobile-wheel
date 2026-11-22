import type { GameConfig } from '../shared/config';
import { locate } from '../track/query';
import type { Track } from '../track/types';
import type { CarState } from './types';

// Colisiones coche-coche (b14 D2). Cada coche son 2 círculos de radio carRadiusM en ±carHalfLenM sobre su eje
// longitudinal. Por par solapado: separación a partes iguales sobre la normal e impulso de masas iguales con
// restitución, pérdida de velocidad y giro según el brazo del contacto. Determinista (orden fijo de pares).

export interface CarHit { a: number; b: number; impulse: number }   // impulse: Δv normal transferida (m/s)

const MAX_PUSHES = 4;   // separaciones posicionales como máximo por par y paso (una por par de círculos)

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

// Par de círculos más solapado entre dos coches: normal de a hacia b, solape y brazos respecto a cada centro.
function deepest(a: CarState, b: CarState, h: number, r2: number) {
  const fax = Math.cos(a.yaw) * h, faz = -Math.sin(a.yaw) * h;
  const fbx = Math.cos(b.yaw) * h, fbz = -Math.sin(b.yaw) * h;
  let best: { nx: number; nz: number; over: number; rax: number; raz: number; rbx: number; rbz: number } | null = null;
  for (let i = -1; i <= 1; i += 2) {
    for (let j = -1; j <= 1; j += 2) {
      const ax = a.x + i * fax, az = a.z + i * faz;
      const bx = b.x + j * fbx, bz = b.z + j * fbz;
      const dx = bx - ax, dz = bz - az;
      const dist = Math.hypot(dx, dz);
      const over = r2 - dist;
      if (over <= 0 || (best && over <= best.over)) continue;
      let nx: number, nz: number;
      if (dist > 1e-9) { nx = dx / dist; nz = dz / dist; }
      else { nx = Math.cos(a.yaw); nz = -Math.sin(a.yaw); }   // centros coincidentes: normal arbitraria fija
      best = { nx, nz, over, rax: i * fax, raz: i * faz, rbx: j * fbx, rbz: j * fbz };
    }
  }
  return best;
}

function syncVelocity(c: CarState): void {
  c.speed = Math.hypot(c.vx, c.vz);
  c.vLong = c.vx * Math.cos(c.yaw) - c.vz * Math.sin(c.yaw);
  c.vLat = -c.vx * Math.sin(c.yaw) - c.vz * Math.cos(c.yaw);
}

// Giro por el impulso: momento del brazo × fuerza normalizado por brazo y velocidad (adimensional, ≤ 1).
function yawKick(c: CarState, rx: number, rz: number, fx: number, fz: number, h: number, cfg: GameConfig): void {
  const cross = rx * fz - rz * fx;                        // > 0 ⇒ tiende a girar a la derecha (yaw decrece)
  const u = Math.max(-1, Math.min(1, cross / (h * Math.max(c.speed, 1))));
  c.yaw = wrapAngle(c.yaw - cfg.race.hitYawKick * u);
}

// Modo de cada coche en la resolución (b16 D4): dinámico, remoto (no se modifica; contacto unilateral) o ignorado.
export const COLLIDE_DYNAMIC = 0, COLLIDE_REMOTE = 1, COLLIDE_IGNORE = 2;

// Resuelve los contactos entre todos los pares (i < j). Mueve x/z, ajusta velocidades y relocaliza en la pista.
// modes (opcional, por coche): con un coche remoto se calcula el contacto como entre masas iguales (usando la velocidad
// estimada del remoto) pero solo se aplica la parte del no remoto, escalada por net.remoteMassFactor; remoto contra
// remoto e ignorados no se resuelven.
export function resolveCollisions(cars: readonly CarState[], track: Track, cfg: GameConfig,
  modes?: ArrayLike<number>): CarHit[] {
  const rc = cfg.race;
  const h = rc.carHalfLenM, r2 = 2 * rc.carRadiusM;
  const reach = 2 * (h + rc.carRadiusM);
  const hits: CarHit[] = [];
  const moved = new Uint8Array(cars.length);
  const mode = (k: number) => (modes ? modes[k] ?? COLLIDE_DYNAMIC : COLLIDE_DYNAMIC);
  for (let i = 0; i < cars.length; i++) {
    const mi = mode(i);
    if (mi === COLLIDE_IGNORE) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const mj = mode(j);
      if (mj === COLLIDE_IGNORE || (mi === COLLIDE_REMOTE && mj === COLLIDE_REMOTE)) continue;
      const a = cars[i], b = cars[j];
      if (Math.abs(b.x - a.x) > reach || Math.abs(b.z - a.z) > reach) continue;
      const first = deepest(a, b, h, r2);
      if (!first) continue;
      // Parte aplicada a cada coche: 1 normal; con un remoto, 0 al remoto y remoteMassFactor al otro
      const f = cfg.net.remoteMassFactor;
      const wa = mi === COLLIDE_REMOTE ? 0 : mj === COLLIDE_REMOTE ? f : 1;
      const wb = mj === COLLIDE_REMOTE ? 0 : mi === COLLIDE_REMOTE ? f : 1;
      // Separación posicional a partes iguales (repetida si queda otro par de círculos solapado)
      let c: ReturnType<typeof deepest> = first;
      for (let k = 0; k < MAX_PUSHES && c; k++) {
        const half = c.over / 2;
        a.x -= c.nx * half * wa; a.z -= c.nz * half * wa;
        b.x += c.nx * half * wb; b.z += c.nz * half * wb;
        c = deepest(a, b, h, r2);
      }
      if (wa > 0) moved[i] = 1;
      if (wb > 0) moved[j] = 1;
      // Impulso sobre la velocidad relativa normal (solo si se acercan)
      const vn = (b.vx - a.vx) * first.nx + (b.vz - a.vz) * first.nz;
      if (vn >= 0) continue;
      const jn = (1 + rc.restitution) * -vn / 2;
      const keep = 1 - rc.hitSpeedLoss;
      if (wa > 0) {
        a.vx -= jn * wa * first.nx; a.vz -= jn * wa * first.nz;
        a.vx *= keep; a.vz *= keep;
        syncVelocity(a);
        yawKick(a, first.rax, first.raz, -jn * wa * first.nx, -jn * wa * first.nz, h, cfg);
        syncVelocity(a);
      }
      if (wb > 0) {
        b.vx += jn * wb * first.nx; b.vz += jn * wb * first.nz;
        b.vx *= keep; b.vz *= keep;
        syncVelocity(b);
        yawKick(b, first.rbx, first.rbz, jn * wb * first.nx, jn * wb * first.nz, h, cfg);
        syncVelocity(b);
      }
      hits.push({ a: i, b: j, impulse: jn });
    }
  }
  for (let i = 0; i < cars.length; i++) {
    if (!moved[i]) continue;
    const c = cars[i];
    const loc = locate(track, c.x, c.z, c.trackIndex);
    c.s = loc.s; c.d = loc.d; c.trackIndex = loc.i; c.surface = loc.surface; c.kerbSide = loc.kerbSide;
    c.y = loc.y + loc.bank * loc.d;
  }
  return hits;
}

// Distancia mínima entre centros de círculos de dos coches (para tests y diagnóstico).
export function minCircleDistance(a: CarState, b: CarState, cfg: GameConfig): number {
  const h = cfg.race.carHalfLenM;
  let m = Infinity;
  for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
    const ax = a.x + i * Math.cos(a.yaw) * h, az = a.z - i * Math.sin(a.yaw) * h;
    const bx = b.x + j * Math.cos(b.yaw) * h, bz = b.z - j * Math.sin(b.yaw) * h;
    m = Math.min(m, Math.hypot(bx - ax, bz - az));
  }
  return m;
}
