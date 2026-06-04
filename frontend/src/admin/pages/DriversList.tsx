import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';

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

			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers?${params.toString()}`, {
				headers: {
					Authorization: `Bearer ${token}`,
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
					<h1 className="text-2xl font-bold tracking-tight text-ink">Drivers Directory</h1>
					<p className="text-xs text-mute mt-1">Manage partner registrations, state triggers, performance metrics, and certifications</p>
				</div>
				<Link
					to="/admin/drivers/onboarding"
					className="inline-flex items-center justify-center bg-ink text-on-dark text-xs font-semibold rounded-pill h-9 px-4 hover:bg-black-elevated transition-colors"
				>
					Onboarding Queue →
				</Link>
			</div>

			{/* ---- Filters Grid ---- */}
			<div className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-4 shadow-sm">
				<div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
					{/* Text Search */}
					<div className="col-span-1 md:col-span-2">
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Search</label>
						<input
							type="text"
							placeholder="Search Name, Phone, Driver ID..."
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-mono"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					{/* Status Selector */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Status</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
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
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">City</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
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
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Transmission</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
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
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Min Rating</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
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
				<div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-canvas-soft">
					{/* Trips count */}
					<div>
						<label className="block text-[9px] uppercase text-mute font-semibold">Min Trips Completed</label>
						<input
							type="number"
							placeholder="e.g. 50"
							className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
							value={tripsMin}
							onChange={(e) => setTripsMin(e.target.value)}
						/>
					</div>

					{/* Acceptance Rate */}
					<div>
						<label className="block text-[9px] uppercase text-mute font-semibold">Min Acceptance Rate (%)</label>
						<input
							type="number"
							placeholder="e.g. 80"
							className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
							value={acceptanceMin}
							onChange={(e) => setAcceptanceMin(e.target.value)}
						/>
					</div>

					{/* Cancellation Rate */}
					<div>
						<label className="block text-[9px] uppercase text-mute font-semibold">Max Cancellation Rate (%)</label>
						<input
							type="number"
							placeholder="e.g. 10"
							className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
							value={cancellationMax}
							onChange={(e) => setCancellationMax(e.target.value)}
						/>
					</div>

					<div className="flex justify-end items-end pb-1.5 col-span-1">
						<button
							onClick={handleResetFilters}
							className="text-[11px] text-mute hover:text-ink font-semibold transition-colors"
						>
							Reset All Filters
						</button>
					</div>
				</div>
			</div>

			{/* ---- Drivers Table ---- */}
			<div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden">
				{loading ? (
					<div className="p-12 text-center text-xs text-mute animate-pulse">Loading drivers directory...</div>
				) : drivers.length === 0 ? (
					<div className="p-12 text-center">
						<div className="text-sm font-semibold text-ink">No drivers match criteria</div>
						<p className="text-xs text-mute mt-1">Try modifying filter parameters or text search</p>
					</div>
				) : (
					<table className="w-full text-left border-collapse">
						<thead>
							<tr className="border-b border-canvas-soft bg-canvas-soft">
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Photo / Name</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Phone</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">City & Exp</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute text-center">Trips</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute text-center">Acceptance</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute text-center">Cancellation</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Rating</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Last Active</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Status</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-canvas-soft">
							{drivers.map((driver) => (
								<tr
									key={driver.driver_id}
									onClick={() => navigate(`/admin/drivers/${driver.driver_id}`)}
									className="hover:bg-canvas-softer cursor-pointer transition-colors text-xs"
								>
									<td className="p-4 flex items-center space-x-3">
										<div className="w-8 h-8 rounded-full bg-canvas-soft border border-canvas-soft flex items-center justify-center font-bold text-ink">
											{driver.name.split(' ').map((n) => n[0]).join('')}
										</div>
										<span className="font-semibold text-ink">{driver.name}</span>
									</td>
									<td className="p-4 font-mono text-body">
										{driver.phone}
									</td>
									<td className="p-4">
										<span className="block font-mono font-semibold text-ink text-[10px]">{driver.city_prefix}</span>
										<span className="text-[10px] text-mute font-semibold uppercase">{driver.transmission_capability}</span>
									</td>
									<td className="p-4 font-mono font-semibold text-ink text-center">
										{driver.total_trips}
									</td>
									<td className="p-4 font-mono text-center text-body">
										{(driver.acceptance_rate * 100).toFixed(0)}%
									</td>
									<td className="p-4 font-mono text-center text-body">
										{(driver.cancellation_rate * 100).toFixed(0)}%
									</td>
									<td className="p-4 font-mono font-semibold text-ink">
										{driver.rating > 0 ? (
											<span>{driver.rating.toFixed(1)} <span className="text-mute font-sans text-[10px]">★</span></span>
										) : (
											<span className="text-mute">—</span>
										)}
									</td>
									<td className="p-4 font-mono text-body">
										{new Date(driver.last_online).toLocaleDateString([], {
											month: 'short',
											day: 'numeric',
											hour: '2-digit',
											minute: '2-digit',
										})}
									</td>
									<td className="p-4">
										<span
											className={`inline-flex items-center text-[9px] font-bold uppercase rounded-pill h-5 px-2.5 tracking-wider border ${
												driver.status === 'ACTIVE'
													? 'bg-canvas text-ink border-canvas-soft'
													: driver.status === 'SUSPENDED'
													? 'bg-canvas-soft text-status-warn border-canvas-soft'
													: driver.status === 'BLOCKED'
													? 'bg-canvas-soft text-status-alert border-canvas-soft'
													: 'bg-canvas-soft text-mute border-canvas-soft'
											}`}
										>
											<span
												className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
													driver.status === 'ACTIVE'
														? 'bg-status-online'
														: driver.status === 'SUSPENDED'
														? 'bg-status-warn'
														: 'bg-status-alert'
												}`}
											/>
											{driver.status.toLowerCase()}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
};
