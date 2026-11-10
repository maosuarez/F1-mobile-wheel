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
