import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';

interface RiderOverviewTab {
	contact: {
		phone: string;
		email: string;
	};
	kyc_level: number;
	addresses: { type: string; address: string }[];
	emergency_contacts: { name: string; phone: string; relationship: string }[];
	devices: { device_name: string; os_version: string; app_version: string }[];
}

// ── Tab payload shapes (mirror the backend handler structs) ──────────────
interface RiderCar {
	id: string;
	make: string;
	model: string;
	year: number;
	car_type: string;
	transmission: string;
	fuel_type: string;
	registration_plate: string;
	color: string;
	is_default: boolean;
	is_active: boolean;
}

interface RiderTrip {
	order_id: string;
	status: string;
	city_prefix: string;
	fare_paise: number;
	driver_name: string;
	created_at: string;
}

interface RiderPaymentTxn {
	id: string;
	order_id: string;
	amount_paise: number;
	currency: string;
	payment_status: string;
	provider_type: string;
	created_at: string;
}

interface RiderWalletTransaction {
	amount_paise: number;
	entry_type: string;
	reason_code: string;
	description: string;
	created_at: string;
}

interface RiderWalletTab {
	balance_paise: number;
	transactions: RiderWalletTransaction[];
}

interface RiderPromoUsage {
	promo_code_id: string;
	code: string;
	order_id: string;
	discount_paise: number;
	created_at: string;
}

interface RiderRating {
	order_id: string;
	rider_rating_for_driver: number | null;
	driver_rating_for_rider: number | null;
	rider_review_comment: string;
	driver_review_comment: string;
	created_at: string;
}

interface RiderRiskSignal {
	id: string;
	fraud_type: string;
	score: number;
	status: string;
	created_at: string;
}

interface RiderNotificationLog {
	id: string;
	type: string;
	title: string;
	body: string;
	is_read: boolean;
	created_at: string;
}

interface RiderAuditLogEntry {
	id: string;
	admin_email: string;
	action: string;
	details: string;
	created_at: string;
}

interface RiderDetailResponse {
	customer_id: string;
	name: string;
	phone: string;
	email: string;
	status: string;
	kyc_level: number;
	phone_verified: boolean;
	email_verified: boolean;
	tags: string[];
	referral_source: string;
	overview: RiderOverviewTab;
}

// Generic helper for the lazily-loaded tab payloads coming from per-tab endpoints.
interface LazyTabState<T> {
	loading: boolean;
	loaded: boolean;
	data: T | null;
}

const emptyTab = <T,>(): LazyTabState<T> => ({ loading: false, loaded: false, data: null });

type ConfirmKind = 'suspend' | 'block' | 'delete';

