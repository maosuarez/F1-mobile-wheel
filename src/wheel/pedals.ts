// Pedal analógico (design D5): 0 con el dedo abajo, 1 arriba, recortado a [0, 1].
export function pedalValue(clientY: number, rect: { top: number; height: number }): number {
  if (!(rect.height > 0)) return 0;
  const v = 1 - (clientY - rect.top) / rect.height;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
