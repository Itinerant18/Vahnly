import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';
import { exportToCsv } from '../lib/tableTools';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

// Column definitions for the DataTable hero component (built-in sort / loading / empty).
const DRIVER_COLUMNS: ColumnDef<DriverSummaryItem>[] = [
  { key: 'name', header: 'Photo / Name', type: 'avatar', sortable: true },
  {
    key: 'phone', header: 'Phone',
    render: (v) => <span className="font-mono text-mono-small text-content-secondary">{String(v)}</span>,
  },
  {
    key: 'city_prefix', header: 'City & Exp', sortable: true,
    render: (_v, r) => (
      <div>
        <span className="block font-mono text-mono-small font-semibold text-content-primary">{r.city_prefix}</span>
        <span className="text-label-small text-content-tertiary uppercase">{r.transmission_capability}</span>
      </div>
    ),
  },
  { key: 'total_trips', header: 'Trips', type: 'numeric', sortable: true },
  {
    key: 'acceptance_rate', header: 'Acceptance', type: 'numeric', sortable: true,
    render: (v) => <span className="font-mono text-mono-small tabular-nums text-content-primary">{(Number(v) * 100).toFixed(0)}%</span>,
  },
  {
    key: 'cancellation_rate', header: 'Cancellation', type: 'numeric', sortable: true,
    render: (v) => <span className="font-mono text-mono-small tabular-nums text-content-primary">{(Number(v) * 100).toFixed(0)}%</span>,
  },
  {
    key: 'rating', header: 'Rating', sortable: true,
    render: (v) => Number(v) > 0
      ? <span className="font-mono text-mono-small text-content-primary">{Number(v).toFixed(1)} <span className="text-content-tertiary">★</span></span>
      : <span className="text-content-tertiary">—</span>,
  },
  { key: 'last_online', header: 'Last Active', type: 'date', sortable: true },
  { key: 'status', header: 'Status', type: 'status', sortable: true },
];

export interface DriverSummaryItem {
	driver_id: string;
	name: string;
	phone: string;
	city_prefix: string;
	status: string; // ACTIVE, SUSPENDED, BLOCKED, PENDING_KYC, OFFLINE_X_DAYS
	rating: number;
	total_trips: number;
	acceptance_rate: number;
	cancellation_rate: number;
	last_online: string;
	transmission_capability: string; // MANUAL, AUTOMATIC, BOTH
	[key: string]: unknown; // satisfies DataTable's row constraint
}

