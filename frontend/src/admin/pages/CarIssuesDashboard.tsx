import React, { useEffect, useState, useCallback } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { getAdminRole } from '../auth';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';
import { AdminBadge } from '../../components/ds/AdminBadge';

interface CarIssueReport {
  id: string;
  order_id: string;
  driver_id: string;
  driver_name: string;
  rider_id: string;
  car: string;
  car_type: string;
  issue_type: string;
  description: string;
  reviewed: boolean;
  admin_notes: string;
  admin_notified: boolean;
  created_at: string;
  [key: string]: unknown; // satisfies DataTable's row constraint
}

const ISSUE_LABEL: Record<string, string> = {
  FUEL_LOW: 'Fuel Low',
  WARNING_LIGHT: 'Warning Light',
  TYRE: 'Tyre',
  AC: 'AC',
  OTHER: 'Other',
};

// Column definitions for the DataTable hero component (built-in sort / loading / empty).
const ISSUE_COLUMNS: ColumnDef<CarIssueReport>[] = [
  {
    key: 'order_id', header: 'Trip',
    render: (v) => <span className="font-mono text-mono-small">{String(v).slice(0, 8)}</span>,
  },
  {
    key: 'driver_name', header: 'Driver',
    render: (v) => <>{(v as string) || '—'}</>,
  },
  {
    key: 'rider_id', header: 'Rider',
    render: (v) => <span className="font-mono text-mono-small">{v ? String(v).slice(0, 8) : '—'}</span>,
  },
  { key: 'car', header: 'Car' },
  {
    key: 'issue_type', header: 'Issue',
    render: (v) => <>{ISSUE_LABEL[String(v)] || String(v)}</>,
  },
  { key: 'created_at', header: 'Reported At', type: 'date' },
  {
    key: 'reviewed', header: 'Status', type: 'status',
    render: (v) =>
      v
        ? <AdminBadge label="Reviewed" variant="positive" />
        : <AdminBadge label="Pending" variant="warning" />,
  },
];

export const CarIssuesDashboard: React.FC = () => {
  const [reports, setReports] = useState<CarIssueReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [carType, setCarType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<CarIssueReport | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (unreviewedOnly) params.append('unreviewed', 'true');
      if (from) params.append('from', from);
      if (to) params.append('to', to);
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/car-issue-reports?${params.toString()}`, {
        headers: { 'X-Admin-Role': getAdminRole() },
      });
      if (res.ok) {
        const data = await res.json();
        setReports((data?.reports as CarIssueReport[]) || []);
      }
    } catch (err) {
      console.error('Failed to fetch car issue reports', err);
    } finally {
      setLoading(false);
    }
  }, [unreviewedOnly, from, to]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const visible = carType
    ? reports.filter((r) => r.car_type.toUpperCase() === carType.toUpperCase())
    : reports;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink">Car Issue Reports</h1>
          <p className="text-xs text-mute mt-0.5">Driver-filed issues on rider vehicles after trips</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" checked={unreviewedOnly} onChange={(e) => setUnreviewedOnly(e.target.checked)} />
          Unreviewed only
        </label>
        <select
          value={carType}
          onChange={(e) => setCarType(e.target.value)}
          className="h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
        >
          <option value="">All car types</option>
          <option value="HATCHBACK">Hatchback</option>
          <option value="SEDAN">Sedan</option>
          <option value="SUV">SUV</option>
          <option value="PREMIUM">Premium</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink" />
      </div>

      {/* Table (DataTable hero component) */}
      <DataTable<CarIssueReport>
        columns={ISSUE_COLUMNS}
        data={visible}
        loading={loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelected(r)}
        emptyState={
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-heading-medium text-content-secondary">No car issues reported</span>
            <span className="text-paragraph-small text-content-tertiary">Reports filed by drivers will appear here.</span>
          </div>
        }
      />

      {selected && (
        <CarIssueDetailPanel
          report={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            fetchReports();
          }}
        />
      )}
    </div>
  );
};

const CarIssueDetailPanel: React.FC<{ report: CarIssueReport; onClose: () => void; onSaved: () => void }> = ({ report, onClose, onSaved }) => {
  const [notes, setNotes] = useState(report.admin_notes || '');
  const [saving, setSaving] = useState(false);

  const submit = async (notify: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/car-issue-reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Role': getAdminRole() },
        body: JSON.stringify({ reviewed: true, admin_notes: notes, notify_rider: notify }),
      });
      if (res.ok) onSaved();
    } catch (err) {
      console.error('Failed to update report', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-md bg-canvas shadow-2xl overflow-y-auto p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">Car Issue Detail</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-sm">✕</button>
        </div>

        <div className="space-y-2 text-xs">
          <Row label="Trip" value={report.order_id} mono />
          <Row label="Driver" value={`${report.driver_name || '—'} (${report.driver_id.slice(0, 8)})`} />
          <Row label="Rider" value={report.rider_id || '—'} mono />
          <Row label="Car" value={`${report.car} · ${report.car_type || '—'}`} />
          <Row label="Issue" value={ISSUE_LABEL[report.issue_type] || report.issue_type} />
          <Row label="Reported" value={new Date(report.created_at).toLocaleString()} />
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mute mb-1">Driver description</div>
          <p className="text-xs text-ink bg-canvas-soft rounded-lg p-3">{report.description || 'No description provided.'}</p>
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mute mb-1">Admin notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded-lg bg-canvas-soft border border-canvas-soft p-3 text-xs text-ink focus:outline-none focus:border-ink resize-none"
            placeholder="Add review notes…"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => submit(false)}
            disabled={saving}
            className="flex-1 h-10 rounded-pill bg-ink text-canvas text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Mark Reviewed'}
          </button>
          <button
            onClick={() => submit(true)}
            disabled={saving}
            className="flex-1 h-10 rounded-pill border border-ink text-ink text-xs font-semibold disabled:opacity-50"
          >
            Notify Rider
          </button>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex justify-between gap-3">
    <span className="text-mute">{label}</span>
    <span className={`text-ink text-right ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
  </div>
);
