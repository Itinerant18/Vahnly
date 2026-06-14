import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

export interface PromoCode {
	code: string;
	promo_type: string; // PERCENT, FLAT, FREE_RIDE, CASHBACK, FIRST_RIDE
	value: number; // discount % or flat rupees
	max_discount_paise: number;
	min_fare_paise: number;
	trip_types: string[];
	car_types: string[];
	cities: string[];
	payment_methods: string[];
	user_segment: string; // ALL, NEW, VIP
	usage_cap_total: number;
	usage_cap_per_user: number;
	valid_from: string;
	valid_to: string;
	stackable: boolean;
	status: string; // DRAFT, SCHEDULED, ACTIVE, PAUSED, EXPIRED
	redemptions_count: number;
	created_at?: string;
}

export interface BannerOffer {
	id: string;
	banner_text: string;
	city_prefix: string;
	is_active: boolean;
	valid_from: string;
	valid_to: string;
}

export interface ReferralRule {
	referrer_role: string; // RIDER, DRIVER
	referee_role: string;  // RIDER, DRIVER
	trigger_type: string;  // SIGNUP, FIRST_TRIP, NTH_TRIP
	trigger_count: number;
	reward_type: string; // WALLET_CREDIT, FREE_RIDE, CASH
	reward_amount_paise: number;
}

export interface ReferralSettings {
	rules: ReferralRule[];
	block_same_device: boolean;
	block_ip_cluster: boolean;
}

export interface LoyaltyTier {
	tier_name: string; // SILVER, GOLD, PLATINUM
	min_trips: number;
	perk_discount_percent: number;
	perk_priority_dispatch: boolean;
	perk_free_care: boolean;
}

export interface LoyaltySettings {
	tiers: LoyaltyTier[];
}

export interface PromoAnalytics {
	code: string;
	redemptions: number;
	gmv_impact_paise: number;
	marketing_roi_percent: number;
}

export const CITIES = ['KOL', 'BLR', 'DEL', 'MUM'];
export const CAR_TYPES = ['Hatchback', 'Sedan', 'SUV', 'Premium'];
export const TRIP_TYPES = ['in-city round', 'one-way', 'mini-outstation', 'outstation'];
export const PAYMENT_METHODS = ['Stripe', 'Razorpay', 'Cash'];
export const SEGMENTS = ['ALL', 'NEW', 'VIP'];
export const PROMO_TYPES = ['PERCENT', 'FLAT', 'FREE_RIDE', 'CASHBACK', 'FIRST_RIDE'];

