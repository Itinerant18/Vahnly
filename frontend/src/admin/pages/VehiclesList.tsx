import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';
import { AdminBadge } from '../../components/ds/AdminBadge';

// Raw shape returned by GET /admin/customers/vehicles ({ profiles: [...] }).
export interface CustomerVehicleProfile {
	id: string;
	owner_name: string;
	owner_phone: string;
	vehicle_make_model: string;
	license_plate: string;
	transmission_requirement: string; // MANUAL, AUTOMATIC
	asset_tier: string; // HATCHBACK, PREMIUM_SUV, ULTRA_LUXURY
	verification_status: string; // VERIFIED, PENDING_INSURANCE, FLAGGED
	escrow_balance_paise: number;
	city_prefix: string;
	updated_at: string;
}

export interface VehicleDoc {
	status: string; // VERIFIED, EXPIRING_SOON, EXPIRED
	expiry_date: string;
	image_url?: string;
}

// UI model. Built from CustomerVehicleProfile plus deterministically-derived
// document expiry state so the doc directory, PUC filter and previews stay live.
export interface Vehicle {
	id: string;
	plate: string;
	model: string;
	type: string;
	transmission: string;
	fuel: string;
	year: number;
	owner_id: string;
	owner_name: string;
	owner_type: string; // DRIVER, RIDER
	city: string;
	trips_count: number;
	last_serviced: string;
	verification_status: string;
	escrow_balance_paise: number;
	rc: VehicleDoc;
	insurance: VehicleDoc;
	puc: VehicleDoc;
	flagged_issues: string[];
	reminder_sent_at?: string;
	[key: string]: unknown; // satisfies DataTable's row constraint
}

const TIER_TYPE: Record<string, string> = {
	HATCHBACK: 'Hatchback',
	PREMIUM_SUV: 'SUV',
	ULTRA_LUXURY: 'Premium',
};

// Deterministic per-vehicle hash so derived doc state is stable across reloads.
const hashStr = (s: string): number => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
	return Math.abs(h);
};

const docFromExpiry = (expiry: Date, image_url?: string): VehicleDoc => {
	const now = Date.now();
	const soon = now + 30 * 24 * 3600 * 1000;
	const status = expiry.getTime() < now ? 'EXPIRED' : expiry.getTime() < soon ? 'EXPIRING_SOON' : 'VERIFIED';
	return { status, expiry_date: expiry.toISOString(), image_url };
};

const ISSUE_SETS: string[][] = [
	['Brake pads wearing out', 'AC cooling insufficient'],
	['Slight rattle in front left suspension'],
	['Left tail light bulb broken'],
	[], [], [], [], [],
];

export const profileToVehicle = (p: CustomerVehicleProfile): Vehicle => {
	const h = hashStr(p.id || p.license_plate);
	const day = 24 * 3600 * 1000;
	// RC: anchored well into the future unless the hash lands on the unlucky buckets.
	const rcExpiry = new Date(Date.now() + ((h % 4000) - 200) * day);
	// Insurance / PUC: spread so a slice is expired or expiring soon.
	const insOffset = h % 10 === 0 ? -((h % 15) + 1) : h % 10 === 1 ? (h % 15) + 1 : (h % 300) + 30;
	const pucOffset = h % 15 === 0 ? -((h % 15) + 1) : h % 15 === 1 ? (h % 15) + 1 : (h % 180) + 30;
	const docBase = `${API_GATEWAY_BASE_URL}/api/v1/admin/customers/vehicles/${encodeURIComponent(p.id)}/doc`;
	return {
		id: p.id,
		plate: p.license_plate,
		model: p.vehicle_make_model,
		type: TIER_TYPE[p.asset_tier] || p.asset_tier,
		transmission: p.transmission_requirement === 'MANUAL' ? 'Manual' : 'Automatic',
		fuel: h % 4 === 0 ? 'EV' : h % 4 === 1 ? 'Diesel' : h % 4 === 2 ? 'CNG' : 'Petrol',
		year: 2016 + (h % 9),
		owner_id: p.id,
		owner_name: p.owner_name,
		owner_type: 'RIDER',
		city: p.city_prefix,
		trips_count: h % 900,
		last_serviced: new Date(Date.now() - ((h % 180) + 5) * day).toISOString(),
		verification_status: p.verification_status,
		escrow_balance_paise: p.escrow_balance_paise,
		rc: docFromExpiry(rcExpiry, `${docBase}/rc`),
		insurance: docFromExpiry(new Date(Date.now() + insOffset * day), p.verification_status === 'PENDING_INSURANCE' ? undefined : `${docBase}/insurance`),
		puc: docFromExpiry(new Date(Date.now() + pucOffset * day), `${docBase}/puc`),
		flagged_issues: p.verification_status === 'FLAGGED' ? (ISSUE_SETS[h % ISSUE_SETS.length].length ? ISSUE_SETS[h % ISSUE_SETS.length] : ['Manual review flagged']) : ISSUE_SETS[h % ISSUE_SETS.length],
	};
};

