import type { GameConfig } from '../shared/config';
import type { CarState, DriverInput } from './types';

// ERS: despliegue base automático a fondo, modo adelantamiento, recarga en frenada y límite por vuelta
// (design D3, skill f1-car-feel §5).

// Fija ersDeployKw y overtake, y actualiza la carga con la potencia de frenado del paso anterior.
export function stepErs(car: CarState, input: DriverInput, brakePowerW: number, cfg: GameConfig): void {
  const e = cfg.ers;
  const dt = cfg.sim.dt;
  const capKJ = e.capacityMJ * 1000;

  // Despliegue: acelerador a fondo, marcha hacia delante, batería y límite de vuelta disponibles
  const canDeploy = input.throttle >= e.fullThrottle && car.gear >= 1 && !car.limiter
    && car.ersCharge > 0 && car.ersLapDeployedMJ < e.lapDeployLimitMJ;
  car.overtake = canDeploy && input.ers && car.ersCharge >= e.overtakeMinCharge;

  if (canDeploy) {
    const deployKw = e.baseDeployKw + (car.overtake ? e.overtakeExtraKw : 0);
    const drain = e.baseDeployKw * (car.overtake ? e.overtakeDrainMult : 1) * dt / capKJ;   // fracción de batería
    // Último paso: se recorta por la batería restante y por el límite de la vuelta
    const lapLeftKJ = (e.lapDeployLimitMJ - car.ersLapDeployedMJ) * 1000;
    const frac = Math.min(1, car.ersCharge / drain, lapLeftKJ / (deployKw * dt));
    car.ersDeployKw = deployKw * frac;
    car.ersCharge = Math.max(0, car.ersCharge - drain * frac);
    car.ersLapDeployedMJ += car.ersDeployKw * dt / 1000;
  } else {
    car.ersDeployKw = 0;
  }

  // Recuperación en frenada
  if (brakePowerW > 0) {
    const regenKw = Math.min(e.regenMaxKw, e.regenFraction * brakePowerW / 1000);
    car.ersCharge = Math.min(1, car.ersCharge + regenKw * dt / capKJ);
  }
}

// Al cruzar la meta: recarga fija pequeña y reinicio del límite de despliegue de la vuelta.
export function onLapStartErs(car: CarState, cfg: GameConfig): void {
  car.ersCharge = Math.min(1, car.ersCharge + cfg.ers.lapBonus);
  car.ersLapDeployedMJ = 0;
}