export const DriversList: React.FC = () => {
	const navigate = useNavigate();
	const [drivers, setDrivers] = useState<DriverSummaryItem[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	
	// Filters State
	const [search, setSearch] = useState<string>('');
	const [status, setStatus] = useState<string>('');
	const [city, setCity] = useState<string>('');
	const [transmission, setTransmission] = useState<string>('');
	const [ratingMin, setRatingMin] = useState<string>('');
	const [acceptanceMin, setAcceptanceMin] = useState<string>('');
	const [cancellationMax, setCancellationMax] = useState<string>('');
	const [tripsMin, setTripsMin] = useState<string>('');

	const fetchDrivers = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (search) params.append('search', search);
			if (status) params.append('status', status);
			if (city) params.append('city_prefix', city);
			if (transmission) params.append('transmission', transmission);
			if (ratingMin) params.append('rating_min', ratingMin);
			if (acceptanceMin) params.append('acceptance_min', (parseFloat(acceptanceMin) / 100).toString());
			if (cancellationMax) params.append('cancellation_max', (parseFloat(cancellationMax) / 100).toString());
			if (tripsMin) params.append('trips_min', tripsMin);

			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers?${params.toString()}`, {
				headers: {
					'X-Admin-Role': role,
				},
			});

			if (res.ok) {
				const data = await res.json();
				setDrivers(data || []);
			}
		} catch (err) {
			console.error('Failed to fetch drivers', err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchDrivers();
	}, [search, status, city, transmission, ratingMin, acceptanceMin, cancellationMax, tripsMin]);

	const handleExportCsv = () => {
		exportToCsv<DriverSummaryItem>('drivers.csv', [
			{ key: 'driver_id', label: 'Driver ID' },
			{ key: 'name', label: 'Name' },
			{ key: 'phone', label: 'Phone' },
			{ key: 'city_prefix', label: 'City' },
			{ key: 'transmission_capability', label: 'Transmission' },
			{ key: 'total_trips', label: 'Trips' },
			{ key: 'acceptance_rate', label: 'Acceptance' },
			{ key: 'cancellation_rate', label: 'Cancellation' },
			{ key: 'rating', label: 'Rating' },
			{ key: 'status', label: 'Status' },
			{ key: 'last_online', label: 'Last Online' },
		], drivers);
	};

	const handleResetFilters = () => {
		setSearch('');
		setStatus('');
		setCity('');
		setTransmission('');
		setRatingMin('');
		setAcceptanceMin('');
		setCancellationMax('');
		setTripsMin('');
	};

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6">
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-content-primary">Drivers Directory</h1>
					<p className="text-xs text-content-tertiary mt-1">Manage partner registrations, state triggers, performance metrics, and certifications</p>
				</div>
				<div className="flex items-center gap-3">
					<button
						onClick={handleExportCsv}
						disabled={drivers.length === 0}
						className="inline-flex items-center justify-center border border-background-secondary text-content-primary text-xs font-semibold rounded-pill h-9 px-4 hover:bg-background-secondary transition-colors disabled:opacity-40"
					>
						Export CSV
					</button>
					<Link
						to="/drivers/onboarding"
						className="inline-flex items-center justify-center bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-4 hover:bg-gray-800 transition-colors"
					>
						Onboarding Queue →
					</Link>
				</div>
			</div>

			{/* ---- Filters Grid ---- */}
			<div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-4 shadow-sm">
				<div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
					{/* Text Search */}
					<div className="col-span-1 md:col-span-2">
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Search</label>
						<input
							type="text"
							placeholder="Search Name, Phone, Driver ID..."
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					{/* Status Selector */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Status</label>
						<select
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
							value={status}
							onChange={(e) => setStatus(e.target.value)}
						>
							<option value="">All Statuses</option>
							<option value="ACTIVE">Active</option>
							<option value="SUSPENDED">Suspended</option>
							<option value="BLOCKED">Blocked</option>
							<option value="PENDING_KYC">Pending KYC</option>
						</select>
					</div>

					{/* City selector */}
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

					{/* Transmission */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Transmission</label>
						<select
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
							value={transmission}
							onChange={(e) => setTransmission(e.target.value)}
						>
							<option value="">All Certification</option>
							<option value="MANUAL">Manual Only</option>
							<option value="AUTOMATIC">Automatic Only</option>
							<option value="BOTH">Both Certifications</option>
						</select>
					</div>

					{/* Min Rating */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Min Rating</label>
						<select
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
							value={ratingMin}
							onChange={(e) => setRatingMin(e.target.value)}
						>
							<option value="">Any</option>
							<option value="4.8">4.8+ ★</option>
							<option value="4.5">4.5+ ★</option>
							<option value="4.0">4.0+ ★</option>
							<option value="3.0">3.0+ ★</option>
						</select>
					</div>
				</div>

				{/* Advanced numeric filters */}
				<div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-background-secondary">
					{/* Trips count */}
					<div>
						<label className="block text-[9px] uppercase text-content-tertiary font-semibold">Min Trips Completed</label>
						<input
							type="number"
							placeholder="e.g. 50"
							className="w-full h-8 rounded-pill bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary font-mono"
							value={tripsMin}
							onChange={(e) => setTripsMin(e.target.value)}
						/>
					</div>

					{/* Acceptance Rate */}
					<div>
						<label className="block text-[9px] uppercase text-content-tertiary font-semibold">Min Acceptance Rate (%)</label>
						<input
							type="number"
							placeholder="e.g. 80"
							className="w-full h-8 rounded-pill bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary font-mono"
							value={acceptanceMin}
							onChange={(e) => setAcceptanceMin(e.target.value)}
						/>
					</div>

					{/* Cancellation Rate */}
					<div>
						<label className="block text-[9px] uppercase text-content-tertiary font-semibold">Max Cancellation Rate (%)</label>
						<input
							type="number"
							placeholder="e.g. 10"
							className="w-full h-8 rounded-pill bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary font-mono"
							value={cancellationMax}
							onChange={(e) => setCancellationMax(e.target.value)}
						/>
					</div>

					<div className="flex justify-end items-end pb-1.5 col-span-1">
						<button
							onClick={handleResetFilters}
							className="text-[11px] text-content-tertiary hover:text-content-primary font-semibold transition-colors"
						>
							Reset All Filters
						</button>
					</div>
				</div>
			</div>

			{/* ---- Drivers Table (DataTable hero component) ---- */}
			<DataTable<DriverSummaryItem>
				columns={DRIVER_COLUMNS}
				data={drivers}
				loading={loading}
				rowKey={(r) => r.driver_id}
				onRowClick={(r) => navigate(`/drivers/${r.driver_id}`)}
				emptyState={
					<div className="flex flex-col items-center gap-1 text-center">
						<span className="text-heading-medium text-content-secondary">No drivers match criteria</span>
						<span className="text-paragraph-small text-content-tertiary">Try modifying filter parameters or text search</span>
					</div>
				}
			/>
		</div>
	);
};
