import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

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
	[key: string]: unknown; // satisfies DataTable's row constraint
}

// Preserve the page's specific document-status colors (VERIFIED / EXPIRING_SOON / EXPIRED).
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

const DocStatusCell: React.FC<{ status: string; expiry: string }> = ({ status, expiry }) => (
	<>
		<span className={`inline-flex items-center text-[9px] font-bold uppercase border rounded-pill h-5 px-2 tracking-wider ${getStatusLabelColor(status)}`}>
			<span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${getStatusDotColor(status)}`} />
			{status.replace('_', ' ').toLowerCase()}
		</span>
		<span className="block text-[10px] text-mute font-mono mt-1">
			Exp: {new Date(expiry).toLocaleDateString([], { year: 'numeric', month: 'short' })}
		</span>
	</>
);

// Column definitions for the DataTable hero component (built-in sort / loading / empty).
const buildVehicleColumns = (
	openOverrideModal: (v: Vehicle) => void,
): ColumnDef<Vehicle>[] => [
	{
		key: 'plate', header: 'Plate', sortable: true,
		render: (_v, v) => (
			<Link
				to={`/vehicles/${encodeURIComponent(v.plate)}`}
				onClick={(e) => e.stopPropagation()}
				className="font-mono text-mono-small font-bold text-content-accent hover:underline whitespace-nowrap"
			>
				{v.plate}
			</Link>
		),
	},
	{
		key: 'model', header: 'Model & Type', sortable: true,
		render: (_v, v) => (
			<div>
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
			</div>
		),
	},
	{
		key: 'owner_name', header: 'Owner', sortable: true,
		render: (_v, v) => (
			<div>
				{v.owner_type === 'DRIVER' ? (
					<Link
						to={`/drivers/${v.owner_id}`}
						onClick={(e) => e.stopPropagation()}
						className="hover:underline font-semibold text-ink"
					>
						{v.owner_name} <span className="text-[9px] uppercase tracking-wider bg-canvas-soft border border-canvas-soft rounded-pill px-1.5 text-mute ml-1 font-bold">Driver</span>
					</Link>
				) : (
					<Link
						to={`/riders/${v.owner_id}`}
						onClick={(e) => e.stopPropagation()}
						className="hover:underline font-semibold text-ink"
					>
						{v.owner_name} <span className="text-[9px] uppercase tracking-wider bg-canvas-soft border border-canvas-soft rounded-pill px-1.5 text-mute ml-1 font-bold">Rider</span>
					</Link>
				)}
				<span className="block text-[10px] text-mute font-mono mt-0.5">{v.city} Shard</span>
			</div>
		),
	},
	{ key: 'trips_count', header: 'Trips', type: 'numeric', sortable: true },
	{
		key: 'rc_status', header: 'RC status', sortable: true,
		render: (_v, v) => <DocStatusCell status={v.rc_status} expiry={v.rc_expiry_date} />,
	},
	{
		key: 'insurance_status', header: 'Insurance status', sortable: true,
		render: (_v, v) => <DocStatusCell status={v.insurance_status} expiry={v.insurance_expiry_date} />,
	},
	{
		key: 'puc_status', header: 'PUC status', sortable: true,
		render: (_v, v) => <DocStatusCell status={v.puc_status} expiry={v.puc_expiry_date} />,
	},
	{
		key: 'flagged_issues', header: 'Flagged Issues',
		render: (_v, v) => (
			v.flagged_issues && v.flagged_issues.length > 0 ? (
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
			)
		),
	},
	{
		key: 'actions', header: 'Actions', type: 'actions',
		render: (_v, v) => (
			<>
				<button
					onClick={(e) => { e.stopPropagation(); openOverrideModal(v); }}
					className="inline-flex items-center justify-center border border-canvas-soft hover:border-ink hover:bg-canvas-soft text-[10px] font-bold rounded-pill h-7 px-3 transition-colors"
				>
					Override
				</button>
				{v.reminder_sent_at && (
					<span className="block text-[9px] text-mute mt-1 font-mono">
						Alerted: {new Date(v.reminder_sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
					</span>
				)}
			</>
		),
	},
];

export const VehiclesList: React.FC = () => {
	const navigate = useNavigate();
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

			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/vehicles?${params.toString()}`, {
				headers: {
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
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/vehicles/reminders`, {
				method: 'POST',
				headers: {
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

			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/vehicles/${selectedVehicle.plate}/override`, {
				method: 'POST',
				headers: {
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

	const columns = buildVehicleColumns(openOverrideModal);

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

			{/* ---- Vehicles Master Table (DataTable hero component) ---- */}
			<DataTable<Vehicle>
				columns={columns}
				data={vehicles}
				loading={loading}
				rowKey={(v) => v.plate}
				onRowClick={(v) => navigate(`/vehicles/${encodeURIComponent(v.plate)}`)}
				emptyState={
					<div className="flex flex-col items-center gap-1 text-center">
						<span className="text-heading-medium text-content-secondary">No vehicles registered or found</span>
						<span className="text-paragraph-small text-content-tertiary">Try modifying filter criteria or search query</span>
					</div>
				}
			/>

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
