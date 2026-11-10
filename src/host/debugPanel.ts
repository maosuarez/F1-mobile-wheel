export interface DebugStats {
  fps: number; drawCalls: number; triangles: number; speedKmh: number; s: number; d: number;
  surface: string; gLong: number; gLat: number;
}

// Panel F3: se refresca como mucho cada 100 ms
export class DebugPanel {
  private readonly el = document.querySelector<HTMLElement>('[data-testid="debug-panel"]')!;
  private last = 0;

  toggle(): void { this.el.hidden = !this.el.hidden; this.last = 0; }
  get visible(): boolean { return !this.el.hidden; }

  update(nowMs: number, st: DebugStats): void {
    if (this.el.hidden || nowMs - this.last < 100) return;
    this.last = nowMs;
    this.el.textContent =
      `fps ${st.fps.toFixed(0)}  draws ${st.drawCalls}  tris ${st.triangles}\n` +
      `v ${st.speedKmh.toFixed(0)} km/h  s ${st.s.toFixed(1)}  d ${st.d.toFixed(2)}  ${st.surface}\n` +
      `g long ${st.gLong.toFixed(2)}  g lat ${st.gLat.toFixed(2)}`;
  }
}
