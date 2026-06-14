import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

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

export const TripsList: React.FC = () => {
  const navigate = useNavigate();
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [tripType, setTripType] = useState<string>('');
  const [carType, setCarType] = useState<string>('');
  const [payment, setPayment] = useState<string>('');
  const [ratingLess3, setRatingLess3] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTagText, setBulkTagText] = useState<string>('');
  const [showTagModal, setShowTagModal] = useState<boolean>(false);
  const [tagsMap, setTagsMap] = useState<Record<string, string[]>>({});

  const fetchTrips = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (status) params.append('status', status);
      if (city) params.append('city_prefix', city);
      if (tripType) params.append('trip_type', tripType);
      if (carType) params.append('car_type', carType);
      if (payment) params.append('payment_method', payment);
      if (ratingLess3) params.append('rating_less_than_3', 'true');

      const role = localStorage.getItem('admin_role') || 'ADMIN';

      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders?${params.toString()}`, {
        headers: {
          'X-Admin-Role': role,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setTrips(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch trips', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrips();
  }, [search, status, city, tripType, carType, payment, ratingLess3]);

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleExportCSV = () => {
    if (trips.length === 0) return;
    const headers = ['Trip ID', 'Date', 'Rider ID', 'Driver', 'Status', 'Fare (INR)', 'Rating', 'Payment', 'Type', 'Car', 'Plate'];
    const rows = trips.map((t) => [
      t.id,
      new Date(t.created_at).toLocaleString(),
      t.customer_id,
      t.driver_name,
      t.status,
      (t.base_fare_paise / 100).toFixed(2),
      t.rating || 'N/A',
      t.payment_method,
      t.trip_type,
      t.car_type,
      t.plate,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' 
      + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `trips_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleApplyBulkTag = () => {
    if (!bulkTagText.trim() || selectedIds.length === 0) return;
    const newTagsMap = { ...tagsMap };
    selectedIds.forEach((id) => {
      const current = newTagsMap[id] || [];
      if (!current.includes(bulkTagText.trim())) {
        newTagsMap[id] = [...current, bulkTagText.trim()];
      }
    });
    setTagsMap(newTagsMap);
    setBulkTagText('');
    setShowTagModal(false);
  };

  const handleBulkRefund = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to cancel and refund ${selectedIds.length} selected trips?`)) return;

    const role = localStorage.getItem('admin_role') || 'ADMIN';

    let successCount = 0;
    for (const orderId of selectedIds) {
      try {
        const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Role': role,
          },
          body: JSON.stringify({ order_id: orderId }),
        });
        if (res.ok) {
          successCount++;
        }
      } catch (err) {
        console.error(`Refund failed for trip ${orderId}`, err);
      }
    }

    alert(`Refunded/Cancelled ${successCount} of ${selectedIds.length} selected trips.`);
    setSelectedIds([]);
    fetchTrips();
  };

  // Column definitions for the DataTable hero component.
  // Selection + tags columns close over component state/handlers so the
  // bulk-action bar and tag modal keep firing exactly as before.
  const TRIP_COLUMNS: ColumnDef<TripItem>[] = [
    {
      key: 'select', header: '', width: 40,
      render: (_v, trip) => (
        <span onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="w-3.5 h-3.5 rounded border-background-secondary text-content-primary focus:ring-0 focus:outline-none cursor-pointer"
            checked={selectedIds.includes(trip.id)}
            onChange={() => toggleSelect(trip.id)}
          />
        </span>
      ),
    },
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
        <span
          className={`inline-flex items-center text-[10px] font-bold uppercase rounded-pill h-5 px-2.5 tracking-wider ${
            trip.status === 'COMPLETED'
              ? 'bg-background-secondary text-content-primary border border-background-secondary'
              : trip.status === 'CANCELLED'
              ? 'bg-background-secondary text-content-tertiary'
              : 'bg-content-primary text-gray-0'
          }`}
        >
          {trip.status === 'ARRIVED_AT_PICKUP' ? 'Arrived' : trip.status.toLowerCase()}
        </span>
      ),
    },
    {
      key: 'base_fare_paise', header: 'Fare',
      render: (_v, trip) => (
        <span className="font-mono text-xs text-content-primary font-semibold">
          ₹{(trip.base_fare_paise / 100).toFixed(2)}
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
    {
      key: 'tags', header: 'Tags',
      render: (_v, trip) => {
        const itemTags = tagsMap[trip.id] || [];
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap gap-1 max-w-[150px]">
              {itemTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center bg-background-secondary border border-background-secondary text-content-tertiary text-[9px] h-4 px-1.5 rounded-pill font-mono"
                >
                  {tag}
                </span>
              ))}
              {itemTags.length === 0 && (
                <button
                  onClick={() => {
                    setSelectedIds([trip.id]);
                    setShowTagModal(true);
                  }}
                  className="text-[9px] text-content-tertiary hover:text-content-primary font-mono opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  + add
                </button>
              )}
            </div>
          </span>
        );
      },
    },
  ];

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-content-primary">Trips</h1>
          <p className="text-xs text-content-tertiary mt-1">Manage and audit all vehicle bookings, states, and transactions</p>
        </div>
        <Link
          to="/trips/new"
          className="inline-flex items-center justify-center bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-4 hover:bg-gray-800 transition-colors"
        >
          + Manual Booking
        </Link>
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
            onClick={() => {
              setSearch('');
              setStatus('');
              setCity('');
              setTripType('');
              setCarType('');
              setPayment('');
              setRatingLess3(false);
            }}
            className="text-[11px] text-content-tertiary hover:text-content-primary font-medium transition-colors"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* ---- Bulk Action Bar ---- */}
      {selectedIds.length > 0 && (
        <div className="bg-content-primary text-gray-0 rounded-xl px-5 py-3 flex justify-between items-center animate-fade-in shadow-lg">
          <span className="text-xs font-mono font-medium">{selectedIds.length} trips selected</span>
          <div className="flex space-x-2">
            <button
              onClick={() => setShowTagModal(true)}
              className="text-[11px] font-semibold bg-background-tertiary/20 hover:bg-background-tertiary/30 text-gray-0 rounded-pill h-7 px-3 transition-colors"
            >
              Apply Tag
            </button>
            <button
              onClick={handleBulkRefund}
              className="text-[11px] font-semibold bg-background-tertiary/20 hover:bg-background-tertiary/30 text-gray-0 rounded-pill h-7 px-3 transition-colors"
            >
              Refund / Cancel
            </button>
            <button
              onClick={handleExportCSV}
              className="text-[11px] font-semibold bg-gray-0 text-content-primary hover:bg-background-tertiary rounded-pill h-7 px-3 transition-colors"
            >
              Export Selected CSV
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="text-[11px] text-gray-0/60 hover:text-gray-0 px-2 font-medium"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ---- Trips Table (DataTable hero component) ---- */}
      <DataTable<TripItem>
        columns={TRIP_COLUMNS}
        data={trips}
        loading={loading}
        rowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/trips/${t.id}`)}
        emptyState={
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-sm font-semibold text-content-primary">No trips matches found</span>
            <span className="text-xs text-content-tertiary">Try modifying your filter matrix or search terms</span>
          </div>
        }
      />

      {/* ---- Tag Modal ---- */}
      {showTagModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-content-primary">Apply Tag to Trips</h3>
              <p className="text-xs text-content-tertiary mt-1">Specify a classification tag for the {selectedIds.length} selected orders</p>
            </div>
            <input
              type="text"
              placeholder="e.g. HIGH_FARE, ESCALATION, FRAUD"
              className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono uppercase"
              value={bulkTagText}
              onChange={(e) => setBulkTagText(e.target.value.toUpperCase())}
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setShowTagModal(false);
                  setBulkTagText('');
                }}
                className="text-xs text-content-secondary hover:text-content-primary px-3"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyBulkTag}
                className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
                disabled={!bulkTagText.trim()}
              >
                Apply Tag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
