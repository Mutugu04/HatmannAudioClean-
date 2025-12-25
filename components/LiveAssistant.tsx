
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
// Added Ghost to the imports from lucide-react
import { Mic, MicOff, Activity, Terminal, Ear, AudioLines, AlertTriangle, Ghost } from 'lucide-react';
import { LiveConnectionState, LiveMessageLog, AnalysisReport } from '../types';
import { base64ToBytes, createPcmBlob, decodeAudioData } from '../utils/audioUtils';
import Visualizer from './Visualizer';

interface LiveAssistantProps {
  // Removed apiKey prop as per GenAI guidelines
  externalAnalysis?: AnalysisReport | null;
  sourceBuffer?: AudioBuffer | null;
}

const LiveAssistant: React.FC<LiveAssistantProps> = ({ externalAnalysis, sourceBuffer }) => {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>(LiveConnectionState.DISCONNECTED);
  const [logs, setLogs] = useState<LiveMessageLog[]>([]);
  const [isSendingSnippet, setIsSendingSnippet] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioQueueRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sessionRef = useRef<any>(null);
  
  const disconnect = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    processorRef.current?.disconnect();
    inputContextRef.current?.close();
    outputContextRef.current?.close();
    audioQueueRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    audioQueueRef.current.clear();
    setConnectionState(LiveConnectionState.DISCONNECTED);
    sessionRef.current = null;
    setLogs(p => [...p, { id: Date.now().toString(), role: 'system', timestamp: Date.now(), text: 'TERMINAL_CLOSED' }]);
  }, []);

  const connect = async () => {
    // Check for process.env.API_KEY directly
    if (!process.env.API_KEY) {
        setErrorMsg("API_KEY_NULL");
        return;
    }
    
    try {
      setErrorMsg(null);
      setConnectionState(LiveConnectionState.CONNECTING);
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;
      
      const analyser = outputCtx.createAnalyser();
      analyserRef.current = analyser;
      analyser.connect(outputCtx.destination);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Use process.env.API_KEY directly to initialize GoogleGenAI
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Setup the session with a direct promise handle
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            systemInstruction: `SYSTEM_PROFILE: Hatmann_AI_Core. ROLE: Master Mix Engineer. 
            CORE_DIRECTIVE: Provide professional mastering and mixing feedback. 
            TONE: Technical, efficient, authoritative. 
            INPUT_STREAMS: User microphone (real-time) and Audio Snippets (high-fidelity).
            DATA_CONTEXT: Use provided RMS/Peak values to calibrate suggestions.`,
            inputAudioTranscription: {}, 
            outputAudioTranscription: {},
        },
        callbacks: {
            onopen: () => {
                setConnectionState(LiveConnectionState.CONNECTED);
                setLogs(p => [...p, { id: Date.now().toString(), role: 'system', timestamp: Date.now(), text: 'NEURAL_LINK_ESTABLISHED' }]);
                
                const source = inputCtx.createMediaStreamSource(stream);
                const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;
                processor.onaudioprocess = (e) => {
                    const blob = createPcmBlob(e.inputBuffer.getChannelData(0), inputCtx.sampleRate);
                    // Use the session promise to send data as per guidelines
                    sessionPromise.then(s => s.sendRealtimeInput({ media: blob }));
                };
                source.connect(processor);
                processor.connect(inputCtx.destination);
            },
            onmessage: async (message: LiveServerMessage) => {
                const outCtx = outputContextRef.current;
                // Handle audio output from the model
                const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audio && outCtx) {
                    nextStartTimeRef.current = Math.max(outCtx.currentTime, nextStartTimeRef.current);
                    try {
                      const buf = await decodeAudioData(base64ToBytes(audio), outCtx, 24000, 1);
                      const source = outCtx.createBufferSource();
                      source.buffer = buf;
                      source.connect(analyserRef.current!);
                      source.start(nextStartTimeRef.current);
                      nextStartTimeRef.current = nextStartTimeRef.current + buf.duration;
                      audioQueueRef.current.add(source);
                      source.onended = () => audioQueueRef.current.delete(source);
                    } catch(err) { console.error("Audio Decode Error", err); }
                }
                // Handle transcriptions
                const text = message.serverContent?.outputTranscription?.text;
                if (text) {
                    setLogs(p => {
                        const last = p[p.length-1];
                        if (last?.role === 'model') return [...p.slice(0,-1), {...last, text: last.text + text}];
                        return [...p, { id: Date.now().toString(), role: 'model', timestamp: Date.now(), text }];
                    });
                }
            },
            onclose: () => disconnect(),
            onerror: (e) => {
                console.error("Live Error", e);
                setErrorMsg("NEURAL_LINK_FAULT");
                disconnect();
            }
        }
      });
      sessionRef.current = sessionPromise;
    } catch (e) { 
        console.error(e);
        setErrorMsg("MIC_ACCESS_DENIED");
        disconnect(); 
    }
  };

  const sendSnippet = async () => {
    if (!sourceBuffer || !sessionRef.current) return;
    setIsSendingSnippet(true);
    
    try {
        const s = await sessionRef.current;
        // Take 8 seconds from the start of the track
        const sampleCount = Math.min(sourceBuffer.sampleRate * 8, sourceBuffer.length);
        const data = sourceBuffer.getChannelData(0).slice(0, sampleCount);
        const blob = createPcmBlob(data, sourceBuffer.sampleRate);
        
        s.sendRealtimeInput({ media: blob });
        s.sendRealtimeInput({ parts: [{ text: "Mastering File Snippet Uploaded. Analyze frequency distribution and dynamic compression requirements." }] });
        
        setLogs(p => [...p, { id: Date.now().toString(), role: 'system', timestamp: Date.now(), text: 'SNIPPET_STREAM_COMPLETE' }]);
    } catch (err) {
        console.error(err);
    } finally {
        setIsSendingSnippet(false);
    }
  };

  useEffect(() => {
    if (connectionState === LiveConnectionState.CONNECTED && externalAnalysis && sessionRef.current) {
        sessionRef.current.then((s: any) => {
             s.sendRealtimeInput({ parts: [{ text: `INCOMING_DNA_DATA: RMS=${externalAnalysis.rms}, Peak=${externalAnalysis.peak}. Analysis Summary: ${externalAnalysis.suggestion}` }] });
        });
    }
  }, [externalAnalysis, connectionState]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-[2.5rem] border border-slate-800 overflow-hidden shadow-2xl">
      <div className="p-8 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-2xl bg-slate-900 border border-slate-800 ${connectionState === LiveConnectionState.CONNECTED ? 'text-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'text-slate-600'}`}>
            <AudioLines className="w-5 h-5" />
          </div>
          <div>
            <span className="font-black text-xs uppercase tracking-[0.3em] text-slate-400">Neural Console</span>
            <div className="flex items-center gap-2 mt-0.5">
                <div className={`w-1.5 h-1.5 rounded-full ${connectionState === LiveConnectionState.CONNECTED ? 'bg-cyan-500 animate-pulse' : 'bg-slate-700'}`}></div>
                <span className="text-[10px] font-mono text-slate-500">{connectionState}</span>
            </div>
          </div>
        </div>
        {sourceBuffer && connectionState === LiveConnectionState.CONNECTED && (
          <button 
            disabled={isSendingSnippet}
            onClick={sendSnippet}
            className="flex items-center gap-3 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl transition-all disabled:opacity-50 shadow-lg shadow-indigo-900/20"
          >
            <Ear className="w-4 h-4" /> {isSendingSnippet ? 'STREAMING...' : 'AI_LISTEN'}
          </button>
        )}
      </div>

      <div className="flex-1 relative bg-black/40">
         <div className="absolute inset-0 opacity-20">
           <Visualizer analyser={analyserRef.current} isActive={connectionState === LiveConnectionState.CONNECTED} />
         </div>
         <div className="relative z-10 h-full p-8 overflow-y-auto space-y-6 flex flex-col justify-end scroll-smooth">
            {errorMsg && (
                <div className="mx-auto bg-red-500/10 border border-red-500/20 p-6 rounded-3xl text-center max-w-sm animate-in zoom-in-95">
                    <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
                    <h4 className="text-red-500 font-black uppercase tracking-widest text-xs mb-1">Fatal Interface Error</h4>
                    <p className="text-[10px] text-red-400 font-mono">{errorMsg}</p>
                </div>
            )}
            
            {logs.length === 0 && !errorMsg && (
              <div className="text-center text-slate-700 my-auto animate-pulse flex flex-col items-center gap-4">
                <Ghost className="w-16 h-16 opacity-10" />
                <p className="text-[10px] font-black uppercase tracking-[0.5em] opacity-30">Awaiting_Neural_Sync...</p>
              </div>
            )}
            {logs.map(log => (
              <div key={log.id} className={`max-w-[80%] p-5 rounded-[2rem] text-xs leading-relaxed border ${log.role === 'model' ? 'bg-slate-800/95 border-slate-700 self-start text-cyan-50 shadow-2xl' : log.role === 'system' ? 'bg-transparent border-transparent text-slate-600 text-[9px] text-center w-full uppercase tracking-[0.4em] font-black mb-4' : 'bg-cyan-600 border-cyan-500 self-end text-white shadow-cyan-900/30 shadow-xl font-bold'}`}>
                {log.text}
              </div>
            ))}
         </div>
      </div>

      <div className="p-10 bg-slate-950 border-t border-slate-800 flex justify-center backdrop-blur-xl">
        {connectionState === LiveConnectionState.DISCONNECTED ? (
          <button onClick={connect} className="px-12 py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-black uppercase tracking-[0.3em] rounded-2xl transition-all shadow-2xl active:scale-95 flex items-center gap-4 group">
            <Mic className="w-5 h-5 group-hover:animate-pulse" /> Initialize Link
          </button>
        ) : (
          <button onClick={disconnect} className="px-12 py-4 bg-red-600/10 border border-red-500 text-red-500 font-black uppercase tracking-[0.3em] rounded-2xl transition-all active:scale-95 flex items-center gap-4 hover:bg-red-600 hover:text-white group">
            <MicOff className="w-5 h-5 group-hover:rotate-12 transition-transform" /> Terminate Link
          </button>
        )}
      </div>
    </div>
  );
};

export default LiveAssistant;