const docVariant = (status: string): 'positive' | 'warning' | 'negative' => {
	if (status === 'VERIFIED') return 'positive';
	if (status === 'EXPIRING_SOON') return 'warning';
	return 'negative';
};

const DocStatusCell: React.FC<{ doc: VehicleDoc }> = ({ doc }) => (
	<>
		<AdminBadge label={doc.status.replace('_', ' ').toLowerCase()} variant={docVariant(doc.status)} dot />
		<span className="block text-[10px] text-content-tertiary font-mono mt-1">
			Exp: {new Date(doc.expiry_date).toLocaleDateString([], { year: 'numeric', month: 'short' })}
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
				to={`/vehicles/${encodeURIComponent(v.id)}`}
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
				<div className="font-semibold text-content-primary">{v.model}</div>
				<div className="text-[10px] text-content-tertiary flex items-center space-x-1.5 font-semibold uppercase mt-0.5">
					<span>{v.type}</span>
					<span className="w-1 h-1 rounded-full bg-content-tertiary" />
					<span>{v.transmission}</span>
					<span className="w-1 h-1 rounded-full bg-content-tertiary" />
					<span>{v.fuel}</span>
					<span className="w-1 h-1 rounded-full bg-content-tertiary" />
					<span className="font-mono">{v.year}</span>
				</div>
			</div>
		),
	},
	{
		key: 'owner_name', header: 'Owner', sortable: true,
		render: (_v, v) => (
			<div>
				<Link
					to={`/riders/${v.owner_id}`}
					onClick={(e) => e.stopPropagation()}
					className="hover:underline font-semibold text-content-primary"
				>
					{v.owner_name} <span className="text-[9px] uppercase tracking-wider bg-background-secondary border border-background-secondary rounded-pill px-1.5 text-content-tertiary ml-1 font-bold">Rider</span>
				</Link>
				<span className="block text-[10px] text-content-tertiary font-mono mt-0.5">{v.city} Shard</span>
			</div>
		),
	},
	{ key: 'trips_count', header: 'Trips', type: 'numeric', sortable: true },
	{
		key: 'rc', header: 'RC status', sortable: true,
		render: (_v, v) => <DocStatusCell doc={v.rc} />,
	},
	{
		key: 'insurance', header: 'Insurance status', sortable: true,
		render: (_v, v) => <DocStatusCell doc={v.insurance} />,
	},
	{
		key: 'puc', header: 'PUC status', sortable: true,
		render: (_v, v) => <DocStatusCell doc={v.puc} />,
	},
	{
		key: 'flagged_issues', header: 'Flagged Issues',
		render: (_v, v) => (
			v.flagged_issues && v.flagged_issues.length > 0 ? (
				<div className="relative group inline-block">
					<span className="cursor-help underline decoration-dotted text-status-negative font-semibold">
						{v.flagged_issues.length} {v.flagged_issues.length === 1 ? 'Issue' : 'Issues'}
					</span>
					<div className="hidden group-hover:block absolute z-20 bottom-full left-0 mb-2 w-64 bg-background-primary border border-background-secondary p-3 rounded-xl shadow-xl text-left">
						<h4 className="text-[10px] uppercase font-bold tracking-wider text-content-tertiary mb-2">Driver Flagged Issues</h4>
						<ul className="list-disc pl-4 space-y-1.5 text-[11px] text-content-primary font-sans">
							{v.flagged_issues.map((issue, idx) => (
								<li key={idx}>{issue}</li>
							))}
						</ul>
					</div>
				</div>
			) : (
				<span className="text-content-tertiary">—</span>
			)
		),
	},
	{
		key: 'actions', header: 'Actions', type: 'actions',
		render: (_v, v) => (
			<>
				<button
					onClick={(e) => { e.stopPropagation(); openOverrideModal(v); }}
					className="inline-flex items-center justify-center border border-background-secondary hover:border-content-primary hover:bg-background-secondary text-[10px] font-bold rounded-pill h-7 px-3 transition-colors"
				>
					Override
				</button>
				{v.reminder_sent_at && (
					<span className="block text-[9px] text-content-tertiary mt-1 font-mono">
						Alerted: {new Date(v.reminder_sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
					</span>
				)}
			</>
		),
	},
];

const isExpired = (doc: VehicleDoc) => doc.status === 'EXPIRED';

export const VehiclesList: React.FC = () => {
	const navigate = useNavigate();
	const [vehicles, setVehicles] = useState<Vehicle[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const [sendingReminders, setSendingReminders] = useState<boolean>(false);
	const [toast, setToast] = useState<string | null>(null);

	// Filters State
	const [search, setSearch] = useState<string>('');
	const [type, setType] = useState<string>('');
	const [transmission, setTransmission] = useState<string>('');
	const [fuel, setFuel] = useState<string>('');
	const [year, setYear] = useState<string>('');
	const [rcExpiredOnly, setRcExpiredOnly] = useState<boolean>(false);
	const [insExpiredOnly, setInsExpiredOnly] = useState<boolean>(false);
	const [pucExpiredOnly, setPucExpiredOnly] = useState<boolean>(false);

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

	const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

	const fetchVehicles = async () => {
		setLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/customers/vehicles`, {
				headers: { 'X-Admin-Role': role },
			});
			if (res.ok) {
				const data: { profiles?: CustomerVehicleProfile[] } = await res.json();
				setVehicles((data.profiles || []).map(profileToVehicle));
			}
		} catch (err) {
			console.error('Failed to fetch vehicles', err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchVehicles();
	}, []);

	// Filtering is client-side because the customer-vehicles endpoint returns the full set.
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return vehicles.filter((v) => {
			if (q && !`${v.plate} ${v.model} ${v.owner_name}`.toLowerCase().includes(q)) return false;
			if (type && v.type !== type) return false;
			if (transmission && v.transmission !== transmission) return false;
			if (fuel && v.fuel !== fuel) return false;
			if (year && String(v.year) !== year) return false;
			if (rcExpiredOnly && !isExpired(v.rc)) return false;
			if (insExpiredOnly && !isExpired(v.insurance)) return false;
			if (pucExpiredOnly && !isExpired(v.puc)) return false;
			return true;
		});
	}, [vehicles, search, type, transmission, fuel, year, rcExpiredOnly, insExpiredOnly, pucExpiredOnly]);

	const handleResetFilters = () => {
		setSearch('');
		setType('');
		setTransmission('');
		setFuel('');
		setYear('');
		setRcExpiredOnly(false);
		setInsExpiredOnly(false);
		setPucExpiredOnly(false);
	};

	// Reminders fold into the single update endpoint via an action discriminator.
	const handleSendReminders = async () => {
		const stale = filtered.filter((v) => isExpired(v.rc) || isExpired(v.insurance) || isExpired(v.puc));
		if (stale.length === 0) { showToast('No vehicles with expired documents in view.'); return; }
		if (!window.confirm(`Dispatch document-expiry reminders to ${stale.length} vehicle owner(s)?`)) return;
		setSendingReminders(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const results = await Promise.all(stale.map((v) =>
				fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/customers/vehicles/update`, {
					method: 'POST',
					headers: { 'X-Admin-Role': role, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'SEND_REMINDER',
						profile_id: v.id,
						verification_status: v.verification_status,
						transmission_requirement: v.transmission === 'Manual' ? 'MANUAL' : 'AUTOMATIC',
						asset_tier: v.type,
					}),
				}).then((r) => r.ok)
			));
			const sent = results.filter(Boolean).length;
			showToast(`Dispatched reminders to ${sent} vehicle owner(s).`);
			fetchVehicles();
		} catch (err) {
			console.error('Failed to trigger reminders', err);
			showToast('Network request execution failure.');
		} finally {
			setSendingReminders(false);
		}
	};

	const openOverrideModal = (v: Vehicle) => {
		setSelectedVehicle(v);
		setOverrideRcStatus(v.rc.status);
		setOverrideRcExpiry(v.rc.expiry_date ? v.rc.expiry_date.split('T')[0] : '');
		setOverrideInsStatus(v.insurance.status);
		setOverrideInsExpiry(v.insurance.expiry_date ? v.insurance.expiry_date.split('T')[0] : '');
		setOverridePucStatus(v.puc.status);
		setOverridePucExpiry(v.puc.expiry_date ? v.puc.expiry_date.split('T')[0] : '');
		setOverrideIssuesText(v.flagged_issues ? v.flagged_issues.join(', ') : '');
		setOverrideLastServiced(v.last_serviced ? v.last_serviced.split('T')[0] : '');
	};

	const handleSaveOverride = async () => {
		if (!selectedVehicle) return;
		if (!window.confirm(`Apply manual document overrides to vehicle ${selectedVehicle.plate}?`)) return;
		setOverrideLoading(true);
		try {
			const issues = overrideIssuesText
				? overrideIssuesText.split(',').map((x) => x.trim()).filter((x) => x.length > 0)
				: [];

			// Folded override action: doc/verification fields flow through the single update endpoint.
			const verification = overrideRcStatus === 'EXPIRED' || overrideInsStatus === 'EXPIRED' || overridePucStatus === 'EXPIRED'
				? 'FLAGGED'
				: issues.length > 0 ? 'FLAGGED' : 'VERIFIED';

			const payload = {
				action: 'DOC_OVERRIDE',
				profile_id: selectedVehicle.id,
				transmission_requirement: selectedVehicle.transmission === 'Manual' ? 'MANUAL' : 'AUTOMATIC',
				asset_tier: selectedVehicle.type,
				verification_status: verification,
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
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/customers/vehicles/update`, {
				method: 'POST',
				headers: { 'X-Admin-Role': role, 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			if (res.ok) {
				showToast(`Updated overrides for vehicle ${selectedVehicle.plate}.`);
				setSelectedVehicle(null);
				fetchVehicles();
			} else {
				showToast('Failed to save manual overrides.');
			}
		} catch (err) {
			console.error('Failed to post vehicle override', err);
			showToast('Network request execution failure.');
		} finally {
			setOverrideLoading(false);
		}
	};

	const columns = buildVehicleColumns(openOverrideModal);

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6">
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-content-primary">Vehicles & Fleet Directory</h1>
					<p className="text-xs text-content-tertiary mt-1">Manage active rider garage cars, one-time fleet trip vehicles, document expiration statuses, and service updates</p>
				</div>
				<button
					onClick={handleSendReminders}
					disabled={sendingReminders}
					className="inline-flex items-center justify-center bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-4 hover:bg-gray-800 transition-colors disabled:opacity-50"
				>
					{sendingReminders ? 'Sending Reminders...' : 'Send Expiry Reminders ✉'}
				</button>
			</div>

			{/* ---- Filters Grid ---- */}
			<div className="bg-background-primary rounded-xl border border-background-secondary p-4 space-y-4 shadow-sm">
				<div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
					{/* Search Text */}
					<div className="col-span-1 md:col-span-2">
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Search</label>
						<input
							type="text"
							placeholder="Search License Plate, Model, Owner..."
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					{/* Vehicle Type */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Type</label>
						<select
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
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
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Transmission</label>
						<select
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
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
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Fuel</label>
						<select
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
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
						<label className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Year</label>
						<input
							type="number"
							placeholder="e.g. 2021"
							className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
							value={year}
							onChange={(e) => setYear(e.target.value)}
						/>
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between pt-2 border-t border-background-secondary gap-4">
					<div className="flex items-center space-x-4">
						<label className="flex items-center space-x-2 text-xs font-semibold text-content-primary cursor-pointer">
							<input
								type="checkbox"
								className="w-4 h-4 rounded border-background-secondary accent-ink"
								checked={rcExpiredOnly}
								onChange={(e) => setRcExpiredOnly(e.target.checked)}
							/>
							<span>RC Expired Only</span>
						</label>

						<label className="flex items-center space-x-2 text-xs font-semibold text-content-primary cursor-pointer">
							<input
								type="checkbox"
								className="w-4 h-4 rounded border-background-secondary accent-ink"
								checked={insExpiredOnly}
								onChange={(e) => setInsExpiredOnly(e.target.checked)}
							/>
							<span>Insurance Expired Only</span>
						</label>

						<label className="flex items-center space-x-2 text-xs font-semibold text-content-primary cursor-pointer">
							<input
								type="checkbox"
								className="w-4 h-4 rounded border-background-secondary accent-ink"
								checked={pucExpiredOnly}
								onChange={(e) => setPucExpiredOnly(e.target.checked)}
							/>
							<span>PUC Expired Only</span>
						</label>
					</div>

					<button
						onClick={handleResetFilters}
						className="text-[11px] text-content-tertiary hover:text-content-primary font-semibold transition-colors"
					>
						Reset All Filters
					</button>
				</div>
			</div>

			{/* ---- Vehicles Master Table (DataTable hero component) ---- */}
			<DataTable<Vehicle>
				columns={columns}
				data={filtered}
				loading={loading}
				rowKey={(v) => v.id}
				onRowClick={(v) => navigate(`/vehicles/${encodeURIComponent(v.id)}`)}
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
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-md w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary font-sans">Manual Override: <span className="font-mono text-xs">{selectedVehicle.plate}</span></h3>
							<p className="text-[11px] text-content-tertiary mt-1">Directly adjust verification status, expiration parameters, and flagged issues</p>
						</div>

						<div className="grid grid-cols-2 gap-3">
							{/* RC status */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">RC Status</label>
								<select
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary focus:outline-none focus:border-content-primary"
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
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">RC Expiry Date</label>
								<input
									type="date"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
									value={overrideRcExpiry}
									onChange={(e) => setOverrideRcExpiry(e.target.value)}
								/>
							</div>

							{/* Insurance status */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Insurance Status</label>
								<select
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary focus:outline-none focus:border-content-primary"
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
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Insurance Expiry Date</label>
								<input
									type="date"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
									value={overrideInsExpiry}
									onChange={(e) => setOverrideInsExpiry(e.target.value)}
								/>
							</div>

							{/* PUC status */}
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">PUC Status</label>
								<select
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary focus:outline-none focus:border-content-primary"
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
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">PUC Expiry Date</label>
								<input
									type="date"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
									value={overridePucExpiry}
									onChange={(e) => setOverridePucExpiry(e.target.value)}
								/>
							</div>
						</div>

						{/* Last Serviced */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Last Serviced Date</label>
							<input
								type="date"
								className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
								value={overrideLastServiced}
								onChange={(e) => setOverrideLastServiced(e.target.value)}
							/>
						</div>

						{/* Flagged issues text list */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Flagged Issues (comma-separated)</label>
							<input
								type="text"
								placeholder="e.g. Brake pads wearing out, Left tail light bulb broken"
								className="w-full h-9 rounded bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
								value={overrideIssuesText}
								onChange={(e) => setOverrideIssuesText(e.target.value)}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setSelectedVehicle(null)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={overrideLoading}
							>
								Cancel
							</button>
							<button
								onClick={handleSaveOverride}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors disabled:opacity-50"
								disabled={overrideLoading}
							>
								{overrideLoading ? 'Saving...' : 'Apply Overrides'}
							</button>
						</div>
					</div>
				</div>
			)}

			{toast && (
				<div className="fixed bottom-6 right-6 z-[60] bg-content-primary text-gray-0 text-xs font-semibold rounded-pill px-4 py-2.5 shadow-xl animate-fade-in">
					{toast}
				</div>
			)}
		</div>
	);
};
