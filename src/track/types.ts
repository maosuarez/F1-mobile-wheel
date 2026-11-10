export type TrackSide = 'left' | 'right';

export interface TrackSamplesJson {
  s: number[]; x: number[]; y: number[]; z: number[];
  wl: number[]; wr: number[]; nx: number[]; nz: number[];
  k: number[]; pitch: number[]; bank: number[];
}

export interface DrsZone { detect_s: number; start_s: number; end_s: number }
export interface Corner { n: number; name: string; s: number }
export interface Kerb { s0: number; s1: number; side: TrackSide }

export interface TrackJson {
  id: string;
  name: string;
  length_m: number;
  direction: 'ccw' | 'cw';
  step_m: number;
  samples: TrackSamplesJson;
  start_s: number;
  sectors_s: [number, number];
  drs_zones: DrsZone[];
  corners: Corner[];
  kerbs: Kerb[];
  runoff_m: number;
}

// --- Pista en memoria (design D3) ---

export type Surface = 'asphalt' | 'kerb' | 'grass';

// Constantes de geometría de pista (metros).
export const KERB_WIDTH_M = 1.2, KERB_HEIGHT_M = 0.03, EDGE_LINE_M = 0.3, WALL_HEIGHT_M = 1.0;

export interface Track {
  id: string; name: string; length: number; step: number; n: number; closed: boolean; direction: 'ccw' | 'cw';
  s: Float64Array; x: Float64Array; y: Float64Array; z: Float64Array; wl: Float64Array; wr: Float64Array;
  nx: Float64Array; nz: Float64Array; tx: Float64Array; tz: Float64Array;   // tx,tz = (−nz, nx)
  k: Float64Array; pitch: Float64Array; bank: Float64Array;
  kerbL: Uint8Array; kerbR: Uint8Array;        // 1 si la muestra i tiene piano en ese lado (precalculado)
  startS: number; sectorsS: [number, number]; drsZones: DrsZone[]; corners: Corner[]; kerbs: Kerb[]; runoff: number;
}

export interface TrackLocation {
  i: number; s: number; d: number; y: number; pitch: number; bank: number; k: number;
  heading: number; wl: number; wr: number; surface: Surface; kerbSide: TrackSide | null; wallL: number; wallR: number;
}
