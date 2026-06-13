import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { SideDrawer } from '../../components/ds/SideDrawer';
import { AdminBadge } from '../../components/ds/AdminBadge';

const timeInPipeline = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d in pipeline`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h in pipeline`;
  return 'just applied';
};

interface SignedDoc { document_type: string; url: string; status: string; }
interface DriverKYCDocument { name: string; status: string; url: string; uploaded_at: string; expiry_date: string; }
interface OnboardingApplicant {
  driver_id: string; name: string; phone: string; city_prefix: string;
  stage: string; kyc_documents_checklist: DriverKYCDocument[];
  applied_at: string; background_status: string; training_completed: boolean;
}

const STAGES = [
  { key: 'APPLIED',           label: 'Applied' },
  { key: 'DOCS_UPLOADED',     label: 'Docs Uploaded' },
  { key: 'BACKGROUND_CHECK',  label: 'Background Check' },
  { key: 'TRAINING',          label: 'Training' },
  { key: 'APPROVED',          label: 'Approved' },
];

// ── Doc completeness bar ──────────────────────────────────────────────
function DocBar({ docs }: { docs: DriverKYCDocument[] }) {
  const approved = docs.filter((d) => d.status === 'approved').length;
  const total    = docs.length || 1;
  const pct      = Math.round((approved / total) * 100);
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-label-small text-content-secondary">{approved}/{total} docs</span>
        <span className="font-mono text-mono-small text-content-tertiary">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-pill bg-background-tertiary overflow-hidden">
        <div
          className="h-full rounded-pill bg-accent-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Kanban card ───────────────────────────────────────────────────────
function ApplicantCard({
  applicant,
  onClick,
}: {
  applicant: OnboardingApplicant;
  onClick: () => void;
}) {
  const initials = applicant.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const showDocs = applicant.stage === 'DOCS_UPLOADED';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-background-primary rounded-md shadow-elevation-1 p-4 mb-3 hover:shadow-elevation-2 transition-base cursor-pointer border border-border-opaque focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-pill bg-background-tertiary border border-border-opaque flex items-center justify-center flex-shrink-0">
          <span className="text-label-small text-content-secondary">{initials}</span>
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-label-medium text-content-primary truncate">{applicant.name}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="badge badge-neutral">{applicant.city_prefix}</span>
            <span className="font-mono text-mono-small text-content-tertiary">{timeInPipeline(applicant.applied_at)}</span>
          </div>
        </div>
      </div>
      {showDocs && <DocBar docs={applicant.kyc_documents_checklist} />}
    </button>
  );
}

