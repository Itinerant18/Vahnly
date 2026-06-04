import React, { useState, useEffect } from 'react';
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

interface RiderCar {
	make_model: string;
	plate: string;
	documents: { rc_status: string; insurance_status: string; puc_status: string };
	expiry_alerts: string[];
}

interface RiderGarageTab {
	cars: RiderCar[];
}

interface RiderTransaction {
	transaction_id: string;
	order_id: string;
	amount_paise: number;
	status: string;
	gateway: string;
	created_at: string;
}

interface RiderRefund {
	refund_id: string;
	order_id: string;
	amount_paise: number;
	status: string;
	reason: string;
	created_at: string;
}

interface RiderChargeback {
	chargeback_id: string;
	order_id: string;
	amount_paise: number;
	status: string;
	created_at: string;
}

interface RiderPaymentsTab {
	methods: { type: string; details: string }[];
	transactions: RiderTransaction[];
	refunds: RiderRefund[];
	chargebacks: RiderChargeback[];
}

interface RiderWalletTransaction {
	type: string;
	amount_paise: number;
	timestamp: string;
	description: string;
}

interface RiderWalletTab {
	balance_paise: number;
	transactions: RiderWalletTransaction[];
}

interface RiderPromoApplied {
	promo_code: string;
	status: string;
	timestamp: string;
}

interface RiderPromosTab {
	applied: RiderPromoApplied[];
	eligibility_flags: string[];
}

interface RiderSupportTicket {
	ticket_id: string;
	subject: string;
	status: string;
	created_at: string;
}

interface RiderSupportChat {
	chat_id: string;
	subject: string;
	last_message: string;
	timestamp: string;
}

interface RiderCallRecording {
	call_id: string;
	duration_seconds: number;
	timestamp: string;
}

interface RiderSupportTab {
	tickets: RiderSupportTicket[];
	chats: RiderSupportChat[];
	call_recordings: RiderCallRecording[];
}

interface RiderRatingsTab {
	average_given: number;
	average_received: number;
}

interface RiderRiskTab {
	score: number;
	flags: string[];
	blocked_reasons: string[];
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
	garage: RiderGarageTab;
	payments: RiderPaymentsTab;
	wallet: RiderWalletTab;
	promos: RiderPromosTab;
	support: RiderSupportTab;
	ratings: RiderRatingsTab;
	risk: RiderRiskTab;
	notifications: RiderNotificationLog[];
	audit_logs: RiderAuditLogEntry[];
}

