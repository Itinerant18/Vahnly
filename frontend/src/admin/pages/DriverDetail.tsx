import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';

// ── KYC documents (signed S3 URLs) ───────────────────────────────────────
interface DriverSignedDoc {
	id: string;
	document_type: string;
	url: string;
	status: string; // VERIFIED, REJECTED, PENDING, REUPLOAD
	reviewed_at: string | null;
	expiry_date?: string | null; // optional — only present when the row carries an expiry
}

// ── Lazily-loaded driver tab payload shapes (mirror backend handler structs) ──
interface DriverEarningEntry {
	id: string;
	amount_paise: number;
	entry_type: string;
	description: string;
	created_at: string;
}

interface DriverPayout {
	id: string;
	amount_paise: number;
	net_amount_paise: number;
	status: string;
	failure_reason: string;
	created_at: string;
}

interface DriverIncentive {
	id: string;
	campaign_name: string;
	status: string;
	offered_at: string;
	claimed_at: string | null;
}

interface DriverTraining {
	id: string;
	module_title: string;
	status: string;
	score: number | null;
	assigned_at: string;
	completed_at: string | null;
}

interface DriverPerformanceRow {
	period_date: string;
	total_distance_km: number;
	harsh_braking_count: number;
	speeding_count: number;
	sharp_turn_count: number;
	phone_usage_count: number;
	safety_score: number;
}

interface DriverNotification {
	id: string;
	category: string;
	title: string;
	body: string;
	is_read: boolean;
	delivered_at: string;
}

interface DriverAuditEntry {
	id: string;
	admin_email: string;
	action: string;
	details: string;
	created_at: string;
}

interface DriverSafetyAlert {
	id: string;
	order_id: string;
	latitude: number;
	longitude: number;
	admin_notes: string;
	resolved_at: string | null;
	created_at: string;
}

interface DriverSupportTicket {
	id: string;
	subject: string;
	status: string;
	priority: string;
	category: string;
	created_at: string;
}

interface DriverTrip {
	trip_id?: string;
	id?: string;
	order_id?: string;
	status?: string;
	fare_paise?: number;
	total_fare_paise?: number;
	base_fare_paise?: number;
	created_at?: string;
	completed_at?: string;
	assigned_driver_id?: string;
}

interface DriverDetailResponse {
	driver_id: string;
	name: string;
	phone: string;
	city_prefix: string;
	status: string;
	overview: {
		bio: string;
		contact_phone: string;
		contact_email: string;
		city: string;
		status: string;
		online_state: string;
	};
	expertise: string;
	trips_count: number;
	device_info: string;
}

interface LazyTabState<T> {
	loading: boolean;
	loaded: boolean;
	data: T | null;
}

const emptyTab = <T,>(): LazyTabState<T> => ({ loading: false, loaded: false, data: null });

// A document is "expiring soon" within 30 days; "expired" once the expiry is in the past.
const DAY_MS = 86_400_000;
type ExpiryState = 'none' | 'ok' | 'expiring' | 'expired';
const expiryState = (iso?: string | null): ExpiryState => {
	if (!iso) return 'none';
	const t = new Date(iso).getTime();
	if (isNaN(t)) return 'none';
	const delta = t - Date.now();
	if (delta < 0) return 'expired';
	if (delta < 30 * DAY_MS) return 'expiring';
	return 'ok';
};

