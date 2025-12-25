import React, { useState, useEffect, useRef } from 'react';

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  unit?: string;
}

const Knob: React.FC<KnobProps> = ({ label, value, min, max, onChange, unit = '' }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const startY = useRef<number>(0);
  const startVal = useRef<number>(0);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startY.current = e.clientY;
    startVal.current = localValue;
    document.body.style.cursor = 'ns-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    const deltaY = startY.current - e.clientY;
    const range = max - min;
    const step = range / 200; // Sensitivity
    const newValue = Math.min(max, Math.max(min, startVal.current + deltaY * step));
    setLocalValue(newValue);
    onChange(newValue);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    document.body.style.cursor = 'default';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  // Calculate rotation: map value to -135deg to +135deg
  const percentage = (localValue - min) / (max - min);
  const rotation = -135 + (percentage * 270);

  return (
    <div className="flex flex-col items-center gap-2 select-none group">
      <div 
        className="relative w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 shadow-xl cursor-ns-resize hover:border-hatmann-accent transition-colors"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-slate-700 to-slate-900 opacity-50"></div>
        {/* Indicator */}
        <div 
          className="absolute w-1 h-1/2 bg-transparent left-1/2 top-0 -ml-0.5 origin-bottom"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
            <div className="w-full h-3 bg-hatmann-accent rounded-full absolute top-1"></div>
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider group-hover:text-slate-200">{label}</div>
        <div className="text-xs font-mono text-hatmann-accent">
            {localValue.toFixed(1)}{unit}
        </div>
      </div>
    </div>
  );
};

export default Knob;
