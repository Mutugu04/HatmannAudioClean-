
export interface AudioMetrics {
  rms: number;
  peak: number;
  frequencyData: Uint8Array;
}

export interface AudioFX {
  denoise: number;  // 0-100
  clarity: number;  // 0-100
  width: number;    // 0-200
  saturation: number; // 0-100
  compression: number; // 0-100
  hpf: number;      // 20-500Hz
  lpf: number;      // 5k-20kHz
  bass: number;     // 0-12dB boost
  mid: number;      // 0-12dB boost
  treble: number;   // 0-12dB boost
  crackle: number;  // 0-100 (Texture)
  hiss: number;     // 0-100 (Texture)
}

export interface EQBand {
  id: number;
  frequency: number;
  gain: number;
  type: 'lowshelf' | 'peaking' | 'highshelf';
  Q?: number;
}

export const DEFAULT_EQ_BANDS: EQBand[] = [
  { id: 0, frequency: 32, gain: 0, type: 'lowshelf' },
  { id: 1, frequency: 64, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 2, frequency: 125, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 3, frequency: 250, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 4, frequency: 500, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 5, frequency: 1000, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 6, frequency: 2000, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 7, frequency: 4000, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 8, frequency: 8000, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 9, frequency: 12000, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 10, frequency: 16000, gain: 0, type: 'peaking', Q: 1.0 },
  { id: 11, frequency: 20000, gain: 0, type: 'highshelf' }
];

export enum LiveConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface LiveMessageLog {
  id: string;
  role: 'user' | 'model' | 'system';
  text?: string;
  timestamp: number;
}

export interface AnalysisReport {
  rms: string;
  peak: string;
  spectralCentroid: string;
  suggestion: string;
  neuralSettings?: {
    eq: number[];
    fx: Partial<AudioFX>;
  };
}
