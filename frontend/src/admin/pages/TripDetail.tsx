import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { API_GATEWAY_BASE_URL } from '../../config';
import { AdminBadge } from '../../components/ds/AdminBadge';
import { OdometerVerificationPanel } from '../components/OdometerVerificationPanel';

interface GpsPoint {
  lat: number;
  lng: number;
  captured_at: string;
  speed: number;
}

// Mask a phone for display: keep the last 4 digits only.
const maskPhone = (p: string): string => (p && p.length > 4 ? `•••• •••• ${p.slice(-4)}` : p || '—');
const copyText = (v: string) => { try { void navigator.clipboard.writeText(v); } catch { /* clipboard unavailable */ } };

interface TimelineEvent {
  event: string;
  timestamp: string;
  status: string;
}

interface LatLng {
  lat: number;
  lng: number;
}

interface RiderInfo {
  customer_id: string;
  name: string;
  phone: string;
  trip_count: number;
}

interface DriverInfo {
  driver_id: string;
  name: string;
  phone: string;
  is_verified: boolean;
  trip_count: number;
}

interface VehicleInfo {
  plate: string;
  model: string;
  type: string;
  transmission: string;
}

interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  night: number;
  surge: number;
  care: number;
  promo: number;
  tax: number;
  total: number;
}

interface PaymentAttempt {
  timestamp: string;
  status: string;
  amount: number;
  txn_id: string;
  provider: string;
}

interface ComplaintItem {
  id: string;
  title: string;
  category: string;
  status: string;
  severity: string;
  agent: string;
}

// Forensic audit trail (GET /admin/orders/{id}/forensic-audit).
interface ForensicAudit {
  order_id: string;
  driver_id: string;
  offer_timestamps: Record<string, unknown>;
  odometer_inputs: Record<string, unknown>;
  route_metrics: Record<string, unknown>;
  hardware_state: Record<string, unknown>;
  final_invoice: Record<string, unknown>;
  captured_at: string;
}

// Driver pool entry (GET /admin/drivers).
interface DriverPoolItem {
  driver_id: string;
  name: string;
  phone: string;
  city_prefix: string;
  status: string;
  [key: string]: unknown;
}

interface TripDetailResponse {
  trip: {
    id: string;
    city_prefix: string;
    customer_id: string;
    status: string;
    pickup_lat: number;
    pickup_lng: number;
    dropoff_lat: number;
    dropoff_lng: number;
    pickup_h3_cell: string;
    surge_multiplier: number;
    base_fare_paise: number;
    created_at: string;
    assigned_at: string | null;
    trip_type: string;
    car_type: string;
    transmission: string;
    payment_method: string;
    promo_applied: string;
    d4m_care: boolean;
    rating: number;
    plate: string;
    driver_name: string;
  };
  timeline: TimelineEvent[];
  polyline: LatLng[];
  rider: RiderInfo;
  driver: DriverInfo | null;
  vehicle: VehicleInfo;
  fare_breakdown: FareBreakdown;
  payment_attempts: PaymentAttempt[];
  issues: ComplaintItem[];
}

// Destructive-action descriptors, fed into the shared confirm modal.
type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  requireReason: boolean;
  run: (reason: string) => Promise<boolean>;
};

