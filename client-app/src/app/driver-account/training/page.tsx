'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { getDriverTraining, TrainingModule } from '@/api/client';

function statusLabel(status: string): string {
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'IN_PROGRESS') return 'In Progress';
  return 'Not Started';
}

export default function DriverTrainingPage() {
  const { token } = useAuthStore();
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    getDriverTraining(token)
      .then((res) => setModules(res.modules))
      .catch((err) => console.warn('Failed to load training:', err))
      .finally(() => setLoading(false));
  }, [token]);

  const completed = modules.filter((m) => m.status === 'COMPLETED').length;

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white font-move">Training Academy</h2>
        <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Certify expertise to unlock premium luxury and EV vehicle dispatch filters</p>
      </div>

      {/* Progress overview */}
      <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-2">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Certification Progress
        </h4>
        <p className="font-mono text-[11px] text-zinc-400">
          <span className="text-emerald-400 font-bold">{completed}</span> of {modules.length} modules completed
        </p>
      </div>

      {/* Modules listing */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-zinc-900 pb-2">
          Academy Modules
        </h3>

        <div className="space-y-3">
          {loading && <p className="text-[10px] font-mono text-zinc-600">Loading modules…</p>}
          {!loading && modules.length === 0 && (
            <p className="text-[10px] font-mono text-zinc-600">No training modules available yet.</p>
          )}
          {modules.map((m) => (
            <div key={m.id} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-4">
              <div className="flex justify-between items-start gap-4 text-xs font-mono">
                <div className="space-y-1.5 flex-grow truncate">
                  <div className="flex items-center gap-2">
                    <span className="bg-zinc-900 text-zinc-500 px-2 py-0.5 rounded text-[8px] font-bold uppercase border border-zinc-850">
                      {m.module_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[8px] text-zinc-600 font-bold uppercase">{m.duration_label}</span>
                  </div>
                  <h4 className="text-sm font-bold text-white truncate font-sans tracking-tight">{m.title}</h4>
                </div>

                <span className={`px-2.5 py-1 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 border ${
                  m.status === 'COMPLETED'
                    ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900'
                    : 'bg-zinc-900 text-zinc-500 border-zinc-850'
                }`}>
                  {statusLabel(m.status)}
                </span>
              </div>

              <div className="border-t border-zinc-900 pt-3 text-[10px] font-mono text-zinc-400 flex justify-between">
                <span>Quiz Score:</span>
                <span className="text-white font-bold">{m.score != null ? `${m.score}%` : '—'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
