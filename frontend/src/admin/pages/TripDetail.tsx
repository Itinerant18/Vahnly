import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { API_GATEWAY_BASE_URL } from '../../config';

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

interface AuditLogItem {
  timestamp: string;
  action: string;
  actor: string;
  details: string;
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
  audit_logs: AuditLogItem[];
}

export const TripDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TripDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [showReassignModal, setShowReassignModal] = useState<boolean>(false);
  const [reassignDriverId, setReassignDriverId] = useState<string>('');
  const [adjustmentAmt, setAdjustmentAmt] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<string>('refund');
  const [adjustmentReason, setAdjustmentReason] = useState<string>('');
  const [gpsTrail, setGpsTrail] = useState<GpsPoint[]>([]);

  useEffect(() => {
    const role = localStorage.getItem('admin_role') || 'ADMIN';
    fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${id}/gps-trail`, { headers: { 'X-Admin-Role': role } })
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

  const fetchTripDetail = async () => {
    setLoading(true);
    try {
      const role = localStorage.getItem('admin_role') || 'ADMIN';

      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${id}`, {
        headers: {
          'X-Admin-Role': role,
        },
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
  };

  useEffect(() => {
    fetchTripDetail();
  }, [id]);

  const handleAdminAction = async (actionPath: string, payload?: any) => {
    setActionLoading(true);
    try {
      const role = localStorage.getItem('admin_role') || 'ADMIN';

      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${id}/${actionPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Role': role,
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });

      if (res.ok) {
        alert(`Action '${actionPath}' executed successfully.`);
        fetchTripDetail();
      } else {
        const errMsg = await res.text();
        alert(`Action failed: ${errMsg}`);
      }
    } catch (err) {
      console.error(err);
      alert('Network request execution failure.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReassignDriver = () => {
    if (!reassignDriverId.trim()) return;
    handleAdminAction('reassign', { driver_id: reassignDriverId });
    setShowReassignModal(false);
    setReassignDriverId('');
  };

  const ADJUSTMENT_TYPE_MAP: Record<string, string> = {
    refund: 'PARTIAL_REFUND',
    waive: 'WAIVE_FEE',
    bonus: 'ADD_BONUS',
  };

  const handleApplyAdjustment = async () => {
    const amt = Number(adjustmentAmt);
    if (!adjustmentAmt.trim() || isNaN(amt) || amt <= 0) {
      alert('Please enter a valid positive amount.');
      return;
    }
    if (!adjustmentReason.trim()) {
      alert('A reason is required for any fare adjustment.');
      return;
    }
    await handleAdminAction('adjust', {
      adjustment_type: ADJUSTMENT_TYPE_MAP[adjustmentType],
      amount_paise: Math.round(amt * 100),
      reason: adjustmentReason,
    });
    setAdjustmentAmt('');
    setAdjustmentReason('');
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-sm text-mute animate-pulse">Loading trip ledger details…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="text-lg font-bold text-ink mb-1">Trip Record Missing</div>
        <p className="text-xs text-mute max-w-sm">The requested Order UUID does not exist or you do not have permission to view it.</p>
        <Link to="/trips" className="mt-4 text-xs font-semibold text-ink underline">Back to Trips List</Link>
      </div>
    );
  }

  const { trip, timeline, polyline: _polyline, rider, driver, vehicle, fare_breakdown, payment_attempts, issues, audit_logs } = data;

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-6">
      {/* ---- Header & Actions ---- */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-canvas-soft pb-4 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Link to="/trips" className="text-xs text-mute hover:text-ink font-medium">Trips</Link>
            <span className="text-xs text-mute font-mono">/</span>
            <span className="text-xs text-ink font-semibold font-mono">TRP-{trip.city_prefix}-{trip.id.substring(trip.id.length - 4).toUpperCase()}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink mt-1 font-mono">{trip.id}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleAdminAction('reopen')}
            disabled={actionLoading || trip.status !== 'CANCELLED' && trip.status !== 'COMPLETED'}
            className="text-[11px] font-semibold bg-canvas-soft hover:bg-canvas-softer text-ink rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Reopen Trip
          </button>
          <button
            onClick={() => setShowReassignModal(true)}
            disabled={actionLoading || trip.status === 'COMPLETED' || trip.status === 'CANCELLED'}
            className="text-[11px] font-semibold bg-canvas-soft hover:bg-canvas-softer text-ink rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Reassign Driver
          </button>
          <button
            onClick={() => handleAdminAction('send-invoice')}
            disabled={actionLoading}
            className="text-[11px] font-semibold bg-canvas-soft hover:bg-canvas-softer text-ink rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Send Invoice
          </button>
          <button
            onClick={() => handleAdminAction('fraud')}
            disabled={actionLoading || trip.status === 'CANCELLED'}
            className="text-[11px] font-semibold bg-canvas-soft hover:bg-canvas-softer text-ink rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Mark Fraudulent
          </button>
          <button
            onClick={() => handleAdminAction('cancel')}
            disabled={actionLoading || trip.status === 'CANCELLED'}
            className="text-[11px] font-semibold bg-ink hover:bg-black-elevated text-on-dark rounded-pill h-8 px-3.5 transition-colors disabled:opacity-40"
          >
            Cancel & Refund
          </button>
        </div>
      </div>

      {/* ---- Split Layout ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Left Side (3/5 width) */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Map Vector Polyline */}
          <div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden">
            <div className="border-b border-canvas-soft px-4 py-3 flex justify-between items-center">
              <span className="text-xs font-bold text-ink uppercase tracking-wider">Route Trajectory</span>
              <span className="text-[10px] text-mute font-mono">H3 Cell: {trip.pickup_h3_cell}</span>
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
                    <Polyline positions={mapData.trailPos} pathOptions={{ color: '#0073E6', weight: 4 }} />
                  )}
                  {mapData.pickup && (
                    <CircleMarker center={mapData.pickup} radius={8} pathOptions={{ color: '#138000', fillColor: '#138000', fillOpacity: 1 }}>
                      <Popup>Pickup</Popup>
                    </CircleMarker>
                  )}
                  {mapData.drop && (
                    <CircleMarker center={mapData.drop} radius={8} pathOptions={{ color: '#b00020', fillColor: '#b00020', fillOpacity: 1 }}>
                      <Popup>Drop-off</Popup>
                    </CircleMarker>
                  )}
                </MapContainer>
              ) : (
                <div className="h-full bg-canvas-soft flex items-center justify-center text-xs text-mute">
                  No GPS breadcrumbs recorded for this trip.
                </div>
              )}
            </div>
          </div>

          {/* Vertical Timeline Progress */}
          <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-4">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">Trip Progression Timeline</h2>
            <div className="relative border-l border-canvas-soft ml-3 pl-6 space-y-5 py-2">
              {timeline.map((event, idx) => (
                <div key={event.event} className="relative">
                  {/* Step Dot */}
                  <span className="absolute -left-[31px] top-1 bg-ink text-on-dark rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold border-2 border-canvas font-mono">
                    {idx + 1}
                  </span>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-bold text-ink">{event.event}</h4>
                      <p className="text-[10px] text-mute mt-0.5">Status: <span className="capitalize">{event.status}</span></p>
                    </div>
                    <span className="text-[10px] text-mute font-mono bg-canvas-soft px-2 py-0.5 rounded-pill">
                      {new Date(event.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
              {timeline.length < 8 && trip.status !== 'CANCELLED' && (
                <div className="relative opacity-40">
                  <span className="absolute -left-[31px] top-1 bg-canvas-soft text-body rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold border-2 border-canvas font-mono">
                    {timeline.length + 1}
                  </span>
                  <h4 className="text-xs font-medium text-body">Next Lifecycle Step</h4>
                  <p className="text-[10px] text-mute mt-0.5">Pending system updates</p>
                </div>
              )}
            </div>
          </div>

          {/* Connected Parties */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Rider Card */}
            <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-3">
              <span className="text-[10px] font-bold text-mute uppercase tracking-wider block">Rider</span>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-canvas-soft flex items-center justify-center font-bold text-ink">
                  R
                </div>
                <div>
                  <h4 className="text-xs font-bold text-ink">{rider.name}</h4>
                  <p className="text-[11px] text-mute font-mono flex items-center gap-1.5">
                    {maskPhone(rider.phone)}
                    <button onClick={() => copyText(rider.phone)} title="Copy phone" className="text-[10px] hover:text-ink">⧉</button>
                  </p>
                </div>
              </div>
              <div className="border-t border-canvas-soft pt-2.5 flex justify-between text-[11px]">
                <span className="text-mute">Customer ID</span>
                <span className="font-mono text-ink font-semibold truncate max-w-[120px]">{rider.customer_id}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-mute">Total Orders</span>
                <span className="font-mono text-ink font-semibold">{rider.trip_count}</span>
              </div>
            </div>

            {/* Driver Card */}
            <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-3">
              <span className="text-[10px] font-bold text-mute uppercase tracking-wider block">Driver</span>
              {driver ? (
                <>
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-canvas-soft flex items-center justify-center font-bold text-ink">
                      D
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-ink">{driver.name}</h4>
                      <p className="text-[11px] text-mute font-mono flex items-center gap-1.5">
                        {maskPhone(driver.phone)}
                        <button onClick={() => copyText(driver.phone)} title="Copy phone" className="text-[10px] hover:text-ink">⧉</button>
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-canvas-soft pt-2.5 flex justify-between text-[11px]">
                    <span className="text-mute">Verification</span>
                    <span className="font-mono text-ink font-semibold">
                      {driver.is_verified ? (
                        <span className="text-[#138000]">Verified</span>
                      ) : (
                        <span className="text-[#a06000]">Pending KYC</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-mute">Platform Trips</span>
                    <span className="font-mono text-ink font-semibold">{driver.trip_count}</span>
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-center p-4">
                  <span className="text-xs text-mute">No driver assigned to this order</span>
                </div>
              )}
            </div>
          </div>

          {/* Vehicle Info */}
          <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-3">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">Vehicle Utilized</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
              <div>
                <span className="text-[10px] uppercase text-mute font-semibold">Model</span>
                <span className="block text-xs font-bold text-ink mt-0.5">{vehicle.model}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-mute font-semibold">Classification</span>
                <span className="block text-xs font-bold text-ink mt-0.5">{vehicle.type}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-mute font-semibold">Plate Number</span>
                <span className="block text-xs font-bold font-mono text-ink mt-0.5">{vehicle.plate}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-mute font-semibold">Transmission</span>
                <span className="block text-xs font-bold text-ink mt-0.5">{vehicle.transmission}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Right Side (2/5 width) */}
        <div className="lg:col-span-2 space-y-6">

          {/* Fare Breakdown */}
          <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-4">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">Fare Breakdown</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-body">Base Fare</span>
                <span className="font-mono text-ink">₹{fare_breakdown.base.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-body">Distance Fare</span>
                <span className="font-mono text-ink">₹{fare_breakdown.distance.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-body">Time Fare</span>
                <span className="font-mono text-ink">₹{fare_breakdown.time.toFixed(2)}</span>
              </div>
              {fare_breakdown.surge > 0 && (
                <div className="flex justify-between">
                  <span className="text-body">Surge Multiplier (x{trip.surge_multiplier})</span>
                  <span className="font-mono text-ink">₹{fare_breakdown.surge.toFixed(2)}</span>
                </div>
              )}
              {fare_breakdown.care > 0 && (
                <div className="flex justify-between">
                  <span className="text-body">D4M Care protection fee</span>
                  <span className="font-mono text-ink">₹{fare_breakdown.care.toFixed(2)}</span>
                </div>
              )}
              {fare_breakdown.promo < 0 && (
                <div className="flex justify-between">
                  <span className="text-body">Promo applied ({trip.promo_applied})</span>
                  <span className="font-mono text-ink">₹{fare_breakdown.promo.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-body">GST tax (5%)</span>
                <span className="font-mono text-ink">₹{fare_breakdown.tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-canvas-soft pt-2.5 font-bold text-sm text-ink">
                <span>Total Fare</span>
                <span className="font-mono">₹{fare_breakdown.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Adjustments Form */}
          <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-4">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">Adjustment Console</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase text-mute font-semibold mb-1">Adjustment Type</label>
                <div className="flex space-x-1 bg-canvas-soft p-0.5 rounded-pill border border-canvas-soft">
                  <button
                    onClick={() => setAdjustmentType('refund')}
                    className={`flex-1 text-[10px] font-semibold h-7 rounded-pill transition-colors ${
                      adjustmentType === 'refund' ? 'bg-ink text-on-dark' : 'text-body hover:bg-canvas-softer/50'
                    }`}
                  >
                    Refund
                  </button>
                  <button
                    onClick={() => setAdjustmentType('waive')}
                    className={`flex-1 text-[10px] font-semibold h-7 rounded-pill transition-colors ${
                      adjustmentType === 'waive' ? 'bg-ink text-on-dark' : 'text-body hover:bg-canvas-softer/50'
                    }`}
                  >
                    Waive Fee
                  </button>
                  <button
                    onClick={() => setAdjustmentType('bonus')}
                    className={`flex-1 text-[10px] font-semibold h-7 rounded-pill transition-colors ${
                      adjustmentType === 'bonus' ? 'bg-ink text-on-dark' : 'text-body hover:bg-canvas-softer/50'
                    }`}
                  >
                    Add Bonus
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-mute font-semibold mb-1">Amount (INR)</label>
                <input
                  type="text"
                  placeholder="₹0.00"
                  className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-mono"
                  value={adjustmentAmt}
                  onChange={(e) => setAdjustmentAmt(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-mute font-semibold mb-1">Reason (required, audited)</label>
                <input
                  type="text"
                  placeholder="e.g. Rider overcharged on surge"
                  className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink"
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                />
              </div>
              <button
                onClick={handleApplyAdjustment}
                disabled={actionLoading}
                className="w-full bg-ink text-on-dark text-xs font-semibold rounded-pill h-9 hover:bg-black-elevated transition-colors disabled:opacity-40"
              >
                {actionLoading ? 'Applying…' : 'Apply Adjustment'}
              </button>
            </div>
          </div>

          {/* Payment Attempts */}
          <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-3">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">Payment History</h2>
            <div className="space-y-3 divide-y divide-canvas-soft">
              {payment_attempts.map((attempt) => (
                <div key={attempt.txn_id} className="pt-2.5 first:pt-0 flex justify-between items-start text-xs">
                  <div>
                    <span className="font-mono block font-bold text-ink">{attempt.txn_id}</span>
                    <span className="text-[10px] text-mute block mt-0.5">
                      {new Date(attempt.timestamp).toLocaleString()} ({attempt.provider})
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono block text-ink font-semibold">₹{attempt.amount.toFixed(2)}</span>
                    <span
                      className={`text-[9px] uppercase font-bold tracking-wider ${
                        attempt.status === 'SUCCEEDED' ? 'text-[#138000]' : 'text-[#b00020]'
                      }`}
                    >
                      {attempt.status.toLowerCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Issues */}
          {issues.length > 0 && (
            <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-3">
              <h2 className="text-xs font-bold text-ink uppercase tracking-wider">Associated Complaints</h2>
              <div className="space-y-3">
                {issues.map((issue) => (
                  <div key={issue.id} className="bg-canvas-soft border border-canvas-soft rounded-lg p-3 space-y-1.5">
                    <div className="flex justify-between items-center text-[10px] font-mono">
                      <span className="font-bold text-ink">{issue.id}</span>
                      <span className="text-[#b00020] font-bold uppercase">{issue.severity}</span>
                    </div>
                    <h4 className="text-xs font-bold text-ink">{issue.title}</h4>
                    <div className="flex justify-between text-[10px] text-mute">
                      <span>Category: {issue.category}</span>
                      <span>Assignee: {issue.agent}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit Logs */}
          <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-3">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">Audit logs</h2>
            <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
              {audit_logs.map((logItem, idx) => (
                <div key={idx} className="text-xs">
                  <div className="flex justify-between text-[10px] text-mute font-mono">
                    <span>{new Date(logItem.timestamp).toLocaleString()}</span>
                    <span>Actor: {logItem.actor}</span>
                  </div>
                  <h4 className="font-bold text-ink mt-0.5">{logItem.action}</h4>
                  <p className="text-[10px] text-body mt-0.5">{logItem.details}</p>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

      {/* ---- Reassign Driver Modal ---- */}
      {showReassignModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-ink">Reassign Driver</h3>
              <p className="text-xs text-mute mt-1">Search and assign another driver to this order</p>
            </div>
            <div>
              <label className="block text-[10px] uppercase text-mute font-semibold mb-1">Driver UUID</label>
              <input
                type="text"
                placeholder="e.g. 5b1a5239-ab20-42d7-b50a-ea77419a84fb"
                className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-mono"
                value={reassignDriverId}
                onChange={(e) => setReassignDriverId(e.target.value)}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setShowReassignModal(false);
                  setReassignDriverId('');
                }}
                className="text-xs text-body hover:text-ink px-3"
              >
                Cancel
              </button>
              <button
                onClick={handleReassignDriver}
                className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
                disabled={!reassignDriverId.trim()}
              >
                Reassign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
