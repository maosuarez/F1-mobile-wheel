import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { config, type GameConfig } from '../shared/config';
import { maxSteerRad } from '../sim/car';
import type { CarState } from '../sim/types';
import { createCarMaterials } from './carMaterials';

// Monoplaza procedural de escudería ficticia (sin logos ni marcas). Morro hacia +X, +Z a la derecha, suelo en y = 0.
export interface CarVisual {
  group: THREE.Group;
  wheels: { fl: THREE.Object3D; fr: THREE.Object3D; rl: THREE.Object3D; rr: THREE.Object3D };
  flap: THREE.Object3D;
  update(car: CarState, dtS: number): void;
}

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// Prepara una geometría para fusionar: sin índice ni UV, con color por vértice opcional
function prep(g: THREE.BufferGeometry, color?: THREE.Color): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  if (color) {
    const n = out.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

// Caja biselada entre dos esquinas (extrusión de un rectángulo con bisel que no cambia las medidas)
function bbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, bevel = 0.012, color?: THREE.Color): THREE.BufferGeometry {
  const b = Math.min(bevel, (x1 - x0) / 3, (y1 - y0) / 3, (z1 - z0) / 3);
  const shape = new THREE.Shape();
  shape.moveTo(x0, y0); shape.lineTo(x1, y0); shape.lineTo(x1, y1); shape.lineTo(x0, y1); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: z1 - z0 - 2 * b, bevelEnabled: true, bevelSegments: 1, bevelSize: b, bevelOffset: -b, bevelThickness: b, steps: 1, curveSegments: 1,
  });
  g.translate(0, 0, z0 + b);
  return prep(g, color);
}

// Barra cilíndrica fina entre dos puntos (brazos de suspensión)
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return prep(g);
}

function tube(points: THREE.Vector3[], r: number, segs: number): THREE.BufferGeometry {
  return prep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segs, r, 6, false));
}

function marker(name: string, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  return o;
}