export const RiderDetail: React.FC = () => {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [data, setData] = useState<RiderDetailResponse | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [activeTab, setActiveTab] = useState<string>('overview');
	const [actionLoading, setActionLoading] = useState<boolean>(false);

	// Modals State
	const [showEditModal, setShowEditModal] = useState(false);
	const [editForm, setEditForm] = useState({ name: '', phone: '', email: '' });

	const [showWalletModal, setShowWalletModal] = useState(false);
	const [walletForm, setWalletForm] = useState({ amount: '', isCredit: true, description: '' });

	const [showVoucherModal, setShowVoucherModal] = useState(false);
	const [voucherCode, setVoucherCode] = useState('');

	const [showMergeModal, setShowMergeModal] = useState(false);
	const [duplicateId, setDuplicateId] = useState('');

	const fetchRiderDetail = async () => {
		setLoading(true);
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/riders/${id}`, {
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
				},
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
				navigate('/admin/riders');
			}
		} catch (err) {
			console.error('Failed to load rider details', err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (id) {
			fetchRiderDetail();
		}
	}, [id]);

	const handleAction = async (actionSlug: string, body?: any) => {
		setActionLoading(true);
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const email = localStorage.getItem('admin_email') || 'admin@platform.com';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/riders/${id}/${actionSlug}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'X-Admin-Email': email,
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (res.ok) {
				alert(`Action '${actionSlug}' executed successfully.`);
				// Reset modals
				setShowEditModal(false);
				setShowWalletModal(false);
				setShowVoucherModal(false);
				setShowMergeModal(false);
				
				fetchRiderDetail();
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

	const handleImpersonate = () => {
		alert(`Starting Read-Only Impersonation Session for Rider ID: ${id}.\nRedirecting client context...`);
	};

	if (loading) {
		return (
			<div className="h-full flex items-center justify-center">
				<div className="text-sm text-mute animate-pulse">Loading rider profile metrics…</div>
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
		{ id: 'support', label: 'Support' },
		{ id: 'ratings', label: 'Ratings' },
		{ id: 'risk', label: 'Risk & Fraud' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'audit', label: 'Audit Log' },
	];

	return (
		<div className="w-full h-full flex flex-col lg:flex-row overflow-hidden bg-canvas">
			
			{/* ---- Left Sidebar: Profile Overview & Actions ---- */}
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
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">Customer ID</span>
							<span className="font-mono text-xs text-ink break-all font-semibold">{data.customer_id}</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">Phone</span>
							<span className="font-mono text-xs text-body flex items-center justify-between">
								{data.phone}
								<span className={`text-[9px] px-1.5 py-0.5 rounded font-sans uppercase font-bold ${data.phone_verified ? 'bg-canvas-soft text-ink' : 'bg-status-alert/10 text-status-alert'}`}>
									{data.phone_verified ? 'Verified' : 'Unverified'}
								</span>
							</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">Email</span>
							<span className="text-xs text-body break-all flex items-center justify-between">
								{data.email}
								<span className={`text-[9px] px-1.5 py-0.5 rounded font-sans uppercase font-bold ${data.email_verified ? 'bg-canvas-soft text-ink' : 'bg-status-alert/10 text-status-alert'}`}>
									{data.email_verified ? 'Verified' : 'Unverified'}
								</span>
							</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">KYC Status</span>
							<span className="text-xs text-ink font-semibold">Level {data.kyc_level} Verified</span>
						</div>
						<div>
							<span className="block text-[9px] uppercase tracking-wider text-mute font-semibold">Referral Source</span>
							<span className="text-xs text-body">{data.referral_source}</span>
						</div>
					</div>
				</div>

				{/* Quick Administrative Actions List */}
				<div className="border-t border-canvas-soft pt-4 space-y-2">
					<h3 className="text-[10px] uppercase tracking-wider text-mute mb-2.5 font-bold">Admin Controls</h3>
					
					<button
						onClick={() => setShowEditModal(true)}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Edit Profile Details
					</button>

					<button
						onClick={() => handleAction('verify-contacts', { phone: true, email: true })}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Mark Contacts Verified
					</button>

					<button
						onClick={() => setShowWalletModal(true)}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Adjust Wallet Balance
					</button>

					<button
						onClick={() => setShowVoucherModal(true)}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Issue Promo Coupon
					</button>

					<button
						onClick={() => handleAction('reset-password')}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Reset Password Token
					</button>

					{data.status !== 'ACTIVE' && (
						<button
							onClick={() => handleAction('unblock')}
							className="w-full text-left text-xs text-ink hover:text-on-dark hover:bg-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
						>
							Restore Account Access
						</button>
					)}

					{data.status === 'ACTIVE' && (
						<>
							<button
								onClick={() => handleAction('suspend')}
								className="w-full text-left text-xs text-status-warn bg-status-warn/5 hover:bg-status-warn/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Suspend Account
							</button>

							<button
								onClick={() => handleAction('block')}
								className="w-full text-left text-xs text-status-alert bg-status-alert/5 hover:bg-status-alert/10 font-semibold rounded-pill px-4.5 py-2 transition-colors"
							>
								Block Account
							</button>
						</>
					)}

					<button
						onClick={() => setShowMergeModal(true)}
						className="w-full text-left text-xs text-body hover:text-ink font-semibold bg-canvas-softer rounded-pill px-4.5 py-2 transition-colors"
					>
						Merge Duplicate Profile
					</button>

					<button
						onClick={handleImpersonate}
						className="w-full text-left text-xs text-on-dark bg-ink hover:bg-black-elevated font-semibold rounded-pill px-4.5 py-2 transition-colors text-center"
					>
						Impersonate Rider
					</button>

					<button
						onClick={() => {
							if (window.confirm("CRITICAL WARNING: This executes GDPR delete sequence. Profile info, email, phone, and wallet adjustments will be permanently wiped. Proceed?")) {
								handleAction('delete');
							}
						}}
						className="w-full text-left text-xs text-mute hover:text-status-alert font-semibold px-4.5 py-2 transition-colors text-center"
					>
						GDPR Delete Profile
					</button>
				</div>
			</div>

			{/* ---- Right Workspace: Tabbed Interface ---- */}
			<div className="flex-1 flex flex-col overflow-hidden bg-canvas">
				{/* Scrollable Tab Row */}
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

				{/* Active Tab Contents Area */}
				<div className="flex-1 overflow-y-auto p-6">
					
					{/* OVERVIEW TAB */}
					{activeTab === 'overview' && (
						<div className="space-y-6">
							{/* Core KYC Detail */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Identity & Verification</h3>
								<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
									<div className="bg-canvas-softer p-4 rounded-xl">
										<span className="block text-[10px] uppercase text-mute font-bold">KYC Level</span>
										<span className="text-xl font-bold font-mono text-ink mt-1">Level {data.overview.kyc_level}</span>
									</div>
									<div className="bg-canvas-softer p-4 rounded-xl">
										<span className="block text-[10px] uppercase text-mute font-bold">Phone verification</span>
										<span className="text-xs font-semibold mt-1 block">
											{data.phone_verified ? 'VERIFIED' : 'UNVERIFIED'}
										</span>
									</div>
									<div className="bg-canvas-softer p-4 rounded-xl">
										<span className="block text-[10px] uppercase text-mute font-bold">Email verification</span>
										<span className="text-xs font-semibold mt-1 block">
											{data.email_verified ? 'VERIFIED' : 'UNVERIFIED'}
										</span>
									</div>
								</div>
							</div>

							{/* Saved Locations */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Saved Addresses</h3>
								<div className="divide-y divide-canvas-soft">
									{data.overview.addresses.map((addr) => (
										<div key={addr.type} className="py-3 flex justify-between items-start">
											<span className="text-xs font-semibold text-ink w-20">{addr.type}</span>
											<span className="text-xs text-body flex-1">{addr.address}</span>
										</div>
									))}
								</div>
							</div>

							{/* Emergency Contacts */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Emergency Contacts</h3>
								<div className="divide-y divide-canvas-soft">
									{data.overview.emergency_contacts.map((contact, idx) => (
										<div key={idx} className="py-3 flex justify-between items-center">
											<div>
												<span className="text-xs font-semibold text-ink block">{contact.name}</span>
												<span className="text-[10px] text-mute">{contact.relationship}</span>
											</div>
											<span className="text-xs font-mono text-body font-semibold">{contact.phone}</span>
										</div>
									))}
								</div>
							</div>

							{/* Devices list */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Registered Devices</h3>
								<div className="divide-y divide-canvas-soft">
									{data.overview.devices.map((device, idx) => (
										<div key={idx} className="py-3 flex justify-between items-center">
											<div>
												<span className="text-xs font-semibold text-ink block">{device.device_name}</span>
												<span className="text-[10px] text-mute">OS: {device.os_version}</span>
											</div>
											<span className="text-xs font-mono text-body">App: {device.app_version}</span>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* GARAGE TAB */}
					{activeTab === 'garage' && (
						<div className="space-y-6">
							{data.garage.cars.length === 0 ? (
								<div className="p-12 text-center text-xs text-mute">No saved cars on profile garage.</div>
							) : (
								data.garage.cars.map((car, idx) => (
									<div key={idx} className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
										<div className="flex justify-between items-center">
											<h3 className="text-sm font-bold text-ink">{car.make_model}</h3>
											<span className="font-mono text-xs text-ink font-bold bg-canvas-soft px-3 py-1 rounded">{car.plate}</span>
										</div>
										<div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-canvas-soft pt-4">
											<div className="bg-canvas-softer p-3 rounded-xl">
												<span className="block text-[10px] uppercase text-mute font-bold">Registration (RC)</span>
												<span className="text-xs font-semibold mt-1 block text-status-online">{car.documents.rc_status}</span>
											</div>
											<div className="bg-canvas-softer p-3 rounded-xl">
												<span className="block text-[10px] uppercase text-mute font-bold">Insurance Status</span>
												<span className="text-xs font-semibold mt-1 block text-status-online">{car.documents.insurance_status}</span>
											</div>
											<div className="bg-canvas-softer p-3 rounded-xl">
												<span className="block text-[10px] uppercase text-mute font-bold">PUC Certificate</span>
												<span className="text-xs font-semibold mt-1 block text-status-online">{car.documents.puc_status}</span>
											</div>
										</div>
										{car.expiry_alerts && car.expiry_alerts.length > 0 && (
											<div className="bg-status-warn/5 border border-status-warn/25 p-3 rounded-xl text-status-warn text-xs font-semibold">
												⚠️ Expiry Alerts: {car.expiry_alerts.join(', ')}
											</div>
										)}
									</div>
								))
							)}
						</div>
					)}

					{/* TRIPS TAB */}
					{activeTab === 'trips' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden">
							{data.payments.transactions.length === 0 ? (
								<div className="p-12 text-center text-xs text-mute">Rider has not made any trip reservations.</div>
							) : (
								<table className="w-full text-left border-collapse">
									<thead>
										<tr className="border-b border-canvas-soft bg-canvas-soft">
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Trip ID</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Date</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Fare</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Payment</th>
											<th className="p-4 text-[10px] font-semibold uppercase tracking-wider text-mute">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-canvas-soft text-xs text-body">
										{data.payments.transactions.map((tx) => (
											<tr key={tx.order_id} className="hover:bg-canvas-softer">
												<td className="p-4 font-mono text-ink font-semibold">
													<Link to={`/admin/trips/${tx.order_id}`} className="underline hover:text-black-elevated">
														TRP-{tx.order_id.substring(tx.order_id.length - 8).toUpperCase()}
													</Link>
												</td>
												<td className="p-4 font-mono">
													{new Date(tx.created_at).toLocaleString()}
												</td>
												<td className="p-4 font-mono text-ink font-semibold">
													₹{(tx.amount_paise / 100).toFixed(2)}
												</td>
												<td className="p-4 font-mono">
													{tx.gateway}
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
					)}

					{/* PAYMENTS TAB */}
					{activeTab === 'payments' && (
						<div className="space-y-6">
							{/* Methods on File */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink font-sans">Payment Methods on File</h3>
								<div className="divide-y divide-canvas-soft">
									{data.payments.methods.map((method, idx) => (
										<div key={idx} className="py-3 flex justify-between items-center text-xs">
											<span className="font-semibold text-ink font-mono uppercase bg-canvas-soft px-2.5 py-0.5 rounded">{method.type}</span>
											<span className="text-body font-mono font-medium">{method.details}</span>
										</div>
									))}
								</div>
							</div>

							{/* Transaction Attempts */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Recent Billing Transactions</h3>
								<div className="overflow-hidden rounded-xl border border-canvas-soft">
									{data.payments.transactions.length === 0 ? (
										<div className="p-6 text-center text-xs text-mute">No billing transactions.</div>
									) : (
										<table className="w-full text-left text-xs border-collapse">
											<thead>
												<tr className="border-b border-canvas-soft bg-canvas-soft">
													<th className="p-3 text-[10px] font-semibold uppercase text-mute">Tx ID</th>
													<th className="p-3 text-[10px] font-semibold uppercase text-mute">Order</th>
													<th className="p-3 text-[10px] font-semibold uppercase text-mute">Gateway</th>
													<th className="p-3 text-[10px] font-semibold uppercase text-mute">Amount</th>
													<th className="p-3 text-[10px] font-semibold uppercase text-mute">Status</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-canvas-soft text-body font-mono">
												{data.payments.transactions.map((tx) => (
													<tr key={tx.transaction_id} className="hover:bg-canvas-softer">
														<td className="p-3 font-semibold text-ink">{tx.transaction_id}</td>
														<td className="p-3">TRP-{tx.order_id.substring(tx.order_id.length - 4).toUpperCase()}</td>
														<td className="p-3 font-sans">{tx.gateway}</td>
														<td className="p-3 font-bold text-ink">₹{(tx.amount_paise / 100).toFixed(2)}</td>
														<td className="p-3 font-semibold text-status-online">{tx.status}</td>
													</tr>
												))}
											</tbody>
										</table>
									)}
								</div>
							</div>

							{/* Refunds / Chargebacks list */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3">
									<h4 className="text-xs font-bold text-ink">Refund History</h4>
									{data.payments.refunds.length === 0 ? (
										<div className="text-center p-6 text-xs text-mute border border-canvas-soft rounded-xl">No refunds.</div>
									) : (
										<div className="space-y-2.5">
											{data.payments.refunds.map((ref) => (
												<div key={ref.refund_id} className="bg-canvas-softer p-3 rounded-xl text-xs space-y-1">
													<div className="flex justify-between font-mono font-semibold text-ink">
														<span>{ref.refund_id}</span>
														<span>₹{(ref.amount_paise / 100).toFixed(2)}</span>
													</div>
													<p className="text-[10px] text-body">{ref.reason}</p>
													<span className="block text-[9px] text-mute font-mono">{new Date(ref.created_at).toLocaleString()}</span>
												</div>
											))}
										</div>
									)}
								</div>

								<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3">
									<h4 className="text-xs font-bold text-ink">Chargeback Discrepancies</h4>
									{data.payments.chargebacks.length === 0 ? (
										<div className="text-center p-6 text-xs text-mute border border-canvas-soft rounded-xl">No chargebacks logged.</div>
									) : (
										<div className="space-y-2.5">
											{data.payments.chargebacks.map((cb) => (
												<div key={cb.chargeback_id} className="bg-status-alert/5 p-3 rounded-xl text-xs space-y-1">
													<div className="flex justify-between font-mono font-semibold text-status-alert">
														<span>{cb.chargeback_id}</span>
														<span>₹{(cb.amount_paise / 100).toFixed(2)}</span>
													</div>
													<span className="block text-[9px] text-mute font-mono">{new Date(cb.created_at).toLocaleString()}</span>
												</div>
											))}
										</div>
									)}
								</div>
							</div>
						</div>
					)}

					{/* WALLET TAB */}
					{activeTab === 'wallet' && (
						<div className="space-y-6">
							{/* Current Balance */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-6 flex flex-col justify-center items-center text-center">
								<span className="text-[10px] uppercase text-mute tracking-wider font-bold">Rider Wallet Balance</span>
								<span className="text-3xl font-extrabold text-ink font-mono mt-2">
									₹{(data.wallet.balance_paise / 100).toFixed(2)}
								</span>
							</div>

							{/* Ledger Transaction History */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Wallet Ledger Entries</h3>
								<div className="overflow-hidden rounded-xl border border-canvas-soft">
									<table className="w-full text-left text-xs border-collapse">
										<thead>
											<tr className="border-b border-canvas-soft bg-canvas-soft">
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Type</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Amount</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Description</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Timestamp</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-canvas-soft font-mono text-body">
											{data.wallet.transactions.map((wt, idx) => (
												<tr key={idx} className="hover:bg-canvas-softer">
													<td className="p-3">
														<span className={`inline-flex items-center font-bold px-2 py-0.5 rounded text-[9px] font-sans ${wt.type === 'TOPUP' || wt.type === 'MANUAL_CREDIT' ? 'bg-canvas-soft text-ink' : 'bg-ink text-on-dark'}`}>
															{wt.type}
														</span>
													</td>
													<td className={`p-3 font-bold ${wt.type === 'TOPUP' || wt.type === 'MANUAL_CREDIT' ? 'text-ink' : 'text-body'}`}>
														{wt.type === 'TOPUP' || wt.type === 'MANUAL_CREDIT' ? '+' : '-'} ₹{(wt.amount_paise / 100).toFixed(2)}
													</td>
													<td className="p-3 font-sans text-xs text-ink">{wt.description}</td>
													<td className="p-3 text-mute">{new Date(wt.timestamp).toLocaleString()}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						</div>
					)}

					{/* PROMOS TAB */}
					{activeTab === 'promos' && (
						<div className="space-y-6">
							{/* Coupon usage history */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Promo Coupon Usage Log</h3>
								<div className="divide-y divide-canvas-soft">
									{data.promos.applied.map((promo, idx) => (
										<div key={idx} className="py-3 flex justify-between items-center text-xs font-mono">
											<span className="font-bold text-ink bg-canvas-soft px-3 py-1 rounded">{promo.promo_code}</span>
											<span className="text-body font-sans text-xs">{promo.status}</span>
											<span className="text-mute">{new Date(promo.timestamp).toLocaleDateString()}</span>
										</div>
									))}
								</div>
							</div>

							{/* Eligibility criteria flags */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Exclusion & Eligibility Matrix</h3>
								<div className="space-y-2">
									{data.promos.eligibility_flags.map((flag, idx) => (
										<div key={idx} className="bg-canvas-softer p-3 rounded-xl text-xs font-semibold text-ink flex items-center">
											<span className="w-1.5 h-1.5 rounded-full bg-status-online mr-2.5" />
											{flag}
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* SUPPORT TAB */}
					{activeTab === 'support' && (
						<div className="space-y-6">
							{/* Tickets */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3">
								<h3 className="text-sm font-bold text-ink">Support Tickets</h3>
								<div className="divide-y divide-canvas-soft">
									{data.support.tickets.map((t) => (
										<div key={t.ticket_id} className="py-3 flex justify-between items-center text-xs">
											<div>
												<span className="font-mono text-ink font-semibold block">{t.ticket_id}</span>
												<span className="text-body">{t.subject}</span>
											</div>
											<div className="flex items-center space-x-3">
												<span className="text-mute font-mono">{new Date(t.created_at).toLocaleDateString()}</span>
												<span className="bg-canvas-soft text-[10px] font-bold px-2 py-0.5 rounded uppercase">{t.status}</span>
											</div>
										</div>
									))}
								</div>
							</div>

							{/* Chats */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3">
								<h3 className="text-sm font-bold text-ink">Live Support Chats</h3>
								<div className="divide-y divide-canvas-soft">
									{data.support.chats.map((c) => (
										<div key={c.chat_id} className="py-3 flex justify-between items-start text-xs">
											<div>
												<span className="font-mono text-ink font-semibold block">{c.chat_id}</span>
												<p className="text-body mt-1">{c.subject}</p>
												<span className="text-[10px] text-mute block mt-0.5">Last Message: {c.last_message}</span>
											</div>
											<span className="text-mute font-mono">{new Date(c.timestamp).toLocaleDateString()}</span>
										</div>
									))}
								</div>
							</div>

							{/* Recordings */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3">
								<h3 className="text-sm font-bold text-ink">Call Recordings</h3>
								<div className="divide-y divide-canvas-soft">
									{data.support.call_recordings.map((rec) => (
										<div key={rec.call_id} className="py-3 flex justify-between items-center text-xs font-mono">
											<div>
												<span className="text-ink font-semibold block">{rec.call_id}</span>
												<span className="text-mute font-sans text-xs">{new Date(rec.timestamp).toLocaleString()}</span>
											</div>
											<span className="text-body font-semibold">{rec.duration_seconds} seconds</span>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* RATINGS TAB */}
					{activeTab === 'ratings' && (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="bg-canvas border border-canvas-soft rounded-xl p-6 flex flex-col justify-center items-center text-center">
								<span className="text-[10px] uppercase text-mute tracking-wider font-bold">Avg Rating Given To Drivers</span>
								<span className="text-4xl font-extrabold text-ink font-mono mt-3">
									{data.ratings.average_given > 0 ? data.ratings.average_given.toFixed(1) : '—'}
									<span className="text-lg font-medium text-mute font-sans ml-1">★</span>
								</span>
							</div>

							<div className="bg-canvas border border-canvas-soft rounded-xl p-6 flex flex-col justify-center items-center text-center">
								<span className="text-[10px] uppercase text-mute tracking-wider font-bold">Avg Rating Received From Drivers</span>
								<span className="text-4xl font-extrabold text-ink font-mono mt-3">
									{data.ratings.average_received > 0 ? data.ratings.average_received.toFixed(1) : '—'}
									<span className="text-lg font-medium text-mute font-sans ml-1">★</span>
								</span>
							</div>
						</div>
					)}

					{/* RISK TAB */}
					{activeTab === 'risk' && (
						<div className="space-y-6">
							{/* Risk Score */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4">
								<h3 className="text-sm font-bold text-ink">Fraud & Risk Evaluation</h3>
								<div className="flex flex-col items-center py-6 text-center border border-canvas-soft rounded-xl">
									<span className="text-[10px] uppercase text-mute font-bold">Rider Safety Risk Score</span>
									<span className={`text-5xl font-extrabold font-mono mt-3 ${data.risk.score > 75 ? 'text-status-alert' : data.risk.score > 40 ? 'text-status-warn' : 'text-ink'}`}>
										{data.risk.score}
									</span>
									<span className="text-[10px] text-mute mt-2">Scale ranges from 0 (Safe) to 100 (Suspicious)</span>
								</div>
							</div>

							{/* Risk Behavioral Flags */}
							<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3">
								<h4 className="text-xs font-bold text-ink">Behavioral Anomaly Flags</h4>
								<div className="space-y-2">
									{data.risk.flags.map((flag, idx) => (
										<div key={idx} className="bg-canvas-softer p-3 rounded-xl text-xs text-body flex items-center font-medium">
											<span className="w-1.5 h-1.5 rounded-full bg-status-alert mr-2.5" />
											{flag}
										</div>
									))}
								</div>
							</div>

							{/* Block reasons */}
							{data.status === 'BLOCKED' && (
								<div className="bg-status-alert/5 border border-status-alert/25 p-5 rounded-xl space-y-2">
									<h4 className="text-xs font-bold text-status-alert uppercase">Account Block Lock Reasons</h4>
									<ul className="list-disc pl-5 text-xs text-status-alert space-y-1.5">
										{data.risk.blocked_reasons.length > 0 ? (
											data.risk.blocked_reasons.map((reason, idx) => <li key={idx}>{reason}</li>)
										) : (
											<li>Manually blocked by Compliance Administrator</li>
										)}
									</ul>
								</div>
							)}
						</div>
					)}

					{/* NOTIFICATIONS TAB */}
					{activeTab === 'notifications' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden">
							{data.notifications.length === 0 ? (
								<div className="p-12 text-center text-xs text-mute">No communication dispatch log found.</div>
							) : (
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
							)}
						</div>
					)}

					{/* AUDIT LOG TAB */}
					{activeTab === 'audit' && (
						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden">
							{data.audit_logs.length === 0 ? (
								<div className="p-12 text-center text-xs text-mute font-medium">No admin audit log recorded for this customer ID.</div>
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
												<td className="p-4">
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
			{/* ---- Action Modals ---- */}
			
			{/* Edit Profile Modal */}
			{showEditModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Edit Rider Profile</h3>
							<p className="text-[11px] text-mute mt-1">Modify rider contact parameters saved in core record</p>
						</div>
						<div className="space-y-3">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Name</label>
								<input
									type="text"
									className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
									value={editForm.name}
									onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
								/>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Phone</label>
								<input
									type="text"
									className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={editForm.phone}
									onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
								/>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Email</label>
								<input
									type="text"
									className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
									value={editForm.email}
									onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
								/>
							</div>
						</div>
						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowEditModal(false)}
								className="text-xs text-body hover:text-ink px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('profile', editForm)}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
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
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Adjust Wallet Balance</h3>
							<p className="text-[11px] text-mute mt-1">Issue a manual debit or credit adjustment on the wallet ledger</p>
						</div>
						<div className="space-y-3">
							{/* Direction Radio */}
							<div className="flex space-x-3">
								<button
									onClick={() => setWalletForm({ ...walletForm, isCredit: true })}
									className={`text-[11px] h-7 px-3.5 rounded-pill transition ${walletForm.isCredit ? 'bg-ink text-on-dark font-semibold' : 'bg-canvas-soft text-body'}`}
								>
									Add Credit (+)
								</button>
								<button
									onClick={() => setWalletForm({ ...walletForm, isCredit: false })}
									className={`text-[11px] h-7 px-3.5 rounded-pill transition ${!walletForm.isCredit ? 'bg-ink text-on-dark font-semibold' : 'bg-canvas-soft text-body'}`}
								>
									Issue Debit (-)
								</button>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Amount (INR / ₹)</label>
								<input
									type="number"
									placeholder="e.g. 150.00"
									className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={walletForm.amount}
									onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Audit Justification Reason</label>
								<input
									type="text"
									placeholder="e.g. Refund for waiting fee charge"
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
									const multiplier = walletForm.isCredit ? 1 : -1;
									const paiseAmount = Math.round(rawAmt * 100) * multiplier;
									handleAction('wallet', { amount_paise: paiseAmount, description: walletForm.description });
								}}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
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
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink font-sans">Issue Promo Voucher</h3>
							<p className="text-[11px] text-mute mt-1">Assign an active promo code voucher key on the rider's profile</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Promo Code</label>
							<input
								type="text"
								placeholder="e.g. SUPER50, WELCOME100"
								className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono uppercase"
								value={voucherCode}
								onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowVoucherModal(false)}
								className="text-xs text-body hover:text-ink px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('voucher', { promo_code: voucherCode })}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
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
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Merge Duplicate Profiles</h3>
							<p className="text-[11px] text-mute mt-1">
								Merge duplicate customer data into this main ID. The duplicate user history will be deleted.
							</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Duplicate Customer UUID ID</label>
							<input
								type="text"
								placeholder="Paste UUID..."
								className="w-full h-9 rounded-md bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
								value={duplicateId}
								onChange={(e) => setDuplicateId(e.target.value)}
							/>
						</div>
						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowMergeModal(false)}
								className="text-xs text-body hover:text-ink px-3"
								disabled={actionLoading}
							>
								Cancel
							</button>
							<button
								onClick={() => handleAction('merge', { duplicate_id: duplicateId })}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
								disabled={actionLoading || !duplicateId}
							>
								{actionLoading ? 'Merging...' : 'Merge Records'}
							</button>
						</div>
					</div>
				</div>
			)}

		</div>
	);
};
