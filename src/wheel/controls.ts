import type { EvKey } from '../shared/protocol';
import { pedalValue } from './pedals';

// Controles táctiles (Pointer Events con captura): todos pueden usarse a la vez.

export interface ControlCallbacks {
  onThr: (v: number) => void;
  onBrk: (v: number) => void;
  onErs: (on: boolean) => void;
  onEv: (k: EvKey) => void;
  onRecenter: () => void;
  onHaptics: () => boolean;           // devuelve el nuevo estado
}

const el = (id: string) => {
  const e = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!e) throw new Error(`falta data-testid=${id}`);
  return e;
};

function capture(e: HTMLElement, id: number): void {
  try { e.setPointerCapture(id); } catch { /* puntero ya liberado */ }
}

// Pulsación simple con respuesta visual inmediata (clase .pressed en el mismo evento)
function press(target: HTMLElement, onDown: () => void, onUp?: () => void): void {
  let active: number | null = null;
  target.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (active !== null) return;
    active = e.pointerId;
    capture(target, e.pointerId);
    target.classList.add('pressed');
    onDown();
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    target.classList.remove('pressed');
    onUp?.();
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

function pedal(target: HTMLElement, set: (v: number) => void): void {
  const fill = target.querySelector<HTMLElement>('.pedal-fill')!;
  let active: number | null = null;
  const apply = (e: PointerEvent) => {
    const v = pedalValue(e.clientY, target.getBoundingClientRect());
    fill.style.height = `${v * 100}%`;
    set(v);
  };
  target.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (active !== null) return;
    active = e.pointerId;
    capture(target, e.pointerId);
    target.classList.add('pressed');
    apply(e);
  });
  target.addEventListener('pointermove', (e) => { if (e.pointerId === active) apply(e); });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    target.classList.remove('pressed');
    fill.style.height = '0%';
    set(0);
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

export function setupControls(cb: ControlCallbacks): void {
  pedal(el('pedal-thr'), cb.onThr);
  pedal(el('pedal-brk'), cb.onBrk);
  press(el('paddle-up'), () => cb.onEv('up'));
  press(el('paddle-down'), () => cb.onEv('down'));
  press(el('btn-drs'), () => cb.onEv('drs'));
  press(el('btn-cam'), () => cb.onEv('cam'));
  press(el('btn-pause'), () => cb.onEv('pause'));
  press(el('btn-center'), () => { cb.onRecenter(); cb.onEv('recal'); });
  press(el('btn-ers'), () => cb.onErs(true), () => cb.onErs(false));

  const vib = el('btn-haptics');
  press(vib, () => {
    const on = cb.onHaptics();
    vib.setAttribute('aria-pressed', String(on));
    vib.textContent = on ? 'VIB: SÍ' : 'VIB: NO';
  });

  // Sin menú contextual, selección, zoom ni gestos del navegador
  for (const ev of ['contextmenu', 'selectstart', 'dblclick', 'gesturestart', 'dragstart']) {
    document.addEventListener(ev, (e) => e.preventDefault());
  }
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
}
