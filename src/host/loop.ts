// Paso fijo con acumulador; puro y testeable
export class FixedStepper {
  private acc = 0;
  constructor(private readonly dt: number, private readonly maxSubSteps: number) {}

  // Devuelve los pasos a ejecutar y alpha ∈ [0,1) para interpolar el render
  advance(frameDtS: number, timescale = 1): { steps: number; alpha: number } {
    const maxSteps = Math.max(1, Math.round(this.maxSubSteps * timescale));
    this.acc += Math.max(0, frameDtS) * timescale;
    const eps = 1e-9;
    let steps = Math.floor((this.acc + eps) / this.dt);
    if (steps > maxSteps) {
      steps = maxSteps;
      this.acc = 0;               // el tiempo restante se descarta
    } else {
      this.acc = Math.max(0, this.acc - steps * this.dt);
    }
    return { steps, alpha: Math.min(this.acc / this.dt, 1) };
  }

  reset(): void { this.acc = 0; }
}
