import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, type ColumnDef, type BulkAction } from '../../components/ds/DataTable';
import { AdminBadge } from '../../components/ds/AdminBadge';
import { exportToCsv, type CsvColumn } from '../lib/tableTools';
import { formatPaise } from '../lib/money';
import { cancelOrder, getOrders } from '../lib/api/orders';

export interface TripItem {
  id: string;
  city_prefix: string;
  customer_id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_h3_cell: string;
  assigned_driver_id: string | null;
  driver_name: string;
  surge_multiplier: number;
  base_fare_paise: number;
  created_at: string;
  assigned_at: string | null;
  // Projected fields
  trip_type: string;
  car_type: string;
  transmission: string;
  payment_method: string;
  promo_applied: string;
  d4m_care: boolean;
  rating: number;
  plate: string;
  [key: string]: unknown; // satisfies DataTable's row constraint
}

const PAGE_SIZE = 50;

// CSV columns for the trips export (shared by full + selected export).
const CSV_COLUMNS: CsvColumn<TripItem>[] = [
  { key: 'id', label: 'Trip ID' },
  { key: 'created_at', label: 'Date' },
  { key: 'customer_id', label: 'Rider ID' },
  { key: 'driver_name', label: 'Driver' },
  { key: 'plate', label: 'Plate' },
  { key: 'status', label: 'Status' },
  { key: 'base_fare_paise', label: 'Fare (paise)' },
  { key: 'rating', label: 'Rating' },
  { key: 'payment_method', label: 'Payment' },
  { key: 'trip_type', label: 'Type' },
  { key: 'car_type', label: 'Car' },
  { key: 'transmission', label: 'Transmission' },
  { key: 'promo_applied', label: 'Promo' },
];

