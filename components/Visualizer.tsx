import React, { useEffect, useRef, useState } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [meters, setMeters] = useState({ left: -60, right: -60 });
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const bufferLength = analyser.frequencyBinCount;
    const timeData = new Uint8Array(bufferLength);
    const freqData = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      if (!isActive) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.beginPath();
        ctx.moveTo(0, rect.height / 2);
        ctx.lineTo(rect.width, rect.height / 2);
        ctx.strokeStyle = '#1e293b';
        ctx.stroke();
        setMeters({ left: -60, right: -60 });
        return;
      }

      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      // Calculate RMS for Meter
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const val = (timeData[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bufferLength);
      const db = Math.max(-60, 20 * Math.log10(rms + 0.00001));
      setMeters({ left: db, right: db }); // Mono simplified for visual

      ctx.clearRect(0, 0, rect.width, rect.height);

      // 1. Draw Spectrum
      const barWidth = (rect.width / bufferLength) * 2.5;
      let barX = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (freqData[i] / 255) * rect.height;
        ctx.fillStyle = `hsla(${200 + (freqData[i] / 2)}, 70%, 50%, 0.3)`;
        ctx.fillRect(barX, rect.height - barHeight, barWidth, barHeight);
        barX += barWidth + 1;
      }

      // 2. Draw Waveform
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#06b6d4';
      ctx.beginPath();
      const sliceWidth = rect.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = timeData[i] / 128.0;
        const y = (v * rect.height) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(animationRef.current);
  }, [analyser, isActive]);

  return (
    <div className="w-full h-full rounded-lg overflow-hidden bg-slate-950 border border-slate-800 shadow-inner relative flex">
      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="w-full h-full block" />
        <div className="absolute bottom-1 right-2 text-[8px] text-slate-500 font-mono">SPECTRUM_FFT_2048</div>
      </div>
      
      {/* DB Meters */}
      <div className="w-8 border-l border-slate-800 bg-slate-900/50 flex flex-col p-1 gap-1">
        <div className="flex-1 bg-slate-800 rounded-sm relative overflow-hidden">
           <div 
             className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 transition-all duration-75"
             style={{ height: `${((meters.left + 60) / 60) * 100}%` }}
           ></div>
        </div>
        <div className="text-[7px] text-center font-bold text-slate-500">dB</div>
      </div>
    </div>
  );
};

export default Visualizer;
