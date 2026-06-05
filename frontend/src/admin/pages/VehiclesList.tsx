import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';

export interface Vehicle {
	plate: string;
	model: string;
	type: string; // Hatchback, Sedan, SUV, Premium
	transmission: string; // Manual, Automatic
	fuel: string; // Petrol, Diesel, EV, CNG
	year: number;
	owner_id: string;
	owner_name: string;
	owner_type: string; // DRIVER, RIDER
	city: string;
	trips_count: number;
	last_serviced: string;
	rc_status: string; // VERIFIED, EXPIRED, EXPIRING_SOON
	rc_expiry_date: string;
	insurance_status: string; // VERIFIED, EXPIRED, EXPIRING_SOON
	insurance_expiry_date: string;
	puc_status: string; // VERIFIED, EXPIRED, EXPIRING_SOON
	puc_expiry_date: string;
	flagged_issues: string[];
	reminder_sent_at?: string;
}

export const VehiclesList: React.FC = () => {
	const [vehicles, setVehicles] = useState<Vehicle[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const [sendingReminders, setSendingReminders] = useState<boolean>(false);

	// Filters State
	const [search, setSearch] = useState<string>('');
	const [type, setType] = useState<string>('');
	const [transmission, setTransmission] = useState<string>('');
	const [fuel, setFuel] = useState<string>('');
	const [year, setYear] = useState<string>('');
	const [rcExpiredOnly, setRcExpiredOnly] = useState<boolean>(false);
	const [insExpiredOnly, setInsExpiredOnly] = useState<boolean>(false);

	// Override Modal State
	const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
	const [overrideRcStatus, setOverrideRcStatus] = useState<string>('');
	const [overrideRcExpiry, setOverrideRcExpiry] = useState<string>('');
	const [overrideInsStatus, setOverrideInsStatus] = useState<string>('');
	const [overrideInsExpiry, setOverrideInsExpiry] = useState<string>('');
	const [overridePucStatus, setOverridePucStatus] = useState<string>('');
	const [overridePucExpiry, setOverridePucExpiry] = useState<string>('');
	const [overrideIssuesText, setOverrideIssuesText] = useState<string>('');
	const [overrideLastServiced, setOverrideLastServiced] = useState<string>('');
	const [overrideLoading, setOverrideLoading] = useState<boolean>(false);

	const fetchVehicles = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (search) params.append('search', search);
			if (type) params.append('type', type);
			if (transmission) params.append('transmission', transmission);
			if (fuel) params.append('fuel', fuel);
			if (year) params.append('year', year);
			if (rcExpiredOnly) params.append('rc_expired', 'true');
			if (insExpiredOnly) params.append('insurance_expired', 'true');

			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/vehicles?${params.toString()}`, {
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
				},
			});

			if (res.ok) {
				const data = await res.json();
				setVehicles(data || []);
			}
		} catch (err) {
			console.error('Failed to fetch vehicles', err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchVehicles();
	}, [search, type, transmission, fuel, year, rcExpiredOnly, insExpiredOnly]);

	const handleResetFilters = () => {
		setSearch('');
		setType('');
		setTransmission('');
		setFuel('');
		setYear('');
		setRcExpiredOnly(false);
		setInsExpiredOnly(false);
	};

	const handleSendReminders = async () => {
		setSendingReminders(true);
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/vehicles/reminders`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
				},
			});
			if (res.ok) {
				const data = await res.json();
				alert(`Successfully dispatched reminders to ${data.reminders_sent} vehicles with expired/expiring documents.`);
				fetchVehicles();
			} else {
				alert('Failed to send document reminders');
			}
		} catch (err) {
			console.error('Failed to trigger reminders', err);
			alert('Network request execution failure.');
		} finally {
			setSendingReminders(false);
		}
	};

	const openOverrideModal = (v: Vehicle) => {
		setSelectedVehicle(v);
		setOverrideRcStatus(v.rc_status);
		setOverrideRcExpiry(v.rc_expiry_date ? v.rc_expiry_date.split('T')[0] : '');
		setOverrideInsStatus(v.insurance_status);
		setOverrideInsExpiry(v.insurance_expiry_date ? v.insurance_expiry_date.split('T')[0] : '');
		setOverridePucStatus(v.puc_status);
		setOverridePucExpiry(v.puc_expiry_date ? v.puc_expiry_date.split('T')[0] : '');
		setOverrideIssuesText(v.flagged_issues ? v.flagged_issues.join(', ') : '');
		setOverrideLastServiced(v.last_serviced ? v.last_serviced.split('T')[0] : '');
	};

	const handleSaveOverride = async () => {
		if (!selectedVehicle) return;
		setOverrideLoading(true);
		try {
			const issues = overrideIssuesText
				? overrideIssuesText.split(',').map((x) => x.trim()).filter((x) => x.length > 0)
				: [];

			const payload = {
				rc_status: overrideRcStatus,
				rc_expiry_date: overrideRcExpiry ? new Date(overrideRcExpiry).toISOString() : undefined,
				insurance_status: overrideInsStatus,
				insurance_expiry_date: overrideInsExpiry ? new Date(overrideInsExpiry).toISOString() : undefined,
				puc_status: overridePucStatus,
				puc_expiry_date: overridePucExpiry ? new Date(overridePucExpiry).toISOString() : undefined,
				flagged_issues: issues,
				last_serviced: overrideLastServiced ? new Date(overrideLastServiced).toISOString() : undefined,
			};

			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/vehicles/${selectedVehicle.plate}/override`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(payload),
			});

			if (res.ok) {
				alert(`Successfully updated overrides for vehicle ${selectedVehicle.plate}.`);
				setSelectedVehicle(null);
				fetchVehicles();
			} else {
				alert('Failed to save manual overrides');
			}
		} catch (err) {
			console.error('Failed to post vehicle override', err);
			alert('Network request execution failure.');
		} finally {
			setOverrideLoading(false);
		}
	};

	const getStatusDotColor = (status: string) => {
		if (status === 'VERIFIED') return 'bg-status-online';
		if (status === 'EXPIRING_SOON') return 'bg-status-warn';
		return 'bg-status-alert';
	};

	const getStatusLabelColor = (status: string) => {
		if (status === 'VERIFIED') return 'text-ink border-canvas-soft bg-canvas';
		if (status === 'EXPIRING_SOON') return 'text-status-warn border-canvas-soft bg-canvas-soft';
		return 'text-status-alert border-canvas-soft bg-canvas-soft';
	};

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6">
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-ink">Vehicles & Fleet Directory</h1>
					<p className="text-xs text-mute mt-1">Manage active rider garage cars, one-time fleet trip vehicles, document expiration statuses, and service updates</p>
				</div>
				<button
					onClick={handleSendReminders}
					disabled={sendingReminders}
					className="inline-flex items-center justify-center bg-ink text-on-dark text-xs font-semibold rounded-pill h-9 px-4 hover:bg-black-elevated transition-colors disabled:opacity-50"
				>
					{sendingReminders ? 'Sending Reminders...' : 'Send Expiry Reminders ✉'}
				</button>
			</div>

			{/* ---- Filters Grid ---- */}
			<div className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-4 shadow-sm">
				<div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
					{/* Search Text */}
					<div className="col-span-1 md:col-span-2">
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Search</label>
						<input
							type="text"
							placeholder="Search License Plate, Model, Owner..."
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-mono"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					{/* Vehicle Type */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Type</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
							value={type}
							onChange={(e) => setType(e.target.value)}
						>
							<option value="">All Types</option>
							<option value="Hatchback">Hatchback</option>
							<option value="Sedan">Sedan</option>
							<option value="SUV">SUV</option>
							<option value="Premium">Premium</option>
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
							<option value="">All Transmissions</option>
							<option value="Manual">Manual</option>
							<option value="Automatic">Automatic</option>
						</select>
					</div>

					{/* Fuel Type */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Fuel</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
							value={fuel}
							onChange={(e) => setFuel(e.target.value)}
						>
							<option value="">All Fuels</option>
							<option value="Petrol">Petrol</option>
							<option value="Diesel">Diesel</option>
							<option value="EV">EV</option>
							<option value="CNG">CNG</option>
						</select>
					</div>

					{/* Year */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Year</label>
						<input
							type="number"
							placeholder="e.g. 2021"
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
							value={year}
							onChange={(e) => setYear(e.target.value)}
						/>
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between pt-2 border-t border-canvas-soft gap-4">
					<div className="flex items-center space-x-4">
						<label className="flex items-center space-x-2 text-xs font-semibold text-ink cursor-pointer">
							<input
								type="checkbox"
								className="w-4 h-4 rounded border-canvas-soft accent-ink"
								checked={rcExpiredOnly}
								onChange={(e) => setRcExpiredOnly(e.target.checked)}
							/>
							<span>RC Expired Only</span>
						</label>

						<label className="flex items-center space-x-2 text-xs font-semibold text-ink cursor-pointer">
							<input
								type="checkbox"
								className="w-4 h-4 rounded border-canvas-soft accent-ink"
								checked={insExpiredOnly}
								onChange={(e) => setInsExpiredOnly(e.target.checked)}
							/>
							<span>Insurance Expired Only</span>
						</label>
					</div>

					<button
						onClick={handleResetFilters}
						className="text-[11px] text-mute hover:text-ink font-semibold transition-colors"
					>
						Reset All Filters
					</button>
				</div>
			</div>

			{/* ---- Vehicles Master Table ---- */}
			<div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden">
				{loading ? (
					<div className="p-12 text-center text-xs text-mute animate-pulse">Loading vehicle directory...</div>
				) : vehicles.length === 0 ? (
					<div className="p-12 text-center">
						<div className="text-sm font-semibold text-ink">No vehicles registered or found</div>
						<p className="text-xs text-mute mt-1">Try modifying filter criteria or search query</p>
					</div>
				) : (
					<table className="w-full text-left border-collapse">
						<thead>
							<tr className="border-b border-canvas-soft bg-canvas-soft">
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Plate</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Model & Type</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Owner</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute text-center">Trips</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">RC status</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Insurance status</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">PUC status</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Flagged Issues</th>
								<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-canvas-soft text-xs">
							{vehicles.map((v) => (
								<tr key={v.plate} className="hover:bg-canvas-softer transition-colors">
									<td className="p-4 font-mono font-bold text-ink whitespace-nowrap">
										{v.plate}
									</td>
									<td className="p-4">
										<div className="font-semibold text-ink">{v.model}</div>
										<div className="text-[10px] text-mute flex items-center space-x-1.5 font-semibold uppercase mt-0.5">
											<span>{v.type}</span>
											<span className="w-1 h-1 rounded-full bg-mute" />
											<span>{v.transmission}</span>
											<span className="w-1 h-1 rounded-full bg-mute" />
											<span>{v.fuel}</span>
											<span className="w-1 h-1 rounded-full bg-mute" />
											<span className="font-mono">{v.year}</span>
										</div>
									</td>
									<td className="p-4">
										{v.owner_type === 'DRIVER' ? (
											<Link
												to={`/drivers/${v.owner_id}`}
												className="hover:underline font-semibold text-ink"
											>
												{v.owner_name} <span className="text-[9px] uppercase tracking-wider bg-canvas-soft border border-canvas-soft rounded-pill px-1.5 text-mute ml-1 font-bold">Driver</span>
											</Link>
										) : (
											<Link
												to={`/riders/${v.owner_id}`}
												className="hover:underline font-semibold text-ink"
											>
												{v.owner_name} <span className="text-[9px] uppercase tracking-wider bg-canvas-soft border border-canvas-soft rounded-pill px-1.5 text-mute ml-1 font-bold">Rider</span>
											</Link>
										)}
										<span className="block text-[10px] text-mute font-mono mt-0.5">{v.city} Shard</span>
									</td>
									<td className="p-4 font-mono font-semibold text-ink text-center">
										{v.trips_count}
									</td>
									<td className="p-4">
										<span className={`inline-flex items-center text-[9px] font-bold uppercase border rounded-pill h-5 px-2 tracking-wider ${getStatusLabelColor(v.rc_status)}`}>
											<span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${getStatusDotColor(v.rc_status)}`} />
											{v.rc_status.replace('_', ' ').toLowerCase()}
										</span>
										<span className="block text-[10px] text-mute font-mono mt-1">
											Exp: {new Date(v.rc_expiry_date).toLocaleDateString([], { year: 'numeric', month: 'short' })}
										</span>
									</td>
									<td className="p-4">
										<span className={`inline-flex items-center text-[9px] font-bold uppercase border rounded-pill h-5 px-2 tracking-wider ${getStatusLabelColor(v.insurance_status)}`}>
											<span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${getStatusDotColor(v.insurance_status)}`} />
											{v.insurance_status.replace('_', ' ').toLowerCase()}
										</span>
										<span className="block text-[10px] text-mute font-mono mt-1">
											Exp: {new Date(v.insurance_expiry_date).toLocaleDateString([], { year: 'numeric', month: 'short' })}
										</span>
									</td>
									<td className="p-4">
										<span className={`inline-flex items-center text-[9px] font-bold uppercase border rounded-pill h-5 px-2 tracking-wider ${getStatusLabelColor(v.puc_status)}`}>
											<span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${getStatusDotColor(v.puc_status)}`} />
											{v.puc_status.replace('_', ' ').toLowerCase()}
										</span>
										<span className="block text-[10px] text-mute font-mono mt-1">
											Exp: {new Date(v.puc_expiry_date).toLocaleDateString([], { year: 'numeric', month: 'short' })}
										</span>
									</td>
									<td className="p-4">
										{v.flagged_issues && v.flagged_issues.length > 0 ? (
											<div className="relative group inline-block">
												<span className="cursor-help underline decoration-dotted text-status-alert font-semibold">
													{v.flagged_issues.length} {v.flagged_issues.length === 1 ? 'Issue' : 'Issues'}
												</span>
												<div className="hidden group-hover:block absolute z-20 bottom-full left-0 mb-2 w-64 bg-canvas border border-canvas-soft p-3 rounded-xl shadow-xl text-left">
													<h4 className="text-[10px] uppercase font-bold tracking-wider text-mute mb-2">Driver Flagged Issues</h4>
													<ul className="list-disc pl-4 space-y-1.5 text-[11px] text-ink font-sans">
														{v.flagged_issues.map((issue, idx) => (
															<li key={idx}>{issue}</li>
														))}
													</ul>
												</div>
											</div>
										) : (
											<span className="text-mute">—</span>
										)}
									</td>
									<td className="p-4 text-right">
										<button
											onClick={() => openOverrideModal(v)}
											className="inline-flex items-center justify-center border border-canvas-soft hover:border-ink hover:bg-canvas-soft text-[10px] font-bold rounded-pill h-7 px-3 transition-colors"
										>
											Override
										</button>
										{v.reminder_sent_at && (
											<span className="block text-[9px] text-mute mt-1 font-mono">
												Alerted: {new Date(v.reminder_sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* Override Settings Modal */}
			{selectedVehicle && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink font-sans">Manual Override: <span className="font-mono text-xs">{selectedVehicle.plate}</span></h3>
							<p className="text-[11px] text-mute mt-1">Directly adjust verification status, expiration parameters, and flagged issues</p>
						</div>

						<div className="grid grid-cols-2 gap-3">
							{/* RC status */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">RC Status</label>
								<select
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink"
									value={overrideRcStatus}
									onChange={(e) => setOverrideRcStatus(e.target.value)}
								>
									<option value="VERIFIED">Verified</option>
									<option value="EXPIRING_SOON">Expiring Soon</option>
									<option value="EXPIRED">Expired</option>
								</select>
							</div>

							{/* RC Expiry */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">RC Expiry Date</label>
								<input
									type="date"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={overrideRcExpiry}
									onChange={(e) => setOverrideRcExpiry(e.target.value)}
								/>
							</div>

							{/* Insurance status */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Insurance Status</label>
								<select
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink"
									value={overrideInsStatus}
									onChange={(e) => setOverrideInsStatus(e.target.value)}
								>
									<option value="VERIFIED">Verified</option>
									<option value="EXPIRING_SOON">Expiring Soon</option>
									<option value="EXPIRED">Expired</option>
								</select>
							</div>

							{/* Insurance Expiry */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Insurance Expiry Date</label>
								<input
									type="date"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={overrideInsExpiry}
									onChange={(e) => setOverrideInsExpiry(e.target.value)}
								/>
							</div>

							{/* PUC status */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">PUC Status</label>
								<select
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink"
									value={overridePucStatus}
									onChange={(e) => setOverridePucStatus(e.target.value)}
								>
									<option value="VERIFIED">Verified</option>
									<option value="EXPIRING_SOON">Expiring Soon</option>
									<option value="EXPIRED">Expired</option>
								</select>
							</div>

							{/* PUC Expiry */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">PUC Expiry Date</label>
								<input
									type="date"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={overridePucExpiry}
									onChange={(e) => setOverridePucExpiry(e.target.value)}
								/>
							</div>
						</div>

						{/* Last Serviced */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Last Serviced Date</label>
							<input
								type="date"
								className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
								value={overrideLastServiced}
								onChange={(e) => setOverrideLastServiced(e.target.value)}
							/>
						</div>

						{/* Flagged issues text list */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Flagged Issues (comma-separated)</label>
							<input
								type="text"
								placeholder="e.g. Brake pads wearing out, Left tail light bulb broken"
								className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
								value={overrideIssuesText}
								onChange={(e) => setOverrideIssuesText(e.target.value)}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setSelectedVehicle(null)}
								className="text-xs text-body hover:text-ink px-3"
								disabled={overrideLoading}
							>
								Cancel
							</button>
							<button
								onClick={handleSaveOverride}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors disabled:opacity-50"
								disabled={overrideLoading}
							>
								{overrideLoading ? 'Saving...' : 'Apply Overrides'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