export const TripDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TripDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [gpsTrail, setGpsTrail] = useState<GpsPoint[]>([]);

  // Toast (lightweight, inline — no shared admin toast exists).
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const showToast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // Confirm modal state (reason input + loading).
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmReason, setConfirmReason] = useState<string>('');

  // Reassign picker.
  const [showReassignModal, setShowReassignModal] = useState<boolean>(false);
  const [reassignDriverId, setReassignDriverId] = useState<string>('');
  const [driverPool, setDriverPool] = useState<DriverPoolItem[]>([]);
  const [poolLoading, setPoolLoading] = useState<boolean>(false);

  // Adjustment console.
  const [adjustmentAmt, setAdjustmentAmt] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<string>('refund');
  const [adjustmentReason, setAdjustmentReason] = useState<string>('');

  // Forensic audit.
  const [audit, setAudit] = useState<ForensicAudit | null>(null);
  const [auditLoading, setAuditLoading] = useState<boolean>(true);

  const role = () => localStorage.getItem('admin_role') || 'ADMIN';

  useEffect(() => {
    fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${id}/gps-trail`, { headers: { 'X-Admin-Role': role() } })
      .then((r) => (r.ok ? r.json() : { trail: [] }))
      .then((d) => setGpsTrail(d.trail || []))
      .catch(() => setGpsTrail([]));
  }, [id]);

  // Resolve map geometry: prefer real GPS breadcrumbs, fall back to trip pickup/drop.
  const mapData = useMemo(() => {
    const t = data?.trip;
    const trailPos = gpsTrail.map((p) => [p.lat, p.lng] as [number, number]);
    const validPickup = t && t.pickup_lat && t.pickup_lng ? ([t.pickup_lat, t.pickup_lng] as [number, number]) : null;
    const validDrop = t && t.dropoff_lat && t.dropoff_lng ? ([t.dropoff_lat, t.dropoff_lng] as [number, number]) : null;
    const pickup = validPickup ?? trailPos[0] ?? null;
    const drop = validDrop ?? trailPos[trailPos.length - 1] ?? null;
    const center = pickup ?? ([22.5726, 88.3639] as [number, number]);
    return { trailPos, pickup, drop, center, hasGeo: Boolean(pickup || trailPos.length) };
  }, [data, gpsTrail]);

  const fetchTripDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${id}`, {
        headers: { 'X-Admin-Role': role() },
      });
      if (res.ok) {
        const payload = await res.json();
        setData(payload);
      }
    } catch (err) {
      console.error('Failed to load trip details', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTripDetail();
  }, [fetchTripDetail]);

  // Forensic audit tab.
  useEffect(() => {
    setAuditLoading(true);
    fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${id}/forensic-audit`, { headers: { 'X-Admin-Role': role() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAudit(d))
      .catch(() => setAudit(null))
      .finally(() => setAuditLoading(false));
  }, [id]);

  // Generic per-id POST action helper. Returns whether it succeeded.
  const postAction = useCallback(async (actionPath: string, payload?: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${id}/${actionPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Role': role() },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) {
      const errMsg = await res.text();
      throw new Error(errMsg || `Action '${actionPath}' failed`);
    }
    return true;
  }, [id]);

  // Cancel uses the collection route POST /admin/orders/cancel with body { order_id }.
  const cancelOrder = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Role': role() },
      body: JSON.stringify({ order_id: id }),
    });
    if (!res.ok) {
      const errMsg = await res.text();
      throw new Error(errMsg || 'Cancellation failed');
    }
    return true;
  }, [id]);

  // Open the shared confirm modal for a destructive action.
  const openConfirm = (action: ConfirmAction) => {
    setConfirmReason('');
    setConfirmAction(action);
  };

  const runConfirm = async () => {
    if (!confirmAction) return;
    if (confirmAction.requireReason && !confirmReason.trim()) {
      showToast('A reason is required.', 'err');
      return;
    }
    setActionLoading(true);
    try {
      await confirmAction.run(confirmReason.trim());
      showToast(`${confirmAction.title} completed.`, 'ok');
      setConfirmAction(null);
      setConfirmReason('');
      await fetchTripDetail();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed.', 'err');
    } finally {
      setActionLoading(false);
    }
  };

  const ADJUSTMENT_TYPE_MAP: Record<string, string> = {
    refund: 'PARTIAL_REFUND',
    full_refund: 'FULL_REFUND',
    waive: 'WAIVE_FEE',
    bonus: 'ADD_BONUS',
  };

  // Fare adjustment routes through the same confirm modal (reason + loading + toast + refresh).
  const requestAdjustment = () => {
    const isFullRefund = adjustmentType === 'full_refund';
    const amt = Number(adjustmentAmt);
    if (!isFullRefund && (!adjustmentAmt.trim() || isNaN(amt) || amt <= 0)) {
      showToast('Enter a valid positive amount.', 'err');
      return;
    }
    if (!adjustmentReason.trim()) {
      showToast('A reason is required for any fare adjustment.', 'err');
      return;
    }
    const total = data?.fare_breakdown.total ?? 0;
    const amountPaise = isFullRefund ? Math.round(total * 100) : Math.round(amt * 100);
    openConfirm({
      title: 'Fare adjustment',
      description: `Apply ${ADJUSTMENT_TYPE_MAP[adjustmentType]} of ₹${(amountPaise / 100).toFixed(2)} to this order? This posts an audited ledger entry.`,
      confirmLabel: 'Apply Adjustment',
      destructive: true,
      requireReason: false,
      run: async () => {
        await postAction('adjust', {
          adjustment_type: ADJUSTMENT_TYPE_MAP[adjustmentType],
          amount_paise: amountPaise,
          reason: adjustmentReason.trim(),
        });
        setAdjustmentAmt('');
        setAdjustmentReason('');
        return true;
      },
    });
  };

  // Reassign driver picker: load the live driver pool from GET /admin/drivers.
  const openReassign = () => {
    setReassignDriverId('');
    setShowReassignModal(true);
    setPoolLoading(true);
    fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers?status=ACTIVE`, { headers: { 'X-Admin-Role': role() } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: DriverPoolItem[]) => setDriverPool(d || []))
      .catch(() => setDriverPool([]))
      .finally(() => setPoolLoading(false));
  };

  const handleReassignDriver = async () => {
    if (!reassignDriverId) return;
    setActionLoading(true);
    try {
      await postAction('reassign', { driver_id: reassignDriverId });
      showToast('Driver reassigned.', 'ok');
      setShowReassignModal(false);
      setReassignDriverId('');
      await fetchTripDetail();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Reassign failed.', 'err');
    } finally {
      setActionLoading(false);
    }
  };

  // Non-destructive Send Invoice keeps a plain click + toast.
  const handleSendInvoice = async () => {
    setActionLoading(true);
    try {
      await postAction('send-invoice');
      showToast('Invoice queued for transmission.', 'ok');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Send invoice failed.', 'err');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-sm text-content-tertiary animate-pulse">Loading trip ledger details…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="text-lg font-bold text-content-primary mb-1">Trip Record Missing</div>
        <p className="text-xs text-content-tertiary max-w-sm">The requested Order UUID does not exist or you do not have permission to view it.</p>
        <Link to="/trips" className="mt-4 text-xs font-semibold text-content-primary underline">Back to Trips List</Link>
      </div>
    );
  }

  const { trip, timeline, polyline: _polyline, rider, driver, vehicle, fare_breakdown, payment_attempts, issues } = data;

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-6">
      {/* ---- Header & Actions ---- */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-background-secondary pb-4 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Link to="/trips" className="text-xs text-content-tertiary hover:text-content-primary font-medium">Trips</Link>
            <span className="text-xs text-content-tertiary font-mono">/</span>
            <span className="text-xs text-content-primary font-semibold font-mono">TRP-{trip.city_prefix}-{trip.id.substring(trip.id.length - 4).toUpperCase()}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-content-primary mt-1 font-mono">{trip.id}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openConfirm({
              title: 'Reopen trip',
              description: 'Reopen this trip? It returns to CREATED and the driver is unassigned.',
              confirmLabel: 'Reopen Trip',
              destructive: false,
              requireReason: false,
              run: () => postAction('reopen'),
            })}
            disabled={actionLoading || (trip.status !== 'CANCELLED' && trip.status !== 'COMPLETED')}
            className="text-[11px] font-semibold bg-background-secondary hover:bg-background-tertiary text-content-primary rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Reopen Trip
          </button>
          <button
            onClick={openReassign}
            disabled={actionLoading || trip.status === 'COMPLETED' || trip.status === 'CANCELLED'}
            className="text-[11px] font-semibold bg-background-secondary hover:bg-background-tertiary text-content-primary rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Reassign Driver
          </button>
          <button
            onClick={handleSendInvoice}
            disabled={actionLoading}
            className="text-[11px] font-semibold bg-background-secondary hover:bg-background-tertiary text-content-primary rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Send Invoice
          </button>
          <button
            onClick={() => openConfirm({
              title: 'Mark fraudulent',
              description: 'Mark this trip as fraudulent? It cancels the order and suspends the assigned driver.',
              confirmLabel: 'Mark Fraudulent',
              destructive: true,
              requireReason: true,
              run: () => postAction('fraud'),
            })}
            disabled={actionLoading || trip.status === 'CANCELLED'}
            className="text-[11px] font-semibold bg-background-secondary hover:bg-background-tertiary text-content-primary rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Mark Fraudulent
          </button>
          <button
            onClick={() => openConfirm({
              title: 'Cancel trip',
              description: 'Cancel this trip? This frees the assigned driver. The rider may need a manual refund.',
              confirmLabel: 'Cancel Trip',
              destructive: true,
              requireReason: true,
              run: () => cancelOrder(),
            })}
            disabled={actionLoading || trip.status === 'CANCELLED'}
            className="text-[11px] font-semibold bg-content-primary hover:bg-gray-800 text-gray-0 rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Cancel Trip
          </button>
        </div>
      </div>

      {/* ---- Split Layout ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Side (3/5 width) */}
        <div className="lg:col-span-3 space-y-6">

          {/* Map Vector Polyline */}
          <div className="bg-background-primary rounded-xl border border-background-secondary overflow-hidden">
            <div className="border-b border-background-secondary px-4 py-3 flex justify-between items-center">
              <span className="text-xs font-bold text-content-primary uppercase tracking-wider">Route Trajectory</span>
              <span className="text-[10px] text-content-tertiary font-mono">H3 Cell: {trip.pickup_h3_cell}</span>
            </div>
            <div className="h-72 relative">
              {mapData.hasGeo ? (
                <MapContainer
                  key={`${id}-${gpsTrail.length}`}
                  center={mapData.center}
                  zoom={14}
                  scrollWheelZoom={false}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {mapData.trailPos.length > 1 && (
                    <Polyline positions={mapData.trailPos} pathOptions={{ color: 'var(--accent-400)', weight: 4 }} />
                  )}
                  {mapData.pickup && (
                    <CircleMarker center={mapData.pickup} radius={8} pathOptions={{ color: 'var(--positive-400)', fillColor: 'var(--positive-400)', fillOpacity: 1 }}>
                      <Popup>Pickup</Popup>
                    </CircleMarker>
                  )}
                  {mapData.drop && (
                    <CircleMarker center={mapData.drop} radius={8} pathOptions={{ color: 'var(--negative-400)', fillColor: 'var(--negative-400)', fillOpacity: 1 }}>
                      <Popup>Drop-off</Popup>
                    </CircleMarker>
                  )}
                </MapContainer>
              ) : (
                <div className="h-full bg-background-secondary flex items-center justify-center text-xs text-content-tertiary">
                  No GPS breadcrumbs recorded for this trip.
                </div>
              )}
            </div>
          </div>

          {/* Vertical Timeline Progress */}
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-4">
            <h2 className="text-xs font-bold text-content-primary uppercase tracking-wider">Trip Progression Timeline</h2>
            <div className="relative border-l border-background-secondary ml-3 pl-6 space-y-5 py-2">
              {timeline.map((event, idx) => (
                <div key={event.event} className="relative">
                  {/* Step Dot */}
                  <span className="absolute -left-[31px] top-1 bg-content-primary text-gray-0 rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold border-2 border-background-primary font-mono">
                    {idx + 1}
                  </span>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-bold text-content-primary">{event.event}</h4>
                      <p className="text-[10px] text-content-tertiary mt-0.5">Status: <span className="capitalize">{event.status}</span></p>
                    </div>
                    <span className="text-[10px] text-content-tertiary font-mono bg-background-secondary px-2 py-0.5 rounded-pill">
                      {new Date(event.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
              {timeline.length < 8 && trip.status !== 'CANCELLED' && (
                <div className="relative opacity-40">
                  <span className="absolute -left-[31px] top-1 bg-background-secondary text-content-secondary rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold border-2 border-background-primary font-mono">
                    {timeline.length + 1}
                  </span>
                  <h4 className="text-xs font-medium text-content-secondary">Next Lifecycle Step</h4>
                  <p className="text-[10px] text-content-tertiary mt-0.5">Pending system updates</p>
                </div>
              )}
            </div>
          </div>

          {/* Connected Parties */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Rider Card */}
            <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-3">
              <span className="text-[10px] font-bold text-content-tertiary uppercase tracking-wider block">Rider</span>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-background-secondary flex items-center justify-center font-bold text-content-primary">
                  R
                </div>
                <div>
                  <h4 className="text-xs font-bold text-content-primary">{rider.name}</h4>
                  <p className="text-[11px] text-content-tertiary font-mono flex items-center gap-1.5">
                    {maskPhone(rider.phone)}
                    <button onClick={() => copyText(rider.phone)} title="Copy phone" className="text-[10px] hover:text-content-primary">⧉</button>
                  </p>
                </div>
              </div>
              <div className="border-t border-background-secondary pt-2.5 flex justify-between text-[11px]">
                <span className="text-content-tertiary">Customer ID</span>
                <span className="font-mono text-content-primary font-semibold truncate max-w-[120px]">{rider.customer_id}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-content-tertiary">Total Orders</span>
                <span className="font-mono text-content-primary font-semibold">{rider.trip_count}</span>
              </div>
            </div>

            {/* Driver Card */}
            <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-3">
              <span className="text-[10px] font-bold text-content-tertiary uppercase tracking-wider block">Driver</span>
              {driver ? (
                <>
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-background-secondary flex items-center justify-center font-bold text-content-primary">
                      D
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-content-primary">{driver.name}</h4>
                      <p className="text-[11px] text-content-tertiary font-mono flex items-center gap-1.5">
                        {maskPhone(driver.phone)}
                        <button onClick={() => copyText(driver.phone)} title="Copy phone" className="text-[10px] hover:text-content-primary">⧉</button>
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-background-secondary pt-2.5 flex justify-between text-[11px]">
                    <span className="text-content-tertiary">Verification</span>
                    <span className="font-mono text-content-primary font-semibold">
                      {driver.is_verified ? (
                        <span className="text-content-positive">Verified</span>
                      ) : (
                        <span className="text-content-warning">Pending KYC</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-content-tertiary">Platform Trips</span>
                    <span className="font-mono text-content-primary font-semibold">{driver.trip_count}</span>
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-center p-4">
                  <span className="text-xs text-content-tertiary">No driver assigned to this order</span>
                </div>
              )}
            </div>
          </div>

          {/* Vehicle Info */}
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-3">
            <h2 className="text-xs font-bold text-content-primary uppercase tracking-wider">Vehicle Utilized</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
              <div>
                <span className="text-[10px] uppercase text-content-tertiary font-semibold">Model</span>
                <span className="block text-xs font-bold text-content-primary mt-0.5">{vehicle.model}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-content-tertiary font-semibold">Classification</span>
                <span className="block text-xs font-bold text-content-primary mt-0.5">{vehicle.type}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-content-tertiary font-semibold">Plate Number</span>
                <span className="block text-xs font-bold font-mono text-content-primary mt-0.5">{vehicle.plate}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-content-tertiary font-semibold">Transmission</span>
                <span className="block text-xs font-bold text-content-primary mt-0.5">{vehicle.transmission}</span>
              </div>
            </div>

            {/* Odometer / mileage forensic audit (was orphaned). */}
            {id && <OdometerVerificationPanel orderId={id} />}
          </div>

        </div>

        {/* Right Side (2/5 width) */}
        <div className="lg:col-span-2 space-y-6">

          {/* Fare Breakdown */}
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-4">
            <h2 className="text-xs font-bold text-content-primary uppercase tracking-wider">Fare Breakdown</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-content-secondary">Base Fare</span>
                <span className="font-mono text-content-primary">₹{fare_breakdown.base.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-content-secondary">Distance Fare</span>
                <span className="font-mono text-content-primary">₹{fare_breakdown.distance.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-content-secondary">Time Fare</span>
                <span className="font-mono text-content-primary">₹{fare_breakdown.time.toFixed(2)}</span>
              </div>
              {fare_breakdown.night > 0 && (
                <div className="flex justify-between">
                  <span className="text-content-secondary">Night Charge</span>
                  <span className="font-mono text-content-primary">₹{fare_breakdown.night.toFixed(2)}</span>
                </div>
              )}
              {fare_breakdown.surge > 0 && (
                <div className="flex justify-between">
                  <span className="text-content-secondary">Surge Multiplier (x{trip.surge_multiplier})</span>
                  <span className="font-mono text-content-primary">₹{fare_breakdown.surge.toFixed(2)}</span>
                </div>
              )}
              {fare_breakdown.care > 0 && (
                <div className="flex justify-between">
                  <span className="text-content-secondary">D4M Care protection fee</span>
                  <span className="font-mono text-content-primary">₹{fare_breakdown.care.toFixed(2)}</span>
                </div>
              )}
              {fare_breakdown.promo < 0 && (
                <div className="flex justify-between">
                  <span className="text-content-secondary">Promo applied ({trip.promo_applied})</span>
                  <span className="font-mono text-content-primary">₹{fare_breakdown.promo.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-content-secondary">GST tax (5%)</span>
                <span className="font-mono text-content-primary">₹{fare_breakdown.tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-background-secondary pt-2.5 font-bold text-sm text-content-primary">
                <span>Total Fare</span>
                <span className="font-mono">₹{fare_breakdown.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Adjustments Form */}
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-4">
            <h2 className="text-xs font-bold text-content-primary uppercase tracking-wider">Adjustment Console</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Adjustment Type</label>
                <div className="grid grid-cols-2 gap-1 bg-background-secondary p-0.5 rounded-pill border border-background-secondary">
                  <button
                    onClick={() => setAdjustmentType('refund')}
                    className={`text-[10px] font-semibold h-7 rounded-pill transition-colors ${
                      adjustmentType === 'refund' ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                    }`}
                  >
                    Partial Refund
                  </button>
                  <button
                    onClick={() => setAdjustmentType('full_refund')}
                    className={`text-[10px] font-semibold h-7 rounded-pill transition-colors ${
                      adjustmentType === 'full_refund' ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                    }`}
                  >
                    Full Refund
                  </button>
                  <button
                    onClick={() => setAdjustmentType('waive')}
                    className={`text-[10px] font-semibold h-7 rounded-pill transition-colors ${
                      adjustmentType === 'waive' ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                    }`}
                  >
                    Waive Fee
                  </button>
                  <button
                    onClick={() => setAdjustmentType('bonus')}
                    className={`text-[10px] font-semibold h-7 rounded-pill transition-colors ${
                      adjustmentType === 'bonus' ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                    }`}
                  >
                    Add Bonus
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">
                  Amount (INR){adjustmentType === 'full_refund' && <span className="text-content-tertiary normal-case"> — preset to total ₹{fare_breakdown.total.toFixed(2)}</span>}
                </label>
                <input
                  type="text"
                  placeholder="₹0.00"
                  disabled={adjustmentType === 'full_refund'}
                  className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono disabled:opacity-50"
                  value={adjustmentType === 'full_refund' ? fare_breakdown.total.toFixed(2) : adjustmentAmt}
                  onChange={(e) => setAdjustmentAmt(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Reason (required, audited)</label>
                <input
                  type="text"
                  placeholder="e.g. Rider overcharged on surge"
                  className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary"
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                />
              </div>
              <button
                onClick={requestAdjustment}
                disabled={actionLoading}
                className="w-full bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 hover:bg-gray-800 transition-colors disabled:opacity-40"
              >
                Apply Adjustment
              </button>
            </div>
          </div>

          {/* Payment Attempts */}
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-3">
            <h2 className="text-xs font-bold text-content-primary uppercase tracking-wider">Payment History</h2>
            <div className="space-y-3 divide-y divide-background-secondary">
              {payment_attempts.map((attempt) => (
                <div key={attempt.txn_id} className="pt-2.5 first:pt-0 flex justify-between items-start text-xs">
                  <div>
                    <span className="font-mono block font-bold text-content-primary">{attempt.txn_id}</span>
                    <span className="text-[10px] text-content-tertiary block mt-0.5">
                      {new Date(attempt.timestamp).toLocaleString()} ({attempt.provider})
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono block text-content-primary font-semibold">₹{attempt.amount.toFixed(2)}</span>
                    <AdminBadge label={attempt.status.toLowerCase()} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Issues */}
          {issues.length > 0 && (
            <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-3">
              <h2 className="text-xs font-bold text-content-primary uppercase tracking-wider">Associated Complaints</h2>
              <div className="space-y-3">
                {issues.map((issue) => (
                  <div key={issue.id} className="bg-background-secondary border border-background-secondary rounded-lg p-3 space-y-1.5">
                    <div className="flex justify-between items-center text-[10px] font-mono">
                      <span className="font-bold text-content-primary">{issue.id}</span>
                      <span className="text-content-negative font-bold uppercase">{issue.severity}</span>
                    </div>
                    <h4 className="text-xs font-bold text-content-primary">{issue.title}</h4>
                    <div className="flex justify-between text-[10px] text-content-tertiary">
                      <span>Category: {issue.category}</span>
                      <span>Assignee: {issue.agent}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Forensic Audit (GET /admin/orders/{id}/forensic-audit) */}
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 space-y-3">
            <h2 className="text-xs font-bold text-content-primary uppercase tracking-wider">Forensic Audit Trail</h2>
            {auditLoading ? (
              <div className="text-[11px] text-content-tertiary font-mono animate-pulse py-2">Compiling forensic audit…</div>
            ) : !audit ? (
              <div className="text-[11px] text-content-tertiary py-2">No forensic audit available for this trip.</div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {([
                  { label: 'Offer Timestamps', obj: audit.offer_timestamps },
                  { label: 'Odometer Inputs', obj: audit.odometer_inputs },
                  { label: 'Route Metrics', obj: audit.route_metrics },
                  { label: 'Hardware State', obj: audit.hardware_state },
                  { label: 'Final Invoice', obj: audit.final_invoice },
                ] as const).map((section) => (
                  <div key={section.label}>
                    <h4 className="text-[10px] font-bold text-content-secondary uppercase tracking-wider mb-1">{section.label}</h4>
                    <div className="space-y-1">
                      {Object.entries(section.obj || {}).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-[10px]">
                          <span className="text-content-tertiary">{k.replace(/_/g, ' ')}</span>
                          <span className="font-mono text-content-primary text-right truncate max-w-[160px]">{String(v ?? '—')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="text-[9px] text-content-tertiary font-mono pt-1 border-t border-background-secondary">
                  Captured: {new Date(audit.captured_at).toLocaleString()}
                </div>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* ---- Confirm Modal (shared for destructive actions) ---- */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-content-primary">{confirmAction.title}</h3>
              <p className="text-xs text-content-tertiary mt-1">{confirmAction.description}</p>
            </div>
            {confirmAction.requireReason && (
              <div>
                <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Reason (required, audited)</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. Rider no-show / fraud signal"
                  className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary"
                  value={confirmReason}
                  onChange={(e) => setConfirmReason(e.target.value)}
                />
              </div>
            )}
            <div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
              <button
                onClick={() => { setConfirmAction(null); setConfirmReason(''); }}
                disabled={actionLoading}
                className="text-xs text-content-secondary hover:text-content-primary px-3"
              >
                Cancel
              </button>
              <button
                onClick={runConfirm}
                disabled={actionLoading || (confirmAction.requireReason && !confirmReason.trim())}
                className={`text-xs font-semibold rounded-pill h-8 px-4 transition-colors disabled:opacity-40 ${
                  confirmAction.destructive
                    ? 'bg-negative-400 text-white hover:bg-negative-500'
                    : 'bg-content-primary text-gray-0 hover:bg-gray-800'
                }`}
              >
                {actionLoading ? 'Working…' : confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Reassign Driver Modal (driver picker) ---- */}
      {showReassignModal && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-content-primary">Reassign Driver</h3>
              <p className="text-xs text-content-tertiary mt-1">Select an active driver to reassign this order</p>
            </div>
            {poolLoading ? (
              <div className="py-8 text-center text-xs text-content-tertiary animate-pulse">Loading driver pool…</div>
            ) : driverPool.length === 0 ? (
              <div className="py-8 text-center text-xs text-content-tertiary">No active drivers available.</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {driverPool.map((drv) => (
                  <button
                    key={drv.driver_id}
                    onClick={() => setReassignDriverId(drv.driver_id)}
                    className={`w-full text-left p-3 rounded-xl border flex justify-between items-center text-xs transition-colors ${
                      reassignDriverId === drv.driver_id
                        ? 'border-content-primary bg-background-tertiary font-bold'
                        : 'border-background-secondary hover:bg-background-tertiary/50'
                    }`}
                  >
                    <div>
                      <span className="block text-content-primary">{drv.name}</span>
                      <span className="block text-[10px] text-content-tertiary font-mono">{drv.phone}</span>
                    </div>
                    <span className="text-[10px] font-mono text-content-tertiary">{drv.city_prefix}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
              <button
                onClick={() => { setShowReassignModal(false); setReassignDriverId(''); }}
                disabled={actionLoading}
                className="text-xs text-content-secondary hover:text-content-primary px-3"
              >
                Cancel
              </button>
              <button
                onClick={handleReassignDriver}
                className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors disabled:opacity-40"
                disabled={actionLoading || !reassignDriverId}
              >
                {actionLoading ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Toast ---- */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] animate-fade-in">
          <div className={`rounded-pill px-4 py-2.5 text-xs font-semibold shadow-xl border ${
            toast.kind === 'ok'
              ? 'bg-surface-positive text-content-positive border-positive-400'
              : 'bg-surface-negative text-content-negative border-negative-400'
          }`}>
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
};
