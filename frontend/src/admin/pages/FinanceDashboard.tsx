import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

// --- TYPES ---
interface Transaction {
	id: string;
	order_id?: string | null;
	user_id: string;
	user_type: string;
	txn_type: string;
	amount_paise: number;
	currency: string;
	gateway: string;
	method: string;
	status: string;
	created_at: string;
	updated_at: string;
	gateway_response?: string;
}

interface Refund {
	id: string;
	transaction_id: string;
	amount_paise: number;
	reason: string;
	status: string;
	approval_type: string;
	approved_by?: string | null;
	created_at: string;
	updated_at: string;
}

interface Wallet {
	id: string;
	user_id: string;
	user_type: string;
	balance_paise: number;
	currency: string;
	created_at: string;
	updated_at: string;
}

interface WalletLedgerEntry {
	id: number;
	wallet_id: string;
	txn_id?: string | null;
	amount_paise: number;
	entry_type: string;
	reason_code: string;
	description: string;
	created_at: string;
}

interface Invoice {
	id: string;
	order_id?: string | null;
	invoice_type: string;
	recipient_name: string;
	recipient_gstin?: string | null;
	amount_paise: number;
	cgst_paise: number;
	sgst_paise: number;
	igst_paise: number;
	total_amount_paise: number;
	status: string;
	irn?: string | null;
	created_at: string;
}

interface Dispute {
	id: string;
	transaction_id: string;
	amount_paise: number;
	status: string;
	reason: string;
	evidence_url?: string | null;
	gateway_dispute_id?: string | null;
	created_at: string;
	updated_at: string;
}

interface ReconciliationReport {
	gateway_total_settled_paise: number;
	internal_ledger_cash_paise: number;
	discrepancy_paise: number;
	stripe_volume_paise: number;
	razorpay_volume_paise: number;
	cash_volume_paise: number;
	status: string;
	timestamp: number;
}

interface CashFloatReport {
	driver_id: string;
	driver_name: string;
	city_prefix: string;
	cash_float_paise: number;
}

type TabType = 'transactions' | 'refunds' | 'wallets' | 'invoices' | 'reconciliation' | 'disputes';

