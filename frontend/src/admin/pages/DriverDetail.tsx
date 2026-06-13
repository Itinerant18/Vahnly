import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';

interface DriverKYCDocument {
	name: string;
	status: string; // APPROVED, REJECTED, PENDING, REUPLOAD
	url: string;
	uploaded_at: string;
	expiry_date: string;
}

interface DriverEarningRecord {
	period: string;
	gross_paise: number;
	incentives: number;
	bonuses: number;
	deductions: number;
	net_paise: number;
}

interface DriverPayoutRecord {
	payout_id: string;
	amount_paise: number;
	status: string;
	bank_details: string;
	requested_at: string;
}

interface DriverPerformanceTab {
	acceptance_rate: number;
	cancellation_rate: number;
	on_time_arrival_rate: number;
	rating_trend: number[];
	complaints_count: number;
}

interface DriverIncentiveGoal {
	goal_id: string;
	description: string;
	target_trips: number;
	current_trip: number;
	bonus_paise: number;
	completed: boolean;
}

interface RiderNotificationLog {
	type: string;
	payload: string;
	timestamp: string;
}

interface RiderAuditLogEntry {
	id: string;
	admin_user: string;
	action: string;
	details: string;
	ip: string;
	created_at: string;
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
	kyc_documents: DriverKYCDocument[];
	expertise: string;
	trips_count: number;
	earnings: DriverEarningRecord[];
	payouts: DriverPayoutRecord[];
	performance: DriverPerformanceTab;
	incentives: DriverIncentiveGoal[];
	training: string[];
	tickets_count: number;
	incidents_count: number;
	notifications: RiderNotificationLog[];
	device_info: string;
	audit_logs: RiderAuditLogEntry[];
}

