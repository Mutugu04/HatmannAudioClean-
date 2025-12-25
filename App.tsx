
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Settings, Mic, Waves, Volume2, Sliders, Play, Square, 
  Upload, Download, RefreshCw, BarChart3, ScanEye, 
  Music, FileAudio, Zap, ShieldAlert, Activity, 
  ChevronRight, BrainCircuit, Headphones, Radio, Ghost,
  X, Cpu, Layers, Eye
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import LiveAssistant from './components/LiveAssistant';
import Knob from './components/Knob';
import Visualizer from './components/Visualizer';
import Equalizer from './components/Equalizer';
import { EQBand, DEFAULT_EQ_BANDS, AnalysisReport, AudioFX } from './types';
import { audioBufferToWav } from './utils/audioUtils';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'forge' | 'assistant'>('forge');
  const [showSettings, setShowSettings] = useState(false);
  
  // Audio State
  const [sourceBuffer, setSourceBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('Master_Bus_Empty');
  const [isPlaying, setIsPlaying] = useState(false);
  const [masterGain, setMasterGain] = useState(0); 
  const [eqBands, setEqBands] = useState<EQBand[]>(DEFAULT_EQ_BANDS);
  const [fx, setFx] = useState<AudioFX>({ 
    denoise: 0, clarity: 0, width: 100, saturation: 0, compression: 0, hpf: 20, lpf: 20000,
    bass: 0, mid: 0, treble: 0, crackle: 0, hiss: 0
  });
  const [bypass, setBypass] = useState(false);
  
  // Analysis
  const [analysis, setAnalysis] = useState<AnalysisReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [neuralActive, setNeuralActive] = useState(false);

  // Audio Graph Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const hissSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const crackleSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const noiseBuffersRef = useRef<{ hiss: AudioBuffer, crackle: AudioBuffer } | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  const nodesRef = useRef<{
    inputGain: GainNode;
    hpf: BiquadFilterNode;
    lpf: BiquadFilterNode;
    denoise: BiquadFilterNode;
    eq: BiquadFilterNode[];
    bassFilter: BiquadFilterNode;
    midFilter: BiquadFilterNode;
    trebleFilter: BiquadFilterNode;
    saturator: WaveShaperNode;
    hissGain: GainNode;
    crackleGain: GainNode;
    widthMid: GainNode;
    widthSide: GainNode;
    compressor: DynamicsCompressorNode;
    limiter: DynamicsCompressorNode;
    masterGain: GainNode;
  } | null>(null);

  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);

  // 1. Initialize Pro DSP Chain
  useEffect(() => {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;

    // Create Noise Buffers
    const sampleRate = ctx.sampleRate;
    const hissBuffer = ctx.createBuffer(1, sampleRate * 2, sampleRate);
    const hissData = hissBuffer.getChannelData(0);
    for (let i = 0; i < hissData.length; i++) hissData[i] = Math.random() * 2 - 1;

    const crackleBuffer = ctx.createBuffer(1, sampleRate * 5, sampleRate);
    const crackleData = crackleBuffer.getChannelData(0);
    for (let i = 0; i < crackleData.length; i++) {
        // Very sparse random clicks
        crackleData[i] = Math.random() > 0.9998 ? (Math.random() * 2 - 1) * 0.5 : 0;
    }
    noiseBuffersRef.current = { hiss: hissBuffer, crackle: crackleBuffer };

    const inputGain = ctx.createGain();
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass';
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass';
    
    const denoise = ctx.createBiquadFilter();
    denoise.type = 'highshelf';
    denoise.frequency.value = 5000;
    denoise.gain.value = 0;

    const eq = DEFAULT_EQ_BANDS.map(b => {
      const f = ctx.createBiquadFilter();
      f.type = b.type as BiquadFilterType;
      f.frequency.value = b.frequency;
      if (b.Q) f.Q.value = b.Q;
      return f;
    });

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'peaking';
    bassFilter.frequency.value = 60;
    bassFilter.Q.value = 0.7;

    const midFilter = ctx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1200;
    midFilter.Q.value = 0.7;

    const trebleFilter = ctx.createBiquadFilter();
    trebleFilter.type = 'peaking';
    trebleFilter.frequency.value = 10000;
    trebleFilter.Q.value = 0.7;

    const saturator = ctx.createWaveShaper();
    saturator.curve = new Float32Array([ -1, 0, 1 ]);

    // Noise Gain Stages
    const hissGain = ctx.createGain();
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'lowpass';
    hissFilter.frequency.value = 6000;
    hissGain.connect(hissFilter);

    const crackleGain = ctx.createGain();
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'highpass';
    crackleFilter.frequency.value = 1500;
    crackleGain.connect(crackleFilter);

    const midGain = ctx.createGain();
    const sideGain = ctx.createGain();

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -0.1;
    limiter.ratio.value = 20;

    const masterGainNode = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    // Connect Chain
    inputGain.connect(hpf);
    hpf.connect(lpf);
    lpf.connect(denoise);
    let lastNode: AudioNode = denoise;
    eq.forEach(f => { lastNode.connect(f); lastNode = f; });
    
    lastNode.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    lastNode = trebleFilter;

    lastNode.connect(saturator);
    saturator.connect(midGain);
    saturator.connect(sideGain);
    
    // Inject Noise before Compression
    hissFilter.connect(midGain);
    crackleFilter.connect(midGain);

    midGain.connect(compressor);
    sideGain.connect(compressor);
    compressor.connect(masterGainNode);
    masterGainNode.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);

    nodesRef.current = { 
      inputGain, hpf, lpf, denoise, eq, 
      bassFilter, midFilter, trebleFilter,
      saturator, hissGain, crackleGain, widthMid: midGain, widthSide: sideGain, 
      compressor, limiter, masterGain: masterGainNode 
    };
    analyserRef.current = analyser;

    return () => { ctx.close(); };
  }, []);

  // 2. Real-time Param Sync
  useEffect(() => {
    const nodes = nodesRef.current;
    const ctx = audioCtxRef.current;
    if (!nodes || !ctx) return;

    const t = ctx.currentTime;
    const b = bypass;

    nodes.hpf.frequency.setTargetAtTime(fx.hpf, t, 0.05);
    nodes.lpf.frequency.setTargetAtTime(fx.lpf, t, 0.05);
    
    const denoiseGain = b ? 0 : (fx.denoise / 100) * -36;
    nodes.denoise.gain.setTargetAtTime(denoiseGain, t, 0.05);

    nodes.eq.forEach((f, i) => {
      const g = b ? 0 : eqBands[i].gain;
      f.gain.setTargetAtTime(g, t, 0.05);
    });

    nodes.bassFilter.gain.setTargetAtTime(b ? 0 : fx.bass, t, 0.05);
    nodes.midFilter.gain.setTargetAtTime(b ? 0 : fx.mid, t, 0.05);
    nodes.trebleFilter.gain.setTargetAtTime(b ? 0 : fx.treble, t, 0.05);

    // Texture Volume (Subtle)
    const hissVol = b ? 0 : (fx.hiss / 100) * 0.08;
    const crackleVol = b ? 0 : (fx.crackle / 100) * 0.15;
    nodes.hissGain.gain.setTargetAtTime(hissVol, t, 0.05);
    nodes.crackleGain.gain.setTargetAtTime(crackleVol, t, 0.05);

    if (!b && fx.saturation > 0) {
      const drive = fx.saturation / 20;
      const n = 44100;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
      }
      nodes.saturator.curve = curve;
    } else {
      nodes.saturator.curve = new Float32Array([ -1, 0, 1 ]);
    }

    const sideV = b ? 1.0 : (fx.width / 100);
    const midV = b ? 1.0 : Math.max(0.1, 1.5 - (fx.width / 200));
    nodes.widthSide.gain.setTargetAtTime(sideV, t, 0.05);
    nodes.widthMid.gain.setTargetAtTime(midV, t, 0.05);

    const compThreshold = b ? 0 : -((fx.compression / 100) * 50);
    const compRatio = b ? 1 : 1 + (fx.compression / 10);
    nodes.compressor.threshold.setTargetAtTime(compThreshold, t, 0.05);
    nodes.compressor.ratio.setTargetAtTime(compRatio, t, 0.05);
    
    nodes.masterGain.gain.setTargetAtTime(Math.pow(10, masterGain / 20), t, 0.05);
  }, [eqBands, fx, masterGain, bypass]);

  const togglePlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    const nodes = nodesRef.current;
    const noise = noiseBuffersRef.current;
    if (!ctx || !sourceBuffer || !nodes || !noise) return;

    if (isPlaying) {
      sourceNodeRef.current?.stop();
      hissSourceRef.current?.stop();
      crackleSourceRef.current?.stop();
      pauseOffsetRef.current = ctx.currentTime - startTimeRef.current;
      setIsPlaying(false);
    } else {
      if (ctx.state === 'suspended') ctx.resume();
      
      const source = ctx.createBufferSource();
      source.buffer = sourceBuffer;
      source.connect(nodes.inputGain);
      
      const hiss = ctx.createBufferSource();
      hiss.buffer = noise.hiss;
      hiss.loop = true;
      hiss.connect(nodes.hissGain);

      const crackle = ctx.createBufferSource();
      crackle.buffer = noise.crackle;
      crackle.loop = true;
      crackle.connect(nodes.crackleGain);

      const offset = pauseOffsetRef.current % sourceBuffer.duration;
      source.start(0, offset);
      hiss.start(0);
      crackle.start(0);

      startTimeRef.current = ctx.currentTime - offset;
      sourceNodeRef.current = source;
      hissSourceRef.current = hiss;
      crackleSourceRef.current = crackle;

      setIsPlaying(true);
      source.onended = () => {
        if (ctx.currentTime - startTimeRef.current >= sourceBuffer.duration - 0.1) {
          setIsPlaying(false);
          hiss.stop();
          crackle.stop();
          pauseOffsetRef.current = 0;
        }
      };
    }
  }, [isPlaying, sourceBuffer]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !audioCtxRef.current) return;
    setFileName(file.name);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);
      if (isPlaying) { sourceNodeRef.current?.stop(); setIsPlaying(false); }
      pauseOffsetRef.current = 0;
      setSourceBuffer(audioBuffer);
      setAnalysis(null);
    } catch (err) { console.error("Critical: Failed to decode audio source.", err); }
  };

  const runAnalysis = async () => {
    if (!sourceBuffer || !process.env.API_KEY) return;
    setIsScanning(true);
    try {
      const data = sourceBuffer.getChannelData(0);
      let sumSquares = 0; let peak = 0;
      const step = Math.max(1, Math.floor(data.length / 50000));
      let count = 0;
      for (let i = 0; i < data.length; i += step) {
        const val = data[i];
        sumSquares += val * val;
        if (Math.abs(val) > peak) peak = Math.abs(val);
        count++;
      }
      const rms = Math.sqrt(sumSquares / count);
      const rmsDb = 20 * Math.log10(rms + 0.00001);
      const peakDb = 20 * Math.log10(peak + 0.00001);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `SYSTEM_PROMPT: Master Audio DNA Scanner. 
        INPUT_STATS: RMS=${rmsDb.toFixed(2)}dB, Peak=${peakDb.toFixed(2)}dB.
        OBJECTIVE: Synthesize professional mastering settings including Texture (Crackle/Hiss).
        
        SCHEMA_REQ:
        1. Suggestion: Technical observation.
        2. EQ: 12 gains for 32Hz-20kHz bands.
        3. FX: Denoise, Clarity, Width, Saturation, Compression (0-100), Bass/Mid/Treble (0-12dB), Crackle/Hiss (0-100).`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rms: { type: Type.STRING },
              peak: { type: Type.STRING },
              suggestion: { type: Type.STRING },
              neuralSettings: {
                type: Type.OBJECT,
                properties: {
                  eq: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                  fx: {
                    type: Type.OBJECT,
                    properties: {
                      denoise: { type: Type.NUMBER },
                      clarity: { type: Type.NUMBER },
                      width: { type: Type.NUMBER },
                      saturation: { type: Type.NUMBER },
                      compression: { type: Type.NUMBER },
                      bass: { type: Type.NUMBER },
                      mid: { type: Type.NUMBER },
                      treble: { type: Type.NUMBER },
                      crackle: { type: Type.NUMBER },
                      hiss: { type: Type.NUMBER }
                    },
                    required: ['denoise', 'clarity', 'width', 'saturation', 'compression', 'bass', 'mid', 'treble', 'crackle', 'hiss']
                  }
                },
                required: ['eq', 'fx']
              }
            },
            required: ['rms', 'peak', 'suggestion', 'neuralSettings']
          }
        }
      });

      const text = response.text;
      if (text) { setAnalysis(JSON.parse(text)); }
    } catch (err) { console.error("Neural Sync Failure", err); } finally { setIsScanning(false); }
  };

  const applyPreset = (type: string) => {
    setBypass(false);
    setNeuralActive(false);
    switch(type) {
      case 'vocal':
        setEqBands(DEFAULT_EQ_BANDS.map(b => 
          b.frequency < 120 ? { ...b, gain: -10 } : 
          b.frequency >= 2000 && b.frequency <= 4500 ? { ...b, gain: 9 } : { ...b, gain: 0 }
        ));
        setFx({ denoise: 25, clarity: 60, width: 100, saturation: 20, compression: 40, hpf: 110, lpf: 16000, bass: 2, mid: 4, treble: 3, crackle: 0, hiss: 5 });
        break;
      case 'podcast':
        setEqBands(DEFAULT_EQ_BANDS.map(b => 
          b.frequency === 250 ? { ...b, gain: -6 } : 
          b.frequency >= 3000 ? { ...b, gain: 5 } : { ...b, gain: 0 }
        ));
        setFx({ denoise: 45, clarity: 30, hpf: 85, compression: 65, saturation: 10, width: 90, lpf: 18000, bass: 3, mid: 5, treble: 2, crackle: 0, hiss: 8 });
        break;
      case 'master':
        setEqBands(DEFAULT_EQ_BANDS.map(b => 
            (b.frequency === 64) ? { ...b, gain: 4 } : 
            (b.frequency === 12000) ? { ...b, gain: 3.5 } : { ...b, gain: 0 }
        ));
        setFx({ compression: 25, width: 135, saturation: 12, hpf: 28, clarity: 20, denoise: 0, lpf: 20000, bass: 1.5, mid: 0.5, treble: 2, crackle: 0, hiss: 2 });
        break;
      case 'cinematic':
        setEqBands(DEFAULT_EQ_BANDS.map(b => 
            b.frequency <= 64 ? { ...b, gain: 10 } : 
            b.frequency >= 10000 ? { ...b, gain: 8 } : { ...b, gain: 0 }
        ));
        setFx({ width: 180, compression: 50, saturation: 25, hpf: 22, lpf: 20000, denoise: 15, clarity: 40, bass: 8, mid: 2, treble: 6, crackle: 12, hiss: 10 });
        break;
      case 'vinyl':
        setEqBands(DEFAULT_EQ_BANDS.map(b => 
            b.frequency > 6000 ? { ...b, gain: -18 } : 
            b.frequency < 120 ? { ...b, gain: -8 } : { ...b, gain: 0 }
        ));
        setFx({ saturation: 65, lpf: 8500, hpf: 65, width: 85, compression: 30, denoise: 50, clarity: 10, bass: 4, mid: 6, treble: 0, crackle: 75, hiss: 35 });
        break;
      case 'broadcast':
        setEqBands(DEFAULT_EQ_BANDS.map(b => ({ ...b, gain: b.frequency >= 4000 ? 6 : 0 })));
        setFx({ compression: 85, saturation: 35, width: 115, hpf: 50, denoise: 10, clarity: 80, lpf: 18000, bass: 5, mid: 3, treble: 4, crackle: 0, hiss: 15 });
        break;
      case 'pure':
        setEqBands(DEFAULT_EQ_BANDS);
        setFx({ denoise: 0, clarity: 0, width: 100, saturation: 0, compression: 0, hpf: 20, lpf: 20000, bass: 0, mid: 0, treble: 0, crackle: 0, hiss: 0 });
        setMasterGain(0);
        break;
    }
  };

  const applyNeuralRemaster = () => {
    if (!analysis?.neuralSettings) return;
    setNeuralActive(true);
    setBypass(false);
    setEqBands(prev => prev.map((b, i) => ({ ...b, gain: analysis.neuralSettings!.eq[i] * 2 })));
    setFx(p => ({ 
      ...p, 
      ...analysis.neuralSettings!.fx,
      width: (analysis.neuralSettings!.fx.width || 100) * 1.2,
      compression: (analysis.neuralSettings!.fx.compression || 0) + 10
    }));
    setActiveTab('forge');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-cyan-500 overflow-hidden">
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-slate-900 w-full max-w-lg rounded-[2.5rem] border border-slate-800 shadow-2xl overflow-hidden flex flex-col">
              <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                <div className="flex items-center gap-3">
                  <Cpu className="text-cyan-500 w-5 h-5" />
                  <h2 className="text-sm font-black uppercase tracking-widest">System Core Settings</h2>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-800 rounded-xl transition-colors"><X className="w-5 h-5"/></button>
              </div>
              <div className="p-10 space-y-8 flex-1 overflow-y-auto">
                 <div className="flex justify-between items-center">
                    <div>
                       <div className="text-xs font-bold uppercase tracking-tight">Oversampling Engine</div>
                       <div className="text-[10px] text-slate-500 mt-1">Simulate 4x processing for saturation smoothness.</div>
                    </div>
                    <div className="w-12 h-6 bg-cyan-600/20 border border-cyan-500/40 rounded-full flex items-center px-1"><div className="w-4 h-4 bg-cyan-500 rounded-full"></div></div>
                 </div>
                 <div className="flex justify-between items-center">
                    <div>
                       <div className="text-xs font-bold uppercase tracking-tight">FFT Precision</div>
                       <div className="text-[10px] text-slate-500 mt-1">Visualizer resolution (Higher = more CPU).</div>
                    </div>
                    <select className="bg-black border border-slate-800 text-[10px] px-3 py-1.5 rounded-lg outline-none font-mono text-cyan-400">
                      <option>1024_SAMPLES</option>
                      <option selected>2048_SAMPLES</option>
                      <option>4096_SAMPLES</option>
                    </select>
                 </div>
                 <div className="flex justify-between items-center">
                    <div>
                       <div className="text-xs font-bold uppercase tracking-tight">VU Sensitivity</div>
                       <div className="text-[10px] text-slate-500 mt-1">Calibrate peak meter ballistics.</div>
                    </div>
                    <input type="range" className="accent-cyan-500 w-24" />
                 </div>
                 <div className="p-6 bg-cyan-500/5 rounded-2xl border border-cyan-500/10 flex items-center gap-4">
                    <Layers className="text-cyan-500 w-8 h-8 opacity-40" />
                    <div>
                       <div className="text-[10px] font-black uppercase text-cyan-500">Firmware Status</div>
                       <div className="text-[10px] font-mono text-slate-400">Hatmann_DSP_v2.5.4_Neural_Active</div>
                    </div>
                 </div>
              </div>
              <div className="p-8 bg-slate-950/50 border-t border-slate-800">
                 <button onClick={() => setShowSettings(false)} className="w-full bg-slate-800 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-colors">Commit Core Changes</button>
              </div>
           </div>
        </div>
      )}

      {/* Navbar */}
      <nav className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-2xl flex items-center px-8 justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-900/30">
            <Activity className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight leading-none uppercase">HATMANN</h1>
            <span className="text-[10px] text-cyan-500 font-mono tracking-widest uppercase opacity-80">PRO DSP TERMINAL</span>
          </div>
        </div>

        <div className="flex gap-1 bg-black/50 p-1.5 rounded-2xl border border-slate-800">
          <button onClick={() => setActiveTab('forge')} className={`px-6 py-2 rounded-xl text-xs font-black transition-all uppercase tracking-widest ${activeTab === 'forge' ? 'bg-slate-700 text-cyan-400 shadow-xl' : 'text-slate-500 hover:text-slate-300'}`}>ENGINE</button>
          <button onClick={() => setActiveTab('assistant')} className={`px-6 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 uppercase tracking-widest ${activeTab === 'assistant' ? 'bg-slate-700 text-purple-400 shadow-xl' : 'text-slate-500 hover:text-slate-300'}`}><BrainCircuit className="w-4 h-4"/> NEURAL</button>
        </div>

        <div className="flex items-center gap-4">
           <div className="text-[10px] text-slate-500 font-mono hidden sm:block uppercase tracking-tighter">DSP_LOAD: 12.8%</div>
           <button onClick={() => setShowSettings(true)} className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800 hover:border-cyan-500 transition-colors group">
              <Settings className="w-4 h-4 text-slate-400 group-hover:rotate-45 transition-transform" />
           </button>
        </div>
      </nav>

      <main className="flex-1 p-6 lg:p-8 max-w-screen-2xl mx-auto w-full overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
          {activeTab === 'forge' && (
            <>
              <div className="lg:col-span-8 flex flex-col gap-8">
                {/* Visualizer Bus */}
                <div className={`h-80 bg-slate-900 rounded-[2rem] border border-slate-800 p-2 relative shadow-2xl overflow-hidden group transition-all duration-700 ${neuralActive ? 'ring-2 ring-purple-500/50 shadow-purple-500/20' : ''}`}>
                  <div className="absolute top-6 left-6 z-10 flex gap-2">
                     <span className="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] px-3 py-1 rounded-full font-mono flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></div> {sourceBuffer ? `${sourceBuffer.sampleRate}Hz HD` : 'BUS_IDLE'}</span>
                     <span className="bg-slate-800 border border-slate-700 text-slate-400 text-[10px] px-3 py-1 rounded-full font-mono">{fileName.slice(0,30)}</span>
                     {neuralActive && <span className="bg-purple-600 text-white text-[8px] font-black px-2 py-1 rounded-full uppercase tracking-widest flex items-center gap-1 animate-bounce">Neural DNA Active</span>}
                  </div>
                  
                  <Visualizer analyser={analyserRef.current} isActive={isPlaying} />

                  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-black/80 backdrop-blur-xl px-8 py-4 rounded-3xl border border-white/10 shadow-2xl">
                    <label className="cursor-pointer text-slate-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-800"><Upload className="w-5 h-5" /><input type="file" className="hidden" onChange={(e) => { handleFileUpload(e); setNeuralActive(false); }} /></label>
                    <button onClick={togglePlayback} disabled={!sourceBuffer} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-amber-500 text-black shadow-amber-500/30 shadow-xl' : 'bg-cyan-600 text-white shadow-cyan-500/30 shadow-xl active:scale-90 hover:bg-cyan-500'}`}>
                       {isPlaying ? <Square className="fill-current w-6 h-6" /> : <Play className="fill-current w-6 h-6 ml-1" />}
                    </button>
                    <button onClick={async () => { if(!sourceBuffer) return; const wav = audioBufferToWav(sourceBuffer); const a = document.createElement('a'); a.href = URL.createObjectURL(wav); a.download = `Hatmann_Final_${fileName}`; a.click(); }} className="text-slate-500 hover:text-white p-2 rounded-lg hover:bg-slate-800"><Download className="w-5 h-5" /></button>
                  </div>
                </div>

                {/* Spectral EQ Bus */}
                <div className="flex-1 bg-slate-900 rounded-[2rem] border border-slate-800 p-2 shadow-xl min-h-[320px]">
                  <Equalizer bands={eqBands} onChange={(id, val) => { setEqBands(p => p.map(b => b.id === id ? {...b, gain: val} : b)); setNeuralActive(false); }} onReset={() => applyPreset('pure')} />
                </div>

                {/* FX Processor Rack */}
                <div className="bg-slate-900 rounded-[2rem] border border-slate-800 p-8 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-600"></div>
                  
                  <div className="flex flex-col gap-6">
                    {/* Primary DSP Row */}
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-6">
                       <Knob label="DENOISE" value={fx.denoise} min={0} max={100} unit="%" onChange={(v) => { setFx(p => ({...p, denoise: v})); setNeuralActive(false); }} />
                       <Knob label="DRIVE" value={fx.saturation} min={0} max={100} unit="%" onChange={(v) => { setFx(p => ({...p, saturation: v})); setNeuralActive(false); }} />
                       <Knob label="COMPRESS" value={fx.compression} min={0} max={100} unit="%" onChange={(v) => { setFx(p => ({...p, compression: v})); setNeuralActive(false); }} />
                       <Knob label="WIDTH" value={fx.width} min={0} max={200} unit="%" onChange={(v) => { setFx(p => ({...p, width: v})); setNeuralActive(false); }} />
                       <Knob label="SUB_CUT" value={fx.hpf} min={20} max={400} unit="Hz" onChange={(v) => { setFx(p => ({...p, hpf: v})); setNeuralActive(false); }} />
                       <Knob label="AIR_CUT" value={fx.lpf} min={4000} max={20000} unit="Hz" onChange={(v) => { setFx(p => ({...p, lpf: v})); setNeuralActive(false); }} />
                    </div>

                    {/* Discrete & Texture Row */}
                    <div className="border-t border-slate-800 pt-6 flex flex-wrap lg:flex-nowrap items-center justify-between gap-6">
                       <div className="flex flex-wrap gap-8 items-center">
                          <div className="hidden lg:block border-r border-slate-800 pr-6 mr-2">
                             <div className="text-[8px] font-black uppercase text-slate-500 tracking-widest mb-1">Analog Path</div>
                             <div className="text-[7px] font-mono text-cyan-500/50">DISCRETE_DSP</div>
                          </div>
                          <Knob label="BASS" value={fx.bass} min={0} max={12} unit="dB" onChange={(v) => { setFx(p => ({...p, bass: v})); setNeuralActive(false); }} />
                          <Knob label="MID" value={fx.mid} min={0} max={12} unit="dB" onChange={(v) => { setFx(p => ({...p, mid: v})); setNeuralActive(false); }} />
                          <Knob label="TREBLE" value={fx.treble} min={0} max={12} unit="dB" onChange={(v) => { setFx(p => ({...p, treble: v})); setNeuralActive(false); }} />
                          
                          <div className="w-px h-12 bg-slate-800 mx-2 hidden md:block"></div>

                          <div className="hidden lg:block border-r border-slate-800 pr-6 mr-2">
                             <div className="text-[8px] font-black uppercase text-amber-500/80 tracking-widest mb-1">Texture</div>
                             <div className="text-[7px] font-mono text-amber-500/40">NOISE_GEN</div>
                          </div>
                          <Knob label="CRACKLE" value={fx.crackle} min={0} max={100} unit="%" onChange={(v) => { setFx(p => ({...p, crackle: v})); setNeuralActive(false); }} />
                          <Knob label="HISS" value={fx.hiss} min={0} max={100} unit="%" onChange={(v) => { setFx(p => ({...p, hiss: v})); setNeuralActive(false); }} />
                       </div>
                       
                       <div className="flex flex-col items-end justify-between py-2 pl-8 border-l border-slate-800 ml-auto min-w-[120px]">
                          <button onClick={() => setBypass(!bypass)} className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] border transition-all mb-4 ${bypass ? 'bg-red-500/10 border-red-500 text-red-500 shadow-lg shadow-red-500/20' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>BYPASS_DSP</button>
                          <Knob label="MASTER" value={masterGain} min={-60} max={12} unit="dB" onChange={setMasterGain} />
                       </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 flex flex-col gap-8">
                <div className="bg-slate-900 rounded-[2rem] border border-slate-800 p-8 shadow-xl">
                  <h3 className="flex items-center gap-3 font-black text-cyan-400 uppercase tracking-widest text-xs mb-6"><Zap className="w-4 h-4"/> Preset Terminal</h3>
                  <div className="grid grid-cols-1 gap-2.5">
                     {[
                       { id: 'master', name: 'Transparent Master', icon: Headphones, color: 'text-cyan-400' },
                       { id: 'vocal', name: 'Elite Vocal', icon: Mic, color: 'text-blue-400' },
                       { id: 'podcast', name: 'Broadcast Pro', icon: Radio, color: 'text-emerald-400' },
                       { id: 'cinematic', name: 'Cinematic Depth', icon: Ghost, color: 'text-purple-400' },
                       { id: 'vinyl', name: 'Warm Heritage', icon: Music, color: 'text-amber-400' },
                       { id: 'broadcast', name: 'Loudness Maximizer', icon: Zap, color: 'text-rose-400' }
                     ].map(p => (
                       <button key={p.id} onClick={() => applyPreset(p.id)} className="p-4 bg-slate-950/40 border border-slate-800 hover:border-cyan-500/40 rounded-2xl transition-all text-left group flex items-center gap-4 hover:bg-slate-800/40">
                          <div className={`p-2 rounded-xl bg-slate-900 border border-slate-800 group-hover:scale-110 transition-transform ${p.color}`}><p.icon className="w-4 h-4" /></div>
                          <span className="font-bold text-xs text-slate-400 group-hover:text-white uppercase tracking-wider">{p.name}</span>
                       </button>
                     ))}
                     <button onClick={() => applyPreset('pure')} className="w-full mt-2 py-3 border border-dashed border-slate-800 rounded-2xl text-[10px] font-black text-slate-600 hover:text-slate-400 uppercase tracking-[0.3em] transition-colors">Reset DSP Core</button>
                  </div>
                </div>

                <div className="flex-1 bg-slate-900 rounded-[2rem] border border-slate-800 p-8 shadow-xl flex flex-col">
                  <h3 className="flex items-center gap-3 font-black text-purple-400 uppercase tracking-widest text-xs mb-6"><ScanEye className="w-4 h-4"/> Neural Analytics</h3>
                  <div className="flex-1 bg-black/40 rounded-3xl border border-slate-800/50 p-6 flex flex-col items-center justify-center text-center relative overflow-hidden group">
                     {!sourceBuffer ? (
                       <div className="opacity-30 group-hover:opacity-100 transition-opacity">
                          <Eye className="w-12 h-12 mx-auto mb-4 text-slate-800" />
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">Awaiting_Source_Bus...</p>
                       </div>
                     ) : isScanning ? (
                       <div className="flex flex-col items-center gap-6 animate-pulse">
                         <div className="relative">
                            <RefreshCw className="w-14 h-14 text-purple-500 animate-spin" />
                            <BrainCircuit className="w-6 h-6 text-purple-200 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                         </div>
                         <p className="text-[10px] font-black font-mono text-purple-400 uppercase tracking-[0.2em]">Synthesizing Neural DNA Map...</p>
                       </div>
                     ) : analysis ? (
                       <div className="w-full text-left space-y-6 animate-in fade-in zoom-in-95 duration-700">
                          <div className="space-y-4">
                              <div className="flex justify-between items-center text-[10px] font-black text-slate-600 uppercase tracking-wider">
                                 <span>LUFS_INTEGRATED</span>
                                 <span className="text-purple-400">{analysis.rms}</span>
                              </div>
                              <div className="flex justify-between items-center text-[10px] font-black text-slate-600 uppercase tracking-wider">
                                 <span>PEAK_HEADROOM</span>
                                 <span className="text-purple-400">{analysis.peak}</span>
                              </div>
                          </div>
                          <div className="p-5 bg-purple-500/5 rounded-2xl border border-purple-500/20">
                             <div className="text-[8px] font-black uppercase text-purple-500 mb-2 opacity-60">AI_OBSERVATION</div>
                             <p className="text-[11px] text-slate-400 leading-relaxed font-medium italic">"{analysis.suggestion}"</p>
                          </div>
                          <button onClick={applyNeuralRemaster} className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-purple-900/20 ${neuralActive ? 'bg-purple-600 text-white border-purple-400' : 'bg-purple-600/20 border border-purple-600/40 text-purple-400 hover:bg-purple-600 hover:text-white'}`}>
                             {neuralActive ? 'Neural DNA Synchronized' : 'Apply Neural DNA Remaster'}
                          </button>
                       </div>
                     ) : (
                       <button onClick={runAnalysis} className="flex flex-col items-center gap-4 group/btn">
                          <div className="w-20 h-20 rounded-full border border-slate-800 flex items-center justify-center group-hover/btn:border-purple-500/50 transition-colors bg-slate-900/50">
                             <BarChart3 className="w-8 h-8 text-slate-700 group-hover/btn:text-purple-400 group-hover/btn:scale-110 transition-all" />
                          </div>
                          <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] group-hover/btn:text-purple-400">Deep_DNA_Scan</span>
                       </button>
                     )}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'assistant' && (
            <div className="lg:col-span-12 h-full">
               <LiveAssistant externalAnalysis={analysis} sourceBuffer={sourceBuffer} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