export const RiderDetail: React.FC = () => {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [data, setData] = useState<RiderDetailResponse | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [activeTab, setActiveTab] = useState<string>('overview');
	const [actionLoading, setActionLoading] = useState<boolean>(false);
	const [toast, setToast] = useState<string | null>(null);

	// Lazily-loaded tab payloads.
	const [garageTab, setGarageTab] = useState<LazyTabState<RiderCar[]>>(emptyTab);
	const [tripsTab, setTripsTab] = useState<LazyTabState<RiderTrip[]>>(emptyTab);
	const [paymentsTab, setPaymentsTab] = useState<LazyTabState<RiderPaymentTxn[]>>(emptyTab);
	const [walletTab, setWalletTab] = useState<LazyTabState<RiderWalletTab>>(emptyTab);
	const [promosTab, setPromosTab] = useState<LazyTabState<RiderPromoUsage[]>>(emptyTab);
	const [ratingsTab, setRatingsTab] = useState<LazyTabState<RiderRating[]>>(emptyTab);
	const [riskTab, setRiskTab] = useState<LazyTabState<RiderRiskSignal[]>>(emptyTab);
	const [notificationsTab, setNotificationsTab] = useState<LazyTabState<RiderNotificationLog[]>>(emptyTab);
	const [auditTab, setAuditTab] = useState<LazyTabState<RiderAuditLogEntry[]>>(emptyTab);

	// Modals State
	const [showEditModal, setShowEditModal] = useState(false);
	const [editForm, setEditForm] = useState({ name: '', phone: '', email: '' });

	const [showWalletModal, setShowWalletModal] = useState(false);
	const [walletForm, setWalletForm] = useState({ amount: '', isCredit: true, description: '' });

	const [showVoucherModal, setShowVoucherModal] = useState(false);
	const [voucherCode, setVoucherCode] = useState('');

	const [showMergeModal, setShowMergeModal] = useState(false);
	const [duplicateId, setDuplicateId] = useState('');

	// Confirm modal for destructive lifecycle actions (suspend / block / GDPR delete).
	const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
	const [confirmReason, setConfirmReason] = useState('');

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		window.setTimeout(() => setToast(null), 3200);
	}, []);

	const authHeaders = useCallback((): Record<string, string> => {
		const role = localStorage.getItem('admin_role') || 'ADMIN';
		const email = localStorage.getItem('admin_email') || 'admin@platform.com';
		return { 'X-Admin-Role': role, 'X-Admin-Email': email };
	}, []);

	const fetchRiderDetail = useCallback(async () => {
		setLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/riders/${id}`, {
				headers: authHeaders(),
			});
			if (res.ok) {
				const payload = await res.json();
				setData(payload);
				setEditForm({
					name: payload.name,
					phone: payload.phone,
					email: payload.email,
				});
			} else {
				alert('Rider details not found.');
				navigate('/riders');
			}
		} catch (err) {
			console.error('Failed to load rider details', err);
		} finally {
			setLoading(false);
		}
	}, [id, authHeaders, navigate]);

	useEffect(() => {
		if (id) {
			fetchRiderDetail();
		}
	}, [id, fetchRiderDetail]);

	// ── Lazy per-tab loader ────────────────────────────────────────────────
	// Fetches `path` once a tab opens, stores the JSON in `setState`. `extract`
	// pulls the tab payload out of the response shape (empty-200 tolerated).
	const loadTab = useCallback(
		async <T,>(
			path: string,
			state: LazyTabState<T>,
			setState: React.Dispatch<React.SetStateAction<LazyTabState<T>>>,
			extract: (json: unknown) => T,
		) => {
			if (state.loaded || state.loading) return;
			setState({ loading: true, loaded: false, data: null });
			try {
				const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/riders/${id}${path}`, {
					headers: authHeaders(),
				});
				const json: unknown = res.ok ? await res.json().catch(() => null) : null;
				setState({ loading: false, loaded: true, data: extract(json) });
			} catch (err) {
				console.error(`Failed to load rider tab ${path}`, err);
				setState({ loading: false, loaded: true, data: extract(null) });
			}
		},
		[id, authHeaders],
	);

	// Allow a tab to be force-refreshed (e.g. after a wallet adjustment).
	const reloadWallet = useCallback(() => {
		setWalletTab(emptyTab());
	}, []);

	useEffect(() => {
		if (!id) return;
		const asArray = <T,>(json: unknown, key?: string): T[] => {
			if (Array.isArray(json)) return json as T[];
			if (json && typeof json === 'object' && key) {
				const v = (json as Record<string, unknown>)[key];
				if (Array.isArray(v)) return v as T[];
			}
			return [];
		};
		switch (activeTab) {
			case 'garage':
				loadTab<RiderCar[]>('/garage', garageTab, setGarageTab, (j) => asArray<RiderCar>(j, 'cars'));
				break;
			case 'trips':
				loadTab<RiderTrip[]>('/orders', tripsTab, setTripsTab, (j) => asArray<RiderTrip>(j, 'orders'));
				break;
			case 'payments':
				loadTab<RiderPaymentTxn[]>('/payments', paymentsTab, setPaymentsTab, (j) =>
					asArray<RiderPaymentTxn>(j, 'transactions'),
				);
				break;
			case 'wallet':
				loadTab<RiderWalletTab>('/wallet', walletTab, setWalletTab, (j) => {
					const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
					return {
						balance_paise: typeof o.balance_paise === 'number' ? o.balance_paise : 0,
						transactions: asArray<RiderWalletTransaction>(o, 'transactions'),
					};
				});
				break;
			case 'promos':
				loadTab<RiderPromoUsage[]>('/promos', promosTab, setPromosTab, (j) => asArray<RiderPromoUsage>(j, 'applied'));
				break;
			case 'ratings':
				loadTab<RiderRating[]>('/ratings', ratingsTab, setRatingsTab, (j) => asArray<RiderRating>(j, 'ratings'));
				break;
			case 'risk':
				loadTab<RiderRiskSignal[]>('/risk', riskTab, setRiskTab, (j) => asArray<RiderRiskSignal>(j, 'signals'));
				break;
			case 'notifications':
				loadTab<RiderNotificationLog[]>('/notifications', notificationsTab, setNotificationsTab, (j) =>
					asArray<RiderNotificationLog>(j, 'notifications'),
				);
				break;
			case 'audit':
				loadTab<RiderAuditLogEntry[]>('/audit', auditTab, setAuditTab, (j) =>
					asArray<RiderAuditLogEntry>(j, 'audit_logs'),
				);
				break;
		}
	}, [
		activeTab,
		id,
		loadTab,
		garageTab,
		tripsTab,
		paymentsTab,
		walletTab,
		promosTab,
		ratingsTab,
		riskTab,
		notificationsTab,
		auditTab,
	]);

	// handleAction posts to /admin/riders/{id}/{actionSlug}. actionSlug may contain
	// sub-paths (e.g. 'wallet/adjust') so a slash is intentional here.
	const handleAction = async (actionSlug: string, body?: Record<string, unknown>): Promise<boolean> => {
		setActionLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/riders/${id}/${actionSlug}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...authHeaders() },
				body: body ? JSON.stringify(body) : undefined,
			});

			if (res.ok) {
				showToast(`Action '${actionSlug}' executed successfully.`);
				setShowEditModal(false);
				setShowWalletModal(false);
				setShowVoucherModal(false);
				setShowMergeModal(false);
				fetchRiderDetail();
				return true;
			}
			const msg = await res.text();
			showToast(`Action failed: ${msg || res.status}`);
			return false;
		} catch (err) {
			console.error(err);
			showToast('Network request execution failure.');
			return false;
		} finally {
			setActionLoading(false);
		}
	};

	const handleImpersonate = () => {
		showToast(`Starting read-only impersonation session for rider ${id}.`);
	};

	const runConfirm = async () => {
		if (!confirmKind) return;
		const slug = confirmKind; // 'suspend' | 'block' | 'delete'
		const ok = await handleAction(slug, confirmReason.trim() ? { reason: confirmReason.trim() } : undefined);
		if (ok) {
			setConfirmKind(null);
			setConfirmReason('');
			if (slug === 'delete') navigate('/riders');
		}
	};

	if (loading) {
		return (
			<div className="h-full flex items-center justify-center">
				<div className="text-sm text-content-tertiary animate-pulse">Loading rider profile metrics…</div>
			</div>
		);
	}

	if (!data) return null;

	const tabsList = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'garage', label: 'Garage' },
		{ id: 'trips', label: 'Trips' },
		{ id: 'payments', label: 'Payments' },
		{ id: 'wallet', label: 'Wallet' },
		{ id: 'promos', label: 'Promos' },
		{ id: 'ratings', label: 'Ratings' },
		{ id: 'risk', label: 'Risk & Fraud' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'audit', label: 'Audit Log' },
	];

	const TabLoading = () => (
		<div className="p-12 text-center text-xs text-content-tertiary font-mono animate-pulse">Loading…</div>
	);

	const cars = garageTab.data ?? [];
	const trips = tripsTab.data ?? [];
	const transactions = paymentsTab.data ?? [];
	const wallet = walletTab.data;
	const promos = promosTab.data ?? [];
	const ratings = ratingsTab.data ?? [];
	const riskSignals = riskTab.data ?? [];
	const notifications = notificationsTab.data ?? [];
	const auditLogs = auditTab.data ?? [];

	const confirmCopy: Record<ConfirmKind, { title: string; body: string; cta: string; danger: boolean }> = {
		suspend: {
			title: 'Suspend Account',
			body: 'Temporarily suspend this rider. They will be unable to book trips until restored.',
			cta: 'Suspend',
			danger: false,
		},
		block: {
			title: 'Block Account',
			body: 'Permanently block this rider account. This prevents all platform access.',
			cta: 'Block',
			danger: true,
		},
		delete: {
			title: 'GDPR Delete Profile',
			body: 'CRITICAL: This executes the GDPR delete sequence. Profile info, email, phone, and wallet adjustments will be permanently wiped.',
			cta: 'Delete Permanently',
			danger: true,
		},
	};

	return (
		<div className="w-full h-full flex flex-col lg:flex-row overflow-hidden bg-background-primary">

			{/* ---- Left Sidebar: Profile Overview & Actions ---- */}
			<div className="w-full lg:w-[320px] bg-background-primary border-r border-background-secondary p-6 flex flex-col flex-shrink-0 overflow-y-auto space-y-6">

				{/* Basic Details Card */}
				<div className="flex flex-col items-center text-center">
					<div className="w-20 h-20 rounded-full bg-background-secondary border border-background-secondary flex items-center justify-center text-3xl font-bold text-content-primary">
						{data.name.split(' ').map(n => n[0]).join('')}
					</div>
					<h2 className="text-lg font-bold text-content-primary mt-4">{data.name}</h2>

					{/* Status Badge */}
					<div className="mt-2">
						<span
							className={`inline-flex items-center text-[10px] font-bold uppercase rounded-pill h-5 px-2.5 tracking-wider border ${
								data.status === 'ACTIVE'
									? 'bg-background-primary text-content-primary border-background-secondary'
									: data.status === 'SUSPENDED'
									? 'bg-background-secondary text-status-pending border-background-secondary'
									: data.status === 'BLOCKED'
									? 'bg-background-secondary text-status-negative border-background-secondary'
									: 'bg-background-secondary text-content-tertiary border-background-secondary'
							}`}
						>
							<span
								className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
									data.status === 'ACTIVE'
										? 'bg-status-online'
										: data.status === 'SUSPENDED'
										? 'bg-status-pending'
										: 'bg-status-negative'
								}`}
							/>
							{data.status.toLowerCase()}
						</span>
					</div>

					{/* Metadata Items */}
					<div className="w-full text-left space-y-3 mt-6 border-t border-background-secondary pt-4">
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">Customer ID</span>
							<span className="font-mono text-xs text-content-primary break-all font-semibold">{data.customer_id}</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">Phone</span>
							<span className="font-mono text-xs text-content-secondary flex items-center justify-between">
								{data.phone}
								<span className={`text-[9px] px-1.5 py-0.5 rounded font-sans uppercase font-bold ${data.phone_verified ? 'bg-background-secondary text-content-primary' : 'bg-status-negative/10 text-status-negative'}`}>
									{data.phone_verified ? 'Verified' : 'Unverified'}
								</span>
							</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">Email</span>
							<span className="text-xs text-content-secondary break-all flex items-center justify-between">
								{data.email}
								<span className={`text-[9px] px-1.5 py-0.5 rounded font-sans uppercase font-bold ${data.email_verified ? 'bg-background-secondary text-content-primary' : 'bg-status-negative/10 text-status-negative'}`}>
									{data.email_verified ? 'Verified' : 'Unverified'}
								</span>
							</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">KYC Status</span>
							<span className="text-xs text-content-primary font-semibold">Level {data.kyc_level} Verified</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">Referral Source</span>
							<span className="text-xs text-content-secondary">{data.referral_source}</span>
						</div>
					</div>
				</div>

				{/* Quick Administrative Actions List */}
				<div className="border-t border-background-secondary pt-4 space-y-2">
					<h3 className="text-[10px] uppercase tracking-wider text-content-tertiary mb-2.5 font-bold">Admin Controls</h3>

					<button
						onClick={() => setShowEditModal(true)}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Edit Profile Details
					</button>

					<button
						onClick={() => handleAction('verify-contacts', { phone: true, email: true })}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Mark Contacts Verified
					</button>

					<button
						onClick={() => setShowWalletModal(true)}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Adjust Wallet Balance
					</button>

					<button
						onClick={() => setShowVoucherModal(true)}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Issue Promo Coupon
					</button>

					<button
						onClick={() => handleAction('reset-password')}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Reset Password Token
					</button>

					{data.status !== 'ACTIVE' && (
						<button
							onClick={() => handleAction('unblock')}
							className="w-full text-left text-xs text-content-primary hover:text-gray-0 hover:bg-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
						>
							Restore Account Access
						</button>
					)}

					{data.status === 'ACTIVE' && (
						<>
							<button
								onClick={() => { setConfirmReason(''); setConfirmKind('suspend'); }}
								className="w-full text-left text-xs text-status-pending bg-status-pending/5 hover:bg-status-pending/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Suspend Account
							</button>

							<button
								onClick={() => { setConfirmReason(''); setConfirmKind('block'); }}
								className="w-full text-left text-xs text-status-negative bg-status-negative/5 hover:bg-status-negative/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Block Account
							</button>
						</>
					)}

					<button
						onClick={() => setShowMergeModal(true)}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Merge Duplicate Profile
					</button>

					<button
						onClick={handleImpersonate}
						className="w-full text-left text-xs text-gray-0 bg-content-primary hover:bg-gray-800 font-semibold rounded-pill px-4.5 py-2 transition-colors text-center"
					>
						Impersonate Rider
					</button>

					<button
						onClick={() => { setConfirmReason(''); setConfirmKind('delete'); }}
						className="w-full text-left text-xs text-content-tertiary hover:text-status-negative font-semibold px-4.5 py-2 transition-colors text-center"
					>
						GDPR Delete Profile
					</button>
				</div>
			</div>

			{/* ---- Right Workspace: Tabbed Interface ---- */}
			<div className="flex-1 flex flex-col overflow-hidden bg-background-primary">
				{/* Scrollable Tab Row */}
				<div className="flex overflow-x-auto border-b border-background-secondary bg-background-tertiary px-6 flex-shrink-0 scrollbar-none">
					<div className="flex space-x-6 min-w-max">
						{tabsList.map((tab) => (
							<button
								key={tab.id}
								onClick={() => setActiveTab(tab.id)}
								className={`py-4 text-xs font-bold transition-all relative border-b-2 ${
									activeTab === tab.id
										? 'border-content-primary text-content-primary font-semibold'
										: 'border-transparent text-content-secondary hover:text-content-primary'
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>

				{/* Active Tab Contents Area */}
				<div className="flex-1 overflow-y-auto p-6">

					{/* OVERVIEW TAB */}
					{activeTab === 'overview' && (
						<div className="space-y-6">
							{/* Core KYC Detail */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-content-primary">Identity & Verification</h3>
								<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
									<div className="bg-background-tertiary p-4 rounded-xl">
										<span className="block text-[10px] uppercase text-content-tertiary font-bold">KYC Level</span>
										<span className="text-xl font-bold font-mono text-content-primary mt-1">Level {data.overview.kyc_level}</span>
									</div>
									<div className="bg-background-tertiary p-4 rounded-xl">
										<span className="block text-[10px] uppercase text-content-tertiary font-bold">Phone verification</span>
										<span className="text-xs font-semibold mt-1 block">
											{data.phone_verified ? 'VERIFIED' : 'UNVERIFIED'}
										</span>
									</div>
									<div className="bg-background-tertiary p-4 rounded-xl">
										<span className="block text-[10px] uppercase text-content-tertiary font-bold">Email verification</span>
										<span className="text-xs font-semibold mt-1 block">
											{data.email_verified ? 'VERIFIED' : 'UNVERIFIED'}
										</span>
									</div>
								</div>
							</div>

							{/* Saved Locations */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-content-primary">Saved Addresses</h3>
								<div className="divide-y divide-background-secondary">
									{data.overview.addresses.map((addr) => (
										<div key={addr.type} className="py-3 flex justify-between items-start">
											<span className="text-xs font-semibold text-content-primary w-20">{addr.type}</span>
											<span className="text-xs text-content-secondary flex-1">{addr.address}</span>
										</div>
									))}
								</div>
							</div>

							{/* Emergency Contacts */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-content-primary">Emergency Contacts</h3>
								<div className="divide-y divide-background-secondary">
									{data.overview.emergency_contacts.map((contact, idx) => (
										<div key={idx} className="py-3 flex justify-between items-center">
											<div>
												<span className="text-xs font-semibold text-content-primary block">{contact.name}</span>
												<span className="text-[10px] text-content-tertiary">{contact.relationship}</span>
											</div>
											<span className="text-xs font-mono text-content-secondary font-semibold">{contact.phone}</span>
										</div>
									))}
								</div>
							</div>

							{/* Devices list */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-content-primary">Registered Devices</h3>
								<div className="divide-y divide-background-secondary">
									{data.overview.devices.map((device, idx) => (
										<div key={idx} className="py-3 flex justify-between items-center">
											<div>
												<span className="text-xs font-semibold text-content-primary block">{device.device_name}</span>
												<span className="text-[10px] text-content-tertiary">OS: {device.os_version}</span>
											</div>
											<span className="text-xs font-mono text-content-secondary">App: {device.app_version}</span>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* GARAGE TAB */}
					{activeTab === 'garage' && (
						garageTab.loading ? <TabLoading /> : (
						<div className="space-y-6">
							{cars.length === 0 ? (
								<div className="p-12 text-center text-xs text-content-tertiary">No saved cars on profile garage.</div>
							) : (
								cars.map((car) => (
									<div key={car.id} className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
										<div className="flex justify-between items-center">
											<h3 className="text-sm font-bold text-content-primary">
												{car.make} {car.model}{car.year ? ` · ${car.year}` : ''}
												{car.is_default && <span className="ml-2 text-[9px] font-bold uppercase bg-content-primary text-gray-0 px-2 py-0.5 rounded">Default</span>}
											</h3>
											<span className="font-mono text-xs text-content-primary font-bold bg-background-secondary px-3 py-1 rounded">{car.registration_plate}</span>
										</div>
										<div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-background-secondary pt-4">
											<div className="bg-background-tertiary p-3 rounded-xl">
												<span className="block text-[10px] uppercase text-content-tertiary font-bold">Type</span>
												<span className="text-xs font-semibold mt-1 block text-content-primary uppercase">{car.car_type || '—'}</span>
											</div>
											<div className="bg-background-tertiary p-3 rounded-xl">
												<span className="block text-[10px] uppercase text-content-tertiary font-bold">Transmission</span>
												<span className="text-xs font-semibold mt-1 block text-content-primary uppercase">{car.transmission || '—'}</span>
											</div>
											<div className="bg-background-tertiary p-3 rounded-xl">
												<span className="block text-[10px] uppercase text-content-tertiary font-bold">Fuel</span>
												<span className="text-xs font-semibold mt-1 block text-content-primary uppercase">{car.fuel_type || '—'}</span>
											</div>
											<div className="bg-background-tertiary p-3 rounded-xl">
												<span className="block text-[10px] uppercase text-content-tertiary font-bold">Color</span>
												<span className="text-xs font-semibold mt-1 block text-content-primary">{car.color || '—'}</span>
											</div>
										</div>
										{!car.is_active && (
											<div className="bg-status-pending/5 border border-status-pending/25 p-3 rounded-xl text-status-pending text-xs font-semibold">
												This vehicle is currently inactive on the rider's garage.
											</div>
										)}
									</div>
								))
							)}
						</div>
						)
					)}

					{/* TRIPS TAB */}
					{activeTab === 'trips' && (
						tripsTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl overflow-hidden">
							{trips.length === 0 ? (
								<div className="p-12 text-center text-xs text-content-tertiary">Rider has not made any trip reservations.</div>
							) : (
								<table className="w-full text-left border-collapse">
									<thead>
										<tr className="border-b border-background-secondary bg-background-secondary">
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Trip ID</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Date</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Fare</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Driver</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">City</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-background-secondary text-xs text-content-secondary">
										{trips.map((tx) => (
											<tr key={tx.order_id} className="hover:bg-background-tertiary">
												<td className="p-4 font-mono text-content-primary font-semibold">
													<Link to={`/trips/${tx.order_id}`} className="underline hover:text-gray-800">
														TRP-{tx.order_id.substring(tx.order_id.length - 8).toUpperCase()}
													</Link>
												</td>
												<td className="p-4 font-mono">
													{new Date(tx.created_at).toLocaleString()}
												</td>
												<td className="p-4 font-mono text-content-primary font-semibold">
													₹{(tx.fare_paise / 100).toFixed(2)}
												</td>
												<td className="p-4 font-sans">
													{tx.driver_name}
												</td>
												<td className="p-4 font-mono uppercase">
													{tx.city_prefix}
												</td>
												<td className="p-4 font-semibold text-status-online">
													{tx.status}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
						)
					)}

					{/* PAYMENTS TAB */}
					{activeTab === 'payments' && (
						paymentsTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl overflow-hidden">
							{transactions.length === 0 ? (
								<div className="p-12 text-center text-xs text-content-tertiary">No billing transactions recorded.</div>
							) : (
								<table className="w-full text-left text-xs border-collapse">
									<thead>
										<tr className="border-b border-background-secondary bg-background-secondary">
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Tx ID</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Order</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Provider</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Amount</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Status</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Date</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-background-secondary text-content-secondary font-mono">
										{transactions.map((tx) => (
											<tr key={tx.id} className="hover:bg-background-tertiary">
												<td className="p-4 font-semibold text-content-primary">{tx.id.substring(0, 12)}</td>
												<td className="p-4">TRP-{tx.order_id.substring(tx.order_id.length - 4).toUpperCase()}</td>
												<td className="p-4 font-sans uppercase">{tx.provider_type}</td>
												<td className="p-4 font-bold text-content-primary">₹{(tx.amount_paise / 100).toFixed(2)}</td>
												<td className="p-4 font-semibold text-status-online">{tx.payment_status}</td>
												<td className="p-4 text-content-tertiary">{new Date(tx.created_at).toLocaleString()}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
						)
					)}

					{/* WALLET TAB */}
					{activeTab === 'wallet' && (
						walletTab.loading ? <TabLoading /> : (
						<div className="space-y-6">
							{/* Current Balance */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-6 flex flex-col justify-center items-center text-center">
								<span className="text-[10px] uppercase text-content-tertiary tracking-wider font-bold">Rider Wallet Balance</span>
								<span className="text-3xl font-extrabold text-content-primary font-mono mt-2">
									₹{((wallet?.balance_paise ?? 0) / 100).toFixed(2)}
								</span>
							</div>

							{/* Ledger Transaction History */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-content-primary">Wallet Ledger Entries</h3>
								<div className="overflow-hidden rounded-xl border border-background-secondary">
									<table className="w-full text-left text-xs border-collapse">
										<thead>
											<tr className="border-b border-background-secondary bg-background-secondary">
												<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Type</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Amount</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Description</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Timestamp</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-background-secondary font-mono text-content-secondary">
											{(wallet?.transactions ?? []).map((wt, idx) => {
												const isCredit = wt.entry_type === 'CREDIT';
												return (
													<tr key={idx} className="hover:bg-background-tertiary">
														<td className="p-3">
															<span className={`inline-flex items-center font-bold px-2 py-0.5 rounded text-[9px] font-sans ${isCredit ? 'bg-background-secondary text-content-primary' : 'bg-content-primary text-gray-0'}`}>
																{wt.entry_type}
															</span>
														</td>
														<td className={`p-3 font-bold ${isCredit ? 'text-content-primary' : 'text-content-secondary'}`}>
															{isCredit ? '+' : '-'} ₹{(Math.abs(wt.amount_paise) / 100).toFixed(2)}
														</td>
														<td className="p-3 font-sans text-xs text-content-primary">{wt.description || wt.reason_code}</td>
														<td className="p-3 text-content-tertiary">{new Date(wt.created_at).toLocaleString()}</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							</div>
						</div>
						)
					)}

					{/* PROMOS TAB */}
					{activeTab === 'promos' && (
						promosTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-content-primary">Promo Coupon Usage Log</h3>
							{promos.length === 0 ? (
								<div className="p-8 text-center text-xs text-content-tertiary">No promo redemptions on record.</div>
							) : (
								<div className="divide-y divide-background-secondary">
									{promos.map((promo, idx) => (
										<div key={idx} className="py-3 flex justify-between items-center text-xs font-mono">
											<span className="font-bold text-content-primary bg-background-secondary px-3 py-1 rounded uppercase">{promo.code || promo.promo_code_id.substring(0, 8)}</span>
											<span className="text-content-secondary font-sans text-xs">
												Order TRP-{promo.order_id.substring(promo.order_id.length - 4).toUpperCase()}
											</span>
											<span className="text-content-primary font-semibold">− ₹{(promo.discount_paise / 100).toFixed(2)}</span>
											<span className="text-content-tertiary">{new Date(promo.created_at).toLocaleDateString()}</span>
										</div>
									))}
								</div>
							)}
						</div>
						)
					)}

					{/* RATINGS TAB */}
					{activeTab === 'ratings' && (
						ratingsTab.loading ? <TabLoading /> : (() => {
							const given = ratings.map((r) => r.rider_rating_for_driver).filter((v): v is number => v != null);
							const received = ratings.map((r) => r.driver_rating_for_rider).filter((v): v is number => v != null);
							const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
							const avgGiven = avg(given);
							const avgReceived = avg(received);
							return (
								<div className="space-y-6">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div className="bg-background-primary border border-background-secondary rounded-xl p-6 flex flex-col justify-center items-center text-center">
											<span className="text-[10px] uppercase text-content-tertiary tracking-wider font-bold">Avg Rating Given To Drivers</span>
											<span className="text-4xl font-extrabold text-content-primary font-mono mt-3">
												{avgGiven > 0 ? avgGiven.toFixed(1) : '—'}
												<span className="text-lg font-medium text-content-tertiary font-sans ml-1">★</span>
											</span>
										</div>
										<div className="bg-background-primary border border-background-secondary rounded-xl p-6 flex flex-col justify-center items-center text-center">
											<span className="text-[10px] uppercase text-content-tertiary tracking-wider font-bold">Avg Rating Received From Drivers</span>
											<span className="text-4xl font-extrabold text-content-primary font-mono mt-3">
												{avgReceived > 0 ? avgReceived.toFixed(1) : '—'}
												<span className="text-lg font-medium text-content-tertiary font-sans ml-1">★</span>
											</span>
										</div>
									</div>
									<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
										<h3 className="text-sm font-bold text-content-primary">Per-Trip Ratings</h3>
										{ratings.length === 0 ? (
											<div className="p-8 text-center text-xs text-content-tertiary">No ratings recorded yet.</div>
										) : (
											<div className="divide-y divide-background-secondary">
												{ratings.map((r) => (
													<div key={r.order_id} className="py-3 space-y-1">
														<div className="flex justify-between items-center text-xs">
															<Link to={`/trips/${r.order_id}`} className="font-mono text-content-primary font-semibold underline hover:text-gray-800">
																TRP-{r.order_id.substring(r.order_id.length - 8).toUpperCase()}
															</Link>
															<span className="font-mono text-content-secondary">
																Given {r.rider_rating_for_driver ?? '—'}★ · Received {r.driver_rating_for_rider ?? '—'}★
															</span>
															<span className="text-content-tertiary font-mono">{new Date(r.created_at).toLocaleDateString()}</span>
														</div>
														{(r.rider_review_comment || r.driver_review_comment) && (
															<p className="text-[10px] text-content-secondary">{r.rider_review_comment || r.driver_review_comment}</p>
														)}
													</div>
												))}
											</div>
										)}
									</div>
								</div>
							);
						})()
					)}

					{/* RISK TAB */}
					{activeTab === 'risk' && (
						riskTab.loading ? <TabLoading /> : (() => {
							const peak = riskSignals.reduce((m, s) => Math.max(m, s.score), 0);
							return (
								<div className="space-y-6">
									{/* Peak Risk Score */}
									<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
										<h3 className="text-sm font-bold text-content-primary">Fraud & Risk Evaluation</h3>
										<div className="flex flex-col items-center py-6 text-center border border-background-secondary rounded-xl">
											<span className="text-[10px] uppercase text-content-tertiary font-bold">Peak Fraud Signal Score</span>
											<span className={`text-5xl font-extrabold font-mono mt-3 ${peak > 75 ? 'text-status-negative' : peak > 40 ? 'text-status-pending' : 'text-content-primary'}`}>
												{peak.toFixed(0)}
											</span>
											<span className="text-[10px] text-content-tertiary mt-2">Scale ranges from 0 (Safe) to 100 (Suspicious)</span>
										</div>
									</div>

									{/* Fraud Signals */}
									<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-3">
										<h4 className="text-xs font-bold text-content-primary">Recorded Fraud Signals</h4>
										{riskSignals.length === 0 ? (
											<div className="p-8 text-center text-xs text-content-tertiary">No fraud or risk signals on file.</div>
										) : (
											<div className="space-y-2">
												{riskSignals.map((s) => (
													<div key={s.id} className="bg-background-tertiary p-3 rounded-xl text-xs text-content-secondary flex items-center justify-between font-medium">
														<span className="flex items-center">
															<span className={`w-1.5 h-1.5 rounded-full mr-2.5 ${s.score > 75 ? 'bg-status-negative' : s.score > 40 ? 'bg-status-pending' : 'bg-status-online'}`} />
															<span className="text-content-primary font-semibold uppercase">{s.fraud_type}</span>
														</span>
														<span className="flex items-center gap-3 font-mono">
															<span>{s.status}</span>
															<span className="text-content-primary font-bold">{s.score.toFixed(0)}</span>
															<span className="text-content-tertiary">{new Date(s.created_at).toLocaleDateString()}</span>
														</span>
													</div>
												))}
											</div>
										)}
									</div>
								</div>
							);
						})()
					)}

					{/* NOTIFICATIONS TAB */}
					{activeTab === 'notifications' && (
						notificationsTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl overflow-hidden">
							{notifications.length === 0 ? (
								<div className="p-12 text-center text-xs text-content-tertiary">No communication dispatch log found.</div>
							) : (
								<table className="w-full text-left border-collapse">
									<thead>
										<tr className="border-b border-background-secondary bg-background-secondary">
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Channel</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Payload Content</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Timestamp</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-background-secondary text-xs text-content-secondary">
										{notifications.map((n) => (
											<tr key={n.id} className="hover:bg-background-tertiary">
												<td className="p-4 font-mono font-semibold text-content-primary uppercase">
													{n.type}
												</td>
												<td className="p-4 font-sans text-content-primary">
													<span className="font-semibold block">{n.title}</span>
													<span className="text-content-secondary">{n.body}</span>
												</td>
												<td className="p-4 font-mono text-content-tertiary">
													{new Date(n.created_at).toLocaleString()}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
						)
					)}

					{/* AUDIT LOG TAB */}
					{activeTab === 'audit' && (
						auditTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl overflow-hidden">
							{auditLogs.length === 0 ? (
								<div className="p-12 text-center text-xs text-content-tertiary font-medium">No admin audit log recorded for this customer ID.</div>
							) : (
								<table className="w-full text-left border-collapse">
									<thead>
										<tr className="border-b border-background-secondary bg-background-secondary">
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Timestamp</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Actor</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Action</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-content-tertiary">Details</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-background-secondary text-xs font-mono text-content-secondary">
										{auditLogs.map((log) => (
											<tr key={log.id} className="hover:bg-background-tertiary">
												<td className="p-4 font-semibold text-content-primary">
													{new Date(log.created_at).toLocaleString()}
												</td>
												<td className="p-4 font-sans text-xs">
													{log.admin_email}
												</td>
												<td className="p-4">
													<span className="bg-background-secondary px-2 py-0.5 rounded font-bold text-content-primary">
														{log.action}
													</span>
												</td>
												<td className="p-4 font-sans text-xs text-content-primary">
													{log.details}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
						)
					)}

				</div>
			</div>

			{/* ========================================================================= */}
			{/* ---- Toast ---- */}
			{toast && (
				<div className="fixed bottom-6 right-6 z-[60] bg-content-primary text-gray-0 text-xs font-semibold rounded-pill px-4 py-2.5 shadow-xl animate-fade-in">
					{toast}
				</div>
			)}

			{/* ---- Action Modals ---- */}

			{/* Edit Profile Modal */}
			{showEditModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary">Edit Rider Profile</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Modify rider contact parameters saved in core record</p>
						</div>
						<div className="space-y-3">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Name</label>
								<input
									type="text"
									className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-semibold"
									value={editForm.name}
									onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
								/>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Phone</label>
								<input
									type="text"
									className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
									value={editForm.phone}
									onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
								/>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Email</label>
								<input
									type="text"
									className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
									value={editForm.email}
									onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
								/>
							</div>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setShowEditModal(false)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('profile', editForm)}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
								disabled={actionLoading || !editForm.name || !editForm.phone || !editForm.email}
							>
								{actionLoading ? 'Updating...' : 'Save Updates'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Wallet Balance Adjustments Modal */}
			{showWalletModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary">Adjust Wallet Balance</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Issue a manual debit or credit adjustment on the wallet ledger</p>
						</div>
						<div className="space-y-3">
							{/* Direction Radio */}
							<div className="flex space-x-3">
								<button
									onClick={() => setWalletForm({ ...walletForm, isCredit: true })}
									className={`text-[11px] h-7 px-3.5 rounded-pill transition ${walletForm.isCredit ? 'bg-content-primary text-gray-0 font-semibold' : 'bg-background-secondary text-content-secondary'}`}
								>
									Add Credit (+)
								</button>
								<button
									onClick={() => setWalletForm({ ...walletForm, isCredit: false })}
									className={`text-[11px] h-7 px-3.5 rounded-pill transition ${!walletForm.isCredit ? 'bg-content-primary text-gray-0 font-semibold' : 'bg-background-secondary text-content-secondary'}`}
								>
									Issue Debit (-)
								</button>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Amount (INR / ₹)</label>
								<input
									type="number"
									placeholder="e.g. 150.00"
									className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
									value={walletForm.amount}
									onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Audit Justification Reason</label>
								<input
									type="text"
									placeholder="e.g. Refund for waiting fee charge"
									className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
									value={walletForm.description}
									onChange={(e) => setWalletForm({ ...walletForm, description: e.target.value })}
								/>
							</div>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setShowWalletModal(false)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={async () => {
									const rawAmt = parseFloat(walletForm.amount);
									if (isNaN(rawAmt) || rawAmt <= 0) return;
									const multiplier = walletForm.isCredit ? 1 : -1;
									const paiseAmount = Math.round(rawAmt * 100) * multiplier;
									const ok = await handleAction('wallet/adjust', { amount_paise: paiseAmount, description: walletForm.description });
									if (ok) {
										setWalletForm({ amount: '', isCredit: true, description: '' });
										reloadWallet();
									}
								}}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
								disabled={actionLoading || !walletForm.amount || !walletForm.description}
							>
								{actionLoading ? 'Executing...' : 'Post Adjustment'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Issue Voucher Modal */}
			{showVoucherModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary font-sans">Issue Promo Voucher</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Assign an active promo code voucher key on the rider's profile</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Promo Code</label>
							<input
								type="text"
								placeholder="e.g. SUPER50, WELCOME100"
								className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono uppercase"
								value={voucherCode}
								onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setShowVoucherModal(false)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('voucher', { promo_code: voucherCode })}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
								disabled={actionLoading || !voucherCode}
							>
								{actionLoading ? 'Issuing...' : 'Issue Coupon'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Merge Profile Modal */}
			{showMergeModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary">Merge Duplicate Profiles</h3>
							<p className="text-[11px] text-content-tertiary mt-1">
								Merge duplicate customer data into this main ID. The duplicate user history will be deleted.
							</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Duplicate Customer UUID ID</label>
							<input
								type="text"
								placeholder="Paste UUID..."
								className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
								value={duplicateId}
								onChange={(e) => setDuplicateId(e.target.value)}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setShowMergeModal(false)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('merge', { duplicate_id: duplicateId })}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
								disabled={actionLoading || !duplicateId}
							>
								{actionLoading ? 'Merging...' : 'Merge Records'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Lifecycle Confirm Modal (Suspend / Block / GDPR Delete) */}
			{confirmKind && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className={`text-sm font-bold ${confirmCopy[confirmKind].danger ? 'text-status-negative' : 'text-content-primary'}`}>{confirmCopy[confirmKind].title}</h3>
							<p className="text-[11px] text-content-tertiary mt-1">{confirmCopy[confirmKind].body}</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Audit Reason</label>
							<input
								type="text"
								placeholder="Reason for this action…"
								className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
								value={confirmReason}
								onChange={(e) => setConfirmReason(e.target.value)}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => { setConfirmKind(null); setConfirmReason(''); }}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={runConfirm}
								className={`text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 transition-colors ${confirmCopy[confirmKind].danger ? 'bg-status-negative hover:bg-status-negative/90' : 'bg-content-primary hover:bg-gray-800'}`}
								disabled={actionLoading || !confirmReason.trim()}
							>
								{actionLoading ? 'Working...' : confirmCopy[confirmKind].cta}
							</button>
						</div>
					</div>
				</div>
			)}

		</div>
	);
};