export const DriverDetail: React.FC = () => {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [data, setData] = useState<DriverDetailResponse | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [activeTab, setActiveTab] = useState<string>('overview');
	const [actionLoading, setActionLoading] = useState<boolean>(false);

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

	const fetchDriverDetail = async () => {
		setLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${id}`, {
				headers: {
					'X-Admin-Role': role,
				},
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
	};

	useEffect(() => {
		if (id) {
			fetchDriverDetail();
		}
	}, [id]);

	// Lazy-load the driver's trips when the Trips tab is opened.
	const [driverTrips, setDriverTrips] = useState<any[]>([]);
	const [tripsLoading, setTripsLoading] = useState<boolean>(false);
	useEffect(() => {
		if (activeTab !== 'trips' || !id) return;
		setTripsLoading(true);
		const role = localStorage.getItem('admin_role') || 'ADMIN';
		fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders?driver_id=${id}&limit=100`, { headers: { 'X-Admin-Role': role } })
			.then((r) => (r.ok ? r.json() : []))
			.then((d) => {
				const list = Array.isArray(d) ? d : (d.orders || d.trips || []);
				// Defensive client-side filter in case the API ignores driver_id.
				setDriverTrips(list.filter((t: any) => !t.assigned_driver_id || t.assigned_driver_id === id));
			})
			.catch(() => setDriverTrips([]))
			.finally(() => setTripsLoading(false));
	}, [activeTab, id]);

	const handleAction = async (actionSlug: string, body?: any) => {
		setActionLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const email = localStorage.getItem('admin_email') || 'admin@platform.com';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${id}/${actionSlug}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Admin-Role': role,
					'X-Admin-Email': email,
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (res.ok) {
				alert(`Action '${actionSlug}' completed successfully.`);
				setShowRatingModal(false);
				setShowWalletModal(false);
				setShowCityModal(false);
				setShowMsgModal(false);
				setShowRejectModal(false);
				fetchDriverDetail();
			} else {
				const msg = await res.text();
				alert(`Action failed: ${msg}`);
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		} finally {
			setActionLoading(false);
		}
	};

	if (loading) {
		return (
			<div className="h-full flex items-center justify-center">
				<div className="text-sm text-mute animate-pulse">Loading driver profile metrics…</div>
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

	return (
		<div className="w-full h-full flex flex-col lg:flex-row overflow-hidden bg-canvas">
			
			{/* ---- Left Sidebar: Profile Summary & Actions ---- */}
			<div className="w-full lg:w-[320px] bg-canvas border-r border-canvas-soft p-6 flex flex-col flex-shrink-0 overflow-y-auto space-y-6">
				
				{/* Basic Details Card */}
				<div className="flex flex-col items-center text-center">
					<div className="w-20 h-20 rounded-full bg-canvas-soft border border-canvas-soft flex items-center justify-center text-3xl font-bold text-ink">
						{data.name.split(' ').map(n => n[0]).join('')}
					</div>
					<h2 className="text-lg font-bold text-ink mt-4">{data.name}</h2>
					
					{/* Status Badge */}
					<div className="mt-2">
						<span
							className={`inline-flex items-center text-[10px] font-bold uppercase rounded-pill h-5 px-2.5 tracking-wider border ${
								data.status === 'ACTIVE'
									? 'bg-canvas text-ink border-canvas-soft'
									: data.status === 'SUSPENDED'
									? 'bg-canvas-soft text-status-warn border-canvas-soft'
									: data.status === 'BLOCKED'
									? 'bg-canvas-soft text-status-alert border-canvas-soft'
									: 'bg-canvas-soft text-mute border-canvas-soft'
							}`}
						>
							<span
								className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
									data.status === 'ACTIVE'
										? 'bg-status-online'
										: data.status === 'SUSPENDED'
										? 'bg-status-warn'
										: 'bg-status-alert'
								}`}
							/>
							{data.status.toLowerCase()}
						</span>
					</div>

					{/* Metadata Items */}
					<div className="w-full text-left space-y-3 mt-6 border-t border-canvas-soft pt-4">
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">Driver ID</span>
							<span className="font-mono text-xs text-ink break-all font-semibold">{data.driver_id}</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">Phone</span>
							<span className="font-mono text-xs text-body">{data.phone}</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">City Scope Prefix</span>
							<span className="font-mono text-xs text-body uppercase">{data.city_prefix}</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">Online Status</span>
							<span className="text-xs text-ink font-semibold flex items-center">
								<span className={`w-2 h-2 rounded-full mr-2 ${data.overview.online_state === 'OFFLINE' ? 'bg-status-alert' : 'bg-status-online'}`} />
								{data.overview.online_state}
							</span>
						</div>
					</div>
				</div>

				{/* Administrative Actions */}
				<div className="border-t border-canvas-soft pt-4 space-y-2">
					<h3 className="text-[10px] uppercase tracking-wider text-mute mb-2.5 font-bold">Admin Actions</h3>
					
					{data.status === 'PENDING_KYC' && (
						<>
							<button
								onClick={() => handleAction('verify-kyc')}
								className="w-full text-left text-xs text-on-dark bg-ink hover:bg-black-elevated font-semibold rounded-pill px-4.5 py-2 transition-colors text-center"
							>
								Approve KYC Profile
							</button>
							<button
								onClick={() => setShowRejectModal(true)}
								className="w-full text-left text-xs text-status-alert bg-status-alert/5 hover:bg-status-alert/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Reject Application
							</button>
						</>
					)}

					{data.status !== 'ACTIVE' && data.status !== 'PENDING_KYC' && (
						<button
							onClick={() => handleAction('unblock')}
							className="w-full text-left text-xs text-ink hover:text-on-dark hover:bg-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
						>
							Restore Driver Status
						</button>
					)}

					{data.status === 'ACTIVE' && (
						<>
							<button
								onClick={() => handleAction('suspend')}
								className="w-full text-left text-xs text-status-warn bg-status-warn/5 hover:bg-status-warn/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Suspend (Temporary)
							</button>

							<button
								onClick={() => handleAction('block')}
								className="w-full text-left text-xs text-status-alert bg-status-alert/5 hover:bg-status-alert/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Block (Permanent)
							</button>
						</>
					)}

					{data.overview.online_state !== 'OFFLINE' && (
						<button
							onClick={() => handleAction('force-offline')}
							className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
						>
							Force Offline Override
						</button>
					)}

					<button
						onClick={() => setShowCityModal(true)}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Reassign City Scope
					</button>

					<button
						onClick={() => setShowRatingModal(true)}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Adjust Rating Metric
					</button>

					<button
						onClick={() => setShowWalletModal(true)}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Credit Bonus / Deduct
					</button>

					<button
						onClick={() => setShowMsgModal(true)}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Send Direct SMS/Push
					</button>

					<button
						onClick={() => handleAction('reset-password')}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Reset Credentials Code
					</button>

					<button
						onClick={() => {
							if (window.confirm("CRITICAL WARNING: This will permanently wipe driver documents and data (GDPR). Proceed?")) {
								handleAction('delete').then(() => navigate('/drivers'));
							}
						}}
						className="w-full text-left text-xs text-mute hover:text-status-alert font-semibold px-4.5 py-2 transition-colors text-center"
					>
						GDPR Delete Profile
					</button>
				</div>
			</div>

			{/* ---- Right Workspace: Tabbed Viewport ---- */}
			<div className="flex-1 flex flex-col overflow-hidden bg-canvas">
				{/* Scrollable Tab Navigation Row */}
				<div className="flex overflow-x-auto border-b border-canvas-soft bg-canvas-softer px-6 flex-shrink-0 scrollbar-none">
					<div className="flex space-x-6 min-w-max">
						{tabsList.map((tab) => (
							<button
								key={tab.id}
								onClick={() => setActiveTab(tab.id)}
								className={`py-4 text-xs font-bold transition-all relative border-b-2 ${
									activeTab === tab.id
										? 'border-ink text-ink font-semibold'
										: 'border-transparent text-body hover:text-ink'
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
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3">
								<h3 className="text-sm font-bold text-ink">Driver Biography</h3>
								<p className="text-xs text-body leading-relaxed">{data.overview.bio}</p>
							</div>

							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink font-sans">Verification Checklist</h3>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="bg-canvas-softer p-4 rounded-xl">
										<span className="block text-[10px] text-mute uppercase font-bold">Background check</span>
										<span className="text-sm font-semibold text-ink mt-1 block uppercase">CLEARED</span>
									</div>
									<div className="bg-canvas-softer p-4 rounded-xl">
										<span className="block text-[10px] text-mute uppercase font-bold">Partner Status</span>
										<span className="text-sm font-semibold text-ink mt-1 block uppercase">{data.status}</span>
									</div>
								</div>
							</div>
						</div>
					)}

					{/* KYC & DOCUMENTS */}
					{activeTab === 'kyc' && (
						<div className="space-y-6">
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Applicant KYC Documents Vault</h3>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{data.kyc_documents.map((doc) => (
										<div key={doc.name} className="border border-canvas-soft rounded-xl p-4 space-y-3 bg-canvas">
											<div className="flex justify-between items-center">
												<span className="text-xs font-bold text-ink">{doc.name}</span>
												<span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${doc.status === 'APPROVED' ? 'bg-status-online/10 text-status-online' : 'bg-status-alert/10 text-status-alert'}`}>
													{doc.status}
												</span>
											</div>
											<div className="text-[10px] text-mute space-y-0.5">
												<span>Uploaded: {new Date(doc.uploaded_at).toLocaleDateString()}</span>
												<span className="block">Expires: {new Date(doc.expiry_date).toLocaleDateString()}</span>
											</div>
											<div className="flex space-x-2 border-t border-canvas-soft pt-2">
												<a
													href={doc.url}
													target="_blank"
													rel="noreferrer"
													className="text-[10px] bg-canvas-soft border border-canvas-soft font-semibold text-ink px-2.5 py-1 rounded-pill hover:bg-canvas-softer transition"
												>
													View Doc PDF
												</a>
												<button
													onClick={() => handleAction('docs-update', { doc_name: doc.name, status: 'APPROVED' })}
													className="text-[10px] bg-ink text-on-dark font-semibold px-2.5 py-1 rounded-pill hover:bg-black-elevated transition"
												>
													Approve
												</button>
												<button
													onClick={() => handleAction('docs-update', { doc_name: doc.name, status: 'REJECTED' })}
													className="text-[10px] text-status-alert bg-status-alert/5 hover:bg-status-alert/10 font-semibold px-2.5 py-1 rounded-pill transition"
												>
													Reject
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* VEHICLE EXPERTISE */}
					{activeTab === 'expertise' && (
						<div className="space-y-6">
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Transmission Expertises</h3>
								<div className="bg-canvas-softer p-5 rounded-xl text-center">
									<span className="block text-[10px] text-mute uppercase font-bold">Active Certification Scopes</span>
									<span className="text-2xl font-extrabold font-mono text-ink mt-2 block uppercase">{data.expertise}</span>
								</div>
							</div>
						</div>
					)}

					{/* TRIPS */}
					{activeTab === 'trips' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden">
							<div className="p-6 border-b border-canvas-soft flex justify-between items-center bg-canvas-softer">
								<span className="text-xs font-bold text-ink">Trip Reservations List</span>
								<span className="text-xs font-mono text-body font-semibold">{data.trips_count} Total Bookings</span>
							</div>
							{tripsLoading ? (
								<div className="p-12 text-center text-xs text-mute font-mono animate-pulse">Loading trips…</div>
							) : driverTrips.length === 0 ? (
								<div className="p-12 text-center text-xs text-mute font-mono">No trips found for this driver.</div>
							) : (
								<table className="w-full text-left text-xs">
									<thead>
										<tr className="border-b border-canvas-soft bg-canvas-softer text-[10px] uppercase tracking-wider text-mute">
											<th className="p-3">Order ID</th>
											<th className="p-3">Status</th>
											<th className="p-3 text-right">Fare</th>
											<th className="p-3">Date</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-canvas-soft">
										{driverTrips.map((t: any) => {
											const oid = t.trip_id || t.id || t.order_id || '';
											const farePaise = t.fare_paise ?? t.total_fare_paise ?? t.base_fare_paise ?? 0;
											const when = t.created_at || t.completed_at;
											return (
												<tr key={oid} onClick={() => navigate(`/trips/${oid}`)} className="hover:bg-canvas-softer cursor-pointer">
													<td className="p-3 font-mono text-ink">{String(oid).slice(0, 12)}</td>
													<td className="p-3"><span className="text-[10px] font-bold uppercase">{t.status}</span></td>
													<td className="p-3 text-right font-mono text-ink">₹{(farePaise / 100).toFixed(2)}</td>
													<td className="p-3 font-mono text-body">{when ? new Date(when).toLocaleDateString() : '—'}</td>
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
						<div className="space-y-6">
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Earnings Summary Period Ledger</h3>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{data.earnings.map((earn) => (
										<div key={earn.period} className="bg-canvas-softer p-4 rounded-xl text-xs space-y-2">
											<span className="font-bold text-ink block">{earn.period}</span>
											<div className="grid grid-cols-2 gap-2 text-body font-mono text-[11px]">
												<span>Gross Earnings:</span>
												<span className="text-right text-ink">₹{(earn.gross_paise / 100).toFixed(2)}</span>
												<span>Incentives:</span>
												<span className="text-right">₹{(earn.incentives / 100).toFixed(2)}</span>
												<span>Bonuses:</span>
												<span className="text-right">₹{(earn.bonuses / 100).toFixed(2)}</span>
												<span>Deductions:</span>
												<span className="text-right text-status-alert">₹{(earn.deductions / 100).toFixed(2)}</span>
												<span className="font-bold border-t border-canvas-soft pt-1">Net Payout:</span>
												<span className="text-right font-bold text-ink border-t border-canvas-soft pt-1">₹{(earn.net_paise / 100).toFixed(2)}</span>
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* PAYOUTS */}
					{activeTab === 'payouts' && (
						<div className="space-y-6">
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Bank Remittances History</h3>
								<div className="divide-y divide-canvas-soft">
									{data.payouts.map((pay) => (
										<div key={pay.payout_id} className="py-3.5 flex justify-between items-center text-xs">
											<div>
												<span className="font-mono text-ink font-semibold block">{pay.payout_id}</span>
												<span className="text-body font-mono text-[10px]">{pay.bank_details}</span>
											</div>
											<div className="text-right">
												<span className="block font-mono font-bold text-ink">₹{(pay.amount_paise / 100).toFixed(2)}</span>
												<span className="text-[10px] text-mute font-mono">{new Date(pay.requested_at).toLocaleDateString()}</span>
											</div>
											<span className="bg-canvas-soft text-[10px] font-bold px-2 py-0.5 rounded text-status-online">{pay.status}</span>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* PERFORMANCE */}
					{activeTab === 'performance' && (
						<div className="space-y-6">
							<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
								<div className="bg-canvas border border-canvas-soft rounded-xl p-4 text-center">
									<span className="text-[10px] uppercase text-mute tracking-wider font-bold">Acceptance Rate</span>
									<span className="text-3xl font-extrabold text-ink font-mono mt-2 block">
										{(data.performance.acceptance_rate * 100).toFixed(0)}%
									</span>
								</div>
								<div className="bg-canvas border border-canvas-soft rounded-xl p-4 text-center">
									<span className="text-[10px] uppercase text-mute tracking-wider font-bold">Cancellation Rate</span>
									<span className="text-3xl font-extrabold text-ink font-mono mt-2 block">
										{(data.performance.cancellation_rate * 100).toFixed(0)}%
									</span>
								</div>
								<div className="bg-canvas border border-canvas-soft rounded-xl p-4 text-center">
									<span className="text-[10px] uppercase text-mute tracking-wider font-bold">On-Time Arrival</span>
									<span className="text-3xl font-extrabold text-ink font-mono mt-2 block">
										{(data.performance.on_time_arrival_rate * 100).toFixed(0)}%
									</span>
								</div>
							</div>

							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Historic Rating Trajectory</h3>
								<div className="flex space-x-3.5 items-end justify-center py-6 h-36 border border-canvas-soft rounded-xl bg-canvas-softer">
									{data.performance.rating_trend.map((rating, idx) => {
										const heightPercent = (rating / 5.0) * 100;
										return (
											<div key={idx} className="flex flex-col items-center space-y-2">
												<span className="text-[10px] font-semibold font-mono">{rating.toFixed(1)}</span>
												<div
													style={{ height: `${heightPercent}px` }}
													className="w-8 bg-ink rounded-t-sm"
												/>
												<span className="text-[9px] text-mute font-mono">T-{idx + 1}</span>
											</div>
										);
									})}
								</div>
							</div>
						</div>
					)}

					{/* INCENTIVES */}
					{activeTab === 'incentives' && (
						<div className="space-y-6">
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Incentives Assigned Goals</h3>
								<div className="divide-y divide-canvas-soft">
									{data.incentives.map((inc) => {
										const progress = (inc.current_trip / inc.target_trips) * 100;
										return (
											<div key={inc.goal_id} className="py-4 space-y-2">
												<div className="flex justify-between items-center text-xs">
													<div>
														<span className="font-mono text-ink font-bold block">{inc.goal_id}</span>
														<span className="text-body font-sans">{inc.description}</span>
													</div>
													<span className="font-mono font-bold text-ink">₹{(inc.bonus_paise / 100).toFixed(2)} Bonus</span>
												</div>
												<div className="w-full bg-canvas-soft h-2 rounded-full overflow-hidden">
													<div style={{ width: `${progress}%` }} className="bg-ink h-2" />
												</div>
												<div className="flex justify-between text-[10px] text-mute font-mono">
													<span>Progress: {inc.current_trip} / {inc.target_trips} trips</span>
													<span>{progress.toFixed(0)}% Completed</span>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						</div>
					)}

					{/* TRAINING */}
					{activeTab === 'training' && (
						<div className="space-y-6">
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Onboarding Training Status</h3>
								<div className="space-y-3">
									{data.training.map((module, idx) => (
										<div key={idx} className="bg-canvas-softer p-4 rounded-xl text-xs font-semibold text-ink flex justify-between items-center">
											<div className="flex items-center">
												<span className="w-2 h-2 rounded-full bg-status-online mr-2.5" />
												{module}
											</div>
											<span className="text-[10px] bg-canvas text-ink border border-canvas-soft font-mono px-2 py-0.5 rounded">COMPLETED</span>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* SUPPORT */}
					{activeTab === 'support' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl p-5 text-center text-xs text-mute font-mono">
							No open support ticket issues registered for this driver ID.
						</div>
					)}

					{/* SAFETY */}
					{activeTab === 'safety' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl p-5 text-center text-xs text-mute font-mono">
							No recorded safety SOS incidents logs.
						</div>
					)}

					{/* NOTIFICATIONS */}
					{activeTab === 'notifications' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden">
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="border-b border-canvas-soft bg-canvas-soft">
										<th className="p-4 text-[10px] font-semibold uppercase text-mute">Channel</th>
										<th className="p-4 text-[10px] font-semibold uppercase text-mute">Payload Content</th>
										<th className="p-4 text-[10px] font-semibold uppercase text-mute">Timestamp</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-canvas-soft text-xs text-body">
									{data.notifications.map((n, idx) => (
										<tr key={idx} className="hover:bg-canvas-softer">
											<td className="p-4 font-mono font-semibold text-ink uppercase">
												{n.type}
											</td>
											<td className="p-4 font-sans text-ink">
												{n.payload}
											</td>
											<td className="p-4 font-mono text-mute">
												{new Date(n.timestamp).toLocaleString()}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{/* DEVICES */}
					{activeTab === 'devices' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
							<h3 className="text-sm font-bold text-ink">Driver Hardware Terminals</h3>
							<div className="bg-canvas-softer p-4 rounded-xl text-xs font-semibold text-ink">
								<span className="block text-[10px] text-mute uppercase font-bold mb-1">Active Device Info</span>
								<span className="font-mono">{data.device_info}</span>
							</div>
						</div>
					)}

					{/* AUDIT LOG */}
					{activeTab === 'audit' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden">
							{data.audit_logs.length === 0 ? (
								<div className="p-12 text-center text-xs text-mute font-mono">No admin auditing modifications logged.</div>
							) : (
								<table className="w-full text-left border-collapse">
									<thead>
										<tr className="border-b border-canvas-soft bg-canvas-soft">
											<th className="p-4 text-[10px] font-semibold uppercase text-mute">Timestamp</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-mute">Actor</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-mute">Action</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-mute">Details</th>
											<th className="p-4 text-[10px] font-semibold uppercase text-mute">IP Address</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-canvas-soft text-xs font-mono text-body">
										{data.audit_logs.map((log) => (
											<tr key={log.id} className="hover:bg-canvas-softer">
												<td className="p-4 font-semibold text-ink">
													{new Date(log.created_at).toLocaleString()}
												</td>
												<td className="p-4 font-sans text-xs">
													{log.admin_user}
												</td>
												<td className="p-4">
													<span className="bg-canvas-soft px-2 py-0.5 rounded font-bold text-ink">
														{log.action}
													</span>
												</td>
												<td className="p-4 font-sans text-xs text-ink">
													{log.details}
												</td>
												<td className="p-4 font-mono">
													{log.ip}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					)}

				</div>
			</div>

			{/* ========================================================================= */}
			{/* ---- Modals View ---- */}

			{/* Adjust Rating Modal */}
			{showRatingModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Adjust Driver Rating</h3>
							<p className="text-[11px] text-mute mt-1">Directly adjust simulated driver rating metric</p>
						</div>
						<div className="space-y-3">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Adjustment Offset (e.g. +0.2, -0.3)</label>
								<input
									type="text"
									className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono font-semibold"
									value={ratingForm.adjustment}
									onChange={(e) => setRatingForm({ ...ratingForm, adjustment: e.target.value })}
								/>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Audit Reason</label>
								<input
									type="text"
									placeholder="e.g. Excellent service adjustment"
									className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
									value={ratingForm.reason}
									onChange={(e) => setRatingForm({ ...ratingForm, reason: e.target.value })}
								/>
							</div>
						</div>
						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowRatingModal(false)}
								className="text-xs text-body hover:text-ink px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('rating-adjust', { adjustment: parseFloat(ratingForm.adjustment), reason: ratingForm.reason })}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
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
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Post Wallet Transaction</h3>
							<p className="text-[11px] text-mute mt-1">Issue a bonus incentive credit or apply a penalty deduction fee</p>
						</div>
						<div className="space-y-3">
							<div className="flex space-x-3">
								<button
									onClick={() => setWalletForm({ ...walletForm, isBonus: true })}
									className={`text-[11px] h-7 px-3.5 rounded-pill transition ${walletForm.isBonus ? 'bg-ink text-on-dark font-semibold' : 'bg-canvas-soft text-body'}`}
								>
									Add Bonus Credit (+)
								</button>
								<button
									onClick={() => setWalletForm({ ...walletForm, isBonus: false })}
									className={`text-[11px] h-7 px-3.5 rounded-pill transition ${!walletForm.isBonus ? 'bg-ink text-on-dark font-semibold' : 'bg-canvas-soft text-body'}`}
								>
									Apply Deduction (-)
								</button>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Amount (₹)</label>
								<input
									type="number"
									placeholder="e.g. 500.00"
									className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={walletForm.amount}
									onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Justification Description</label>
								<input
									type="text"
									placeholder="e.g. Weekly high-rating trip goal met"
									className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
									value={walletForm.description}
									onChange={(e) => setWalletForm({ ...walletForm, description: e.target.value })}
								/>
							</div>
						</div>
						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowWalletModal(false)}
								className="text-xs text-body hover:text-ink px-3"
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
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
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
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Reassign Operations City Scope</h3>
							<p className="text-[11px] text-mute mt-1">Shift driver mapping scope to a different active city prefix hub</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Target City Prefix</label>
							<select
								className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono font-semibold"
								value={targetCity}
								onChange={(e) => setTargetCity(e.target.value)}
							>
								<option value="KOL">KOL (Kolkata)</option>
								<option value="BLR">BLR (Bangalore)</option>
								<option value="DEL">DEL (Delhi)</option>
								<option value="MUM">MUM (Mumbai)</option>
							</select>
						</div>
						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowCityModal(false)}
								className="text-xs text-body hover:text-ink px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('reassign-city', { city_prefix: targetCity })}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
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
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Dispatch Message Notification</h3>
							<p className="text-[11px] text-mute mt-1">Send a direct text SMS or high priority push notification to driver app</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Message Body Payload</label>
							<textarea
								rows={3}
								placeholder="Type message here..."
								className="w-full rounded-md bg-canvas-soft border border-canvas-soft p-2.5 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
								value={messageText}
								onChange={(e) => setMessageText(e.target.value)}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowMsgModal(false)}
								className="text-xs text-body hover:text-ink px-3"
							>
								Cancel
							</button>
							<button
								onClick={() => {
									handleAction('message', { title: 'Message from Support', body: messageText });
									setShowMsgModal(false);
									setMessageText('');
								}}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
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
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink font-sans text-status-alert">Reject Application</h3>
							<p className="text-[11px] text-mute mt-1">Provide clear audit log reason for candidate verification rejection</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Rejection Audit Reason</label>
							<input
								type="text"
								placeholder="e.g. Identity selfie match failure"
								className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
								value={rejectReason}
								onChange={(e) => setRejectReason(e.target.value)}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowRejectModal(false)}
								className="text-xs text-body hover:text-ink px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('reject-kyc', { reason: rejectReason })}
								className="bg-status-alert text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-status-alert/90 transition-colors"
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