export const DriverDetail: React.FC = () => {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [data, setData] = useState<DriverDetailResponse | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [activeTab, setActiveTab] = useState<string>('overview');
	const [actionLoading, setActionLoading] = useState<boolean>(false);
	const [toast, setToast] = useState<string | null>(null);

	// KYC tab state
	const [kycTab, setKycTab] = useState<LazyTabState<DriverSignedDoc[]>>(emptyTab);
	const [activeDocIdx, setActiveDocIdx] = useState<number>(0);

	// Other lazily-loaded tabs
	const [tripsTab, setTripsTab] = useState<LazyTabState<DriverTrip[]>>(emptyTab);
	const [earningsTab, setEarningsTab] = useState<LazyTabState<DriverEarningEntry[]>>(emptyTab);
	const [payoutsTab, setPayoutsTab] = useState<LazyTabState<DriverPayout[]>>(emptyTab);
	const [incentivesTab, setIncentivesTab] = useState<LazyTabState<DriverIncentive[]>>(emptyTab);
	const [trainingTab, setTrainingTab] = useState<LazyTabState<DriverTraining[]>>(emptyTab);
	const [performanceTab, setPerformanceTab] = useState<LazyTabState<DriverPerformanceRow[]>>(emptyTab);
	const [notificationsTab, setNotificationsTab] = useState<LazyTabState<DriverNotification[]>>(emptyTab);
	const [auditTab, setAuditTab] = useState<LazyTabState<DriverAuditEntry[]>>(emptyTab);
	const [safetyTab, setSafetyTab] = useState<LazyTabState<DriverSafetyAlert[]>>(emptyTab);
	const [supportTab, setSupportTab] = useState<LazyTabState<DriverSupportTicket[]>>(emptyTab);

	// Modals State
	const [showRatingModal, setShowRatingModal] = useState(false);
	const [ratingForm, setRatingForm] = useState({ adjustment: '0.1', reason: '' });

	const [showWalletModal, setShowWalletModal] = useState(false);
	const [walletForm, setWalletForm] = useState({ amount: '', isBonus: true, description: '' });

	const [showCityModal, setShowCityModal] = useState(false);
	const [targetCity, setTargetCity] = useState('');

	const [showMsgModal, setShowMsgModal] = useState(false);
	const [messageText, setMessageText] = useState('');

	const [showRejectModal, setShowRejectModal] = useState(false);
	const [rejectReason, setRejectReason] = useState('');

	const showToast = useCallback((msg: string) => {
		setToast(msg);
		window.setTimeout(() => setToast(null), 3200);
	}, []);

	const authHeaders = useCallback((): Record<string, string> => {
		const role = localStorage.getItem('admin_role') || 'ADMIN';
		const email = localStorage.getItem('admin_email') || 'admin@platform.com';
		return { 'X-Admin-Role': role, 'X-Admin-Email': email };
	}, []);

	const fetchDriverDetail = useCallback(async () => {
		setLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${id}`, {
				headers: authHeaders(),
			});
			if (res.ok) {
				const payload = await res.json();
				setData(payload);
				setTargetCity(payload.city_prefix);
			} else {
				alert('Driver profile not found.');
				navigate('/drivers');
			}
		} catch (err) {
			console.error('Failed to load driver details', err);
		} finally {
			setLoading(false);
		}
	}, [id, authHeaders, navigate]);

	useEffect(() => {
		if (id) {
			fetchDriverDetail();
		}
	}, [id, fetchDriverDetail]);

	// ── Lazy per-tab loader ────────────────────────────────────────────────
	const loadTab = useCallback(
		async <T,>(
			url: string,
			state: LazyTabState<T>,
			setState: React.Dispatch<React.SetStateAction<LazyTabState<T>>>,
			extract: (json: unknown) => T,
		) => {
			if (state.loaded || state.loading) return;
			setState({ loading: true, loaded: false, data: null });
			try {
				const res = await fetch(url, { headers: authHeaders() });
				const json: unknown = res.ok ? await res.json().catch(() => null) : null;
				setState({ loading: false, loaded: true, data: extract(json) });
			} catch (err) {
				console.error(`Failed to load driver tab ${url}`, err);
				setState({ loading: false, loaded: true, data: extract(null) });
			}
		},
		[authHeaders],
	);

	const reloadKyc = useCallback(() => {
		setKycTab(emptyTab());
		setActiveDocIdx(0);
	}, []);

	useEffect(() => {
		if (!id) return;
		const base = `${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${id}`;
		const asArray = <T,>(json: unknown, key?: string): T[] => {
			if (Array.isArray(json)) return json as T[];
			if (json && typeof json === 'object' && key) {
				const v = (json as Record<string, unknown>)[key];
				if (Array.isArray(v)) return v as T[];
			}
			return [];
		};
		switch (activeTab) {
			case 'kyc':
				loadTab<DriverSignedDoc[]>(`${base}/kyc/documents`, kycTab, setKycTab, (j) =>
					asArray<DriverSignedDoc>(j, 'documents'),
				);
				break;
			case 'trips':
				loadTab<DriverTrip[]>(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders?driver_id=${id}&limit=100`, tripsTab, setTripsTab, (j) => {
					const list = asArray<DriverTrip>(j, 'orders').length ? asArray<DriverTrip>(j, 'orders') : asArray<DriverTrip>(j, 'trips');
					const all = Array.isArray(j) ? (j as DriverTrip[]) : list;
					return all.filter((t) => !t.assigned_driver_id || t.assigned_driver_id === id);
				});
				break;
			case 'earnings':
				loadTab<DriverEarningEntry[]>(`${base}/profile/earnings`, earningsTab, setEarningsTab, (j) => asArray<DriverEarningEntry>(j, 'entries'));
				break;
			case 'payouts':
				loadTab<DriverPayout[]>(`${base}/profile/payouts`, payoutsTab, setPayoutsTab, (j) => asArray<DriverPayout>(j, 'payouts'));
				break;
			case 'incentives':
				loadTab<DriverIncentive[]>(`${base}/profile/incentives`, incentivesTab, setIncentivesTab, (j) => asArray<DriverIncentive>(j, 'offers'));
				break;
			case 'training':
				loadTab<DriverTraining[]>(`${base}/profile/training`, trainingTab, setTrainingTab, (j) => asArray<DriverTraining>(j, 'items'));
				break;
			case 'performance':
				loadTab<DriverPerformanceRow[]>(`${base}/profile/performance`, performanceTab, setPerformanceTab, (j) => asArray<DriverPerformanceRow>(j, 'rows'));
				break;
			case 'notifications':
				loadTab<DriverNotification[]>(`${base}/profile/notifications`, notificationsTab, setNotificationsTab, (j) => asArray<DriverNotification>(j, 'notifications'));
				break;
			case 'audit':
				loadTab<DriverAuditEntry[]>(`${base}/profile/audit`, auditTab, setAuditTab, (j) => asArray<DriverAuditEntry>(j, 'entries'));
				break;
			case 'safety':
				loadTab<DriverSafetyAlert[]>(`${base}/profile/safety`, safetyTab, setSafetyTab, (j) => asArray<DriverSafetyAlert>(j, 'alerts'));
				break;
			case 'support':
				loadTab<DriverSupportTicket[]>(`${base}/profile/support`, supportTab, setSupportTab, (j) => asArray<DriverSupportTicket>(j, 'tickets'));
				break;
		}
	}, [
		activeTab, id, loadTab,
		kycTab, tripsTab, earningsTab, payoutsTab, incentivesTab, trainingTab,
		performanceTab, notificationsTab, auditTab, safetyTab, supportTab,
	]);

	const handleAction = async (actionSlug: string, body?: Record<string, unknown>): Promise<boolean> => {
		setActionLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${id}/${actionSlug}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...authHeaders() },
				body: body ? JSON.stringify(body) : undefined,
			});

			if (res.ok) {
				showToast(`Action '${actionSlug}' completed successfully.`);
				setShowRatingModal(false);
				setShowWalletModal(false);
				setShowCityModal(false);
				setShowMsgModal(false);
				setShowRejectModal(false);
				fetchDriverDetail();
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

	// Per-document KYC review: posts docs-update then refreshes the signed docs.
	const reviewDoc = async (docName: string, status: 'APPROVED' | 'REJECTED' | 'REUPLOAD') => {
		const ok = await handleAction('docs-update', { doc_name: docName, status });
		if (ok) reloadKyc();
	};

	if (loading) {
		return (
			<div className="h-full flex items-center justify-center">
				<div className="text-sm text-content-tertiary animate-pulse">Loading driver profile metrics…</div>
			</div>
		);
	}

	if (!data) return null;

	const tabsList = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'kyc', label: 'KYC & Documents' },
		{ id: 'expertise', label: 'Expertise' },
		{ id: 'trips', label: 'Trips' },
		{ id: 'earnings', label: 'Earnings' },
		{ id: 'payouts', label: 'Payouts' },
		{ id: 'performance', label: 'Performance' },
		{ id: 'incentives', label: 'Incentives' },
		{ id: 'training', label: 'Training' },
		{ id: 'support', label: 'Support' },
		{ id: 'safety', label: 'Safety' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'devices', label: 'Devices' },
		{ id: 'audit', label: 'Audit Log' },
	];

	const TabLoading = () => (
		<div className="p-12 text-center text-xs text-content-tertiary font-mono animate-pulse">Loading…</div>
	);

	const kycDocs = kycTab.data ?? [];
	const trips = tripsTab.data ?? [];
	const earnings = earningsTab.data ?? [];
	const payouts = payoutsTab.data ?? [];
	const incentives = incentivesTab.data ?? [];
	const training = trainingTab.data ?? [];
	const performance = performanceTab.data ?? [];
	const notifications = notificationsTab.data ?? [];
	const auditLogs = auditTab.data ?? [];
	const safety = safetyTab.data ?? [];
	const support = supportTab.data ?? [];

	const activeDoc = kycDocs[activeDocIdx];
	const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url);

	return (
		<div className="w-full h-full flex flex-col lg:flex-row overflow-hidden bg-background-primary">

			{/* ---- Left Sidebar: Profile Summary & Actions ---- */}
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
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">Driver ID</span>
							<span className="font-mono text-xs text-content-primary break-all font-semibold">{data.driver_id}</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">Phone</span>
							<span className="font-mono text-xs text-content-secondary">{data.phone}</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">City Scope Prefix</span>
							<span className="font-mono text-xs text-content-secondary uppercase">{data.city_prefix}</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-content-tertiary font-semibold">Online Status</span>
							<span className="text-xs text-content-primary font-semibold flex items-center">
								<span className={`w-2 h-2 rounded-full mr-2 ${data.overview.online_state === 'OFFLINE' ? 'bg-status-negative' : 'bg-status-online'}`} />
								{data.overview.online_state}
							</span>
						</div>
					</div>
				</div>

				{/* Administrative Actions */}
				<div className="border-t border-background-secondary pt-4 space-y-2">
					<h3 className="text-[10px] uppercase tracking-wider text-content-tertiary mb-2.5 font-bold">Admin Actions</h3>

					{data.status === 'PENDING_KYC' && (
						<>
							<button
								onClick={() => handleAction('verify-kyc')}
								className="w-full text-left text-xs text-gray-0 bg-content-primary hover:bg-gray-800 font-semibold rounded-pill px-4.5 py-2 transition-colors text-center"
							>
								Approve KYC Profile
							</button>
							<button
								onClick={() => setShowRejectModal(true)}
								className="w-full text-left text-xs text-status-negative bg-status-negative/5 hover:bg-status-negative/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Reject Application
							</button>
						</>
					)}

					{data.status !== 'ACTIVE' && data.status !== 'PENDING_KYC' && (
						<button
							onClick={() => handleAction('unblock')}
							className="w-full text-left text-xs text-content-primary hover:text-gray-0 hover:bg-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
						>
							Restore Driver Status
						</button>
					)}

					{data.status === 'ACTIVE' && (
						<>
							<button
								onClick={() => handleAction('suspend')}
								className="w-full text-left text-xs text-status-pending bg-status-pending/5 hover:bg-status-pending/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Suspend (Temporary)
							</button>

							<button
								onClick={() => handleAction('block')}
								className="w-full text-left text-xs text-status-negative bg-status-negative/5 hover:bg-status-negative/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Block (Permanent)
							</button>
						</>
					)}

					{data.overview.online_state !== 'OFFLINE' && (
						<button
							onClick={() => handleAction('force-offline')}
							className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
						>
							Force Offline Override
						</button>
					)}

					<button
						onClick={() => setShowCityModal(true)}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Reassign City Scope
					</button>

					<button
						onClick={() => setShowRatingModal(true)}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Adjust Rating Metric
					</button>

					<button
						onClick={() => setShowWalletModal(true)}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Credit Bonus / Deduct
					</button>

					<button
						onClick={() => setShowMsgModal(true)}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Send Direct SMS/Push
					</button>

					<button
						onClick={() => handleAction('reset-password')}
						className="w-full text-left text-xs text-content-secondary hover:text-content-primary font-semibold bg-background-tertiary rounded-pill px-4.5 py-2 transition-colors"
					>
						Reset Credentials Code
					</button>

					<button
						onClick={() => {
							if (window.confirm("CRITICAL WARNING: This will permanently wipe driver documents and data (GDPR). Proceed?")) {
								handleAction('delete').then((ok) => { if (ok) navigate('/drivers'); });
							}
						}}
						className="w-full text-left text-xs text-content-tertiary hover:text-status-negative font-semibold px-4.5 py-2 transition-colors text-center"
					>
						GDPR Delete Profile
					</button>
				</div>
			</div>

			{/* ---- Right Workspace: Tabbed Viewport ---- */}
			<div className="flex-1 flex flex-col overflow-hidden bg-background-primary">
				{/* Scrollable Tab Navigation Row */}
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

				{/* Active Panel Viewport */}
				<div className="flex-1 overflow-y-auto p-6">

					{/* OVERVIEW */}
					{activeTab === 'overview' && (
						<div className="space-y-6">
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-3">
								<h3 className="text-sm font-bold text-content-primary">Driver Biography</h3>
								<p className="text-xs text-content-secondary leading-relaxed">{data.overview.bio}</p>
							</div>

							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-content-primary font-sans">Verification Checklist</h3>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="bg-background-tertiary p-4 rounded-xl">
										<span className="block text-[10px] text-content-tertiary uppercase font-bold">Background check</span>
										<span className="text-sm font-semibold text-content-primary mt-1 block uppercase">CLEARED</span>
									</div>
									<div className="bg-background-tertiary p-4 rounded-xl">
										<span className="block text-[10px] text-content-tertiary uppercase font-bold">Partner Status</span>
										<span className="text-sm font-semibold text-content-primary mt-1 block uppercase">{data.status}</span>
									</div>
								</div>
							</div>
						</div>
					)}

					{/* KYC & DOCUMENTS */}
					{activeTab === 'kyc' && (
						kycTab.loading ? <TabLoading /> : (
						<div className="space-y-6">
							{kycDocs.length === 0 ? (
								<div className="bg-background-primary border border-background-secondary rounded-xl p-12 text-center text-xs text-content-tertiary">
									No KYC documents uploaded by this applicant.
								</div>
							) : (
								<>
									{/* Doc selector chips */}
									<div className="flex gap-2 flex-wrap">
										{kycDocs.map((doc, idx) => {
											const exp = expiryState(doc.expiry_date);
											return (
												<button
													key={doc.id}
													type="button"
													onClick={() => setActiveDocIdx(idx)}
													className={`rounded-pill px-3 py-1.5 text-[11px] font-semibold transition flex items-center gap-1.5 ${
														activeDocIdx === idx
															? 'bg-content-primary text-gray-0'
															: 'bg-background-secondary border border-background-secondary text-content-secondary hover:text-content-primary'
													}`}
												>
													{exp === 'expired' && <span className="w-1.5 h-1.5 rounded-full bg-status-negative" />}
													{exp === 'expiring' && <span className="w-1.5 h-1.5 rounded-full bg-status-pending" />}
													{doc.document_type.replace(/_/g, ' ')}
												</button>
											);
										})}
									</div>

									{activeDoc && (() => {
										const exp = expiryState(activeDoc.expiry_date);
										return (
											<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
												{/* Header row */}
												<div className="flex justify-between items-center">
													<div>
														<h3 className="text-sm font-bold text-content-primary">{activeDoc.document_type.replace(/_/g, ' ')}</h3>
														{activeDoc.reviewed_at && (
															<span className="text-[10px] text-content-tertiary">Reviewed: {new Date(activeDoc.reviewed_at).toLocaleString()}</span>
														)}
													</div>
													<span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
														activeDoc.status === 'VERIFIED' || activeDoc.status === 'APPROVED'
															? 'bg-status-online/10 text-status-online'
															: activeDoc.status === 'REJECTED' || activeDoc.status === 'REUPLOAD'
															? 'bg-status-negative/10 text-status-negative'
															: 'bg-status-pending/10 text-status-pending'
													}`}>
														{activeDoc.status}
													</span>
												</div>

												{/* Expiry banner */}
												{exp === 'expired' && (
													<div className="bg-status-negative/5 border border-status-negative/25 p-3 rounded-xl text-status-negative text-xs font-semibold">
														⚠️ This document expired on {new Date(activeDoc.expiry_date as string).toLocaleDateString()}.
													</div>
												)}
												{exp === 'expiring' && (
													<div className="bg-status-pending/5 border border-status-pending/25 p-3 rounded-xl text-status-pending text-xs font-semibold">
														⚠️ This document expires soon: {new Date(activeDoc.expiry_date as string).toLocaleDateString()}.
													</div>
												)}

												{/* Viewer: PDF in iframe, image in img */}
												<div className={`rounded-xl overflow-hidden bg-background-tertiary border ${exp === 'expired' ? 'border-status-negative/40' : 'border-background-secondary'}`}>
													{!activeDoc.url ? (
														<div className="p-12 text-center text-xs text-content-tertiary">No file available for this document.</div>
													) : isPdf(activeDoc.url) ? (
														<iframe
															src={activeDoc.url}
															title={activeDoc.document_type}
															className="w-full h-[460px] bg-white"
														/>
													) : (
														<img
															src={activeDoc.url}
															alt={activeDoc.document_type}
															className="w-full max-h-[460px] object-contain"
														/>
													)}
												</div>

												{/* Per-doc review actions */}
												<div className="flex gap-2 border-t border-background-secondary pt-4">
													<button
														onClick={() => reviewDoc(activeDoc.document_type, 'APPROVED')}
														disabled={actionLoading}
														className="flex-1 text-xs bg-content-primary text-gray-0 font-semibold px-3 py-2 rounded-pill hover:bg-gray-800 transition disabled:opacity-50"
													>
														Approve
													</button>
													<button
														onClick={() => reviewDoc(activeDoc.document_type, 'REJECTED')}
														disabled={actionLoading}
														className="flex-1 text-xs text-status-negative bg-status-negative/5 hover:bg-status-negative/10 font-semibold px-3 py-2 rounded-pill transition disabled:opacity-50"
													>
														Reject
													</button>
													<button
														onClick={() => reviewDoc(activeDoc.document_type, 'REUPLOAD')}
														disabled={actionLoading}
														className="flex-1 text-xs text-content-secondary bg-background-secondary border border-background-secondary hover:bg-background-tertiary font-semibold px-3 py-2 rounded-pill transition disabled:opacity-50"
													>
														Request Reupload
													</button>
												</div>
											</div>
										);
									})()}
								</>
							)}
						</div>
						)
					)}

					{/* VEHICLE EXPERTISE */}
					{activeTab === 'expertise' && (
						<div className="space-y-6">
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-content-primary">Transmission Expertises</h3>
								<div className="bg-background-tertiary p-5 rounded-xl text-center">
									<span className="block text-[10px] text-content-tertiary uppercase font-bold">Active Certification Scopes</span>
									<span className="text-2xl font-extrabold font-mono text-content-primary mt-2 block uppercase">{data.expertise}</span>
								</div>
							</div>
						</div>
					)}

					{/* TRIPS */}
					{activeTab === 'trips' && (
						<div className="bg-background-primary border border-background-secondary rounded-xl overflow-hidden">
							<div className="p-6 border-b border-background-secondary flex justify-between items-center bg-background-tertiary">
								<span className="text-xs font-bold text-content-primary">Trip Reservations List</span>
								<span className="text-xs font-mono text-content-secondary font-semibold">{data.trips_count} Total Bookings</span>
							</div>
							{tripsTab.loading ? (
								<div className="p-12 text-center text-xs text-content-tertiary font-mono animate-pulse">Loading trips…</div>
							) : trips.length === 0 ? (
								<div className="p-12 text-center text-xs text-content-tertiary font-mono">No trips found for this driver.</div>
							) : (
								<table className="w-full text-left text-xs">
									<thead>
										<tr className="border-b border-background-secondary bg-background-tertiary text-[10px] uppercase tracking-wider text-content-tertiary">
											<th className="p-3">Order ID</th>
											<th className="p-3">Status</th>
											<th className="p-3 text-right">Fare</th>
											<th className="p-3">Date</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-background-secondary">
										{trips.map((t) => {
											const oid = t.trip_id || t.id || t.order_id || '';
											const farePaise = t.fare_paise ?? t.total_fare_paise ?? t.base_fare_paise ?? 0;
											const when = t.created_at || t.completed_at;
											return (
												<tr key={oid} onClick={() => navigate(`/trips/${oid}`)} className="hover:bg-background-tertiary cursor-pointer">
													<td className="p-3 font-mono text-content-primary">{String(oid).slice(0, 12)}</td>
													<td className="p-3"><span className="text-[10px] font-bold uppercase">{t.status}</span></td>
													<td className="p-3 text-right font-mono text-content-primary">₹{(farePaise / 100).toFixed(2)}</td>
													<td className="p-3 font-mono text-content-secondary">{when ? new Date(when).toLocaleDateString() : '—'}</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							)}
						</div>
					)}

					{/* EARNINGS */}
					{activeTab === 'earnings' && (
						earningsTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-content-primary">Earnings Ledger</h3>
							{earnings.length === 0 ? (
								<div className="p-8 text-center text-xs text-content-tertiary">No earnings ledger entries.</div>
							) : (
								<div className="overflow-hidden rounded-xl border border-background-secondary">
									<table className="w-full text-left text-xs border-collapse">
										<thead>
											<tr className="border-b border-background-secondary bg-background-secondary">
												<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Type</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Description</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary text-right">Amount</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-content-tertiary">Date</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-background-secondary font-mono text-content-secondary">
											{earnings.map((e) => {
												const isCredit = e.amount_paise >= 0;
												return (
													<tr key={e.id} className="hover:bg-background-tertiary">
														<td className="p-3">
															<span className="inline-flex items-center font-bold px-2 py-0.5 rounded text-[9px] font-sans bg-background-secondary text-content-primary uppercase">{e.entry_type}</span>
														</td>
														<td className="p-3 font-sans text-content-primary">{e.description}</td>
														<td className={`p-3 text-right font-bold ${isCredit ? 'text-content-primary' : 'text-status-negative'}`}>
															{isCredit ? '+' : '-'} ₹{(Math.abs(e.amount_paise) / 100).toFixed(2)}
														</td>
														<td className="p-3 text-content-tertiary">{new Date(e.created_at).toLocaleDateString()}</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							)}
						</div>
						)
					)}

					{/* PAYOUTS */}
					{activeTab === 'payouts' && (
						payoutsTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-content-primary">Bank Remittances History</h3>
							{payouts.length === 0 ? (
								<div className="p-8 text-center text-xs text-content-tertiary">No payouts on record.</div>
							) : (
								<div className="divide-y divide-background-secondary">
									{payouts.map((pay) => (
										<div key={pay.id} className="py-3.5 flex justify-between items-center text-xs">
											<div>
												<span className="font-mono text-content-primary font-semibold block">{pay.id.substring(0, 12)}</span>
												{pay.failure_reason && <span className="text-status-negative font-sans text-[10px]">{pay.failure_reason}</span>}
											</div>
											<div className="text-right">
												<span className="block font-mono font-bold text-content-primary">₹{(pay.net_amount_paise / 100).toFixed(2)}</span>
												<span className="text-[10px] text-content-tertiary font-mono">gross ₹{(pay.amount_paise / 100).toFixed(2)} · {new Date(pay.created_at).toLocaleDateString()}</span>
											</div>
											<span className={`text-[10px] font-bold px-2 py-0.5 rounded ${pay.status === 'FAILED' ? 'bg-status-negative/10 text-status-negative' : 'bg-background-secondary text-status-online'}`}>{pay.status}</span>
										</div>
									))}
								</div>
							)}
						</div>
						)
					)}

					{/* PERFORMANCE */}
					{activeTab === 'performance' && (
						performanceTab.loading ? <TabLoading /> : (() => {
							const trend = performance.map((p) => p.safety_score);
							const latest = performance[0];
							return (
								<div className="space-y-6">
									<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
										<div className="bg-background-primary border border-background-secondary rounded-xl p-4 text-center">
											<span className="text-[10px] uppercase text-content-tertiary tracking-wider font-bold">Latest Safety Score</span>
											<span className="text-3xl font-extrabold text-content-primary font-mono mt-2 block">{latest ? latest.safety_score : '—'}</span>
										</div>
										<div className="bg-background-primary border border-background-secondary rounded-xl p-4 text-center">
											<span className="text-[10px] uppercase text-content-tertiary tracking-wider font-bold">Harsh Braking (latest)</span>
											<span className="text-3xl font-extrabold text-content-primary font-mono mt-2 block">{latest ? latest.harsh_braking_count : '—'}</span>
										</div>
										<div className="bg-background-primary border border-background-secondary rounded-xl p-4 text-center">
											<span className="text-[10px] uppercase text-content-tertiary tracking-wider font-bold">Speeding (latest)</span>
											<span className="text-3xl font-extrabold text-content-primary font-mono mt-2 block">{latest ? latest.speeding_count : '—'}</span>
										</div>
									</div>

									<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
										<h3 className="text-sm font-bold text-content-primary">Safety Score Trajectory</h3>
										{trend.length === 0 ? (
											<div className="p-8 text-center text-xs text-content-tertiary">No performance periods recorded.</div>
										) : (
											<div className="flex space-x-3.5 items-end justify-center py-6 h-36 border border-background-secondary rounded-xl bg-background-tertiary">
												{trend.slice(0, 12).reverse().map((score, idx) => {
													const heightPercent = (score / 100) * 100;
													return (
														<div key={idx} className="flex flex-col items-center space-y-2">
															<span className="text-[10px] font-semibold font-mono">{score}</span>
															<div style={{ height: `${heightPercent}px` }} className="w-8 bg-content-primary rounded-t-sm" />
															<span className="text-[9px] text-content-tertiary font-mono">P-{idx + 1}</span>
														</div>
													);
												})}
											</div>
										)}
									</div>
								</div>
							);
						})()
					)}

					{/* INCENTIVES */}
					{activeTab === 'incentives' && (
						incentivesTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-content-primary">Incentive Campaign Offers</h3>
							{incentives.length === 0 ? (
								<div className="p-8 text-center text-xs text-content-tertiary">No incentive offers assigned.</div>
							) : (
								<div className="divide-y divide-background-secondary">
									{incentives.map((inc) => (
										<div key={inc.id} className="py-4 flex justify-between items-center text-xs">
											<div>
												<span className="font-sans text-content-primary font-bold block">{inc.campaign_name}</span>
												<span className="text-content-tertiary font-mono text-[10px]">Offered {new Date(inc.offered_at).toLocaleDateString()}{inc.claimed_at ? ` · Claimed ${new Date(inc.claimed_at).toLocaleDateString()}` : ''}</span>
											</div>
											<span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${inc.status === 'CLAIMED' ? 'bg-status-online/10 text-status-online' : 'bg-background-secondary text-content-secondary'}`}>{inc.status}</span>
										</div>
									))}
								</div>
							)}
						</div>
						)
					)}

					{/* TRAINING */}
					{activeTab === 'training' && (
						trainingTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-content-primary">Onboarding Training Status</h3>
							{training.length === 0 ? (
								<div className="p-8 text-center text-xs text-content-tertiary">No training modules assigned.</div>
							) : (
								<div className="space-y-3">
									{training.map((t) => (
										<div key={t.id} className="bg-background-tertiary p-4 rounded-xl text-xs font-semibold text-content-primary flex justify-between items-center">
											<div className="flex items-center">
												<span className={`w-2 h-2 rounded-full mr-2.5 ${t.status === 'COMPLETED' ? 'bg-status-online' : 'bg-status-pending'}`} />
												{t.module_title}
												{t.score != null && <span className="ml-2 text-content-tertiary font-mono">({t.score})</span>}
											</div>
											<span className="text-[10px] bg-background-primary text-content-primary border border-background-secondary font-mono px-2 py-0.5 rounded uppercase">{t.status}</span>
										</div>
									))}
								</div>
							)}
						</div>
						)
					)}

					{/* SUPPORT */}
					{activeTab === 'support' && (
						supportTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-content-primary">Support Tickets</h3>
							{support.length === 0 ? (
								<div className="p-8 text-center text-xs text-content-tertiary font-mono">No open support ticket issues registered for this driver ID.</div>
							) : (
								<div className="divide-y divide-background-secondary">
									{support.map((t) => (
										<div key={t.id} className="py-3 flex justify-between items-center text-xs">
											<div>
												<span className="font-mono text-content-primary font-semibold block">{t.id.substring(0, 12)}</span>
												<span className="text-content-secondary">{t.subject}</span>
											</div>
											<div className="flex items-center space-x-3">
												<span className="text-content-tertiary font-mono uppercase text-[10px]">{t.priority} · {t.category}</span>
												<span className="bg-background-secondary text-[10px] font-bold px-2 py-0.5 rounded uppercase">{t.status}</span>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
						)
					)}

					{/* SAFETY */}
					{activeTab === 'safety' && (
						safetyTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-content-primary">Safety / SOS Incidents</h3>
							{safety.length === 0 ? (
								<div className="p-8 text-center text-xs text-content-tertiary font-mono">No recorded safety SOS incident logs.</div>
							) : (
								<div className="divide-y divide-background-secondary">
									{safety.map((s) => (
										<div key={s.id} className="py-3 flex justify-between items-start text-xs">
											<div>
												<span className="font-mono text-content-primary font-semibold block">
													Order TRP-{s.order_id ? s.order_id.substring(s.order_id.length - 6).toUpperCase() : '—'}
												</span>
												{s.admin_notes && <span className="text-content-secondary block mt-0.5">{s.admin_notes}</span>}
												<span className="text-[10px] text-content-tertiary font-mono">{s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}</span>
											</div>
											<div className="text-right">
												<span className={`text-[10px] font-bold px-2 py-0.5 rounded ${s.resolved_at ? 'bg-status-online/10 text-status-online' : 'bg-status-negative/10 text-status-negative'}`}>
													{s.resolved_at ? 'RESOLVED' : 'OPEN'}
												</span>
												<span className="block text-[10px] text-content-tertiary font-mono mt-1">{new Date(s.created_at).toLocaleString()}</span>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
						)
					)}

					{/* NOTIFICATIONS */}
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
												<td className="p-4 font-mono font-semibold text-content-primary uppercase">{n.category}</td>
												<td className="p-4 font-sans text-content-primary">
													<span className="font-semibold block">{n.title}</span>
													<span className="text-content-secondary">{n.body}</span>
												</td>
												<td className="p-4 font-mono text-content-tertiary">{new Date(n.delivered_at).toLocaleString()}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
						)
					)}

					{/* DEVICES */}
					{activeTab === 'devices' && (
						<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-content-primary">Driver Hardware Terminals</h3>
							<div className="bg-background-tertiary p-4 rounded-xl text-xs font-semibold text-content-primary">
								<span className="block text-[10px] text-content-tertiary uppercase font-bold mb-1">Active Device Info</span>
								<span className="font-mono">{data.device_info}</span>
							</div>
						</div>
					)}

					{/* AUDIT LOG */}
					{activeTab === 'audit' && (
						auditTab.loading ? <TabLoading /> : (
						<div className="bg-background-primary border border-background-secondary rounded-xl overflow-hidden">
							{auditLogs.length === 0 ? (
								<div className="p-12 text-center text-xs text-content-tertiary font-mono">No admin auditing modifications logged.</div>
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
												<td className="p-4 font-semibold text-content-primary">{new Date(log.created_at).toLocaleString()}</td>
												<td className="p-4 font-sans text-xs">{log.admin_email}</td>
												<td className="p-4">
													<span className="bg-background-secondary px-2 py-0.5 rounded font-bold text-content-primary">{log.action}</span>
												</td>
												<td className="p-4 font-sans text-xs text-content-primary">{log.details}</td>
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

			{/* ---- Modals View ---- */}

			{/* Adjust Rating Modal */}
			{showRatingModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary">Adjust Driver Rating</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Directly adjust simulated driver rating metric</p>
						</div>
						<div className="space-y-3">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Adjustment Offset (e.g. +0.2, -0.3)</label>
								<input
									type="text"
									className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono font-semibold"
									value={ratingForm.adjustment}
									onChange={(e) => setRatingForm({ ...ratingForm, adjustment: e.target.value })}
								/>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Audit Reason</label>
								<input
									type="text"
									placeholder="e.g. Excellent service adjustment"
									className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
									value={ratingForm.reason}
									onChange={(e) => setRatingForm({ ...ratingForm, reason: e.target.value })}
								/>
							</div>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setShowRatingModal(false)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('rating-adjust', { adjustment: parseFloat(ratingForm.adjustment), reason: ratingForm.reason })}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
								disabled={actionLoading || !ratingForm.adjustment || !ratingForm.reason}
							>
								{actionLoading ? 'Saving...' : 'Apply Rating'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Wallet Credit/Deduct Modal */}
			{showWalletModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary">Post Wallet Transaction</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Issue a bonus incentive credit or apply a penalty deduction fee</p>
						</div>
						<div className="space-y-3">
							<div className="flex space-x-3">
								<button
									onClick={() => setWalletForm({ ...walletForm, isBonus: true })}
									className={`text-[11px] h-7 px-3.5 rounded-pill transition ${walletForm.isBonus ? 'bg-content-primary text-gray-0 font-semibold' : 'bg-background-secondary text-content-secondary'}`}
								>
									Add Bonus Credit (+)
								</button>
								<button
									onClick={() => setWalletForm({ ...walletForm, isBonus: false })}
									className={`text-[11px] h-7 px-3.5 rounded-pill transition ${!walletForm.isBonus ? 'bg-content-primary text-gray-0 font-semibold' : 'bg-background-secondary text-content-secondary'}`}
								>
									Apply Deduction (-)
								</button>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Amount (₹)</label>
								<input
									type="number"
									placeholder="e.g. 500.00"
									className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
									value={walletForm.amount}
									onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Justification Description</label>
								<input
									type="text"
									placeholder="e.g. Weekly high-rating trip goal met"
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
								onClick={() => {
									const rawAmt = parseFloat(walletForm.amount);
									if (isNaN(rawAmt) || rawAmt <= 0) return;
									const multiplier = walletForm.isBonus ? 1 : -1;
									const paise = Math.round(rawAmt * 100) * multiplier;
									handleAction('wallet', { amount_paise: paise, description: walletForm.description });
								}}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
								disabled={actionLoading || !walletForm.amount || !walletForm.description}
							>
								{actionLoading ? 'Processing...' : 'Post Remittance'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Reassign City Modal */}
			{showCityModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary">Reassign Operations City Scope</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Shift driver mapping scope to a different active city prefix hub</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Target City Prefix</label>
							<select
								className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono font-semibold"
								value={targetCity}
								onChange={(e) => setTargetCity(e.target.value)}
							>
								<option value="KOL">KOL (Kolkata)</option>
								<option value="BLR">BLR (Bangalore)</option>
								<option value="DEL">DEL (Delhi)</option>
								<option value="MUM">MUM (Mumbai)</option>
							</select>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setShowCityModal(false)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('reassign-city', { city_prefix: targetCity })}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
								disabled={actionLoading || !targetCity}
							>
								{actionLoading ? 'Updating...' : 'Assign City'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Send Notification Modal */}
			{showMsgModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary">Dispatch Message Notification</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Send a direct text SMS or high priority push notification to driver app</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Message Body Payload</label>
							<textarea
								rows={3}
								placeholder="Type message here..."
								className="w-full rounded-md bg-background-secondary border border-background-secondary p-2.5 text-xs text-content-primary focus:outline-none focus:border-content-primary font-semibold"
								value={messageText}
								onChange={(e) => setMessageText(e.target.value)}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setShowMsgModal(false)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
							>
								Cancel
							</button>
							<button
								onClick={() => {
									handleAction('message', { title: 'Message from Support', body: messageText });
									setShowMsgModal(false);
									setMessageText('');
								}}
								className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-gray-800 transition-colors"
								disabled={!messageText.trim()}
							>
								Dispatch Broadcast
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Reject KYC Application Modal */}
			{showRejectModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary font-sans text-status-negative">Reject Application</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Provide clear audit log reason for candidate verification rejection</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Rejection Audit Reason</label>
							<input
								type="text"
								placeholder="e.g. Identity selfie match failure"
								className="w-full h-9 rounded-md bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-semibold"
								value={rejectReason}
								onChange={(e) => setRejectReason(e.target.value)}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								onClick={() => setShowRejectModal(false)}
								className="text-xs text-content-secondary hover:text-content-primary px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('reject-kyc', { reason: rejectReason })}
								className="bg-status-negative text-gray-0 text-xs font-semibold rounded-pill h-8 px-4 hover:bg-status-negative/90 transition-colors"
								disabled={actionLoading || !rejectReason.trim()}
							>
								{actionLoading ? 'Rejecting...' : 'Reject Applicant'}
							</button>
						</div>
					</div>
				</div>
			)}

		</div>
	);
};
