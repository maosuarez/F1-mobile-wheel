// "1:18.457"; null → "-:--.---"
export function formatLapTime(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '-:--.---';
  const totalMs = Math.round(Math.max(0, s) * 1000);
  const m = Math.floor(totalMs / 60000);
  const sec = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// "+0.123", "−0.045" (signo menos U+2212); null → ""
export function formatDelta(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '';
  const a = (Math.round(Math.abs(s) * 1000) / 1000).toFixed(3);
  return `${s < 0 ? '−' : '+'}${a}`;
}
