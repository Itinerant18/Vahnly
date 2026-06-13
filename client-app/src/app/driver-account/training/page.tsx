'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/store/useAuthStore';
import { getDriverTraining, TrainingModule } from '@/api/client';

export default function DriverTrainingPage() {
  const t = useTranslations('driverTraining');
  const { token } = useAuthStore();

  const statusLabel = (status: string): string => {
    if (status === 'COMPLETED') return t('statusCompleted');
    if (status === 'IN_PROGRESS') return t('statusInProgress');
    return t('statusNotStarted');
  };

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
        <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
        <p className="text-content-tertiary text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Progress overview */}
      <div className="bg-background-primary border border-border-opaque rounded-2xl p-5 space-y-2">
        <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('certificationProgress')}
        </h4>
        <p className="font-mono text-[11px] text-content-secondary">
          <span className="text-content-positive font-bold">{completed}</span> {t('ofModulesCompleted', { total: modules.length })}
        </p>
      </div>

      {/* Modules listing */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider border-b border-border-opaque pb-2">
          {t('academyModules')}
        </h3>

        <div className="space-y-3">
          {loading && <p className="text-[10px] font-mono text-content-tertiary">{t('loadingModules')}</p>}
          {!loading && modules.length === 0 && (
            <p className="text-[10px] font-mono text-content-tertiary">{t('noModules')}</p>
          )}
          {modules.map((m) => (
            <div key={m.id} className="bg-background-primary border border-border-opaque p-5 rounded-2xl space-y-4">
              <div className="flex justify-between items-start gap-4 text-xs font-mono">
                <div className="space-y-1.5 flex-grow truncate">
                  <div className="flex items-center gap-2">
                    <span className="bg-background-secondary text-content-tertiary px-2 py-0.5 rounded text-[8px] font-bold uppercase border border-border-opaque">
                      {m.module_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[8px] text-content-tertiary font-bold uppercase">{m.duration_label}</span>
                  </div>
                  <h4 className="text-sm font-bold text-white truncate font-sans tracking-tight">{m.title}</h4>
                </div>

                <span className={`px-2.5 py-1 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 border ${
                  m.status === 'COMPLETED'
                    ? 'bg-surface-positive/20 text-content-positive border-positive-400'
                    : 'bg-background-secondary text-content-tertiary border-border-opaque'
                }`}>
                  {statusLabel(m.status)}
                </span>
              </div>

              <div className="border-t border-border-opaque pt-3 text-[10px] font-mono text-content-secondary flex justify-between">
                <span>{t('quizScore')}</span>
                <span className="text-white font-bold">{m.score != null ? `${m.score}%` : '—'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
