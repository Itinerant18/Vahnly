import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';
import { DataTable, type ColumnDef } from '../../components/ds/DataTable';

// Column definitions for the DataTable hero component (built-in sort / loading / empty).
const RIDER_COLUMNS: ColumnDef<RiderSummaryItem>[] = [
	{
		key: 'name', header: 'Name', type: 'avatar', sortable: true,
		render: (_v, r) => (
			<div>
				<span className="block font-semibold text-content-primary text-paragraph-medium">{r.name}</span>
				{r.tags && r.tags.length > 0 && (
					<div className="flex flex-wrap gap-1 mt-1">
						{r.tags.map((tag) => (
							<span
								key={tag}
								className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase font-mono ${
									tag.toLowerCase() === 'vip'
										? 'bg-ink text-on-dark'
										: tag.toLowerCase() === 'blocked'
										? 'bg-status-alert/10 text-status-alert'
										: 'bg-status-warn/10 text-status-warn'
								}`}
							>
								{tag}
							</span>
						))}
					</div>
				)}
			</div>
		),
	},
	{
		key: 'phone', header: 'Phone',
		render: (v) => <span className="font-mono text-mono-small text-content-secondary">{String(v)}</span>,
	},
	{ key: 'email', header: 'Email', sortable: true },
	{ key: 'total_trips', header: 'Trips', type: 'numeric', sortable: true },
	{
		key: 'average_rating', header: 'Rating', sortable: true,
		render: (v) => Number(v) > 0
			? <span className="font-mono text-mono-small text-content-primary">{Number(v).toFixed(1)} <span className="text-content-tertiary">★</span></span>
			: <span className="text-content-tertiary">—</span>,
	},
	{
		key: 'wallet_balance', header: 'Wallet', type: 'numeric', sortable: true,
		render: (v) => <span className="font-mono text-mono-small tabular-nums text-content-secondary font-semibold">₹{(Number(v) / 100).toFixed(2)}</span>,
	},
	{
		key: 'lifetime_value', header: 'LTV', type: 'numeric', sortable: true,
		render: (v) => <span className="font-mono text-mono-small tabular-nums text-content-primary font-bold">₹{(Number(v) / 100).toFixed(2)}</span>,
	},
	{ key: 'last_trip_date', header: 'Last Trip', type: 'date', sortable: true },
	{
		key: 'status', header: 'Status', sortable: true,
		render: (_v, r) => (
			<span
				className={`inline-flex items-center text-[10px] font-bold uppercase rounded-pill h-5 px-2.5 tracking-wider border ${
					r.status === 'ACTIVE'
						? 'bg-canvas text-ink border-canvas-soft'
						: r.status === 'SUSPENDED'
						? 'bg-canvas-soft text-status-warn border-canvas-soft'
						: r.status === 'BLOCKED'
						? 'bg-canvas-soft text-status-alert border-canvas-soft'
						: 'bg-canvas-soft text-mute border-canvas-soft'
				}`}
			>
				<span
					className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
						r.status === 'ACTIVE'
							? 'bg-status-online'
							: r.status === 'SUSPENDED'
							? 'bg-status-warn'
							: 'bg-status-alert'
					}`}
				/>
				{r.status.toLowerCase()}
			</span>
		),
	},
];

export interface RiderSummaryItem {
	customer_id: string;
	name: string;
	phone: string;
	email: string;
	signup_date: string;
	cities: string[];
	total_trips: number;
	average_rating: number;
	wallet_balance: number;
	lifetime_value: number;
	last_trip_date: string;
	status: string;
	tags: string[];
	referral_source: string;
	[key: string]: unknown; // satisfies DataTable's row constraint
}

export const RidersList: React.FC = () => {
	const navigate = useNavigate();
	const [riders, setRiders] = useState<RiderSummaryItem[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const [search, setSearch] = useState<string>('');
	const [city, setCity] = useState<string>('');
	const [tag, setTag] = useState<string>('');
	const [referral, setReferral] = useState<string>('');
	
	// Advanced range filters
	const [tripsMin, setTripsMin] = useState<string>('');
	const [tripsMax, setTripsMax] = useState<string>('');
	const [ratingMin, setRatingMin] = useState<string>('');
	const [walletMin, setWalletMin] = useState<string>('');
	const [walletMax, setWalletMax] = useState<string>('');
	const [ltvMin, setLtvMin] = useState<string>('');
	const [ltvMax, setLtvMax] = useState<string>('');
	const [signupStart, setSignupStart] = useState<string>('');
	const [signupEnd, setSignupEnd] = useState<string>('');

	const fetchRiders = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (search) params.append('search', search);
			if (city) params.append('city_prefix', city);
			if (tag) params.append('tag', tag);
			if (referral) params.append('referral_source', referral);
			
			if (tripsMin) params.append('trips_min', tripsMin);
			if (tripsMax) params.append('trips_max', tripsMax);
			if (ratingMin) params.append('rating_min', ratingMin);
			
			// Convert ₹ to paise for backend API
			if (walletMin) params.append('wallet_min', (parseFloat(walletMin) * 100).toString());
			if (walletMax) params.append('wallet_max', (parseFloat(walletMax) * 100).toString());
			if (ltvMin) params.append('ltv_min', (parseFloat(ltvMin) * 100).toString());
			if (ltvMax) params.append('ltv_max', (parseFloat(ltvMax) * 100).toString());
			
			if (signupStart) params.append('signup_start', signupStart);
			if (signupEnd) params.append('signup_end', signupEnd);

			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/riders?${params.toString()}`, {
				headers: {
					'X-Admin-Role': role,
				},
			});

			if (res.ok) {
				const data = await res.json();
				setRiders(data || []);
			}
		} catch (err) {
			console.error('Failed to fetch riders list', err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchRiders();
	}, [search, city, tag, referral, tripsMin, tripsMax, ratingMin, walletMin, walletMax, ltvMin, ltvMax, signupStart, signupEnd]);

	const exportCSV = () => {
		const headers = ['ID', 'Name', 'Phone', 'Cities', 'Trips', 'Spent (₹)', 'Status', 'Joined'];
		const rows = riders.map((r) => [
			r.customer_id,
			r.name,
			r.phone,
			(r.cities || []).join('|'),
			String(r.total_trips),
			(r.lifetime_value / 100).toFixed(2),
			r.status,
			r.signup_date ? new Date(r.signup_date).toISOString().slice(0, 10) : '',
		]);
		const csv = [headers, ...rows]
			.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'riders.csv';
		a.click();
		URL.revokeObjectURL(url);
	};

	const handleResetFilters = () => {
		setSearch('');
		setCity('');
		setTag('');
		setReferral('');
		setTripsMin('');
		setTripsMax('');
		setRatingMin('');
		setWalletMin('');
		setWalletMax('');
		setLtvMin('');
		setLtvMax('');
		setSignupStart('');
		setSignupEnd('');
	};

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6">
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-ink">Riders Matrix</h1>
					<p className="text-xs text-mute mt-1">Monitor passenger lifetime value, activity trends, risk scores, and account status</p>
				</div>
				<button
					onClick={exportCSV}
					disabled={riders.length === 0}
					className="h-9 px-4 rounded-pill bg-ink text-canvas text-xs font-semibold disabled:opacity-40"
				>
					Export CSV
				</button>
			</div>

			{/* ---- Filters Panel ---- */}
			<div className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-4 shadow-sm">
				<div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
					{/* Text Search */}
					<div className="col-span-1 md:col-span-2">
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Search</label>
						<input
							type="text"
							placeholder="Search Name, Phone, Email, UUID..."
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-mono"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
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

					{/* Tag selector */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Tags</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
							value={tag}
							onChange={(e) => setTag(e.target.value)}
						>
							<option value="">All Tags</option>
							<option value="VIP">VIP</option>
							<option value="blocked">Blocked</option>
							<option value="risky">Risky</option>
						</select>
					</div>

					{/* Referral Source */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Referral Source</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
							value={referral}
							onChange={(e) => setReferral(e.target.value)}
						>
							<option value="">All Sources</option>
							<option value="Organic">Organic</option>
							<option value="Google Ads">Google Ads</option>
							<option value="App Store">App Store</option>
							<option value="Referral Code">Referral Code</option>
							<option value="Facebook Campaign">Facebook</option>
						</select>
					</div>

					{/* Rating Threshold */}
					<div>
						<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Min Rating (★)</label>
						<select
							className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
							value={ratingMin}
							onChange={(e) => setRatingMin(e.target.value)}
						>
							<option value="">Any</option>
							<option value="4.5">4.5+ ★</option>
							<option value="4.0">4.0+ ★</option>
							<option value="3.0">3.0+ ★</option>
							<option value="2.0">2.0+ ★</option>
						</select>
					</div>
				</div>

				{/* Advanced numeric filters */}
				<div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 pt-2 border-t border-canvas-soft">
					{/* Trips count */}
					<div className="flex items-center space-x-2">
						<div className="w-1/2">
							<label className="block text-[9px] uppercase text-mute font-semibold">Min Trips</label>
							<input
								type="number"
								placeholder="0"
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
								value={tripsMin}
								onChange={(e) => setTripsMin(e.target.value)}
							/>
						</div>
						<div className="w-1/2">
							<label className="block text-[9px] uppercase text-mute font-semibold">Max Trips</label>
							<input
								type="number"
								placeholder="any"
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
								value={tripsMax}
								onChange={(e) => setTripsMax(e.target.value)}
							/>
						</div>
					</div>

					{/* Wallet balance */}
					<div className="flex items-center space-x-2">
						<div className="w-1/2">
							<label className="block text-[9px] uppercase text-mute font-semibold">Min Wallet (₹)</label>
							<input
								type="number"
								placeholder="0"
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
								value={walletMin}
								onChange={(e) => setWalletMin(e.target.value)}
							/>
						</div>
						<div className="w-1/2">
							<label className="block text-[9px] uppercase text-mute font-semibold">Max Wallet (₹)</label>
							<input
								type="number"
								placeholder="any"
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
								value={walletMax}
								onChange={(e) => setWalletMax(e.target.value)}
							/>
						</div>
					</div>

					{/* LTV */}
					<div className="flex items-center space-x-2">
						<div className="w-1/2">
							<label className="block text-[9px] uppercase text-mute font-semibold">Min LTV (₹)</label>
							<input
								type="number"
								placeholder="0"
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
								value={ltvMin}
								onChange={(e) => setLtvMin(e.target.value)}
							/>
						</div>
						<div className="w-1/2">
							<label className="block text-[9px] uppercase text-mute font-semibold">Max LTV (₹)</label>
							<input
								type="number"
								placeholder="any"
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
								value={ltvMax}
								onChange={(e) => setLtvMax(e.target.value)}
							/>
						</div>
					</div>

					{/* Signup date range */}
					<div className="flex items-center space-x-2 col-span-1 md:col-span-2">
						<div className="w-1/2">
							<label className="block text-[9px] uppercase text-mute font-semibold">Signed Up From</label>
							<input
								type="date"
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink font-mono"
								value={signupStart}
								onChange={(e) => setSignupStart(e.target.value)}
							/>
						</div>
						<div className="w-1/2">
							<label className="block text-[9px] uppercase text-mute font-semibold">Signed Up To</label>
							<input
								type="date"
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink font-mono"
								value={signupEnd}
								onChange={(e) => setSignupEnd(e.target.value)}
							/>
						</div>
					</div>
				</div>

				<div className="flex justify-end pt-1">
					<button
						onClick={handleResetFilters}
						className="text-[11px] text-mute hover:text-ink font-semibold transition-colors"
					>
						Reset All Filters
					</button>
				</div>
			</div>

			{/* ---- Riders Table (DataTable hero component) ---- */}
			<DataTable<RiderSummaryItem>
				columns={RIDER_COLUMNS}
				data={riders}
				loading={loading}
				rowKey={(r) => r.customer_id}
				onRowClick={(r) => navigate(`/riders/${r.customer_id}`)}
				emptyState={
					<div className="flex flex-col items-center gap-1 text-center">
						<span className="text-heading-medium text-content-secondary">No riders match selection criteria</span>
						<span className="text-paragraph-small text-content-tertiary">Try resetting filter parameters or adjusting terms</span>
					</div>
				}
			/>
		</div>
	);
};