export const PromotionsDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<'promos' | 'banners' | 'referrals' | 'loyalty'>('promos');

	// --- Promos Registry States ---
	const [promos, setPromos] = useState<PromoCode[]>([]);
	const [promosLoading, setPromosLoading] = useState<boolean>(true);
	const [statusFilter, setStatusFilter] = useState<string>('');
	const [cityFilter, setCityFilter] = useState<string>('');
	const [segmentFilter, setSegmentFilter] = useState<string>('');

	// Create Promo Modal
	const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
	const [newPromo, setNewPromo] = useState<Partial<PromoCode>>({
		code: '',
		promo_type: 'PERCENT',
		value: 10,
		max_discount_paise: 10000,
		min_fare_paise: 5000,
		trip_types: ['one-way'],
		car_types: ['Hatchback', 'Sedan'],
		cities: ['KOL'],
		payment_methods: ['Stripe', 'Razorpay'],
		user_segment: 'ALL',
		usage_cap_total: 1000,
		usage_cap_per_user: 1,
		valid_from: new Date().toISOString().slice(0, 16),
		valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
		stackable: false,
		status: 'ACTIVE',
	});

	// Bulk Upload Modal
	const [showBulkModal, setShowBulkModal] = useState<boolean>(false);
	const [bulkCsvText, setBulkCsvText] = useState<string>('');
	const [bulkUploading, setBulkUploading] = useState<boolean>(false);

	// Analytics Modal
	const [selectedPromoAnalytics, setSelectedPromoAnalytics] = useState<PromoAnalytics | null>(null);
	const [analyticsLoading, setAnalyticsLoading] = useState<boolean>(false);

	// --- App Banners States ---
	const [banners, setBanners] = useState<BannerOffer[]>([]);
	const [bannersLoading, setBannersLoading] = useState<boolean>(true);
	const [newBanner, setNewBanner] = useState<Partial<BannerOffer>>({
		banner_text: '',
		city_prefix: 'KOL',
		is_active: true,
		valid_from: new Date().toISOString().slice(0, 16),
		valid_to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
	});

	// --- Referrals States ---
	const [referralSettings, setReferralSettings] = useState<ReferralSettings | null>(null);
	const [referralsLoading, setReferralsLoading] = useState<boolean>(true);
	const [newReferralRule, setNewReferralRule] = useState<ReferralRule>({
		referrer_role: 'RIDER',
		referee_role: 'RIDER',
		trigger_type: 'FIRST_TRIP',
		trigger_count: 1,
		reward_type: 'WALLET_CREDIT',
		reward_amount_paise: 10000, // Rs 100
	});

	// --- Loyalty States ---
	const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings | null>(null);
	const [loyaltyLoading, setLoyaltyLoading] = useState<boolean>(true);

	// Token & Role Auth
	const role = localStorage.getItem('admin_role') || 'ADMIN';
	const headers = {
		'X-Admin-Role': role,
		'Content-Type': 'application/json',
	};

	// --- Fetch Handlers ---
	const fetchPromos = async () => {
		setPromosLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos`, { headers });
			if (res.ok) {
				const data = await res.json();
				setPromos(data || []);
			}
		} catch (err) {
			console.error('Failed to fetch promos', err);
		} finally {
			setPromosLoading(false);
		}
	};

	const fetchBanners = async () => {
		setBannersLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/banners`, { headers });
			if (res.ok) {
				const data = await res.json();
				setBanners(data || []);
			}
		} catch (err) {
			console.error('Failed to fetch banners', err);
		} finally {
			setBannersLoading(false);
		}
	};

	const fetchReferralSettings = async () => {
		setReferralsLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/referral`, { headers });
			if (res.ok) {
				const data = await res.json();
				setReferralSettings(data);
			}
		} catch (err) {
			console.error('Failed to fetch referral settings', err);
		} finally {
			setReferralsLoading(false);
		}
	};

	const fetchLoyaltySettings = async () => {
		setLoyaltyLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/loyalty`, { headers });
			if (res.ok) {
				const data = await res.json();
				setLoyaltySettings(data);
			}
		} catch (err) {
			console.error('Failed to fetch loyalty settings', err);
		} finally {
			setLoyaltyLoading(false);
		}
	};

	useEffect(() => {
		if (activeTab === 'promos') fetchPromos();
		if (activeTab === 'banners') fetchBanners();
		if (activeTab === 'referrals') fetchReferralSettings();
		if (activeTab === 'loyalty') fetchLoyaltySettings();
	}, [activeTab]);

	// --- Action Handlers ---

	// State toggle (Pause/Resume/Expire)
	const handleUpdatePromoState = async (code: string, newStatus: string) => {
		if (newStatus === 'EXPIRED' && !window.confirm(`Expire promo ${code}? This permanently deactivates a live promotion.`)) {
			return;
		}
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/${code}/state`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ status: newStatus }),
			});
			if (res.ok) {
				fetchPromos();
			} else {
				alert('Failed to update promotion state.');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Create single promo code
	const handleCreatePromo = async () => {
		if (!newPromo.code || !newPromo.promo_type) {
			alert('Please fill out code identifier and promotion category.');
			return;
		}
		// Reject "discount forever" / unlimited promos before they reach the server.
		const validFrom = newPromo.valid_from ? new Date(newPromo.valid_from) : new Date();
		const validTo = newPromo.valid_to ? new Date(newPromo.valid_to) : null;
		if (!validTo || isNaN(validTo.getTime()) || validTo.getTime() <= Date.now()) {
			alert('Set a valid expiry date in the future.');
			return;
		}
		if (validTo.getTime() <= validFrom.getTime()) {
			alert('Expiry must be after the start date.');
			return;
		}
		if (!newPromo.value || newPromo.value <= 0) {
			alert('Discount value must be greater than zero.');
			return;
		}
		if (!newPromo.usage_cap_total || newPromo.usage_cap_total <= 0) {
			alert('Set a total usage cap — unlimited promos are not allowed.');
			return;
		}
		if (!window.confirm(
			`Create promo ${newPromo.code} (${newPromo.promo_type}) valid until ${validTo.toLocaleString()}, total cap ${newPromo.usage_cap_total}?`
		)) {
			return;
		}
		try {
			const payload = {
				...newPromo,
				valid_from: new Date(newPromo.valid_from!).toISOString(),
				valid_to: new Date(newPromo.valid_to!).toISOString(),
			};
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos`, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			});
			if (res.ok) {
				setShowCreateModal(false);
				setNewPromo({
					code: '',
					promo_type: 'PERCENT',
					value: 10,
					max_discount_paise: 10000,
					min_fare_paise: 5000,
					trip_types: ['one-way'],
					car_types: ['Hatchback', 'Sedan'],
					cities: ['KOL'],
					payment_methods: ['Stripe', 'Razorpay'],
					user_segment: 'ALL',
					usage_cap_total: 1000,
					usage_cap_per_user: 1,
					valid_from: new Date().toISOString().slice(0, 16),
					valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
					stackable: false,
					status: 'ACTIVE',
				});
				fetchPromos();
			} else {
				alert('Failed to create promo configuration.');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Bulk CSV Upload
	const handleBulkUpload = async () => {
		if (!bulkCsvText.trim()) {
			alert('Please paste valid CSV lines.');
			return;
		}
		setBulkUploading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/bulk`, {
				method: 'POST',
				headers: {
					'X-Admin-Role': role,
					'Content-Type': 'text/csv',
				},
				body: bulkCsvText,
			});
			if (res.ok) {
				const data = await res.json();
				alert(`Successfully imported ${data.uploaded_count || 0} promo codes.`);
				setShowBulkModal(false);
				setBulkCsvText('');
				fetchPromos();
			} else {
				alert('Failed parsing/uploading bulk CSV dataset.');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		} finally {
			setBulkUploading(false);
		}
	};

	// Open Analytics
	const handleViewAnalytics = async (code: string) => {
		setAnalyticsLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/${code}/analytics`, { headers });
			if (res.ok) {
				const data = await res.json();
				setSelectedPromoAnalytics(data);
			}
		} catch (err) {
			console.error(err);
		} finally {
			setAnalyticsLoading(false);
		}
	};

	// Save Banner settings
	const handleSaveBanners = async (updatedBanners: BannerOffer[]) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/banners`, {
				method: 'POST',
				headers,
				body: JSON.stringify(updatedBanners),
			});
			if (res.ok) {
				alert('Banner configuration matrix updated successfully.');
				fetchBanners();
			} else {
				alert('Failed to save banner configurations.');
			}
		} catch (err) {
			console.error(err);
			alert('Network failure.');
		}
	};

	const handleAddBanner = () => {
		if (!newBanner.banner_text) {
			alert('Please fill out the banner notification text.');
			return;
		}
		const bannerObj: BannerOffer = {
			id: `banner-${Date.now()}`,
			banner_text: newBanner.banner_text,
			city_prefix: newBanner.city_prefix || 'KOL',
			is_active: newBanner.is_active ?? true,
			valid_from: new Date(newBanner.valid_from!).toISOString(),
			valid_to: new Date(newBanner.valid_to!).toISOString(),
		};
		const updated = [...banners, bannerObj];
		setBanners(updated);
		setNewBanner({
			banner_text: '',
			city_prefix: 'KOL',
			is_active: true,
			valid_from: new Date().toISOString().slice(0, 16),
			valid_to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
		});
		handleSaveBanners(updated);
	};

	const handleRemoveBanner = (id: string) => {
		const updated = banners.filter(b => b.id !== id);
		setBanners(updated);
		handleSaveBanners(updated);
	};

	const handleToggleBanner = (id: string) => {
		const updated = banners.map(b => b.id === id ? { ...b, is_active: !b.is_active } : b);
		setBanners(updated);
		handleSaveBanners(updated);
	};

	// Save Referral Settings
	const handleSaveReferrals = async (updatedSettings: ReferralSettings) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/referral`, {
				method: 'POST',
				headers,
				body: JSON.stringify(updatedSettings),
			});
			if (res.ok) {
				alert('Referral configurations and fraud criteria updated.');
				fetchReferralSettings();
			} else {
				alert('Failed to save referral configurations.');
			}
		} catch (err) {
			console.error(err);
			alert('Network error.');
		}
	};

	const handleAddReferralRule = () => {
		if (!referralSettings) return;
		const updatedRules = [...referralSettings.rules, newReferralRule];
		const updatedSettings = { ...referralSettings, rules: updatedRules };
		setReferralSettings(updatedSettings);
		handleSaveReferrals(updatedSettings);
	};

	const handleRemoveReferralRule = (idx: number) => {
		if (!referralSettings) return;
		const updatedRules = referralSettings.rules.filter((_, i) => i !== idx);
		const updatedSettings = { ...referralSettings, rules: updatedRules };
		setReferralSettings(updatedSettings);
		handleSaveReferrals(updatedSettings);
	};

	// Save Loyalty Settings
	const handleSaveLoyalty = async () => {
		if (!loyaltySettings) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/promos/loyalty`, {
				method: 'POST',
				headers,
				body: JSON.stringify(loyaltySettings),
			});
			if (res.ok) {
				alert('Loyalty tiers and reward multipliers synced.');
				fetchLoyaltySettings();
			} else {
				alert('Failed to update loyalty settings.');
			}
		} catch (err) {
			console.error(err);
			alert('Network connection loss.');
		}
	};

	const handleUpdateTierTripLimit = (idx: number, val: number) => {
		if (!loyaltySettings) return;
		const updatedTiers = [...loyaltySettings.tiers];
		updatedTiers[idx].min_trips = val;
		setLoyaltySettings({ ...loyaltySettings, tiers: updatedTiers });
	};

	const handleUpdateTierDiscount = (idx: number, val: number) => {
		if (!loyaltySettings) return;
		const updatedTiers = [...loyaltySettings.tiers];
		updatedTiers[idx].perk_discount_percent = val;
		setLoyaltySettings({ ...loyaltySettings, tiers: updatedTiers });
	};

	const handleToggleTierPerk = (idx: number, perk: 'dispatch' | 'care') => {
		if (!loyaltySettings) return;
		const updatedTiers = [...loyaltySettings.tiers];
		if (perk === 'dispatch') {
			updatedTiers[idx].perk_priority_dispatch = !updatedTiers[idx].perk_priority_dispatch;
		} else {
			updatedTiers[idx].perk_free_care = !updatedTiers[idx].perk_free_care;
		}
		setLoyaltySettings({ ...loyaltySettings, tiers: updatedTiers });
	};

	// Filters helper
	const filteredPromos = promos.filter(p => {
		if (statusFilter && p.status !== statusFilter) return false;
		if (cityFilter && !p.cities.includes(cityFilter)) return false;
		if (segmentFilter && p.user_segment !== segmentFilter) return false;
		return true;
	});

	// Formatting Helpers
	const formatPaise = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight text-content-primary">Promotions & Loyalty Management</h1>
				<p className="text-xs text-content-tertiary mt-1">Manage corporate marketing promo codes, bulk CSV registrations, active app banners, referral parameters, and loyalty brackets</p>
			</div>

			{/* Tabs Navigation */}
			<div className="flex border-b border-background-secondary bg-background-primary rounded-xl p-1 shadow-sm max-w-lg">
				<button
					onClick={() => setActiveTab('promos')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'promos' ? 'bg-background-secondary text-content-primary border border-background-secondary' : 'text-content-tertiary hover:text-content-primary'
					}`}
				>
					Promo Codes
				</button>
				<button
					onClick={() => setActiveTab('banners')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'banners' ? 'bg-background-secondary text-content-primary border border-background-secondary' : 'text-content-tertiary hover:text-content-primary'
					}`}
				>
					App Banners
				</button>
				<button
					onClick={() => setActiveTab('referrals')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'referrals' ? 'bg-background-secondary text-content-primary border border-background-secondary' : 'text-content-tertiary hover:text-content-primary'
					}`}
				>
					Referral Engine
				</button>
				<button
					onClick={() => setActiveTab('loyalty')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'loyalty' ? 'bg-background-secondary text-content-primary border border-background-secondary' : 'text-content-tertiary hover:text-content-primary'
					}`}
				>
					Loyalty Tiers
				</button>
			</div>

			{/* TAB: PROMO CODES */}
			{activeTab === 'promos' && (
				<div className="space-y-6 animate-fade-in">
					{/* Controls Header */}
					<div className="flex flex-wrap items-center justify-between gap-4 bg-background-primary p-4 rounded-xl border border-background-secondary shadow-sm">
						<div className="flex items-center space-x-4">
							<div className="flex flex-col">
								<label className="text-[10px] uppercase font-bold text-content-tertiary mb-1 font-sans">Filter Status</label>
								<select
									className="h-8 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono font-bold"
									value={statusFilter}
									onChange={(e) => setStatusFilter(e.target.value)}
								>
									<option value="">ALL STATUSES</option>
									<option value="DRAFT">DRAFT</option>
									<option value="SCHEDULED">SCHEDULED</option>
									<option value="ACTIVE">ACTIVE</option>
									<option value="PAUSED">PAUSED</option>
									<option value="EXPIRED">EXPIRED</option>
								</select>
							</div>

							<div className="flex flex-col">
								<label className="text-[10px] uppercase font-bold text-content-tertiary mb-1 font-sans">Filter Shard</label>
								<select
									className="h-8 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono font-semibold"
									value={cityFilter}
									onChange={(e) => setCityFilter(e.target.value)}
								>
									<option value="">ALL SHARDS</option>
									{CITIES.map(c => <option key={c} value={c}>{c}</option>)}
								</select>
							</div>

							<div className="flex flex-col">
								<label className="text-[10px] uppercase font-bold text-content-tertiary mb-1 font-sans">User Segment</label>
								<select
									className="h-8 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono font-semibold"
									value={segmentFilter}
									onChange={(e) => setSegmentFilter(e.target.value)}
								>
									<option value="">ALL SEGMENTS</option>
									{SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
								</select>
							</div>
						</div>

						<div className="flex space-x-2">
							<button
								onClick={() => setShowBulkModal(true)}
								className="border border-background-secondary hover:border-content-primary text-xs font-semibold rounded-pill h-8 px-4 transition-colors"
							>
								Bulk Upload CSV
							</button>
							<button
								onClick={() => setShowCreateModal(true)}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
							>
								Create Promo Code +
							</button>
						</div>
					</div>

					{/* Registry Table */}
					<div className="bg-background-primary rounded-xl border border-background-secondary overflow-hidden shadow-sm">
						{promosLoading ? (
							<div className="p-12 text-center text-xs text-content-tertiary animate-pulse">Fetching promotions database registry...</div>
						) : filteredPromos.length === 0 ? (
							<div className="p-12 text-center">
								<div className="text-sm font-semibold text-content-primary">No promotions registered matching filters</div>
								<p className="text-xs text-content-tertiary mt-1">Configure a new code or adjust filters to list registry keys.</p>
							</div>
						) : (
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="border-b border-background-secondary bg-background-secondary">
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Code</th>
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Type</th>
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Value</th>
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Caps (Max / Min)</th>
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Segment</th>
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary text-center">Redemptions</th>
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Validity Range</th>
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Status</th>
										<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary text-right">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-background-secondary text-xs">
									{filteredPromos.map((p) => (
										<tr key={p.code} className="hover:bg-background-tertiary transition-colors">
											<td className="p-4 font-mono font-bold text-content-primary text-sm tracking-wide">{p.code}</td>
											<td className="p-4 font-semibold text-content-secondary">{p.promo_type}</td>
											<td className="p-4 font-mono text-content-primary font-bold">
												{p.promo_type === 'PERCENT' ? `${p.value}%` : `₹${p.value}`}
											</td>
											<td className="p-4 font-mono text-content-secondary space-y-0.5">
												<div>Max: {formatPaise(p.max_discount_paise)}</div>
												<div className="text-[10px] text-content-tertiary">Min Fare: {formatPaise(p.min_fare_paise)}</div>
											</td>
											<td className="p-4">
												<span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-background-secondary text-content-primary">
													{p.user_segment}
												</span>
											</td>
											<td className="p-4 text-center font-mono font-bold text-content-primary">
												{p.redemptions_count} / {p.usage_cap_total}
											</td>
											<td className="p-4 font-mono text-content-secondary space-y-0.5 text-[11px]">
												<div>From: {new Date(p.valid_from).toLocaleDateString()}</div>
												<div>To: {new Date(p.valid_to).toLocaleDateString()}</div>
											</td>
											<td className="p-4">
												<span
													className={`inline-flex items-center text-[10px] font-bold uppercase rounded-pill h-5 px-2.5 tracking-wider border ${
														p.status === 'ACTIVE'
															? 'bg-background-primary text-content-primary border-background-secondary'
															: p.status === 'PAUSED'
															? 'bg-background-secondary text-status-pending border-background-secondary'
															: p.status === 'EXPIRED'
															? 'bg-background-secondary text-status-negative border-background-secondary'
															: 'bg-background-secondary text-content-tertiary border-background-secondary'
													}`}
												>
													<span
														className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
															p.status === 'ACTIVE'
																? 'bg-status-online'
																: p.status === 'PAUSED'
																? 'bg-status-pending'
																: 'bg-status-negative'
														}`}
													/>
													{p.status}
												</span>
											</td>
											<td className="p-4 text-right space-x-1 space-y-1">
												<button
													onClick={() => handleViewAnalytics(p.code)}
													className="border border-background-secondary hover:border-content-primary text-[10px] font-bold px-2 py-1 rounded"
												>
													{analyticsLoading ? '...' : 'Analytics 📊'}
												</button>
												{p.status === 'ACTIVE' ? (
													<button
														onClick={() => handleUpdatePromoState(p.code, 'PAUSED')}
														className="bg-background-secondary text-status-pending border border-background-secondary hover:border-status-pending text-[10px] font-bold px-2 py-1 rounded"
													>
														Pause
													</button>
												) : p.status === 'PAUSED' || p.status === 'DRAFT' ? (
													<button
														onClick={() => handleUpdatePromoState(p.code, 'ACTIVE')}
														className="bg-content-primary text-gray-0 hover:bg-gray-800 text-[10px] font-bold px-2 py-1 rounded"
													>
														Resume
													</button>
												) : null}
												{p.status !== 'EXPIRED' && (
													<button
														onClick={() => handleUpdatePromoState(p.code, 'EXPIRED')}
														className="bg-background-secondary text-status-negative border border-background-secondary hover:border-status-negative text-[10px] font-bold px-2 py-1 rounded"
													>
														Expire
													</button>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				</div>
			)}

			{/* TAB: APP BANNERS */}
			{activeTab === 'banners' && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
					{/* Master Config list */}
					<div className="lg:col-span-2 bg-background-primary p-6 rounded-xl border border-background-secondary shadow-sm space-y-6">
						<div>
							<h2 className="text-sm font-bold text-content-primary uppercase tracking-wider">Active Promotional Banners</h2>
							<p className="text-[11px] text-content-tertiary mt-0.5">Manage messages broadcasted to passengers inside regional app shards</p>
						</div>

						{bannersLoading ? (
							<div className="text-xs text-content-tertiary animate-pulse">Loading configurations...</div>
						) : (
							<div className="space-y-4">
								{banners.length === 0 ? (
									<div className="p-8 text-center text-xs text-content-tertiary border border-dashed border-background-secondary rounded-lg">
										No banners currently configured. Create a banner campaign on the right.
									</div>
								) : (
									<div className="space-y-4">
										{banners.map((b) => (
											<div key={b.id} className="p-4 rounded-lg bg-background-secondary border border-background-secondary space-y-3 flex flex-col justify-between">
												<div className="flex justify-between items-start">
													<div>
														<span className="font-mono text-[10px] font-bold bg-content-primary text-gray-0 px-1.5 py-0.5 rounded mr-2 uppercase">
															{b.city_prefix}
														</span>
														<span className="text-xs font-mono text-content-tertiary">
															Valid: {new Date(b.valid_from).toLocaleDateString()} - {new Date(b.valid_to).toLocaleDateString()}
														</span>
													</div>
													<div className="flex space-x-2">
														<button
															onClick={() => handleToggleBanner(b.id)}
															className={`text-[10px] font-bold px-2 py-0.5 rounded ${
																b.is_active ? 'bg-status-online/15 text-status-online border border-status-online/20' : 'bg-background-primary text-content-tertiary border border-background-secondary'
															}`}
														>
															{b.is_active ? 'Active' : 'Paused'}
														</button>
														<button
															onClick={() => handleRemoveBanner(b.id)}
															className="text-status-negative text-[10px] hover:underline"
														>
															Delete
														</button>
													</div>
												</div>
												<p className="text-xs text-content-primary font-semibold italic bg-background-primary p-2.5 rounded border border-background-secondary">
													"{b.banner_text}"
												</p>
											</div>
										))}
									</div>
								)}
							</div>
						)}
					</div>

					{/* Banner Creator form */}
					<div className="bg-background-primary p-5 rounded-xl border border-background-secondary shadow-sm space-y-4 h-fit">
						<div>
							<h3 className="text-xs font-bold text-content-primary uppercase tracking-wider">New Banner Campaign</h3>
							<p className="text-[10px] text-content-tertiary mt-0.5">Publish an auto-applied promotion banner</p>
						</div>

						<div className="space-y-3 text-xs">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">City Shard Code</label>
								<select
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 text-xs text-content-primary font-mono font-bold"
									value={newBanner.city_prefix}
									onChange={(e) => setNewBanner({ ...newBanner, city_prefix: e.target.value })}
								>
									{CITIES.map(c => <option key={c} value={c}>{c}</option>)}
								</select>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Banner Message Text</label>
								<textarea
									placeholder="e.g. Surge discount applied for BLR today!"
									className="w-full min-h-20 rounded bg-background-secondary border border-background-secondary p-2.5 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-semibold"
									value={newBanner.banner_text}
									onChange={(e) => setNewBanner({ ...newBanner, banner_text: e.target.value })}
								/>
							</div>

							<div className="grid grid-cols-2 gap-2">
								<div>
									<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Start Range</label>
									<input
										type="datetime-local"
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 text-[10px] text-content-primary font-mono"
										value={newBanner.valid_from}
										onChange={(e) => setNewBanner({ ...newBanner, valid_from: e.target.value })}
									/>
								</div>
								<div>
									<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">End Range</label>
									<input
										type="datetime-local"
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 text-[10px] text-content-primary font-mono"
										value={newBanner.valid_to}
										onChange={(e) => setNewBanner({ ...newBanner, valid_to: e.target.value })}
									/>
								</div>
							</div>

							<div className="pt-2">
								<button
									onClick={handleAddBanner}
									className="w-full bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 hover:bg-gray-800 transition-colors"
								>
									Publish Banner Config
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* TAB: REFERRALS */}
			{activeTab === 'referrals' && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
					{/* Left Rules and Blockers */}
					<div className="lg:col-span-2 bg-background-primary p-6 rounded-xl border border-background-secondary shadow-sm space-y-6">
						<div>
							<h2 className="text-sm font-bold text-content-primary uppercase tracking-wider">Referral Reward & Fraud Rules</h2>
							<p className="text-[11px] text-content-tertiary mt-0.5">Control reward payouts triggered by customer invitations and set validation safeguards</p>
						</div>

						{referralsLoading || !referralSettings ? (
							<div className="text-xs text-content-tertiary animate-pulse">Loading referral settings...</div>
						) : (
							<div className="space-y-6">
								{/* Fraud Controls */}
								<div className="p-4 rounded-lg bg-background-secondary border border-background-secondary space-y-3">
									<h3 className="text-xs font-bold text-content-primary uppercase tracking-wider">Fraud Prevention Filters</h3>
									<div className="space-y-2">
										<label className="flex items-center space-x-3 text-xs text-content-secondary font-semibold cursor-pointer">
											<input
												type="checkbox"
												className="rounded bg-background-primary border-background-secondary text-content-primary focus:ring-0"
												checked={referralSettings.block_same_device}
												onChange={() => {
													const updated = { ...referralSettings, block_same_device: !referralSettings.block_same_device };
													setReferralSettings(updated);
													handleSaveReferrals(updated);
												}}
											/>
											<span>Block triggers if Referrer and Referee share telemetry identifiers (Same Device)</span>
										</label>
										<label className="flex items-center space-x-3 text-xs text-content-secondary font-semibold cursor-pointer">
											<input
												type="checkbox"
												className="rounded bg-background-primary border-background-secondary text-content-primary focus:ring-0"
												checked={referralSettings.block_ip_cluster}
												onChange={() => {
													const updated = { ...referralSettings, block_ip_cluster: !referralSettings.block_ip_cluster };
													setReferralSettings(updated);
													handleSaveReferrals(updated);
												}}
											/>
											<span>Flag & Block referral payouts matching IP Address cluster anomalies</span>
										</label>
									</div>
								</div>

								{/* Rules list */}
								<div className="space-y-3">
									<h3 className="text-xs font-bold text-content-primary uppercase tracking-wider">Reward Distribution Rules</h3>
									{referralSettings.rules.length === 0 ? (
										<div className="p-8 text-center text-xs text-content-tertiary border border-dashed border-background-secondary rounded-lg">
											No reward distribution rules registered. Add one on the right.
										</div>
									) : (
										<div className="bg-background-primary border border-background-secondary rounded-lg overflow-hidden">
											<table className="w-full text-left border-collapse text-xs">
												<thead>
													<tr className="border-b border-background-secondary bg-background-secondary">
														<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Participant Flow</th>
														<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Trigger Event</th>
														<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Reward Type</th>
														<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Reward Value</th>
														<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary text-right">Action</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-background-secondary">
													{referralSettings.rules.map((rule, idx) => (
														<tr key={idx} className="hover:bg-background-tertiary transition-colors">
															<td className="p-3 text-content-primary font-semibold">
																{rule.referrer_role} invite {rule.referee_role}
															</td>
															<td className="p-3 font-mono text-[11px]">
																{rule.trigger_type} ({rule.trigger_count} occurrences)
															</td>
															<td className="p-3 font-semibold text-content-secondary">
																{rule.reward_type}
															</td>
															<td className="p-3 font-mono font-bold text-content-primary">
																{formatPaise(rule.reward_amount_paise)}
															</td>
															<td className="p-3 text-right">
																<button
																	onClick={() => handleRemoveReferralRule(idx)}
																	className="text-status-negative font-semibold hover:underline"
																>
																	Remove
																</button>
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									)}
								</div>
							</div>
						)}
					</div>

					{/* Rule Creator */}
					<div className="bg-background-primary p-5 rounded-xl border border-background-secondary shadow-sm space-y-4 h-fit">
						<div>
							<h3 className="text-xs font-bold text-content-primary uppercase tracking-wider">Create Reward Rule</h3>
							<p className="text-[10px] text-content-tertiary mt-0.5">Register a trigger mapping and reward release</p>
						</div>

						<div className="space-y-3 text-xs">
							<div className="grid grid-cols-2 gap-2">
								<div>
									<label className="block text-[9px] uppercase text-content-tertiary mb-1 font-semibold">Inviter Role</label>
									<select
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 text-content-primary font-semibold"
										value={newReferralRule.referrer_role}
										onChange={(e) => setNewReferralRule({ ...newReferralRule, referrer_role: e.target.value })}
									>
										<option value="RIDER">RIDER</option>
										<option value="DRIVER">DRIVER</option>
									</select>
								</div>
								<div>
									<label className="block text-[9px] uppercase text-content-tertiary mb-1 font-semibold">Invited Role</label>
									<select
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 text-content-primary font-semibold"
										value={newReferralRule.referee_role}
										onChange={(e) => setNewReferralRule({ ...newReferralRule, referee_role: e.target.value })}
									>
										<option value="RIDER">RIDER</option>
										<option value="DRIVER">DRIVER</option>
									</select>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-2">
								<div>
									<label className="block text-[9px] uppercase text-content-tertiary mb-1 font-semibold">Trigger Event</label>
									<select
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 text-content-primary font-semibold"
										value={newReferralRule.trigger_type}
										onChange={(e) => setNewReferralRule({ ...newReferralRule, trigger_type: e.target.value })}
									>
										<option value="SIGNUP">SIGNUP</option>
										<option value="FIRST_TRIP">FIRST TRIP</option>
										<option value="NTH_TRIP">NTH TRIP</option>
									</select>
								</div>
								<div>
									<label className="block text-[9px] uppercase text-content-tertiary mb-1 font-semibold">Trigger Event Count</label>
									<input
										type="number"
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono"
										value={newReferralRule.trigger_count}
										onChange={(e) => setNewReferralRule({ ...newReferralRule, trigger_count: parseInt(e.target.value) || 1 })}
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-2">
								<div>
									<label className="block text-[9px] uppercase text-content-tertiary mb-1 font-semibold">Reward Medium</label>
									<select
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 text-content-primary font-semibold"
										value={newReferralRule.reward_type}
										onChange={(e) => setNewReferralRule({ ...newReferralRule, reward_type: e.target.value })}
									>
										<option value="WALLET_CREDIT">WALLET CREDIT</option>
										<option value="FREE_RIDE">FREE RIDE</option>
										<option value="CASH">CASH PAYOUT</option>
									</select>
								</div>
								<div>
									<label className="block text-[9px] uppercase text-content-tertiary mb-1 font-semibold">Reward Value (₹)</label>
									<input
										type="number"
										step="1"
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono font-bold"
										value={newReferralRule.reward_amount_paise / 100}
										onChange={(e) => setNewReferralRule({ ...newReferralRule, reward_amount_paise: Math.round(parseFloat(e.target.value) * 100) || 0 })}
									/>
								</div>
							</div>

							<div className="pt-2">
								<button
									onClick={handleAddReferralRule}
									className="w-full bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 hover:bg-gray-800 transition-colors"
								>
									Add Referral Rule
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* TAB: LOYALTY TIERS */}
			{activeTab === 'loyalty' && (
				<div className="bg-background-primary p-6 rounded-xl border border-background-secondary shadow-sm space-y-6 animate-fade-in">
					<div>
						<h2 className="text-sm font-bold text-content-primary uppercase tracking-wider">Loyalty Tier Thresholds & Perks</h2>
						<p className="text-[11px] text-content-tertiary mt-0.5">Define completed trip goals for passenger tiers and assign app perks matrices</p>
					</div>

					{loyaltyLoading || !loyaltySettings ? (
						<div className="text-xs text-content-tertiary animate-pulse">Loading loyalty metrics configuration...</div>
					) : (
						<div className="space-y-6">
							<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
								{loyaltySettings.tiers.map((tier, idx) => (
									<div key={tier.tier_name} className="p-5 bg-background-secondary border border-background-secondary rounded-xl space-y-4">
										<div className="flex justify-between items-center pb-2 border-b border-background-secondary">
											<span className="font-mono text-sm font-black text-content-primary tracking-wide">{tier.tier_name}</span>
											<span className="text-[10px] text-content-tertiary font-bold uppercase">Tier Matrix</span>
										</div>

										<div className="space-y-3 text-xs">
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Min Completed Trips</label>
												<input
													type="number"
													className="w-full h-8 rounded bg-background-primary border border-background-secondary px-2.5 font-mono text-content-primary font-bold"
													value={tier.min_trips}
													onChange={(e) => handleUpdateTierTripLimit(idx, parseInt(e.target.value) || 0)}
												/>
											</div>

											<div>
												<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Perk Discount Rate (%)</label>
												<input
													type="number"
													step="0.5"
													className="w-full h-8 rounded bg-background-primary border border-background-secondary px-2.5 font-mono text-content-primary font-bold"
													value={tier.perk_discount_percent}
													onChange={(e) => handleUpdateTierDiscount(idx, parseFloat(e.target.value) || 0)}
												/>
											</div>

											<div className="space-y-2 pt-2 border-t border-background-secondary">
												<label className="flex items-center space-x-3 text-content-secondary font-semibold cursor-pointer">
													<input
														type="checkbox"
														className="rounded bg-background-primary border-background-secondary text-content-primary focus:ring-0"
														checked={tier.perk_priority_dispatch}
														onChange={() => handleToggleTierPerk(idx, 'dispatch')}
													/>
													<span>Priority Matching Dispatch</span>
												</label>

												<label className="flex items-center space-x-3 text-content-secondary font-semibold cursor-pointer">
													<input
														type="checkbox"
														className="rounded bg-background-primary border-background-secondary text-content-primary focus:ring-0"
														checked={tier.perk_free_care}
														onChange={() => handleToggleTierPerk(idx, 'care')}
													/>
													<span>Free D4M Care Protection</span>
												</label>
											</div>
										</div>
									</div>
								))}
							</div>

							<div className="flex justify-end pt-4 border-t border-background-secondary">
								<button
									onClick={handleSaveLoyalty}
									className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-6 hover:bg-gray-800 transition-colors"
								>
									Save Loyalty Configurations
								</button>
							</div>
						</div>
					)}
				</div>
			)}

			{/* --- MODAL: CREATE PROMO CODE --- */}
			{showCreateModal && (
				<div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary border border-background-secondary rounded-xl max-w-xl w-full p-6 space-y-6 shadow-2xl relative">
						<button
							onClick={() => setShowCreateModal(false)}
							className="absolute top-4 right-4 text-content-tertiary hover:text-content-primary text-lg font-bold"
						>
							&times;
						</button>

						<div>
							<h3 className="text-sm font-bold text-content-primary uppercase tracking-wider">Configure Promotional Code</h3>
							<p className="text-[11px] text-content-tertiary mt-0.5">Commit a new promo coupon key parameters</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Promo Code (Uppercase)</label>
								<input
									type="text"
									placeholder="e.g. MONSOON30"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 font-mono font-bold text-content-primary focus:outline-none focus:border-content-primary"
									value={newPromo.code}
									onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Category Type</label>
								<select
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold text-content-primary focus:outline-none"
									value={newPromo.promo_type}
									onChange={(e) => setNewPromo({ ...newPromo, promo_type: e.target.value })}
								>
									{PROMO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
								</select>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Discount Value (rupees/percent)</label>
								<input
									type="number"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 font-mono font-bold text-content-primary"
									value={newPromo.value}
									onChange={(e) => setNewPromo({ ...newPromo, value: parseFloat(e.target.value) || 0 })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Max Discount Allowed (₹)</label>
								<input
									type="number"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 font-mono font-bold text-content-primary"
									value={newPromo.max_discount_paise ? newPromo.max_discount_paise / 100 : ''}
									onChange={(e) => setNewPromo({ ...newPromo, max_discount_paise: Math.round(parseFloat(e.target.value) * 100) || 0 })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Min Ride Fare Requirement (₹)</label>
								<input
									type="number"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 font-mono text-content-primary"
									value={newPromo.min_fare_paise ? newPromo.min_fare_paise / 100 : ''}
									onChange={(e) => setNewPromo({ ...newPromo, min_fare_paise: Math.round(parseFloat(e.target.value) * 100) || 0 })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">User Segment Shard</label>
								<select
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold text-content-primary"
									value={newPromo.user_segment}
									onChange={(e) => setNewPromo({ ...newPromo, user_segment: e.target.value })}
								>
									{SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
								</select>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Global Usage Cap Limit</label>
								<input
									type="number"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 font-mono text-content-primary"
									value={newPromo.usage_cap_total}
									onChange={(e) => setNewPromo({ ...newPromo, usage_cap_total: parseInt(e.target.value) || 1000 })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Usage Cap Limit Per User</label>
								<input
									type="number"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2.5 font-mono text-content-primary"
									value={newPromo.usage_cap_per_user}
									onChange={(e) => setNewPromo({ ...newPromo, usage_cap_per_user: parseInt(e.target.value) || 1 })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Activation Start Date</label>
								<input
									type="datetime-local"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono text-content-primary"
									value={newPromo.valid_from}
									onChange={(e) => setNewPromo({ ...newPromo, valid_from: e.target.value })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Expiration End Date</label>
								<input
									type="datetime-local"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono text-content-primary"
									value={newPromo.valid_to}
									onChange={(e) => setNewPromo({ ...newPromo, valid_to: e.target.value })}
								/>
							</div>
						</div>

						<div className="flex items-center space-x-3 text-xs pt-2">
							<label className="flex items-center space-x-2 text-content-secondary font-semibold cursor-pointer">
								<input
									type="checkbox"
									className="rounded bg-background-primary border-background-secondary text-content-primary focus:ring-0"
									checked={newPromo.stackable}
									onChange={() => setNewPromo({ ...newPromo, stackable: !newPromo.stackable })}
								/>
								<span>Allow stacking with other active coupon codes</span>
							</label>
						</div>

						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-4">
							<button
								onClick={() => setShowCreateModal(false)}
								className="border border-background-secondary hover:border-content-primary text-xs font-semibold rounded-pill h-9 px-4 transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={handleCreatePromo}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-5 hover:bg-gray-800 transition-colors"
							>
								Commit Promo Code
							</button>
						</div>
					</div>
				</div>
			)}

			{/* --- MODAL: BULK CSV UPLOAD --- */}
			{showBulkModal && (
				<div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary border border-background-secondary rounded-xl max-w-xl w-full p-6 space-y-6 shadow-2xl relative">
						<button
							onClick={() => setShowBulkModal(false)}
							className="absolute top-4 right-4 text-content-tertiary hover:text-content-primary text-lg font-bold"
						>
							&times;
						</button>

						<div>
							<h3 className="text-sm font-bold text-content-primary uppercase tracking-wider">Bulk CSV Importer</h3>
							<p className="text-[11px] text-content-tertiary mt-0.5">Paste comma-separated rows mapping code definitions directly to Redis</p>
						</div>

						<div className="space-y-2">
							<label className="block text-[10px] uppercase tracking-wider text-content-tertiary font-semibold">CSV Text Input</label>
							<textarea
								placeholder="code,promotype,value,minfare&#10;DISCOUNT50,PERCENT,50,5000&#10;FLAT100,FLAT,100,8000"
								className="w-full min-h-60 rounded bg-background-secondary border border-background-secondary p-3 font-mono text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-semibold"
								value={bulkCsvText}
								onChange={(e) => setBulkCsvText(e.target.value)}
							/>
							<div className="text-[10px] text-content-tertiary">
								Headers required: <code className="font-mono text-content-primary font-bold">code,promotype,value,minfare</code>. Value and minfare are rupee-denominated floats (e.g. 5000 paise = 50 rupees, but enter raw 50 rupees or 5000 paise depending on handler fallback, the backend defaults to paise integers).
							</div>
						</div>

						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-4">
							<button
								onClick={() => setShowBulkModal(false)}
								className="border border-background-secondary hover:border-content-primary text-xs font-semibold rounded-pill h-9 px-4 transition-colors"
								disabled={bulkUploading}
							>
								Cancel
							</button>
							<button
								onClick={handleBulkUpload}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-5 hover:bg-gray-800 transition-colors disabled:opacity-50"
								disabled={bulkUploading}
							>
								{bulkUploading ? 'Uploading Matrix...' : 'Import Dataset'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* --- MODAL: ANALYTICS OVERLAY --- */}
			{selectedPromoAnalytics && (
				<div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary border border-background-secondary rounded-xl max-w-md w-full p-6 space-y-6 shadow-2xl relative">
						<button
							onClick={() => setSelectedPromoAnalytics(null)}
							className="absolute top-4 right-4 text-content-tertiary hover:text-content-primary text-lg font-bold"
						>
							&times;
						</button>

						<div>
							<h3 className="text-sm font-bold text-content-primary uppercase tracking-wider">Performance Analytics: {selectedPromoAnalytics.code}</h3>
							<p className="text-[11px] text-content-tertiary mt-0.5">Dynamic marketing KPIs computed using standard SHA/FNV hashes</p>
						</div>

						<div className="grid grid-cols-1 gap-4 divide-y divide-background-secondary">
							<div className="pt-2 flex justify-between items-center text-xs">
								<span className="text-content-tertiary font-semibold">Total Redemptions</span>
								<span className="font-mono font-bold text-content-primary text-base">{selectedPromoAnalytics.redemptions}</span>
							</div>

							<div className="pt-4 flex justify-between items-center text-xs">
								<span className="text-content-tertiary font-semibold">Gross Value GMV Impact</span>
								<span className="font-mono font-bold text-content-primary text-base">{formatPaise(selectedPromoAnalytics.gmv_impact_paise)}</span>
							</div>

							<div className="pt-4 flex justify-between items-center text-xs">
								<span className="text-content-tertiary font-semibold">Marketing Campaign ROI</span>
								<span className="font-mono font-bold text-status-online text-base">{selectedPromoAnalytics.marketing_roi_percent.toFixed(1)}%</span>
							</div>
						</div>

						<div className="bg-background-secondary p-3 rounded-lg border border-background-secondary text-[10px] text-content-tertiary font-mono">
							Redemption counts and marketing ROI calculations are linked directly to active Redis hash metrics and transaction audits.
						</div>

						<div className="flex justify-end border-t border-background-secondary pt-4">
							<button
								onClick={() => setSelectedPromoAnalytics(null)}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-6 hover:bg-gray-800 transition-colors"
							>
								Close Overview
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
