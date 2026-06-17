import React, { useState } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import type { ActiveOrderRecord } from '../ActiveTripRadar';
import { AdminBadge } from '../../components/ds/AdminBadge';

// Live driver pin shown on the Control Room map and inspected in the side panel.
export interface LiveDriverPin {
  driverId: string;
  name: string;
  status: string;
  rating: number | null;
  totalTrips: number | null;
  lat: number;
  lng: number;
}

function adminRole(): string {
  return localStorage.getItem('admin_role') ?? 'ADMIN';
}

/* ------------------------------------------------------------------ */
/*  Driver inspection panel (name / rating / trips + Force-offline)     */
/* ------------------------------------------------------------------ */

export function ControlRoomDriverPanel({
  driver,
  onClose,
  onForcedOffline,
}: {
  driver: LiveDriverPin;
  onClose: () => void;
  onForcedOffline: (driverId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleForceOffline = async () => {
    if (!window.confirm(`Force driver ${driver.name || driver.driverId} offline?\n\nThis drops them from the live pool immediately.`)) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${driver.driverId}/force-offline`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Role': adminRole() } }
      );
      if (res.ok) {
        setMsg({ ok: true, text: 'Driver forced offline.' });
        onForcedOffline(driver.driverId);
      } else {
        setMsg({ ok: false, text: 'Force-offline was rejected by the gateway.' });
      }
    } catch {
      setMsg({ ok: false, text: 'Gateway communication failure.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-label-small text-content-tertiary uppercase tracking-wider">Driver</div>
          <h3 className="text-heading-small text-content-primary mt-1">{driver.name || 'Unknown'}</h3>
          <div className="font-mono text-mono-small text-content-tertiary mt-0.5">{driver.driverId}</div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="h-8 w-8 rounded-pill border border-border-opaque bg-background-primary hover:bg-background-tertiary text-content-primary text-xs flex items-center justify-center transition-base cursor-pointer"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2">
        <AdminBadge label={driver.status.replace(/_/g, ' ').toLowerCase()} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <div className="text-label-small text-content-secondary uppercase tracking-wider mb-1">Rating</div>
          <div className="text-heading-medium font-mono text-content-primary">
            {driver.rating != null ? `${driver.rating.toFixed(1)} ★` : '—'}
          </div>
        </div>
        <div className="card">
          <div className="text-label-small text-content-secondary uppercase tracking-wider mb-1">Last trips</div>
          <div className="text-heading-medium font-mono text-content-primary">
            {driver.totalTrips != null ? driver.totalTrips.toLocaleString('en-IN') : '—'}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleForceOffline}
        disabled={busy}
        className="btn-primary w-full"
      >
        {busy ? 'Working…' : 'Force offline'}
      </button>

      {msg && (
        <p className={`text-label-medium ${msg.ok ? 'text-content-positive' : 'text-content-negative'}`}>{msg.text}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Active-trip panel (Force-cancel + Reassign)                         */
/* ------------------------------------------------------------------ */

export function ControlRoomTripPanel({
  order,
  onClose,
  onResolved,
}: {
  order: ActiveOrderRecord;
  onClose: () => void;
  onResolved: (orderId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reassignId, setReassignId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleForceCancel = async () => {
    if (!window.confirm(`Force-cancel trip ${order.id.slice(0, 8)}…?\n\nThis terminates an in-progress trip and releases the driver. This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Role': adminRole() },
        body: JSON.stringify({ order_id: order.id }),
      });
      if (res.ok) {
        setMsg({ ok: true, text: 'Trip cancelled and driver released.' });
        onResolved(order.id);
      } else {
        setMsg({ ok: false, text: 'Force-cancel was rejected by transaction gates.' });
      }
    } catch {
      setMsg({ ok: false, text: 'Gateway communication failure.' });
    } finally {
      setBusy(false);
    }
  };

  const handleReassign = async () => {
    if (!reassignId.trim()) {
      setMsg({ ok: false, text: 'Enter a driver ID to reassign.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${order.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Role': adminRole() },
        body: JSON.stringify({ driver_id: reassignId.trim() }),
      });
      if (res.ok) {
        setMsg({ ok: true, text: 'Trip reassigned.' });
        onResolved(order.id);
      } else {
        setMsg({ ok: false, text: 'Reassignment was rejected by the gateway.' });
      }
    } catch {
      setMsg({ ok: false, text: 'Gateway communication failure.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-label-small text-content-tertiary uppercase tracking-wider">Active trip</div>
          <h3 className="text-heading-small text-content-primary mt-1 font-mono">{order.id.slice(0, 18)}…</h3>
          <div className="flex items-center gap-2 mt-1">
            <AdminBadge label={order.city_prefix} variant="neutral" />
            <AdminBadge label={order.status.replace(/_/g, ' ').toLowerCase()} variant="accent" />
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="h-8 w-8 rounded-pill border border-border-opaque bg-background-primary hover:bg-background-tertiary text-content-primary text-xs flex items-center justify-center transition-base cursor-pointer"
        >
          ✕
        </button>
      </div>

      <div className="card space-y-1">
        <div className="flex justify-between text-label-medium">
          <span className="text-content-secondary">Assigned driver</span>
          <span className="font-mono text-content-primary">{order.assigned_driver_id ? order.assigned_driver_id.slice(0, 12) + '…' : 'Unassigned'}</span>
        </div>
        <div className="flex justify-between text-label-medium">
          <span className="text-content-secondary">Fare</span>
          <span className="font-mono text-content-primary">₹{(order.base_fare_paise / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-label-medium">
          <span className="text-content-secondary">Surge</span>
          <span className="font-mono text-content-primary">{order.surge_multiplier.toFixed(2)}x</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-label-small text-content-secondary uppercase tracking-wider">Reassign to driver</label>
        <input
          value={reassignId}
          onChange={(e) => setReassignId(e.target.value)}
          placeholder="Driver ID"
          className="w-full h-10 px-3 rounded-sm border border-border-opaque bg-background-primary text-content-primary font-mono text-mono-small focus:outline-none focus:border-interactive-primary"
        />
        <button type="button" onClick={handleReassign} disabled={busy} className="btn-primary w-full">
          {busy ? 'Working…' : 'Reassign'}
        </button>
      </div>

      <button
        type="button"
        onClick={handleForceCancel}
        disabled={busy}
        className="w-full h-10 rounded-sm bg-surface-negative border border-negative-400 text-content-negative text-label-medium font-semibold hover:opacity-88 disabled:opacity-40 transition-base cursor-pointer"
      >
        {busy ? 'Working…' : 'Force cancel'}
      </button>

      {msg && (
        <p className={`text-label-medium ${msg.ok ? 'text-content-positive' : 'text-content-negative'}`}>{msg.text}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Manual Dispatch form (POST /admin/orders)                           */
/* ------------------------------------------------------------------ */

export function ManualDispatchForm({ onDispatched }: { onDispatched?: () => void }) {
  const [riderPhone, setRiderPhone] = useState('');
  const [pickupLat, setPickupLat] = useState('22.5726');
  const [pickupLng, setPickupLng] = useState('88.3639');
  const [dropoffLat, setDropoffLat] = useState('22.5855');
  const [dropoffLng, setDropoffLng] = useState('88.4111');
  const [carType, setCarType] = useState('AUTOMATIC');
  const [driverId, setDriverId] = useState('');
  const [cityPrefix, setCityPrefix] = useState('KOL');
  const [fareInr, setFareInr] = useState('350');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      // customer_phone / transmission are surfaced for the operator; the gateway
      // also requires base_fare_paise (paise) and resolves the rider server-side.
      const payload = {
        customer_phone: riderPhone.trim(),
        city_prefix: cityPrefix,
        pickup_lat: parseFloat(pickupLat),
        pickup_lng: parseFloat(pickupLng),
        dropoff_lat: parseFloat(dropoffLat),
        dropoff_lng: parseFloat(dropoffLng),
        transmission: carType,
        base_fare_paise: Math.round(parseFloat(fareInr || '0') * 100),
        assigned_driver_id: driverId.trim() || undefined,
      };
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Role': adminRole() },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setMsg({ ok: true, text: 'Order dispatched.' });
        setRiderPhone('');
        setDriverId('');
        onDispatched?.();
      } else {
        const text = await res.text();
        setMsg({ ok: false, text: `Dispatch failed: ${text || res.status}` });
      }
    } catch {
      setMsg({ ok: false, text: 'Gateway communication failure.' });
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full h-10 px-3 rounded-sm border border-border-opaque bg-background-primary text-content-primary text-label-medium focus:outline-none focus:border-interactive-primary';

  return (
    <form onSubmit={handleSubmit} className="card space-y-3">
      <h3 className="text-heading-small text-content-primary">Manual dispatch</h3>

      <div className="space-y-1">
        <label className="text-label-small text-content-secondary uppercase tracking-wider">Rider phone</label>
        <input value={riderPhone} onChange={(e) => setRiderPhone(e.target.value)} placeholder="+91 …" className={inputCls} required />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-label-small text-content-secondary uppercase tracking-wider">Pickup lat</label>
          <input value={pickupLat} onChange={(e) => setPickupLat(e.target.value)} className={`${inputCls} font-mono text-mono-small`} required />
        </div>
        <div className="space-y-1">
          <label className="text-label-small text-content-secondary uppercase tracking-wider">Pickup lng</label>
          <input value={pickupLng} onChange={(e) => setPickupLng(e.target.value)} className={`${inputCls} font-mono text-mono-small`} required />
        </div>
        <div className="space-y-1">
          <label className="text-label-small text-content-secondary uppercase tracking-wider">Drop lat</label>
          <input value={dropoffLat} onChange={(e) => setDropoffLat(e.target.value)} className={`${inputCls} font-mono text-mono-small`} required />
        </div>
        <div className="space-y-1">
          <label className="text-label-small text-content-secondary uppercase tracking-wider">Drop lng</label>
          <input value={dropoffLng} onChange={(e) => setDropoffLng(e.target.value)} className={`${inputCls} font-mono text-mono-small`} required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-label-small text-content-secondary uppercase tracking-wider">Car</label>
          <select value={carType} onChange={(e) => setCarType(e.target.value)} className={inputCls}>
            <option value="AUTOMATIC">Automatic</option>
            <option value="MANUAL">Manual</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-label-small text-content-secondary uppercase tracking-wider">City</label>
          <input value={cityPrefix} onChange={(e) => setCityPrefix(e.target.value.toUpperCase())} className={`${inputCls} font-mono text-mono-small`} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-label-small text-content-secondary uppercase tracking-wider">Base fare (₹)</label>
        <input value={fareInr} onChange={(e) => setFareInr(e.target.value)} type="number" min="1" className={`${inputCls} font-mono text-mono-small`} required />
      </div>

      <div className="space-y-1">
        <label className="text-label-small text-content-secondary uppercase tracking-wider">Assign driver (optional)</label>
        <input value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="Driver ID" className={`${inputCls} font-mono text-mono-small`} />
      </div>

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? 'Dispatching…' : 'Dispatch order'}
      </button>

      {msg && (
        <p className={`text-label-medium ${msg.ok ? 'text-content-positive' : 'text-content-negative'}`}>{msg.text}</p>
      )}
    </form>
  );
}