export function buildCar(cfg: GameConfig = config): CarVisual {
  const cv = cfg.carVisual;
  const mats = createCarMaterials(cfg);
  const primary = new THREE.Color(cv.colors.primary), accent = new THREE.Color(cv.colors.accent), white = new THREE.Color(cv.colors.number);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const L = cfg.car.wheelbaseM / 2;
  const R = cv.wheelRadiusM;

  // Carrocería pintada: monocasco, morro, pontones, cubierta del motor, toma de aire, dorsal y deriva delantera
  const nose = new THREE.ConeGeometry(0.27, 1.3, 16);
  nose.rotateZ(-Math.PI / 2);
  nose.scale(1, 0.62, 1);
  nose.translate(1.95, 0.36, 0);
  const bodyParts: THREE.BufferGeometry[] = [
    bbox(-0.9, 1.3, 0.18, 0.62, -0.3, 0.3, 0.03, primary),
    prep(nose, primary),
    ...[1, -1].flatMap((sd) => {
      const [za, zb] = sd > 0 ? [0.3, 0.74] : [-0.74, -0.3];
      const [sa, sb] = sd > 0 ? [0.4, 0.5] : [-0.5, -0.4];
      return [
        bbox(-1.3, 0.45, 0.2, 0.56, za, zb, 0.05, primary),
        bbox(-1.0, 0.3, 0.56, 0.585, sa, sb, 0.004, accent),
        bbox(-2.8, -2.35, 0.3, 1.0, sd > 0 ? 0.5 : -0.53, sd > 0 ? 0.53 : -0.5, 0.006, accent),
        bbox(2.45, 2.85, 0.05, 0.32, sd > 0 ? 0.96 : -0.99, sd > 0 ? 0.99 : -0.96, 0.008, accent),
        // dorsal "7" a cada lado de la toma de aire
        bbox(-0.62, -0.28, 0.9, 0.94, sd > 0 ? 0.172 : -0.18, sd > 0 ? 0.18 : -0.172, 0.002, white),
        bbox(-0.45, -0.4, 0.74, 0.9, sd > 0 ? 0.172 : -0.18, sd > 0 ? 0.18 : -0.172, 0.002, white),
      ];
    }),
    bbox(-2.0, -0.9, 0.3, 0.62, -0.2, 0.2, 0.04, primary),
    bbox(-0.7, -0.2, 0.62, 1.0, -0.17, 0.17, 0.04, accent),
  ];
  const bodyGeom = mergeGeometries(bodyParts)!;

  // Carbono: suelo, difusor, alerones, borde del habitáculo, reposacabezas, halo, brazos de suspensión
  const carbonParts: THREE.BufferGeometry[] = [
    bbox(-1.8, 1.6, 0.04, 0.08, -0.7, 0.7, 0.01),
    bbox(-2.4, -1.8, 0.06, 0.3, -0.4, 0.4, 0.015),
    bbox(2.45, 2.85, 0.08, 0.13, -0.99, 0.99, 0.008),
    bbox(2.35, 2.7, 0.16, 0.2, -0.9, 0.9, 0.008),
    bbox(-2.8, -2.4, 0.78, 0.83, -0.53, 0.53, 0.008),
    bbox(-2.35, -2.25, 0.3, 0.8, -0.03, 0.03, 0.005),
    bbox(-0.1, 0.9, 0.62, 0.72, -0.3, -0.26, 0.01),
    bbox(-0.1, 0.9, 0.62, 0.72, 0.26, 0.3, 0.01),
    bbox(0.86, 0.95, 0.62, 0.72, -0.3, 0.3, 0.01),
    bbox(-0.38, -0.22, 0.62, 0.9, -0.17, 0.17, 0.03),
    tube([V(-0.2, 0.72, 0.27), V(0.1, 1.0, 0.3), V(0.55, 1.0, 0.17), V(0.86, 0.96, 0), V(0.55, 1.0, -0.17), V(0.1, 1.0, -0.3), V(-0.2, 0.72, -0.27)], 0.022, 28),
    tube([V(0.86, 0.96, 0), V(0.93, 0.62, 0)], 0.026, 2),
  ];
  for (const sd of [1, -1]) {
    const hub = V(L, R, sd * (cv.halfTrackM - cv.tireFrontW / 2));
    carbonParts.push(
      strut(V(1.15, 0.3, sd * 0.3), hub, 0.012), strut(V(1.45, 0.34, sd * 0.3), hub, 0.012),
      strut(V(1.2, 0.5, sd * 0.3), V(L, R + 0.1, hub.z), 0.012),
      strut(V(-1.7, 0.3, sd * 0.3), V(-L, R, sd * (cv.halfTrackM - cv.tireRearW / 2)), 0.012),
    );
  }
  const carbonGeom = mergeGeometries(carbonParts)!;

  // Plano móvil del alerón trasero: bisagra en el borde de ataque, se abre levantando el borde de salida
  const flapGeom = bbox(-0.4, 0, 0, 0.035, -0.53, 0.53, 0.006);

  // Volante: placa de carbono con pantalla emisiva en la cara del piloto (−X)
  const wheelPlate = bbox(-0.015, 0.015, -0.07, 0.07, -0.15, 0.15, 0.008);
  const screenGeom = bbox(-0.022, -0.012, -0.045, 0.05, -0.055, 0.055, 0.002);

  const group = new THREE.Group();
  group.name = 'car';
  const body = new THREE.Group();
  body.name = 'body';
  group.add(body);
  const bodyMesh = new THREE.Mesh(bodyGeom, mats.body); bodyMesh.name = 'body-paint';
  const carbonMesh = new THREE.Mesh(carbonGeom, mats.carbon); carbonMesh.name = 'carbon';
  body.add(bodyMesh, carbonMesh);

  // Marcadores con el nombre de cada pieza fusionada
  body.add(
    marker('nose', 2.0, 0.36, 0), marker('front-wing', 2.65, 0.12, 0), marker('rear-wing', -2.6, 0.8, 0),
    marker('sidepods', -0.4, 0.38, 0), marker('airbox', -0.45, 0.8, 0), marker('halo', 0.4, 1.0, 0),
    marker('floor', -0.1, 0.06, 0), marker('cockpit', 0.4, 0.67, 0), marker('suspension', 1.5, 0.35, 0),
  );

  const flap = new THREE.Mesh(flapGeom, mats.carbon);
  flap.name = 'rear-wing-flap';
  flap.position.set(-2.4, 0.93, 0);
  body.add(flap);

  const steer = new THREE.Group();
  steer.name = 'steering-wheel';
  steer.position.set(0.62, 0.66, 0);
  steer.add(new THREE.Mesh(wheelPlate, mats.carbon), new THREE.Mesh(screenGeom, mats.screen));
  body.add(steer);

  // Ruedas: pivote de viraje (wheel-xx) > eje de giro (spin) > neumático y llanta. Eje del cuerpo = Z
  const wheelGeoms = (w: number) => {
    const hw = w / 2;
    const tire = new THREE.LatheGeometry([
      V2(0.21, -hw), V2(R - 0.03, -hw), V2(R - 0.005, -hw * 0.8), V2(R, -hw * 0.5), V2(R, hw * 0.5), V2(R - 0.005, hw * 0.8), V2(R - 0.03, hw), V2(0.21, hw),
    ], 24);
    tire.rotateX(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.21, 0.21, w * 0.9, 20, 1);
    rim.rotateX(Math.PI / 2);
    return { tire, rim };
  };
  const gFront = wheelGeoms(cv.tireFrontW), gRear = wheelGeoms(cv.tireRearW);
  const makeWheel = (name: string, x: number, z: number, g: { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry }) => {
    const w = new THREE.Group();
    w.name = name;
    w.position.set(x, R, z);
    const spin = new THREE.Group();
    spin.name = 'spin';
    const tire = new THREE.Mesh(g.tire, mats.tire); tire.name = 'tire';
    const rim = new THREE.Mesh(g.rim, mats.rim); rim.name = 'rim';
    spin.add(tire, rim);
    w.add(spin);
    body.add(w);
    return { w, spin };
  };
  const fz = cv.halfTrackM - cv.tireFrontW / 2, rz = cv.halfTrackM - cv.tireRearW / 2;
  const fl = makeWheel('wheel-fl', L, -fz, gFront), fr = makeWheel('wheel-fr', L, fz, gFront);
  const rl = makeWheel('wheel-rl', -L, -rz, gRear), rr = makeWheel('wheel-rr', -L, rz, gRear);
  const spins = [fl.spin, fr.spin, rl.spin, rr.spin];

  let spinAngle = 0, flapDeg = 0, pitchDeg = 0, rollDeg = 0;
  const update = (car: CarState, dtS: number) => {
    // Giro: ω = v / r; el sentido hace avanzar la rueda hacia +X
    spinAngle = (spinAngle + (car.vLong / R) * dtS) % (Math.PI * 2);
    for (const s of spins) s.rotation.z = -spinAngle;
    // Viraje delantero: steerAngle > 0 es a la derecha, que es rotación negativa alrededor de Y
    fl.w.rotation.y = fr.w.rotation.y = -car.steerAngle;
    steer.rotation.x = clamp(car.steerAngle / maxSteerRad(car.speed, cfg), -1, 1) * cv.steerWheelDeg * DEG;
    // Plano móvil del DRS hacia su posición con velocidad angular acotada
    const target = car.drs === 2 ? cv.flapOpenDeg : 0;
    const step = cv.flapRateDegS * dtS;
    flapDeg += clamp(target - flapDeg, -step, step);
    flap.rotation.z = -flapDeg * DEG;
    // Cabeceo y balanceo visuales con las fuerzas g, filtrados y acotados
    const k = dtS > 0 ? 1 - Math.exp(-dtS / cv.tiltTauS) : 0;
    const g = cfg.sim.g;
    pitchDeg += (clamp((car.aLong / g) * cv.tiltDegPerG, -cv.tiltMaxDeg, cv.tiltMaxDeg) - pitchDeg) * k;
    rollDeg += (clamp((-car.aLat / g) * cv.tiltDegPerG, -cv.tiltMaxDeg, cv.tiltMaxDeg) - rollDeg) * k;
    body.rotation.z = pitchDeg * DEG;
    body.rotation.x = rollDeg * DEG;
  };

  return { group, wheels: { fl: fl.w, fr: fr.w, rl: rl.w, rr: rr.w }, flap, update };
}

function V2(x: number, y: number): THREE.Vector2 { return new THREE.Vector2(x, y); }
