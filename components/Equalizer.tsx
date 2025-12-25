import React from 'react';
import { EQBand } from '../types';

interface EqualizerProps {
  bands: EQBand[];
  onChange: (id: number, gain: number) => void;
  onReset: () => void;
}

const Equalizer: React.FC<EqualizerProps> = ({ bands, onChange, onReset }) => {
  return (
    <div className="flex flex-col h-full bg-slate-900/50 p-6 rounded-3xl">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
           <div className="w-2 h-6 bg-cyan-500 rounded-full animate-pulse"></div>
           <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Surgical EQ Array</h3>
        </div>
        <button onClick={onReset} className="text-[10px] font-bold text-slate-500 hover:text-cyan-400 transition-colors px-3 py-1 border border-slate-800 rounded-full hover:border-cyan-500/50">RESET FLAT</button>
      </div>
      
      <div className="flex-1 flex justify-between items-center gap-1">
        {bands.map((band) => (
          <div key={band.id} className="group flex flex-col items-center flex-1 h-full">
             <div className="relative flex-1 w-full flex justify-center items-center py-4">
                 {/* Center Detent Line */}
                 <div className="absolute left-1/2 -translate-x-1/2 w-[1px] h-full bg-slate-800 pointer-events-none"></div>
                 
                 <input
                   type="range" min="-18" max="18" step="0.1"
                   value={band.gain}
                   onChange={(e) => onChange(band.id, parseFloat(e.target.value))}
                   className="absolute inset-0 h-full w-full appearance-none bg-transparent cursor-ns-resize vertical-slider"
                   style={{ writingMode: 'vertical-lr', direction: 'rtl', WebkitAppearance: 'slider-vertical' } as any}
                 />
                 
                 <div 
                    className={`pointer-events-none w-1 rounded-full transition-all duration-300 ${band.gain > 0 ? 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]' : band.gain < 0 ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-slate-700'}`}
                    style={{ height: `${Math.abs(band.gain / 18) * 50}%`, position: 'absolute', top: '50%', transform: band.gain > 0 ? 'translateY(-100%)' : 'translateY(0)' }}
                 ></div>
             </div>
             
             <div className="mt-4 flex flex-col items-center">
                 <div className={`text-[9px] font-mono mb-1 ${band.gain === 0 ? 'text-slate-600' : 'text-slate-200'}`}>
                    {band.gain > 0 ? '+' : ''}{band.gain.toFixed(1)}
                 </div>
                 <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                     {band.frequency >= 1000 ? `${band.frequency/1000}k` : band.frequency}
                 </div>
             </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Equalizer;