export const TripsList: React.FC = () => {
  const navigate = useNavigate();
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [tripType, setTripType] = useState<string>('');
  const [carType, setCarType] = useState<string>('');
  const [payment, setPayment] = useState<string>('');
  const [transmission, setTransmission] = useState<string>('');
  const [promo, setPromo] = useState<string>('');
  const [d4mCare, setD4mCare] = useState<string>('');
  const [dateStart, setDateStart] = useState<string>('');
  const [dateEnd, setDateEnd] = useState<string>('');
  const [ratingLess3, setRatingLess3] = useState<boolean>(false);

  // Convert a local datetime-local value (YYYY-MM-DDTHH:mm) to RFC3339 for the API.
  const toRFC3339 = (local: string): string => (local ? new Date(local).toISOString() : '');

  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setCity('');
    setTripType('');
    setCarType('');
    setPayment('');
    setTransmission('');
    setPromo('');
    setD4mCare('');
    setDateStart('');
    setDateEnd('');
    setRatingLess3(false);
  };

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getOrders({
        page: page + 1,
        limit: PAGE_SIZE,
        search,
        status,
        city,
        tripType,
        carType,
        payment,
        transmission,
        promo,
        d4mCare,
        dateFrom: toRFC3339(dateStart),
        dateTo: toRFC3339(dateEnd),
        ratingLess3,
      });
      setTrips(result.orders as TripItem[]);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to fetch trips', err);
      setTrips([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [search, status, city, tripType, carType, payment, transmission, promo, d4mCare, dateStart, dateEnd, ratingLess3, page]);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  // Reset to first page whenever a filter changes.
  useEffect(() => {
    setPage(0);
  }, [search, status, city, tripType, carType, payment, transmission, promo, d4mCare, dateStart, dateEnd, ratingLess3]);

  const handleExportAll = () => {
    exportToCsv<TripItem>(`trips_export_${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, trips);
  };

  const handleBulkCancel = async (selectedIds: string[]) => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Cancel ${selectedIds.length} selected trip(s)? This frees the assigned drivers.`)) return;

    let successCount = 0;
    for (const orderId of selectedIds) {
      try {
        await cancelOrder(orderId);
        successCount++;
      } catch (err) {
        console.error(`Cancel failed for trip ${orderId}`, err);
      }
    }
    alert(`Cancelled ${successCount} of ${selectedIds.length} selected trips.`);
    fetchTrips();
  };

  const handleExportSelected = (selectedIds: string[]) => {
    const idSet = new Set(selectedIds);
    const rows = trips.filter((t) => idSet.has(t.id));
    if (rows.length === 0) return;
    exportToCsv<TripItem>(`trips_export_${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, rows);
  };

  const BULK_ACTIONS: BulkAction[] = [
    { label: 'Export Selected', onClick: handleExportSelected },
    { label: 'Cancel', onClick: handleBulkCancel, variant: 'destructive' },
  ];

  // Column definitions for the DataTable hero component.
  const TRIP_COLUMNS: ColumnDef<TripItem>[] = [
    {
      key: 'id', header: 'Trip ID',
      render: (_v, trip) => (
        <span className="font-mono text-mono-small text-content-primary font-semibold">
          TRP-{trip.city_prefix}-{trip.id.substring(trip.id.length - 4).toUpperCase()}
        </span>
      ),
    },
    { key: 'created_at', header: 'Date', type: 'date' },
    {
      key: 'customer_id', header: 'Rider',
      render: (_v, trip) => (
        <span className="text-xs text-content-secondary">Rider-{trip.customer_id.substring(0, 4)}</span>
      ),
    },
    {
      key: 'driver_name', header: 'Driver',
      render: (_v, trip) => (
        <span className="text-xs text-content-secondary font-medium">
          {trip.driver_name}
          <span className="block text-[10px] text-content-tertiary font-mono">{trip.plate}</span>
        </span>
      ),
    },
    {
      key: 'route', header: 'Route',
      render: (_v, trip) => (
        <span className="text-[10px] text-content-secondary font-mono">
          {trip.pickup_lat.toFixed(3)}, {trip.pickup_lng.toFixed(3)}
          <span className="block text-content-tertiary">→ {trip.dropoff_lat.toFixed(3)}, {trip.dropoff_lng.toFixed(3)}</span>
        </span>
      ),
    },
    {
      key: 'city_prefix', header: 'City & Type',
      render: (_v, trip) => (
        <span className="text-xs text-content-secondary">
          <span className="block text-[10px] font-mono text-content-tertiary">{trip.city_prefix}</span>
          <span className="capitalize">{trip.trip_type}</span>
        </span>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (_v, trip) => (
        <AdminBadge label={trip.status === 'ARRIVED_AT_PICKUP' ? 'Arrived' : trip.status.replace(/_/g, ' ').toLowerCase()} />
      ),
    },
    {
      key: 'base_fare_paise', header: 'Fare',
      render: (_v, trip) => (
        <span className="font-mono text-xs text-content-primary font-semibold">
          {formatPaise(trip.base_fare_paise, 2)}
        </span>
      ),
    },
    {
      key: 'rating', header: 'Rating',
      render: (_v, trip) => (
        <span className="font-mono text-xs">
          {trip.rating > 0 ? (
            <span className="text-content-primary font-medium">
              {trip.rating} <span className="text-content-tertiary font-sans">★</span>
            </span>
          ) : (
            <span className="text-content-tertiary">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'payment_method', header: 'Payment',
      render: (_v, trip) => (
        <span className="text-[10px] font-medium text-content-secondary">{trip.payment_method}</span>
      ),
    },
  ];

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-content-primary">Trips</h1>
          <p className="text-xs text-content-tertiary mt-1">Manage and audit all vehicle bookings, states, and transactions</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportAll}
            disabled={trips.length === 0}
            className="inline-flex items-center justify-center border border-background-secondary text-content-primary text-xs font-semibold rounded-pill h-9 px-4 hover:bg-background-secondary transition-colors disabled:opacity-40"
          >
            Export CSV
          </button>
          <Link
            to="/trips/new"
            className="inline-flex items-center justify-center bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-4 hover:bg-gray-800 transition-colors"
          >
            + Manual Booking
          </Link>
        </div>
      </div>

      {/* ---- Filters ---- */}
      <div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {/* Search */}
          <div className="col-span-1 md:col-span-2">
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Search</label>
            <input
              type="text"
              placeholder="Trip ID, rider, driver, plate..."
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Status</label>
            <select
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="CREATED">Requested</option>
              <option value="ASSIGNED">Assigned</option>
              <option value="ARRIVED_AT_PICKUP">Arrived</option>
              <option value="DELIVERING">Started</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* City */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">City</label>
            <select
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">All Cities</option>
              <option value="KOL">KOL (Kolkata)</option>
              <option value="BLR">BLR (Bangalore)</option>
              <option value="DEL">DEL (Delhi)</option>
              <option value="MUM">MUM (Mumbai)</option>
            </select>
          </div>

          {/* Trip Type */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Trip Type</label>
            <select
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
              value={tripType}
              onChange={(e) => setTripType(e.target.value)}
            >
              <option value="">All Types</option>
              <option value="in-city round">In-City Round</option>
              <option value="one-way">One-Way</option>
              <option value="mini-outstation">Mini-Outstation</option>
              <option value="outstation">Outstation</option>
            </select>
          </div>

          {/* Car Type */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Car Type</label>
            <select
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
              value={carType}
              onChange={(e) => setCarType(e.target.value)}
            >
              <option value="">All Cars</option>
              <option value="Hatchback">Hatchback</option>
              <option value="Sedan">Sedan</option>
              <option value="SUV">SUV</option>
              <option value="Premium">Premium</option>
            </select>
          </div>

          {/* Transmission */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Transmission</label>
            <select
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
              value={transmission}
              onChange={(e) => setTransmission(e.target.value)}
            >
              <option value="">All</option>
              <option value="Manual">Manual</option>
              <option value="Automatic">Automatic</option>
            </select>
          </div>

          {/* Promo */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Promo</label>
            <select
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
              value={promo}
              onChange={(e) => setPromo(e.target.value)}
            >
              <option value="">All Promos</option>
              <option value="WELCOME50">WELCOME50</option>
              <option value="SAVEMORE">SAVEMORE</option>
              <option value="None">No Promo</option>
            </select>
          </div>

          {/* D4M Care */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">D4M Care</label>
            <select
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
              value={d4mCare}
              onChange={(e) => setD4mCare(e.target.value)}
            >
              <option value="">Any</option>
              <option value="true">Protected</option>
              <option value="false">Unprotected</option>
            </select>
          </div>

          {/* Date Start */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">From</label>
            <input
              type="datetime-local"
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
            />
          </div>

          {/* Date End */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">To</label>
            <input
              type="datetime-local"
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-between items-center border-t border-background-secondary pt-3">
          <div className="flex items-center space-x-4">
            {/* Payment Method */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-content-secondary font-medium">Payment:</span>
              {['', 'Stripe', 'Razorpay', 'Cash'].map((pay) => (
                <button
                  key={pay}
                  onClick={() => setPayment(pay)}
                  className={`text-[11px] h-6 px-3 rounded-pill transition-colors ${
                    payment === pay
                      ? 'bg-content-primary text-gray-0 font-medium'
                      : 'bg-background-secondary text-content-secondary hover:bg-background-tertiary'
                  }`}
                >
                  {pay || 'All'}
                </button>
              ))}
            </div>

            {/* Rating Checkbox */}
            <label className="flex items-center space-x-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 rounded border-background-secondary text-content-primary focus:ring-0 focus:outline-none"
                checked={ratingLess3}
                onChange={(e) => setRatingLess3(e.target.checked)}
              />
              <span className="text-xs text-content-secondary">Low Rating (★ &lt; 3)</span>
            </label>
          </div>

          <button
            onClick={clearFilters}
            className="text-[11px] text-content-tertiary hover:text-content-primary font-medium transition-colors"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* ---- Trips Table (DataTable hero component) ---- */}
      <DataTable<TripItem>
        columns={TRIP_COLUMNS}
        data={trips}
        loading={loading}
        selectable
        bulkActions={BULK_ACTIONS}
        rowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/trips/${t.id}`)}
        emptyState={
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-sm font-semibold text-content-primary">No orders found</span>
            <span className="text-xs text-content-tertiary">Try modifying your filter matrix or search terms</span>
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] text-content-primary underline font-medium"
            >
              Clear filters
            </button>
          </div>
        }
      />

      {/* ---- Pagination ---- */}
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-content-tertiary font-mono">
          Page {page + 1} · showing {trips.length} trip{trips.length === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="text-[11px] font-semibold border border-background-secondary text-content-primary rounded-pill h-8 px-4 hover:bg-background-secondary transition-colors disabled:opacity-40"
          >
            ← Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || loading}
            className="text-[11px] font-semibold border border-background-secondary text-content-primary rounded-pill h-8 px-4 hover:bg-background-secondary transition-colors disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
};