// ── Reject Modal ──────────────────────────────────────────────────────
function RejectModal({
  name,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  loading,
}: {
  name: string;
  reason: string;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background-primary rounded-md border border-border-opaque shadow-elevation-3 p-600 w-full max-w-md">
        <h3 className="text-heading-small text-content-primary mb-2">Reject applicant</h3>
        <p className="text-paragraph-medium text-content-secondary mb-4">
          You are rejecting <strong className="text-content-primary">{name}</strong>. This will remove them from the pipeline.
        </p>
        <label className="block text-label-small text-content-secondary uppercase tracking-wider mb-2">Reason</label>
        <textarea
          className="w-full bg-background-secondary border border-border-opaque rounded-sm px-4 py-3 text-paragraph-medium text-content-primary placeholder:text-content-tertiary outline-none focus:ring-2 focus:ring-accent-400 resize-none transition-base"
          rows={3}
          placeholder="Enter rejection reason…"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
        />
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-sm bg-background-secondary border border-border-opaque py-2.5 text-label-medium text-content-secondary hover:bg-background-tertiary transition-base cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!reason.trim() || loading}
            className="flex-1 rounded-sm bg-negative-400 text-white py-2.5 text-label-medium font-medium hover:opacity-90 transition-base cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Rejecting…' : 'Reject applicant'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const DriverOnboardingQueue: React.FC = () => {
  const [applicants,        setApplicants]        = useState<OnboardingApplicant[]>([]);
  const [loading,           setLoading]           = useState<boolean>(true);
  const [selectedApplicant, setSelectedApplicant] = useState<OnboardingApplicant | null>(null);
  const [actionLoading,     setActionLoading]     = useState<boolean>(false);
  const [rejectReason,      setRejectReason]      = useState<string>('');
  const [showRejectModal,   setShowRejectModal]   = useState<boolean>(false);
  const [signedDocs,        setSignedDocs]        = useState<SignedDoc[]>([]);
  const [activeDocIdx,      setActiveDocIdx]      = useState<number>(0);

  useEffect(() => {
    if (!selectedApplicant) { setSignedDocs([]); return; }
    const role = localStorage.getItem('admin_role') || 'ADMIN';
    fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${selectedApplicant.driver_id}/kyc/documents`, {
      headers: { 'X-Admin-Role': role },
    })
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((d) => setSignedDocs(d.documents || []))
      .catch(() => setSignedDocs([]));
  }, [selectedApplicant?.driver_id]);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const role = localStorage.getItem('admin_role') || 'ADMIN';
      const res  = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/onboarding`, {
        headers: { 'X-Admin-Role': role },
      });
      if (res.ok) {
        const data = await res.json();
        setApplicants(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch onboarding queue', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchQueue(); }, []);

  const advanceStage = async () => {
    if (!selectedApplicant) return;
    setActionLoading(true);
    const role  = localStorage.getItem('admin_role') || 'ADMIN';
    const stages = STAGES.map((s) => s.key);
    const nextStage = stages[stages.indexOf(selectedApplicant.stage) + 1];
    if (!nextStage) { setActionLoading(false); return; }
    try {
      await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${selectedApplicant.driver_id}/onboarding/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Role': role },
        body: JSON.stringify({ stage: nextStage }),
      });
      await fetchQueue();
      setSelectedApplicant(null);
    } catch (err) {
      console.error('Failed to advance stage', err);
    } finally {
      setActionLoading(false);
    }
  };

  const rejectApplicant = async () => {
    if (!selectedApplicant || !rejectReason.trim()) return;
    setActionLoading(true);
    const role = localStorage.getItem('admin_role') || 'ADMIN';
    try {
      await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${selectedApplicant.driver_id}/onboarding/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Role': role },
        body: JSON.stringify({ reason: rejectReason }),
      });
      await fetchQueue();
      setShowRejectModal(false);
      setSelectedApplicant(null);
      setRejectReason('');
    } catch (err) {
      console.error('Failed to reject applicant', err);
    } finally {
      setActionLoading(false);
    }
  };

  const stageLabel: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
  const nextStageLabel = selectedApplicant
    ? stageLabel[STAGES[STAGES.findIndex((s) => s.key === selectedApplicant.stage) + 1]?.key] ?? null
    : null;

  return (
    <div className="w-full h-full flex flex-col bg-background-primary overflow-hidden">
      {/* Page header */}
      <div className="flex-shrink-0 px-700 py-500 border-b border-border-opaque flex items-center justify-between">
        <div>
          <h1 className="text-heading-xl text-content-primary">Driver Onboarding Queue</h1>
          <p className="text-paragraph-small text-content-secondary mt-0.5">{applicants.length} applicants in pipeline</p>
        </div>
        <button type="button" onClick={fetchQueue} className="btn-primary flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M1 4v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-700 py-500">
        {loading ? (
          <div className="flex gap-4">
            {STAGES.map((s) => (
              <div key={s.key} className="min-w-[280px] flex-shrink-0">
                <div className="h-9 rounded-sm bg-background-tertiary animate-pulse mb-3" />
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 rounded-md bg-background-secondary animate-pulse mb-3" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4 h-full">
            {STAGES.map((stage) => {
              const cards = applicants.filter((a) => a.stage === stage.key);
              return (
                <div key={stage.key} className="min-w-[280px] flex-shrink-0 flex flex-col">
                  {/* Column header */}
                  <div className="flex items-center justify-between bg-background-secondary rounded-sm px-4 py-2.5 mb-3">
                    <span className="text-label-small text-content-secondary uppercase tracking-wider">{stage.label}</span>
                    <span className="badge badge-neutral font-mono">{cards.length}</span>
                  </div>
                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto">
                    {cards.length === 0 ? (
                      <div className="flex items-center justify-center h-20 rounded-md border border-dashed border-border-opaque">
                        <span className="text-paragraph-small text-content-tertiary">Empty</span>
                      </div>
                    ) : (
                      cards.map((applicant) => (
                        <ApplicantCard
                          key={applicant.driver_id}
                          applicant={applicant}
                          onClick={() => { setSelectedApplicant(applicant); setActiveDocIdx(0); }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail SideDrawer */}
      <SideDrawer
        isOpen={!!selectedApplicant}
        onClose={() => setSelectedApplicant(null)}
        title={selectedApplicant?.name ?? ''}
        footer={
          selectedApplicant && selectedApplicant.stage !== 'APPROVED' ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowRejectModal(true)}
                className="flex-1 rounded-sm bg-surface-negative border border-negative-200 py-2.5 text-label-medium text-content-negative font-medium hover:opacity-80 transition-base cursor-pointer"
              >
                Reject
              </button>
              {nextStageLabel && (
                <button
                  type="button"
                  onClick={advanceStage}
                  disabled={actionLoading}
                  className="flex-1 rounded-sm bg-positive-400 text-white py-2.5 text-label-medium font-medium hover:opacity-90 transition-base cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? 'Advancing…' : `Advance to ${nextStageLabel}`}
                </button>
              )}
            </div>
          ) : null
        }
      >
        {selectedApplicant && (
          <div className="space-y-5">
            {/* Info rows */}
            {[
              { label: 'Driver ID', value: selectedApplicant.driver_id, mono: true },
              { label: 'Phone',     value: selectedApplicant.phone },
              { label: 'City',      value: selectedApplicant.city_prefix },
              { label: 'Applied',   value: timeInPipeline(selectedApplicant.applied_at), mono: true },
            ].map(({ label, value, mono }) => (
              <div key={label} className="flex items-center justify-between border-b border-border-opaque pb-3">
                <span className="text-label-small text-content-secondary uppercase tracking-wider">{label}</span>
                <span className={`text-paragraph-medium text-content-primary ${mono ? 'font-mono' : ''}`}>{value}</span>
              </div>
            ))}

            {/* Stage badge */}
            <div className="flex items-center justify-between border-b border-border-opaque pb-3">
              <span className="text-label-small text-content-secondary uppercase tracking-wider">Stage</span>
              <AdminBadge label={stageLabel[selectedApplicant.stage] ?? selectedApplicant.stage} variant="accent" />
            </div>

            {/* Background check */}
            {selectedApplicant.background_status && (
              <div className="flex items-center justify-between border-b border-border-opaque pb-3">
                <span className="text-label-small text-content-secondary uppercase tracking-wider">Background</span>
                <AdminBadge label={selectedApplicant.background_status} />
              </div>
            )}

            {/* KYC Documents */}
            {signedDocs.length > 0 && (
              <div>
                <div className="text-label-small text-content-secondary uppercase tracking-wider mb-3">KYC Documents</div>
                {/* Doc tabs */}
                <div className="flex gap-2 flex-wrap mb-4">
                  {signedDocs.map((doc, idx) => (
                    <button
                      key={doc.document_type}
                      type="button"
                      onClick={() => setActiveDocIdx(idx)}
                      className={`rounded-pill px-3 py-1 text-label-small transition-base cursor-pointer ${
                        activeDocIdx === idx
                          ? 'bg-interactive-primary text-interactive-primary-text'
                          : 'bg-background-secondary border border-border-opaque text-content-secondary hover:text-content-primary'
                      }`}
                    >
                      {doc.document_type.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
                {/* Image viewer */}
                {signedDocs[activeDocIdx]?.url && (
                  <div className="rounded-md overflow-hidden bg-background-tertiary border border-border-opaque">
                    <img
                      src={signedDocs[activeDocIdx].url}
                      alt={signedDocs[activeDocIdx].document_type}
                      className="w-full max-h-[380px] object-contain"
                    />
                  </div>
                )}
                {/* Per-doc actions */}
                <div className="flex gap-2 mt-3">
                  <button className="flex-1 rounded-sm bg-positive-400 text-white py-2 text-label-small font-medium hover:opacity-90 transition-base cursor-pointer">✓ Approve</button>
                  <button className="flex-1 rounded-sm bg-negative-400 text-white py-2 text-label-small font-medium hover:opacity-90 transition-base cursor-pointer">✗ Reject</button>
                  <button className="flex-1 rounded-sm bg-background-secondary border border-border-opaque text-content-secondary py-2 text-label-small hover:bg-background-tertiary transition-base cursor-pointer">↗ Request Reupload</button>
                </div>
              </div>
            )}

            {/* KYC checklist */}
            {selectedApplicant.kyc_documents_checklist.length > 0 && (
              <div>
                <div className="text-label-small text-content-secondary uppercase tracking-wider mb-3">Checklist</div>
                <div className="space-y-2">
                  {selectedApplicant.kyc_documents_checklist.map((doc) => (
                    <div key={doc.name} className="flex items-center justify-between py-2 border-b border-border-opaque last:border-none">
                      <span className="text-paragraph-medium text-content-primary">{doc.name.replace(/_/g, ' ')}</span>
                      <AdminBadge label={doc.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SideDrawer>

      {/* Reject Modal */}
      {showRejectModal && selectedApplicant && (
        <RejectModal
          name={selectedApplicant.name}
          reason={rejectReason}
          onReasonChange={setRejectReason}
          onConfirm={rejectApplicant}
          onCancel={() => { setShowRejectModal(false); setRejectReason(''); }}
          loading={actionLoading}
        />
      )}
    </div>
  );
};