export const FinanceDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<TabType>('transactions');
	const [loading, setLoading] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);

	const token = localStorage.getItem('admin_jwt_token') || '';
	const role = localStorage.getItem('admin_role') || 'ADMIN';
	const headers = {
		Authorization: `Bearer ${token}`,
		'X-Admin-Role': role,
		'Content-Type': 'application/json',
		'X-Admin-Email': 'finance_admin@platform.com'
	};

	// --- DATA STATES ---
	const [transactions, setTransactions] = useState<Transaction[]>([]);
	const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
	const [selectedTxDetails, setSelectedTxDetails] = useState<any | null>(null);

	const [refunds, setRefunds] = useState<Refund[]>([]);
	const [wallets, setWallets] = useState<Wallet[]>([]);
	const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
	const [selectedWalletEntries, setSelectedWalletEntries] = useState<WalletLedgerEntry[]>([]);

	const [invoices, setInvoices] = useState<Invoice[]>([]);
	const [reconReport, setReconReport] = useState<ReconciliationReport | null>(null);
	const [cashFloat, setCashFloat] = useState<CashFloatReport[]>([]);
	const [disputes, setDisputes] = useState<Dispute[]>([]);
	const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);

	// --- FILTER STATES ---
	const [txGateway, setTxGateway] = useState<string>('');
	const [txStatus, setTxStatus] = useState<string>('');
	const [txSearch, setTxSearch] = useState<string>('');

	const [refundStatus, setRefundStatus] = useState<string>('');
	const [walletSearch, setWalletSearch] = useState<string>('');
	const [invoiceType, setInvoiceType] = useState<string>('');

	// --- MUTATION MODAL STATES ---
	const [showRefundModal, setShowRefundModal] = useState<boolean>(false);
	const [refundTxId, setRefundTxId] = useState<string>('');
	const [refundAmount, setRefundAmount] = useState<string>('');
	const [refundReason, setRefundReason] = useState<string>('');

	const [showAdjustModal, setShowAdjustModal] = useState<boolean>(false);
	const [adjustAmount, setAdjustAmount] = useState<string>('');
	const [adjustType, setAdjustType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
	const [adjustReasonCode, setAdjustReasonCode] = useState<string>('MANUAL_ADJUSTMENT');
	const [adjustDesc, setAdjustDesc] = useState<string>('');

	const [showEvidenceModal, setShowEvidenceModal] = useState<boolean>(false);
	const [evidenceUrl, setEvidenceUrl] = useState<string>('');

	// --- DATA FETCHERS ---
	const fetchTransactions = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (txGateway) params.append('gateway', txGateway);
			if (txStatus) params.append('status', txStatus);
			if (txSearch) params.append('search', txSearch);

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/transactions?${params.toString()}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setTransactions(data.transactions || []);
			} else {
				setError('Failed to fetch transactions');
			}
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	const fetchTransactionDetails = async (id: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/transactions/${id}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setSelectedTxDetails(data);
			}
		} catch (err) {
			console.error(err);
		}
	};

	const fetchRefunds = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (refundStatus) params.append('status', refundStatus);

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/refunds?${params.toString()}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setRefunds(data.refunds || []);
			}
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	const fetchWallets = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (walletSearch) params.append('search', walletSearch);

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/wallets?${params.toString()}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setWallets(data.wallets || []);
			}
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	const fetchWalletDetails = async (id: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/wallets/${id}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setSelectedWallet(data.wallet);
				setSelectedWalletEntries(data.entries || []);
			}
		} catch (err) {
			console.error(err);
		}
	};

	const fetchInvoices = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (invoiceType) params.append('invoice_type', invoiceType);

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/invoices?${params.toString()}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setInvoices(data.invoices || []);
			}
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	const fetchReconciliation = async () => {
		setLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/reconciliation`, { headers });
			const cashRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/reconciliation/cash-collect`, { headers });
			if (res.ok && cashRes.ok) {
				setReconReport(await res.json());
				setCashFloat(await cashRes.json());
			}
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	const fetchDisputes = async () => {
		setLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/disputes`, { headers });
			if (res.ok) {
				setDisputes(await res.json());
			}
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	// --- MUTATIONS ---
	const handleRequestRefund = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/refunds`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					transaction_id: refundTxId,
					amount_paise: Math.round(parseFloat(refundAmount) * 100),
					reason: refundReason
				})
			});
			if (res.ok) {
				setShowRefundModal(false);
				setRefundTxId('');
				setRefundAmount('');
				setRefundReason('');
				if (activeTab === 'refunds') fetchRefunds();
				else fetchTransactions();
			} else {
				const txt = await res.text();
				alert(`Failed: ${txt}`);
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleProcessRefundAction = async (id: string, action: 'approve' | 'reject') => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/refunds/${id}/${action}`, {
				method: 'POST',
				headers
			});
			if (res.ok) {
				fetchRefunds();
			} else {
				alert(`Failed: ${await res.text()}`);
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleAdjustWallet = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedWallet) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/wallets/${selectedWallet.id}/adjust`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					amount_paise: Math.round(parseFloat(adjustAmount) * 100),
					entry_type: adjustType,
					reason_code: adjustReasonCode,
					description: adjustDesc
				})
			});
			if (res.ok) {
				setShowAdjustModal(false);
				setAdjustAmount('');
				setAdjustDesc('');
				fetchWalletDetails(selectedWallet.id);
				fetchWallets();
			} else {
				alert(`Failed: ${await res.text()}`);
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleSubmitEvidence = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedDispute) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/disputes/${selectedDispute.id}/evidence`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ evidence_url: evidenceUrl })
			});
			if (res.ok) {
				setShowEvidenceModal(false);
				setEvidenceUrl('');
				setSelectedDispute(null);
				fetchDisputes();
			} else {
				alert(`Failed: ${await res.text()}`);
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleDailyClose = async () => {
		if (!confirm('Are you sure you want to close and lock the financial ledger for today?')) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/reconciliation/daily-close`, {
				method: 'POST',
				headers
			});
			if (res.ok) {
				alert('Daily ledger close complete!');
				fetchReconciliation();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleExportInvoices = () => {
		const params = new URLSearchParams();
		if (invoiceType) params.append('invoice_type', invoiceType);
		window.open(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/invoices/export?${params.toString()}&Authorization=Bearer ${token}`);
	};

	// --- EFFECTS ---
	useEffect(() => {
		setError(null);
		if (activeTab === 'transactions') fetchTransactions();
		if (activeTab === 'refunds') fetchRefunds();
		if (activeTab === 'wallets') fetchWallets();
		if (activeTab === 'invoices') fetchInvoices();
		if (activeTab === 'reconciliation') fetchReconciliation();
		if (activeTab === 'disputes') fetchDisputes();
	}, [activeTab, txGateway, txStatus, txSearch, refundStatus, walletSearch, invoiceType]);

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6 bg-canvas">
			{/* ---- Header ---- */}
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
						Payments & Finance
						{loading && (
							<span className="inline-flex w-3.5 h-3.5 rounded-full border-2 border-canvas-soft border-t-ink animate-spin" />
						)}
					</h1>
					<p className="text-xs text-mute mt-1">Audit transactions, manage wallets, verify ledger closes, track invoices & resolve gateway disputes.</p>
				</div>
				<div className="flex gap-2">
					<button
						onClick={() => setShowRefundModal(true)}
						className="px-4 py-2 bg-ink hover:bg-black-elevated text-on-dark rounded-pill text-xs font-semibold flex items-center gap-1.5 shadow"
					>
						<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
						</svg>
						Request Refund
					</button>
				</div>
			</div>

			{/* ---- Quick KPI Metrics ---- */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
				<div className="bg-canvas border border-canvas-soft rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Gateway Volume</span>
					<span className="text-2xl font-bold font-mono text-ink mt-2">
						₹{reconReport ? ((reconReport.stripe_volume_paise + reconReport.razorpay_volume_paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
					</span>
					<span className="text-[10px] text-mute font-mono mt-1">Stripe & Razorpay settled</span>
				</div>
				<div className="bg-canvas border border-canvas-soft rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Cash Collected Volume</span>
					<span className="text-2xl font-bold font-mono text-ink mt-2">
						₹{reconReport ? (reconReport.cash_volume_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
					</span>
					<span className="text-[10px] text-mute font-mono mt-1">Cash float at drivers</span>
				</div>
				<div className="bg-canvas border border-canvas-soft rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Pending Refunds</span>
					<span className="text-2xl font-bold font-mono text-ink mt-2">
						{refunds.filter(r => r.status === 'PENDING').length}
					</span>
					<span className="text-[10px] text-mute font-mono mt-1">Requires manual review</span>
				</div>
				<div className="bg-canvas border border-canvas-soft rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Active Disputes</span>
					<span className="text-2xl font-bold font-mono text-ink mt-2">
						{disputes.filter(d => d.status === 'NEEDS_RESPONSE').length}
					</span>
					<span className="text-[10px] text-mute font-mono mt-1">Gateway chargebacks</span>
				</div>
			</div>

			{/* ---- TAB NAVIGATION ---- */}
			<div className="flex border-b border-canvas-soft bg-canvas-soft p-1 rounded-xl">
				{(['transactions', 'refunds', 'wallets', 'invoices', 'reconciliation', 'disputes'] as TabType[]).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition ${
							activeTab === tab ? 'bg-canvas text-ink shadow-sm' : 'text-body hover:text-ink'
						}`}
					>
						{tab === 'invoices' ? 'Invoices & GST' : tab}
					</button>
				))}
			</div>

			{error && <div className="p-4 bg-status-alert/10 text-status-alert text-xs rounded-lg">{error}</div>}

			{/* ---- TABS SECTION ---- */}

			{/* 1. TRANSACTIONS TAB */}
			{activeTab === 'transactions' && (
				<div className="space-y-4">
					{/* Filters */}
					<div className="bg-canvas border border-canvas-soft rounded-xl p-4 flex gap-3 shadow-sm items-center">
						<div className="flex-1">
							<input
								type="text"
								placeholder="Search Transaction ID, Order UUID..."
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-mono"
								value={txSearch}
								onChange={(e) => setTxSearch(e.target.value)}
							/>
						</div>
						<select
							className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
							value={txGateway}
							onChange={(e) => setTxGateway(e.target.value)}
						>
							<option value="">All Gateways</option>
							<option value="STRIPE">Stripe</option>
							<option value="RAZORPAY">Razorpay</option>
							<option value="CASH">Cash</option>
						</select>
						<select
							className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
							value={txStatus}
							onChange={(e) => setTxStatus(e.target.value)}
						>
							<option value="">All Statuses</option>
							<option value="SUCCESS">Success</option>
							<option value="FAILED">Failed</option>
							<option value="PENDING">Pending</option>
							<option value="REFUNDED">Refunded</option>
						</select>
					</div>

					{/* Datagrid */}
					<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="bg-canvas-soft border-b border-canvas-soft">
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Txn ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute font-mono">Trip ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">User Details</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Type</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Gateway/Method</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Amount</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Status</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Created At</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-canvas-soft text-xs">
								{transactions.map((tx) => (
									<tr
										key={tx.id}
										onClick={() => {
											setSelectedTx(tx);
											fetchTransactionDetails(tx.id);
										}}
										className="hover:bg-canvas-softer cursor-pointer transition-colors"
									>
										<td className="p-3 font-mono text-ink font-semibold">{tx.id}</td>
										<td className="p-3 font-mono text-mute">{tx.order_id ? tx.order_id.substring(0, 8) : '—'}</td>
										<td className="p-3">
											<span className="text-ink font-medium">{tx.user_id.substring(0, 8)}</span>
											<span className="text-[10px] text-mute block uppercase font-semibold">{tx.user_type}</span>
										</td>
										<td className="p-3 font-semibold">{tx.txn_type}</td>
										<td className="p-3">
											<span className="text-ink font-semibold">{tx.gateway}</span>
											<span className="text-[10px] text-mute block font-mono">{tx.method}</span>
										</td>
										<td className="p-3 font-mono text-right font-bold text-ink">
											₹{(tx.amount_paise / 100).toFixed(2)}
										</td>
										<td className="p-3">
											<span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-pill ${
												tx.status === 'SUCCESS' ? 'bg-canvas text-ink border border-canvas-soft' : 'bg-canvas-soft text-mute'
											}`}>
												{tx.status}
											</span>
										</td>
										<td className="p-3 font-mono text-mute">{new Date(tx.created_at).toLocaleString()}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* 2. REFUNDS TAB */}
			{activeTab === 'refunds' && (
				<div className="space-y-4">
					<div className="bg-canvas border border-canvas-soft rounded-xl p-4 flex gap-3 shadow-sm items-center">
						<select
							className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
							value={refundStatus}
							onChange={(e) => setRefundStatus(e.target.value)}
						>
							<option value="">All Refund Statuses</option>
							<option value="PENDING">Pending Approval</option>
							<option value="PROCESSED">Processed</option>
							<option value="FAILED">Failed</option>
						</select>
					</div>

					<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="bg-canvas-soft border-b border-canvas-soft">
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Refund ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Txn ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Reason</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Type</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Refund Amount</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Status</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Action By</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Created At</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-canvas-soft text-xs">
								{refunds.map((ref) => (
									<tr key={ref.id} className="hover:bg-canvas-softer transition-colors">
										<td className="p-3 font-mono text-ink font-semibold">{ref.id}</td>
										<td className="p-3 font-mono text-mute">{ref.transaction_id}</td>
										<td className="p-3 text-body">{ref.reason}</td>
										<td className="p-3 font-semibold font-mono text-[10px]">{ref.approval_type}</td>
										<td className="p-3 font-mono text-right font-bold text-ink">₹{(ref.amount_paise / 100).toFixed(2)}</td>
										<td className="p-3">
											<span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-pill ${
												ref.status === 'PROCESSED' ? 'bg-canvas text-ink border border-canvas-soft' : 'bg-canvas-soft text-mute'
											}`}>
												{ref.status}
											</span>
										</td>
										<td className="p-3 font-medium text-ink">{ref.approved_by || '—'}</td>
										<td className="p-3 font-mono text-mute">{new Date(ref.created_at).toLocaleString()}</td>
										<td className="p-3 text-right">
											{ref.status === 'PENDING' && (
												<div className="flex gap-1.5 justify-end">
													<button
														onClick={() => handleProcessRefundAction(ref.id, 'approve')}
														className="px-2 py-1 bg-ink text-on-dark rounded text-[10px] font-semibold hover:bg-black-elevated transition"
													>
														Approve
													</button>
													<button
														onClick={() => handleProcessRefundAction(ref.id, 'reject')}
														className="px-2 py-1 bg-canvas-soft text-body hover:text-ink rounded text-[10px] font-semibold transition"
													>
														Reject
													</button>
												</div>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* 3. WALLETS TAB */}
			{activeTab === 'wallets' && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
					{/* Wallets List */}
					<div className="lg:col-span-2 space-y-4">
						<div className="bg-canvas border border-canvas-soft rounded-xl p-4 flex gap-3 shadow-sm items-center">
							<input
								type="text"
								placeholder="Search User UUID..."
								className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-mono"
								value={walletSearch}
								onChange={(e) => setWalletSearch(e.target.value)}
							/>
						</div>

						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="bg-canvas-soft border-b border-canvas-soft">
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">User ID</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">User Type</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Balance</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Last Updated</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-canvas-soft text-xs">
									{wallets.map((w) => (
										<tr
											key={w.id}
											onClick={() => fetchWalletDetails(w.id)}
											className={`hover:bg-canvas-softer cursor-pointer transition-colors ${
												selectedWallet?.id === w.id ? 'bg-canvas-softer font-medium' : ''
											}`}
										>
											<td className="p-3 font-mono text-ink font-semibold">{w.user_id}</td>
											<td className="p-3 font-semibold uppercase text-[10px]">{w.user_type}</td>
											<td className="p-3 font-mono text-right font-bold text-ink">₹{(w.balance_paise / 100).toFixed(2)}</td>
											<td className="p-3 font-mono text-mute">{new Date(w.updated_at).toLocaleString()}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>

					{/* Wallet Detail & Ledger Entries */}
					<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-5 shadow-sm">
						{selectedWallet ? (
							<div className="space-y-4">
								<div className="border-b border-canvas-soft pb-3 flex justify-between items-start">
									<div>
										<h3 className="text-sm font-bold text-ink">Wallet Details</h3>
										<span className="text-[10px] text-mute block font-mono">{selectedWallet.user_id}</span>
										<span className="text-[9px] uppercase font-bold text-ink font-mono">{selectedWallet.user_type} Account</span>
									</div>
									<div className="text-right">
										<span className="text-xs text-mute uppercase font-semibold tracking-wide block">Balance</span>
										<span className="text-lg font-bold font-mono text-ink">₹{(selectedWallet.balance_paise / 100).toFixed(2)}</span>
									</div>
								</div>

								<div className="flex gap-2">
									<button
										onClick={() => setShowAdjustModal(true)}
										className="w-full py-1.5 bg-ink hover:bg-black-elevated text-on-dark rounded text-xs font-semibold shadow-sm transition"
									>
										Manual Adjustment
									</button>
								</div>

								{/* Ledger History */}
								<div className="space-y-3">
									<span className="text-[10px] text-mute uppercase tracking-wider font-semibold block">Wallet Ledger History</span>
									{selectedWalletEntries.length === 0 ? (
										<div className="text-center py-6 text-xs text-mute">No ledger entries logged.</div>
									) : (
										<div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
											{selectedWalletEntries.map((ent) => (
												<div key={ent.id} className="p-3 bg-canvas-soft rounded-lg flex flex-col gap-1 text-xs">
													<div className="flex justify-between items-center">
														<span className={`font-bold font-mono text-[9px] px-1.5 py-0.5 rounded-full ${
															ent.entry_type === 'CREDIT' ? 'bg-ink text-on-dark' : 'bg-canvas text-ink border border-canvas-soft'
														}`}>
															{ent.entry_type}
														</span>
														<span className="font-mono text-ink font-semibold">₹{(ent.amount_paise / 100).toFixed(2)}</span>
													</div>
													<p className="text-body font-medium leading-snug mt-1">{ent.description}</p>
													<div className="flex justify-between items-center text-[10px] text-mute font-mono mt-1">
														<span>{ent.reason_code}</span>
														<span>{new Date(ent.created_at).toLocaleString()}</span>
													</div>
												</div>
											))}
										</div>
									)}
								</div>
							</div>
						) : (
							<div className="text-center py-16 text-xs text-mute">Select a wallet from the table to view details, ledger, and perform manual adjustments.</div>
						)}
					</div>
				</div>
			)}

			{/* 4. INVOICES TAB */}
			{activeTab === 'invoices' && (
				<div className="space-y-4">
					<div className="bg-canvas border border-canvas-soft rounded-xl p-4 flex gap-3 shadow-sm items-center justify-between">
						<select
							className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
							value={invoiceType}
							onChange={(e) => setInvoiceType(e.target.value)}
						>
							<option value="">All Invoice Types</option>
							<option value="RIDER_TRIP">Rider Trip (B2C)</option>
							<option value="DRIVER_TAX">Driver Tax Invoice</option>
							<option value="PLATFORM_B2B">Platform Corporate (B2B)</option>
						</select>

						<button
							onClick={handleExportInvoices}
							className="h-8 px-4 bg-canvas-soft hover:bg-canvas border border-canvas-soft text-ink rounded-pill text-xs font-semibold transition flex items-center gap-1.5"
						>
							<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
							Bulk Export CSV
						</button>
					</div>

					<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="bg-canvas-soft border-b border-canvas-soft">
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Invoice ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Trip ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Recipient</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">GSTIN</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Subtotal</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">CGST (9%)</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">SGST (9%)</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Total Amount</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">IRN (E-invoice)</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Created At</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-canvas-soft text-xs text-body">
								{invoices.map((inv) => (
									<tr key={inv.id} className="hover:bg-canvas-softer transition-colors">
										<td className="p-3 font-mono text-ink font-semibold">{inv.id}</td>
										<td className="p-3 font-mono text-mute">{inv.order_id ? inv.order_id.substring(0, 8) : '—'}</td>
										<td className="p-3 font-medium text-ink">{inv.recipient_name}</td>
										<td className="p-3 font-mono text-mute uppercase">{inv.recipient_gstin || '—'}</td>
										<td className="p-3 font-mono text-right">₹{(inv.amount_paise / 100).toFixed(2)}</td>
										<td className="p-3 font-mono text-right text-mute">₹{(inv.cgst_paise / 100).toFixed(2)}</td>
										<td className="p-3 font-mono text-right text-mute">₹{(inv.sgst_paise / 100).toFixed(2)}</td>
										<td className="p-3 font-mono text-right font-bold text-ink">₹{(inv.total_amount_paise / 100).toFixed(2)}</td>
										<td className="p-3 font-mono text-mute truncate max-w-[120px]" title={inv.irn || ''}>{inv.irn || '—'}</td>
										<td className="p-3 font-mono text-mute">{new Date(inv.created_at).toLocaleString()}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* 5. RECONCILIATION TAB */}
			{activeTab === 'reconciliation' && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
					{/* Reconciliation stats & discrepancy close */}
					<div className="lg:col-span-1 space-y-6">
						<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4 shadow-sm">
							<h3 className="text-sm font-bold text-ink">Gateway Settlement Match</h3>
							<div className="space-y-3 border-b border-canvas-soft pb-4">
								<div className="flex justify-between items-center text-xs">
									<span className="text-mute">Gateway Settlements (Success):</span>
									<span className="font-mono font-bold text-ink">
										₹{reconReport ? (reconReport.gateway_total_settled_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
									</span>
								</div>
								<div className="flex justify-between items-center text-xs">
									<span className="text-mute">Internal Ledger Outflow:</span>
									<span className="font-mono font-bold text-ink">
										₹{reconReport ? (reconReport.internal_ledger_cash_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
									</span>
								</div>
							</div>
							<div className="flex justify-between items-center">
								<span className="text-xs font-semibold text-ink">Total Reconciliation Error:</span>
								<span className={`text-sm font-bold font-mono px-2 py-0.5 rounded ${
									reconReport && reconReport.discrepancy_paise === 0 ? 'bg-canvas text-ink border border-canvas-soft' : 'bg-status-alert/15 text-status-alert'
								}`}>
									₹{reconReport ? (reconReport.discrepancy_paise / 100).toFixed(2) : '0.00'}
								</span>
							</div>

							<div className="pt-2">
								<button
									onClick={handleDailyClose}
									className="w-full py-2 bg-ink hover:bg-black-elevated text-on-dark rounded text-xs font-semibold transition active:scale-[0.98] shadow"
								>
									Complete Daily Closing
								</button>
							</div>
						</div>
					</div>

					{/* Driver Cash Collected (cash float) list */}
					<div className="lg:col-span-2 space-y-4">
						<div className="bg-canvas border border-canvas-soft rounded-xl p-4 shadow-sm">
							<h3 className="text-sm font-bold text-ink">Driver Cash Collected Reports</h3>
							<p className="text-[11px] text-mute mt-0.5">Commission float (20% platform share) currently held by drivers from cash trips.</p>
						</div>

						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="bg-canvas-soft border-b border-canvas-soft">
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Driver Name</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Driver ID</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Region</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Owed Cash Float</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-canvas-soft text-xs">
									{cashFloat.map((row) => (
										<tr key={row.driver_id} className="hover:bg-canvas-softer transition-colors">
											<td className="p-3 font-semibold text-ink">{row.driver_name}</td>
											<td className="p-3 font-mono text-mute">{row.driver_id}</td>
											<td className="p-3 font-mono text-mute uppercase">{row.city_prefix}</td>
											<td className="p-3 font-mono text-right font-bold text-status-alert">₹{(row.cash_float_paise / 100).toFixed(2)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			)}

			{/* 6. DISPUTES TAB */}
			{activeTab === 'disputes' && (
				<div className="space-y-4">
					<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="bg-canvas-soft border-b border-canvas-soft">
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Dispute ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Gateway Dispute ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Reason</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Disputed Txn ID</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Disputed Amount</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Status</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Evidence Link</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Created At</th>
									<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-canvas-soft text-xs">
								{disputes.map((disp) => (
									<tr key={disp.id} className="hover:bg-canvas-softer transition-colors">
										<td className="p-3 font-mono text-ink font-semibold">{disp.id}</td>
										<td className="p-3 font-mono text-mute">{disp.gateway_dispute_id || '—'}</td>
										<td className="p-3 text-body">{disp.reason}</td>
										<td className="p-3 font-mono text-mute">{disp.transaction_id}</td>
										<td className="p-3 font-mono text-right font-bold text-status-alert">₹{(disp.amount_paise / 100).toFixed(2)}</td>
										<td className="p-3">
											<span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-pill ${
												disp.status === 'NEEDS_RESPONSE' ? 'bg-status-alert/15 text-status-alert' : 'bg-canvas-soft text-mute'
											}`}>
												{disp.status.replace(/_/g, ' ')}
											</span>
										</td>
										<td className="p-3 font-mono text-mute truncate max-w-[150px]">
											{disp.evidence_url ? (
												<a href={disp.evidence_url} target="_blank" rel="noopener noreferrer" className="text-ink hover:underline font-semibold">
													View Evidence
												</a>
											) : (
												'Not Uploaded'
											)}
										</td>
										<td className="p-3 font-mono text-mute">{new Date(disp.created_at).toLocaleString()}</td>
										<td className="p-3 text-right">
											{disp.status === 'NEEDS_RESPONSE' && (
												<button
													onClick={() => {
														setSelectedDispute(disp);
														setShowEvidenceModal(true);
													}}
													className="px-2 py-1 bg-ink text-on-dark rounded text-[10px] font-semibold hover:bg-black-elevated transition"
												>
													Upload Evidence
												</button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* ---- MODALS SECTION ---- */}

			{/* TRANSACTION DETAIL DRAWER (SLIDE-OVER) */}
			{selectedTx && (
				<div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
					<div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSelectedTx(null)} />
					<div className="relative w-full max-w-lg bg-canvas border-l border-canvas-soft h-full shadow-2xl flex flex-col justify-between animate-slide-in">
						<div className="p-6 overflow-y-auto space-y-6">
							<div className="flex justify-between items-start border-b border-canvas-soft pb-4">
								<div>
									<h2 className="text-base font-bold text-ink">Transaction Details</h2>
									<span className="text-[11px] font-mono text-mute block mt-0.5">{selectedTx.id}</span>
								</div>
								<button
									onClick={() => setSelectedTx(null)}
									className="p-1 rounded-full hover:bg-canvas-soft text-body hover:text-ink transition"
								>
									<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6ly12 12" />
									</svg>
								</button>
							</div>

							<div className="grid grid-cols-2 gap-4 text-xs">
								<div>
									<span className="text-[10px] text-mute uppercase tracking-wide block">Amount</span>
									<span className="text-base font-bold font-mono text-ink">₹{(selectedTx.amount_paise / 100).toFixed(2)}</span>
								</div>
								<div>
									<span className="text-[10px] text-mute uppercase tracking-wide block">Status</span>
									<span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-pill mt-1 bg-canvas border border-canvas-soft">
										{selectedTx.status}
									</span>
								</div>
								<div>
									<span className="text-[10px] text-mute uppercase tracking-wide block">Transaction Type</span>
									<span className="font-semibold text-ink">{selectedTx.txn_type}</span>
								</div>
								<div>
									<span className="text-[10px] text-mute uppercase tracking-wide block">Order/Trip ID</span>
									<span className="font-mono text-ink font-semibold">{selectedTx.order_id || 'N/A'}</span>
								</div>
								<div>
									<span className="text-[10px] text-mute uppercase tracking-wide block">User ID ({selectedTx.user_type})</span>
									<span className="font-mono text-ink">{selectedTx.user_id}</span>
								</div>
								<div>
									<span className="text-[10px] text-mute uppercase tracking-wide block">Gateway (Method)</span>
									<span className="font-semibold text-ink">{selectedTx.gateway} ({selectedTx.method})</span>
								</div>
							</div>

							{selectedTxDetails && selectedTxDetails.gateway_response && (
								<div className="space-y-2">
									<span className="text-[10px] text-mute uppercase tracking-wide font-semibold block">Gateway Response Payload</span>
									<pre className="bg-canvas-soft border border-canvas-soft p-3 rounded-lg text-[10px] font-mono text-body overflow-x-auto leading-relaxed max-h-[300px]">
										{JSON.stringify(JSON.parse(selectedTxDetails.gateway_response), null, 2)}
									</pre>
								</div>
							)}
						</div>
						<div className="p-4 bg-canvas-soft border-t border-canvas-soft flex gap-2">
							{selectedTx.status === 'SUCCESS' && (
								<button
									onClick={() => {
										setRefundTxId(selectedTx.id);
										setRefundAmount((selectedTx.amount_paise / 100).toString());
										setShowRefundModal(true);
										setSelectedTx(null);
									}}
									className="w-full py-2 bg-ink hover:bg-black-elevated text-on-dark text-xs font-semibold rounded transition"
								>
									Refund Transaction
								</button>
							)}
							<button
								onClick={() => setSelectedTx(null)}
								className="w-full py-2 bg-canvas border border-canvas-soft text-ink hover:bg-canvas-soft text-xs font-semibold rounded transition"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}

			{/* REFUND MODAL */}
			{showRefundModal && (
				<div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
					<div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowRefundModal(false)} />
					<form onSubmit={handleRequestRefund} className="relative w-full max-w-md bg-canvas border border-canvas-soft rounded-xl shadow-2xl p-6 space-y-4 animate-dropdown">
						<div>
							<h3 className="text-sm font-bold text-ink">Request Transaction Refund</h3>
							<p className="text-[10px] text-mute">Submit a refund request for processing. Auto-approvals occur if the amount is under ₹500.</p>
						</div>
						<div className="space-y-3 text-xs">
							<div>
								<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Transaction ID</label>
								<input
									type="text"
									required
									placeholder="pi_..."
									className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 font-mono text-ink placeholder:text-mute focus:outline-none focus:border-ink"
									value={refundTxId}
									onChange={(e) => setRefundTxId(e.target.value)}
								/>
							</div>
							<div>
								<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Refund Amount (₹)</label>
								<input
									type="number"
									step="0.01"
									required
									placeholder="0.00"
									className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 font-mono text-ink placeholder:text-mute focus:outline-none focus:border-ink"
									value={refundAmount}
									onChange={(e) => setRefundAmount(e.target.value)}
								/>
							</div>
							<div>
								<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Reason for Refund</label>
								<textarea
									required
									placeholder="Customer charged in error / cancellation grace..."
									className="w-full rounded-xl bg-canvas-soft border border-canvas-soft p-3 h-20 text-ink placeholder:text-mute focus:outline-none focus:border-ink"
									value={refundReason}
									onChange={(e) => setRefundReason(e.target.value)}
								/>
							</div>
						</div>
						<div className="flex justify-end gap-2 pt-2">
							<button
								type="button"
								onClick={() => setShowRefundModal(false)}
								className="px-4 py-2 bg-canvas-soft hover:bg-canvas border border-canvas-soft rounded-pill text-xs font-semibold transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-2 bg-ink hover:bg-black-elevated text-on-dark rounded-pill text-xs font-semibold transition"
							>
								Submit Request
							</button>
						</div>
					</form>
				</div>
			)}

			{/* WALLET ADJUSTMENT MODAL */}
			{showAdjustModal && selectedWallet && (
				<div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
					<div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAdjustModal(false)} />
					<form onSubmit={handleAdjustWallet} className="relative w-full max-w-md bg-canvas border border-canvas-soft rounded-xl shadow-2xl p-6 space-y-4 animate-dropdown">
						<div>
							<h3 className="text-sm font-bold text-ink">Manual Wallet Balance Adjustment</h3>
							<p className="text-[10px] text-mute">Adjust balance for user {selectedWallet.user_id.substring(0, 8)} ({selectedWallet.user_type}). All actions are audited.</p>
						</div>
						<div className="space-y-3 text-xs">
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => setAdjustType('CREDIT')}
									className={`flex-1 py-1.5 rounded text-xs font-semibold border transition ${
										adjustType === 'CREDIT' ? 'bg-ink text-on-dark border-ink' : 'bg-canvas text-ink border-canvas-soft hover:bg-canvas-soft'
									}`}
								>
									Credit (Add)
								</button>
								<button
									type="button"
									onClick={() => setAdjustType('DEBIT')}
									className={`flex-1 py-1.5 rounded text-xs font-semibold border transition ${
										adjustType === 'DEBIT' ? 'bg-ink text-on-dark border-ink' : 'bg-canvas text-ink border-canvas-soft hover:bg-canvas-soft'
									}`}
								>
									Debit (Deduct)
								</button>
							</div>
							<div>
								<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Adjustment Amount (₹)</label>
								<input
									type="number"
									step="0.01"
									required
									placeholder="0.00"
									className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 font-mono text-ink placeholder:text-mute focus:outline-none focus:border-ink"
									value={adjustAmount}
									onChange={(e) => setAdjustAmount(e.target.value)}
								/>
							</div>
							<div>
								<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Reason Code</label>
								<select
									className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
									value={adjustReasonCode}
									onChange={(e) => setAdjustReasonCode(e.target.value)}
								>
									<option value="MANUAL_ADJUSTMENT">Manual adjustment / correction</option>
									<option value="PROMO_CREDIT">Promo credit reward</option>
									<option value="FINE">Deduction / Fine</option>
									<option value="REFUND">Refund settlement</option>
								</select>
							</div>
							<div>
								<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Detailed Description</label>
								<textarea
									required
									placeholder="Detailed reasoning for the adjustment record..."
									className="w-full rounded-xl bg-canvas-soft border border-canvas-soft p-3 h-20 text-ink placeholder:text-mute focus:outline-none focus:border-ink"
									value={adjustDesc}
									onChange={(e) => setAdjustDesc(e.target.value)}
								/>
							</div>
						</div>
						<div className="flex justify-end gap-2 pt-2">
							<button
								type="button"
								onClick={() => setShowAdjustModal(false)}
								className="px-4 py-2 bg-canvas-soft hover:bg-canvas border border-canvas-soft rounded-pill text-xs font-semibold transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-2 bg-ink hover:bg-black-elevated text-on-dark rounded-pill text-xs font-semibold transition"
							>
								Submit Adjustment
							</button>
						</div>
					</form>
				</div>
			)}

			{/* DISPUTE EVIDENCE MODAL */}
			{showEvidenceModal && selectedDispute && (
				<div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
					<div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowEvidenceModal(false)} />
					<form onSubmit={handleSubmitEvidence} className="relative w-full max-w-md bg-canvas border border-canvas-soft rounded-xl shadow-2xl p-6 space-y-4 animate-dropdown">
						<div>
							<h3 className="text-sm font-bold text-ink">Submit Dispute Evidence</h3>
							<p className="text-[10px] text-mute">Provide a file URL or description to submit as evidence to the gateway for dispute {selectedDispute.id}.</p>
						</div>
						<div className="space-y-3 text-xs">
							<div>
								<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Disputed Amount</label>
								<span className="font-mono font-bold text-status-alert block text-sm">₹{(selectedDispute.amount_paise / 100).toFixed(2)}</span>
							</div>
							<div>
								<label className="block text-[10px] uppercase tracking-wider text-mute mb-1 font-semibold">Evidence File Path / URL</label>
								<input
									type="text"
									required
									placeholder="https://example.com/evidence_receipt.pdf"
									className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 font-mono text-ink placeholder:text-mute focus:outline-none focus:border-ink"
									value={evidenceUrl}
									onChange={(e) => setEvidenceUrl(e.target.value)}
								/>
							</div>
						</div>
						<div className="flex justify-end gap-2 pt-2">
							<button
								type="button"
								onClick={() => setShowEvidenceModal(false)}
								className="px-4 py-2 bg-canvas-soft hover:bg-canvas border border-canvas-soft rounded-pill text-xs font-semibold transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-2 bg-ink hover:bg-black-elevated text-on-dark rounded-pill text-xs font-semibold transition"
							>
								Submit Evidence
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
};
