'use client';

import React from 'react';

export default function DriverTrainingPage() {
  const modules = [
    { title: 'Core Passenger Etiquette & Greeting Rules', duration: '20 mins', type: 'Required', score: '100% (Passed)', status: 'Completed' },
    { title: 'Defensive Driving and Speed Compliance', duration: '35 mins', type: 'Required', score: '95% (Passed)', status: 'Completed' },
    { title: 'Premium Luxury Class (Audi/Merc Gearboxes)', duration: '40 mins', type: 'Optional Badge', score: '90% (Passed)', status: 'Completed' },
    { title: 'EV Charging & Range Safety Navigation', duration: '15 mins', type: 'Optional Badge', score: 'Awaiting quiz', status: 'In Progress' }
  ];

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Training Academy</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Certify expertise to unlock premium luxury and EV vehicle dispatch filters</p>
      </div>

      {/* Badges overview */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Earned Certifications
        </h4>

        <div className="flex flex-wrap gap-3 font-mono text-[9px] uppercase font-bold text-zinc-400">
          <span className="bg-zinc-900 text-amber-500 border border-zinc-800 px-3 py-2 rounded-xl">
            🏆 Premium Luxury Operator
          </span>
          <span className="bg-zinc-900 text-emerald-400 border border-zinc-800 px-3 py-2 rounded-xl">
            🛡️ Safety First Compliance
          </span>
          <span className="bg-zinc-900 text-zinc-500 border border-zinc-800 px-3 py-2 rounded-xl">
            ⚡ EV Pilot (Pending)
          </span>
        </div>
      </div>

      {/* Modules listing */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Academy Modules
        </h3>

        <div className="space-y-3">
          {modules.map((m, idx) => (
            <div key={idx} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-4">
              <div className="flex justify-between items-start gap-4 text-xs font-mono">
                <div className="space-y-1.5 flex-grow truncate">
                  <div className="flex items-center gap-2">
                    <span className="bg-zinc-900 text-zinc-500 px-2 py-0.5 rounded text-[8px] font-bold uppercase border border-zinc-850">
                      {m.type}
                    </span>
                    <span className="text-[8px] text-zinc-600 font-bold uppercase">{m.duration}</span>
                  </div>
                  <h4 className="text-sm font-bold text-white truncate font-sans tracking-tight">{m.title}</h4>
                </div>

                <span className={`px-2.5 py-1 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 border ${
                  m.status === 'Completed' 
                    ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900' 
                    : 'bg-zinc-900 text-zinc-500 border-zinc-850 animate-pulse'
                }`}>
                  {m.status}
                </span>
              </div>

              <div className="border-t border-zinc-900 pt-3 text-[10px] font-mono text-zinc-400 flex justify-between">
                <span>Quiz Score:</span>
                <span className="text-white font-bold">{m.score}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
