/* eslint-disable react/prop-types */
import React, { useState, useEffect, useRef } from 'react';
import { Cpu, Layers, Sparkles } from 'lucide-react';

export default function ScannerLoader() {
    const [statusText, setStatusText] = useState('Initializing Engine...');
    const [eyePos, setEyePos] = useState({ x: 0, y: 0 });
    const faceRef = useRef(null);
    
    useEffect(() => {
        const statuses = [
            'Extracting Master Images...',
            'Aligning Pixels...',
            'Running Visual Regression...',
            'Highlighting Differences...',
            'Generating Report...'
        ];
        let i = 0;
        const interval = setInterval(() => {
            i = (i + 1) % statuses.length;
            setStatusText(statuses[i]);
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!faceRef.current) return;
            const rect = faceRef.current.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            const dx = e.clientX - centerX;
            const dy = e.clientY - centerY;
            
            // Calculate eye movement. Max movement 3px for subtle effect.
            const distance = Math.hypot(dx, dy);
            const maxRadius = 3;
            const speed = 0.015; 
            
            let moveX = dx * speed;
            let moveY = dy * speed;
            
            if (Math.hypot(moveX, moveY) > maxRadius) {
                const angle = Math.atan2(dy, dx);
                moveX = Math.cos(angle) * maxRadius;
                moveY = Math.sin(angle) * maxRadius;
            }
            
            setEyePos({ x: moveX, y: moveY });
        };
        
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    return (
        <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] bg-slate-50 relative overflow-hidden">
            {/* Background ambient light */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl animate-pulse"></div>
                <div className="w-64 h-64 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000 absolute translate-x-10 translate-y-10"></div>
            </div>

            <div className="relative z-10 flex flex-col items-center">
                {/* Premium Glass Card */}
                <div className="bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl rounded-3xl p-8 flex flex-col items-center w-80 relative overflow-hidden">
                    
                    {/* Flowing Data Background inside card */}
                    <div className="absolute inset-0 animate-data-flow pointer-events-none opacity-50"></div>

                    {/* Scanner Core */}
                    <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
                        {/* Outer rotating dashed ring */}
                        <div className="absolute inset-0 rounded-full border-2 border-dashed border-indigo-300 animate-[spin_8s_linear_infinite]"></div>
                        {/* Inner glowing ring */}
                        <div className="absolute inset-2 rounded-full border border-blue-400/50 shadow-[0_0_15px_rgba(96,165,250,0.5)]"></div>
                        
                        {/* SVG Stock Graph Line */}
                        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 128 128">
                            <defs>
                                <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#3b82f6" />
                                    <stop offset="50%" stopColor="#8b5cf6" />
                                    <stop offset="100%" stopColor="#10b981" />
                                </linearGradient>
                            </defs>
                            {/* P1(24,84) P2(44,64) P3(59,79) P4(79,44) P5(92,64) P6(106,39) */}
                            <path 
                                d="M 24,84 L 44,64 L 59,79 L 79,44 L 92,64 L 106,39" 
                                fill="none" 
                                stroke="url(#lineGradient)" 
                                strokeWidth="3" 
                                strokeLinecap="round" 
                                strokeLinejoin="round" 
                                className="animate-draw-line"
                            />
                        </svg>

                        {/* Center Icon (Document to Dot) */}
                        <div className="flex items-center justify-center animate-doc-to-dot relative overflow-hidden z-20">
                            
                            <div className="relative w-full h-full flex flex-col items-center justify-center animate-inner-icon-fade">
                                {/* Document lines */}
                                <div className="w-[60%] h-[6%] bg-white/90 rounded-full mb-[12%]"></div>
                                <div className="w-[60%] h-[6%] bg-white/90 rounded-full mb-[12%]"></div>
                                <div className="w-[40%] h-[6%] bg-white/90 rounded-full self-start ml-[20%]"></div>
                                
                                {/* Laser Line */}
                                <div className="absolute left-0 w-full h-[2px] bg-blue-300 shadow-[0_0_8px_#93c5fd] animate-scanline z-20"></div>
                            </div>
                        </div>
                    </div>

                    {/* Text Status */}
                    <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                        <Sparkles size={18} className="text-amber-500" />
                        AI Analysis
                    </h3>
                    
                    <div className="h-6 overflow-hidden relative w-full text-center">
                        <p className="text-sm font-medium text-indigo-600 animate-[pulse_2s_ease-in-out_infinite] absolute w-full transition-all duration-500">
                            {statusText}
                        </p>
                    </div>

                    {/* Progress Dots */}
                    <div className="flex gap-1.5 mt-6">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0s' }}></div>
                        <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                        <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0.3s' }}></div>
                    </div>
                </div>

                {/* Cyber Badges below */}
                <div className="flex gap-4 mt-8 opacity-70">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white shadow-sm border border-slate-200 text-xs font-semibold text-slate-500">
                        <Cpu size={14} className="text-blue-500" /> Deep Learning
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white shadow-sm border border-slate-200 text-xs font-semibold text-slate-500">
                        <Layers size={14} className="text-indigo-500" /> Pixel Match
                    </div>
                </div>
            </div>
        </div>
    );
}
