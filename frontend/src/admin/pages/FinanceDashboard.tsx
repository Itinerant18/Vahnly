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

/* ─── DS4 helpers ──────────────────────────────────────────────────────── */
const thCls = 'p-3 text-label-small uppercase tracking-wider text-content-tertiary font-semibold';
const tdCls = 'p-3 text-paragraph-small text-content-primary';
const trHover = 'hover:bg-background-secondary transition-base cursor-pointer';

function txnStatusBadge(status: string) {
	switch (status) {
		case 'SUCCESS': return 'badge badge-positive';
		case 'FAILED': return 'badge badge-negative';
		case 'PENDING': return 'badge badge-warning';
		case 'REFUNDED': return 'badge badge-accent';
		default: return 'badge badge-neutral';
	}
}

function disputeStatusBadge(status: string) {
	if (status === 'NEEDS_RESPONSE') return 'badge badge-negative';
	if (status === 'UNDER_REVIEW') return 'badge badge-warning';
	return 'badge badge-neutral';
}

function refundStatusBadge(status: string) {
	if (status === 'PROCESSED') return 'badge badge-positive';
	if (status === 'PENDING') return 'badge badge-warning';
	if (status === 'FAILED') return 'badge badge-negative';
	return 'badge badge-neutral';
}

const monoAmt = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export const FinanceDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<TabType>('transactions');
	const [loading, setLoading] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);

	const role = localStorage.getItem('admin_role') || 'ADMIN';
	const headers = {
		'X-Admin-Role': role,
		'Content-Type': 'application/json',
		'X-Admin-Email': 'finance_admin@platform.com'
	};

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

	const [txGateway, setTxGateway] = useState<string>('');
	const [txStatus, setTxStatus] = useState<string>('');
	const [txSearch, setTxSearch] = useState<string>('');
	const [refundStatus, setRefundStatus] = useState<string>('');
	const [walletSearch, setWalletSearch] = useState<string>('');
	const [invoiceType, setInvoiceType] = useState<string>('');

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

	const fetchTransactions = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (txGateway) params.append('gateway', txGateway);
			if (txStatus) params.append('status', txStatus);
			if (txSearch) params.append('search', txSearch);
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/transactions?${params.toString()}`, { headers });
			if (res.ok) setTransactions((await res.json()).transactions || []);
			else setError('Failed to fetch transactions');
		} catch (err) { console.error(err); } finally { setLoading(false); }
	};

	const fetchTransactionDetails = async (id: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/transactions/${id}`, { headers });
			if (res.ok) setSelectedTxDetails(await res.json());
		} catch (err) { console.error(err); }
	};

	const fetchRefunds = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (refundStatus) params.append('status', refundStatus);
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/refunds?${params.toString()}`, { headers });
			if (res.ok) setRefunds((await res.json()).refunds || []);
		} catch (err) { console.error(err); } finally { setLoading(false); }
	};

	const fetchWallets = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (walletSearch) params.append('search', walletSearch);
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/wallets?${params.toString()}`, { headers });
			if (res.ok) setWallets((await res.json()).wallets || []);
		} catch (err) { console.error(err); } finally { setLoading(false); }
	};

	const fetchWalletDetails = async (id: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/wallets/${id}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setSelectedWallet(data.wallet);
				setSelectedWalletEntries(data.entries || []);
			}
		} catch (err) { console.error(err); }
	};

	const fetchInvoices = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (invoiceType) params.append('invoice_type', invoiceType);
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/invoices?${params.toString()}`, { headers });
			if (res.ok) setInvoices((await res.json()).invoices || []);
		} catch (err) { console.error(err); } finally { setLoading(false); }
	};

	const fetchReconciliation = async () => {
		setLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/reconciliation`, { headers });
			const cashRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/reconciliation/cash-collect`, { headers });
			if (res.ok && cashRes.ok) { setReconReport(await res.json()); setCashFloat(await cashRes.json()); }
		} catch (err) { console.error(err); } finally { setLoading(false); }
	};

	const fetchDisputes = async () => {
		setLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/disputes`, { headers });
			if (res.ok) setDisputes(await res.json());
		} catch (err) { console.error(err); } finally { setLoading(false); }
	};

	const handleRequestRefund = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/refunds`, {
				method: 'POST', headers,
				body: JSON.stringify({ transaction_id: refundTxId, amount_paise: Math.round(parseFloat(refundAmount) * 100), reason: refundReason })
			});
			if (res.ok) {
				setShowRefundModal(false); setRefundTxId(''); setRefundAmount(''); setRefundReason('');
				if (activeTab === 'refunds') fetchRefunds(); else fetchTransactions();
			} else alert(`Failed: ${await res.text()}`);
		} catch (err) { console.error(err); }
	};

	const handleProcessRefundAction = async (id: string, action: 'approve' | 'reject') => {
		if (!window.confirm(`${action === 'approve' ? 'Approve' : 'Reject'} refund ${id}?${action === 'approve' ? ' This disburses money to the customer.' : ''}`)) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/refunds/${id}/${action}`, { method: 'POST', headers });
			if (res.ok) fetchRefunds(); else alert(`Failed: ${await res.text()}`);
		} catch (err) { console.error(err); }
	};

	const handleAdjustWallet = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedWallet) return;
		if (!window.confirm(`${adjustType} ₹${adjustAmount || '0'} to wallet ${selectedWallet.id}?\n\nThis moves real money in/out of the user's wallet and is audited.`)) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/wallets/${selectedWallet.id}/adjust`, {
				method: 'POST', headers,
				body: JSON.stringify({ amount_paise: Math.round(parseFloat(adjustAmount) * 100), entry_type: adjustType, reason_code: adjustReasonCode, description: adjustDesc })
			});
			if (res.ok) {
				setShowAdjustModal(false); setAdjustAmount(''); setAdjustDesc('');
				fetchWalletDetails(selectedWallet.id); fetchWallets();
			} else alert(`Failed: ${await res.text()}`);
		} catch (err) { console.error(err); }
	};

	const handleSubmitEvidence = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedDispute) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/disputes/${selectedDispute.id}/evidence`, {
				method: 'POST', headers, body: JSON.stringify({ evidence_url: evidenceUrl })
			});
			if (res.ok) { setShowEvidenceModal(false); setEvidenceUrl(''); setSelectedDispute(null); fetchDisputes(); }
			else alert(`Failed: ${await res.text()}`);
		} catch (err) { console.error(err); }
	};

	const handleDailyClose = async () => {
		if (!confirm('Are you sure you want to close and lock the financial ledger for today?')) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/reconciliation/daily-close`, { method: 'POST', headers });
			if (res.ok) { alert('Daily ledger close complete!'); fetchReconciliation(); }
		} catch (err) { console.error(err); }
	};

	const handleExportInvoices = () => {
		const params = new URLSearchParams();
		if (invoiceType) params.append('invoice_type', invoiceType);
		window.open(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/invoices/export?${params.toString()}`);
	};

	useEffect(() => {
		setError(null);
		if (activeTab === 'transactions') fetchTransactions();
		if (activeTab === 'refunds') fetchRefunds();
		if (activeTab === 'wallets') fetchWallets();
		if (activeTab === 'invoices') fetchInvoices();
		if (activeTab === 'reconciliation') fetchReconciliation();
		if (activeTab === 'disputes') fetchDisputes();
	}, [activeTab, txGateway, txStatus, txSearch, refundStatus, walletSearch, invoiceType]);

	const tabs: { key: TabType; label: string }[] = [
		{ key: 'transactions', label: 'Transactions' },
		{ key: 'refunds', label: 'Refunds' },
		{ key: 'wallets', label: 'Wallets' },
		{ key: 'invoices', label: 'Invoices & GST' },
		{ key: 'reconciliation', label: 'Reconciliation' },
		{ key: 'disputes', label: 'Disputes' },
	];

	const filterSelect = (value: string, onChange: (v: string) => void, children: React.ReactNode) => (
		<select
			className="h-8 rounded-sm bg-background-secondary border border-border-opaque px-3 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			{children}
		</select>
	);

	const filterInput = (value: string, onChange: (v: string) => void, placeholder: string) => (
		<input
			type="text"
			placeholder={placeholder}
			className="flex-1 h-8 rounded-sm bg-background-secondary border border-border-opaque px-3 text-label-medium font-mono text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		/>
	);

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6 bg-background-primary">
			{/* ─── Header ──────────────────────────────────────────────── */}
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-heading-xl text-content-primary flex items-center gap-2">
						Payments &amp; Finance
						{loading && <span className="inline-flex w-3.5 h-3.5 rounded-full border-2 border-border-opaque border-t-interactive-primary animate-spin" />}
					</h1>
					<p className="text-paragraph-small text-content-secondary mt-1">
						Audit transactions, manage wallets, verify ledger closes, track invoices &amp; resolve gateway disputes.
					</p>
				</div>
				<button
					onClick={() => setShowRefundModal(true)}
					className="btn-primary flex items-center gap-1.5"
				>
					<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
					</svg>
					Request Refund
				</button>
			</div>

			{/* ─── KPI Cards ───────────────────────────────────────────── */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
				{[
					{
						label: 'Gateway Volume',
						value: reconReport ? monoAmt((reconReport.stripe_volume_paise + reconReport.razorpay_volume_paise)) : '₹0.00',
						sub: 'Stripe & Razorpay settled',
					},
					{
						label: 'Cash Collected Volume',
						value: reconReport ? monoAmt(reconReport.cash_volume_paise) : '₹0.00',
						sub: 'Cash float at drivers',
					},
					{
						label: 'Pending Refunds',
						value: refunds.filter((r) => r.status === 'PENDING').length.toString(),
						sub: 'Requires manual review',
					},
					{
						label: 'Active Disputes',
						value: disputes.filter((d) => d.status === 'NEEDS_RESPONSE').length.toString(),
						sub: 'Gateway chargebacks',
					},
				].map(({ label, value, sub }) => (
					<div key={label} className="card flex flex-col justify-between gap-2">
						<span className="text-label-small uppercase tracking-wider text-content-secondary">{label}</span>
						<span className="text-display-small font-mono text-content-primary">{value}</span>
						<span className="text-paragraph-small text-content-tertiary font-mono">{sub}</span>
					</div>
				))}
			</div>

			{/* ─── Tab Navigation ──────────────────────────────────────── */}
			<div className="flex bg-background-secondary rounded-pill p-1 gap-0.5 flex-wrap">
				{tabs.map(({ key, label }) => (
					<button
						key={key}
						onClick={() => setActiveTab(key)}
						className={`flex-1 py-2 rounded-pill text-label-small font-semibold capitalize transition-base min-w-[80px] ${
							activeTab === key ? 'bg-interactive-primary text-interactive-primary-text shadow-sm' : 'text-content-secondary hover:text-content-primary'
						}`}
					>
						{label}
					</button>
				))}
			</div>

			{error && (
				<div className="p-4 bg-surface-negative text-content-negative text-paragraph-small rounded-sm border border-negative-200">{error}</div>
			)}

			{/* ══════════════════════════════════════════════════════════ */}
			{/* 1. TRANSACTIONS                                             */}
			{/* ══════════════════════════════════════════════════════════ */}
			{activeTab === 'transactions' && (
				<div className="space-y-4">
					<div className="card flex gap-3 items-center flex-wrap">
						{filterInput(txSearch, setTxSearch, 'Search Transaction ID, Order UUID...')}
						{filterSelect(txGateway, setTxGateway, (
							<>
								<option value="">All Gateways</option>
								<option value="STRIPE">Stripe</option>
								<option value="RAZORPAY">Razorpay</option>
								<option value="CASH">Cash</option>
							</>
						))}
						{filterSelect(txStatus, setTxStatus, (
							<>
								<option value="">All Statuses</option>
								<option value="SUCCESS">Success</option>
								<option value="FAILED">Failed</option>
								<option value="PENDING">Pending</option>
								<option value="REFUNDED">Refunded</option>
							</>
						))}
					</div>

					<div className="card overflow-hidden p-0">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="bg-background-tertiary border-b border-border-opaque">
									<th className={thCls}>Txn ID</th>
									<th className={thCls}>Trip ID</th>
									<th className={thCls}>User</th>
									<th className={thCls}>Type</th>
									<th className={thCls}>Gateway/Method</th>
									<th className={`${thCls} text-right`}>Amount</th>
									<th className={thCls}>Status</th>
									<th className={thCls}>Created At</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border-opaque">
								{transactions.map((tx) => (
									<tr
										key={tx.id}
										onClick={() => { setSelectedTx(tx); fetchTransactionDetails(tx.id); }}
										className={trHover}
									>
										<td className="p-3 font-mono text-paragraph-small text-content-primary font-semibold truncate max-w-[120px]">{tx.id}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary">{tx.order_id ? tx.order_id.substring(0, 8) : '—'}</td>
										<td className="p-3">
											<span className="text-paragraph-small text-content-primary font-medium">{tx.user_id.substring(0, 8)}</span>
											<span className="text-label-small text-content-tertiary block uppercase">{tx.user_type}</span>
										</td>
										<td className="p-3">
											<span className="badge badge-neutral">{tx.txn_type}</span>
										</td>
										<td className="p-3">
											<span className="text-paragraph-small text-content-primary font-semibold">{tx.gateway}</span>
											<span className="text-paragraph-small text-content-secondary block font-mono">{tx.method}</span>
										</td>
										<td className="p-3 font-mono text-paragraph-small text-right text-content-primary font-semibold">{monoAmt(tx.amount_paise)}</td>
										<td className="p-3"><span className={txnStatusBadge(tx.status)}>{tx.status}</span></td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary">{new Date(tx.created_at).toLocaleString()}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* ══════════════════════════════════════════════════════════ */}
			{/* 2. REFUNDS                                                  */}
			{/* ══════════════════════════════════════════════════════════ */}
			{activeTab === 'refunds' && (
				<div className="space-y-4">
					<div className="card flex gap-3 items-center">
						{filterSelect(refundStatus, setRefundStatus, (
							<>
								<option value="">All Refund Statuses</option>
								<option value="PENDING">Pending Approval</option>
								<option value="PROCESSED">Processed</option>
								<option value="FAILED">Failed</option>
							</>
						))}
					</div>

					<div className="card overflow-hidden p-0">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="bg-background-tertiary border-b border-border-opaque">
									<th className={thCls}>Refund ID</th>
									<th className={thCls}>Txn ID</th>
									<th className={thCls}>Reason</th>
									<th className={thCls}>Type</th>
									<th className={`${thCls} text-right`}>Refund Amount</th>
									<th className={thCls}>Status</th>
									<th className={thCls}>Action By</th>
									<th className={thCls}>Created At</th>
									<th className={`${thCls} text-right`}>Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border-opaque">
								{refunds.map((ref) => (
									<tr key={ref.id} className="hover:bg-background-secondary transition-base">
										<td className="p-3 font-mono text-paragraph-small text-content-primary font-semibold truncate max-w-[120px]">{ref.id}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary truncate max-w-[100px]">{ref.transaction_id}</td>
										<td className={tdCls}>{ref.reason}</td>
										<td className="p-3"><span className="badge badge-neutral">{ref.approval_type}</span></td>
										<td className="p-3 font-mono text-paragraph-small text-right text-content-primary font-semibold">{monoAmt(ref.amount_paise)}</td>
										<td className="p-3"><span className={refundStatusBadge(ref.status)}>{ref.status}</span></td>
										<td className={tdCls}>{ref.approved_by || '—'}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary">{new Date(ref.created_at).toLocaleString()}</td>
										<td className="p-3 text-right">
											{ref.status === 'PENDING' && (
												<div className="flex gap-1.5 justify-end">
													<button onClick={() => handleProcessRefundAction(ref.id, 'approve')} className="btn-primary text-xs py-1 px-2">Approve</button>
													<button onClick={() => handleProcessRefundAction(ref.id, 'reject')} className="border border-border-opaque hover:border-content-primary text-label-small font-semibold rounded-sm px-2 py-1 text-content-secondary hover:text-content-primary transition-base">Reject</button>
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

			{/* ══════════════════════════════════════════════════════════ */}
			{/* 3. WALLETS                                                  */}
			{/* ══════════════════════════════════════════════════════════ */}
			{activeTab === 'wallets' && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
					<div className="lg:col-span-2 space-y-4">
						<div className="card flex gap-3 items-center">
							{filterInput(walletSearch, setWalletSearch, 'Search User UUID...')}
						</div>

						<div className="card overflow-hidden p-0">
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="bg-background-tertiary border-b border-border-opaque">
										<th className={thCls}>User ID</th>
										<th className={thCls}>User Type</th>
										<th className={`${thCls} text-right`}>Balance</th>
										<th className={thCls}>Last Updated</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border-opaque">
									{wallets.map((w) => (
										<tr
											key={w.id}
											onClick={() => fetchWalletDetails(w.id)}
											className={`${trHover} ${selectedWallet?.id === w.id ? 'bg-background-secondary' : ''}`}
										>
											<td className="p-3 font-mono text-paragraph-small text-content-primary font-semibold">{w.user_id}</td>
											<td className="p-3"><span className="badge badge-neutral">{w.user_type}</span></td>
											<td className="p-3 font-mono text-paragraph-small text-right text-content-primary font-semibold">{monoAmt(w.balance_paise)}</td>
											<td className="p-3 font-mono text-paragraph-small text-content-secondary">{new Date(w.updated_at).toLocaleString()}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>

					<div className="card space-y-4">
						{selectedWallet ? (
							<>
								<div className="border-b border-border-opaque pb-3 flex justify-between items-start">
									<div>
										<h3 className="text-label-large text-content-primary font-semibold">Wallet Details</h3>
										<span className="text-paragraph-small text-content-tertiary block font-mono">{selectedWallet.user_id}</span>
										<span className="badge badge-neutral mt-1">{selectedWallet.user_type} Account</span>
									</div>
									<div className="text-right">
										<span className="text-label-small text-content-tertiary uppercase tracking-wide block">Balance</span>
										<span className="text-display-small font-mono text-content-primary">{monoAmt(selectedWallet.balance_paise)}</span>
									</div>
								</div>

								<button onClick={() => setShowAdjustModal(true)} className="btn-primary w-full">Manual Adjustment</button>

								<div className="space-y-2">
									<span className="text-label-small text-content-tertiary uppercase tracking-wider block">Wallet Ledger History</span>
									{selectedWalletEntries.length === 0 ? (
										<div className="text-center py-6 text-paragraph-small text-content-tertiary">No ledger entries logged.</div>
									) : (
										<div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
											{selectedWalletEntries.map((ent) => (
												<div key={ent.id} className="p-3 bg-background-secondary rounded-sm border border-border-opaque flex flex-col gap-1">
													<div className="flex justify-between items-center">
														<span className={ent.entry_type === 'CREDIT' ? 'badge badge-positive' : 'badge badge-negative'}>
															{ent.entry_type}
														</span>
														<span className={`font-mono text-paragraph-small font-semibold ${ent.entry_type === 'CREDIT' ? 'text-content-positive' : 'text-content-negative'}`}>
															{ent.entry_type === 'CREDIT' ? '+' : '-'}{monoAmt(ent.amount_paise)}
														</span>
													</div>
													<p className="text-paragraph-small text-content-primary leading-snug">{ent.description}</p>
													<div className="flex justify-between items-center text-paragraph-small text-content-tertiary font-mono">
														<span>{ent.reason_code}</span>
														<span>{new Date(ent.created_at).toLocaleString()}</span>
													</div>
												</div>
											))}
										</div>
									)}
								</div>
							</>
						) : (
							<div className="text-center py-16 text-paragraph-small text-content-tertiary">
								Select a wallet from the table to view details, ledger, and perform manual adjustments.
							</div>
						)}
					</div>
				</div>
			)}

			{/* ══════════════════════════════════════════════════════════ */}
			{/* 4. INVOICES                                                 */}
			{/* ══════════════════════════════════════════════════════════ */}
			{activeTab === 'invoices' && (
				<div className="space-y-4">
					<div className="card flex gap-3 items-center justify-between">
						{filterSelect(invoiceType, setInvoiceType, (
							<>
								<option value="">All Invoice Types</option>
								<option value="RIDER_TRIP">Rider Trip (B2C)</option>
								<option value="DRIVER_TAX">Driver Tax Invoice</option>
								<option value="PLATFORM_B2B">Platform Corporate (B2B)</option>
							</>
						))}
						<button
							onClick={handleExportInvoices}
							className="h-8 px-4 bg-background-secondary hover:bg-background-tertiary border border-border-opaque text-content-primary rounded-pill text-label-small font-semibold transition-base flex items-center gap-1.5"
						>
							<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
							Bulk Export CSV
						</button>
					</div>

					<div className="card overflow-hidden p-0">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="bg-background-tertiary border-b border-border-opaque">
									<th className={thCls}>Invoice ID</th>
									<th className={thCls}>Trip ID</th>
									<th className={thCls}>Recipient</th>
									<th className={thCls}>GSTIN</th>
									<th className={`${thCls} text-right`}>Subtotal</th>
									<th className={`${thCls} text-right`}>CGST (9%)</th>
									<th className={`${thCls} text-right`}>SGST (9%)</th>
									<th className={`${thCls} text-right`}>Total Amount</th>
									<th className={thCls}>IRN (E-invoice)</th>
									<th className={thCls}>Created At</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border-opaque">
								{invoices.map((inv) => (
									<tr key={inv.id} className="hover:bg-background-secondary transition-base">
										<td className="p-3 font-mono text-paragraph-small text-content-primary font-semibold truncate max-w-[100px]">{inv.id}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary">{inv.order_id ? inv.order_id.substring(0, 8) : '—'}</td>
										<td className={tdCls}>{inv.recipient_name}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary uppercase">{inv.recipient_gstin || '—'}</td>
										<td className="p-3 font-mono text-paragraph-small text-right text-content-primary">{monoAmt(inv.amount_paise)}</td>
										<td className="p-3 font-mono text-paragraph-small text-right text-content-secondary">{monoAmt(inv.cgst_paise)}</td>
										<td className="p-3 font-mono text-paragraph-small text-right text-content-secondary">{monoAmt(inv.sgst_paise)}</td>
										<td className="p-3 font-mono text-paragraph-small text-right text-content-primary font-semibold">{monoAmt(inv.total_amount_paise)}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary truncate max-w-[120px]" title={inv.irn || ''}>{inv.irn || '—'}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary">{new Date(inv.created_at).toLocaleString()}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* ══════════════════════════════════════════════════════════ */}
			{/* 5. RECONCILIATION                                           */}
			{/* ══════════════════════════════════════════════════════════ */}
			{activeTab === 'reconciliation' && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
					<div className="card space-y-4">
						<h3 className="text-label-large text-content-primary font-semibold">Gateway Settlement Match</h3>
						<div className="space-y-3 border-b border-border-opaque pb-4">
							<div className="flex justify-between items-center text-paragraph-small">
								<span className="text-content-secondary">Gateway Settlements (Success):</span>
								<span className="font-mono text-content-primary font-semibold">
									{reconReport ? monoAmt(reconReport.gateway_total_settled_paise) : '₹0.00'}
								</span>
							</div>
							<div className="flex justify-between items-center text-paragraph-small">
								<span className="text-content-secondary">Internal Ledger Outflow:</span>
								<span className="font-mono text-content-primary font-semibold">
									{reconReport ? monoAmt(reconReport.internal_ledger_cash_paise) : '₹0.00'}
								</span>
							</div>
						</div>
						<div className="flex justify-between items-center">
							<span className="text-label-medium text-content-primary font-semibold">Total Reconciliation Error:</span>
							<span className={`font-mono text-paragraph-small px-2 py-0.5 rounded-sm font-semibold ${
								reconReport && reconReport.discrepancy_paise === 0 ? 'badge badge-positive' : 'badge badge-negative'
							}`}>
								{reconReport ? monoAmt(reconReport.discrepancy_paise) : '₹0.00'}
							</span>
						</div>
						<button onClick={handleDailyClose} className="btn-primary w-full">Complete Daily Closing</button>
					</div>

					<div className="lg:col-span-2 space-y-4">
						<div className="card">
							<h3 className="text-label-large text-content-primary font-semibold">Driver Cash Collected Reports</h3>
							<p className="text-paragraph-small text-content-secondary mt-0.5">Commission float (20% platform share) currently held by drivers from cash trips.</p>
						</div>
						<div className="card overflow-hidden p-0">
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="bg-background-tertiary border-b border-border-opaque">
										<th className={thCls}>Driver Name</th>
										<th className={thCls}>Driver ID</th>
										<th className={thCls}>Region</th>
										<th className={`${thCls} text-right`}>Owed Cash Float</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border-opaque">
									{cashFloat.map((row) => (
										<tr key={row.driver_id} className="hover:bg-background-secondary transition-base">
											<td className={tdCls}>{row.driver_name}</td>
											<td className="p-3 font-mono text-paragraph-small text-content-secondary">{row.driver_id}</td>
											<td className="p-3 font-mono text-paragraph-small text-content-secondary uppercase">{row.city_prefix}</td>
											<td className="p-3 font-mono text-paragraph-small text-right text-content-negative font-semibold">{monoAmt(row.cash_float_paise)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			)}

			{/* ══════════════════════════════════════════════════════════ */}
			{/* 6. DISPUTES                                                 */}
			{/* ══════════════════════════════════════════════════════════ */}
			{activeTab === 'disputes' && (
				<div className="space-y-4">
					<div className="card overflow-hidden p-0">
						<table className="w-full text-left border-collapse">
							<thead>
								<tr className="bg-background-tertiary border-b border-border-opaque">
									<th className={thCls}>Dispute ID</th>
									<th className={thCls}>Gateway Dispute ID</th>
									<th className={thCls}>Reason</th>
									<th className={thCls}>Disputed Txn ID</th>
									<th className={`${thCls} text-right`}>Disputed Amount</th>
									<th className={thCls}>Status</th>
									<th className={thCls}>Evidence Link</th>
									<th className={thCls}>Created At</th>
									<th className={`${thCls} text-right`}>Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border-opaque">
								{disputes.map((disp) => (
									<tr key={disp.id} className="hover:bg-background-secondary transition-base">
										<td className="p-3 font-mono text-paragraph-small text-content-primary font-semibold truncate max-w-[100px]">{disp.id}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary">{disp.gateway_dispute_id || '—'}</td>
										<td className={tdCls}>{disp.reason}</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary">{disp.transaction_id}</td>
										<td className="p-3 font-mono text-paragraph-small text-right text-content-negative font-semibold">{monoAmt(disp.amount_paise)}</td>
										<td className="p-3"><span className={disputeStatusBadge(disp.status)}>{disp.status.replace(/_/g, ' ')}</span></td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary truncate max-w-[150px]">
											{disp.evidence_url ? (
												<a href={disp.evidence_url} target="_blank" rel="noopener noreferrer" className="text-content-accent hover:underline font-semibold">View Evidence</a>
											) : 'Not Uploaded'}
										</td>
										<td className="p-3 font-mono text-paragraph-small text-content-secondary">{new Date(disp.created_at).toLocaleString()}</td>
										<td className="p-3 text-right">
											{disp.status === 'NEEDS_RESPONSE' && (
												<button
													onClick={() => { setSelectedDispute(disp); setShowEvidenceModal(true); }}
													className="btn-primary text-xs py-1 px-2"
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

			{/* ══════════════════════════════════════════════════════════ */}
			{/* TRANSACTION DETAIL DRAWER                                   */}
			{/* ══════════════════════════════════════════════════════════ */}
			{selectedTx && (
				<div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
					<div className="absolute inset-0 bg-background-secondary0/30 backdrop-blur-sm" onClick={() => setSelectedTx(null)} />
					<div className="relative w-full max-w-lg bg-background-primary border-l border-border-opaque h-full shadow-2xl flex flex-col">
						<div className="p-6 overflow-y-auto space-y-6 flex-1">
							<div className="flex justify-between items-start border-b border-border-opaque pb-4">
								<div>
									<h2 className="text-heading-medium text-content-primary">Transaction Details</h2>
									<span className="text-paragraph-small font-mono text-content-secondary block mt-0.5">{selectedTx.id}</span>
								</div>
								<button onClick={() => setSelectedTx(null)} className="p-1 rounded-full hover:bg-background-secondary text-content-secondary hover:text-content-primary transition-base">
									<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>

							<div className="grid grid-cols-2 gap-4 text-paragraph-small">
								<div>
									<span className="text-label-small text-content-tertiary uppercase tracking-wide block">Amount</span>
									<span className="text-heading-medium font-mono text-content-primary">{monoAmt(selectedTx.amount_paise)}</span>
								</div>
								<div>
									<span className="text-label-small text-content-tertiary uppercase tracking-wide block">Status</span>
									<span className={`${txnStatusBadge(selectedTx.status)} mt-1 inline-flex`}>{selectedTx.status}</span>
								</div>
								<div>
									<span className="text-label-small text-content-tertiary uppercase tracking-wide block">Transaction Type</span>
									<span className="text-content-primary font-semibold">{selectedTx.txn_type}</span>
								</div>
								<div>
									<span className="text-label-small text-content-tertiary uppercase tracking-wide block">Order/Trip ID</span>
									<span className="font-mono text-content-primary">{selectedTx.order_id || 'N/A'}</span>
								</div>
								<div>
									<span className="text-label-small text-content-tertiary uppercase tracking-wide block">User ID ({selectedTx.user_type})</span>
									<span className="font-mono text-content-primary text-paragraph-small">{selectedTx.user_id}</span>
								</div>
								<div>
									<span className="text-label-small text-content-tertiary uppercase tracking-wide block">Gateway (Method)</span>
									<span className="text-content-primary font-semibold">{selectedTx.gateway} ({selectedTx.method})</span>
								</div>
							</div>

							{selectedTxDetails?.gateway_response && (
								<div className="space-y-2">
									<span className="text-label-small text-content-tertiary uppercase tracking-wide font-semibold block">Gateway Response Payload</span>
									<pre className="bg-background-secondary border border-border-opaque p-3 rounded-sm text-paragraph-small font-mono text-content-secondary overflow-x-auto leading-relaxed max-h-[300px]">
										{JSON.stringify(JSON.parse(selectedTxDetails.gateway_response), null, 2)}
									</pre>
								</div>
							)}
						</div>
						<div className="p-4 bg-background-secondary border-t border-border-opaque flex gap-2">
							{selectedTx.status === 'SUCCESS' && (
								<button
									onClick={() => { setRefundTxId(selectedTx.id); setRefundAmount((selectedTx.amount_paise / 100).toString()); setShowRefundModal(true); setSelectedTx(null); }}
									className="btn-primary flex-1"
								>
									Refund Transaction
								</button>
							)}
							<button
								onClick={() => setSelectedTx(null)}
								className="flex-1 py-2 bg-background-primary border border-border-opaque text-content-primary hover:bg-background-secondary text-label-small font-semibold rounded-sm transition-base"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── REFUND MODAL ── */}
			{showRefundModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
					<div className="absolute inset-0 bg-background-secondary0/40 backdrop-blur-sm" onClick={() => setShowRefundModal(false)} />
					<form onSubmit={handleRequestRefund} className="relative w-full max-w-md card space-y-4">
						<div>
							<h3 className="text-label-large text-content-primary font-semibold">Request Transaction Refund</h3>
							<p className="text-paragraph-small text-content-secondary">Submit a refund request for processing. Auto-approvals occur if the amount is under ₹500.</p>
						</div>
						<div className="space-y-3">
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Transaction ID</label>
								<input type="text" required placeholder="pi_..." className="w-full h-9 rounded-sm bg-background-secondary border border-border-opaque px-3 font-mono text-paragraph-small text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" value={refundTxId} onChange={(e) => setRefundTxId(e.target.value)} />
							</div>
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Refund Amount (₹)</label>
								<input type="number" step="0.01" required placeholder="0.00" className="w-full h-9 rounded-sm bg-background-secondary border border-border-opaque px-3 font-mono text-paragraph-small text-content-primary text-right placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
							</div>
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Reason for Refund</label>
								<textarea required placeholder="Customer charged in error / cancellation grace..." className="w-full rounded-sm bg-background-secondary border border-border-opaque p-3 h-20 text-paragraph-small text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
							</div>
						</div>
						<div className="flex justify-end gap-2">
							<button type="button" onClick={() => setShowRefundModal(false)} className="border border-border-opaque hover:border-content-primary text-label-small font-semibold rounded-pill px-4 py-2 text-content-secondary hover:text-content-primary transition-base">Cancel</button>
							<button type="submit" className="btn-primary">Submit Request</button>
						</div>
					</form>
				</div>
			)}

			{/* ── WALLET ADJUSTMENT MODAL ── */}
			{showAdjustModal && selectedWallet && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
					<div className="absolute inset-0 bg-background-secondary0/40 backdrop-blur-sm" onClick={() => setShowAdjustModal(false)} />
					<form onSubmit={handleAdjustWallet} className="relative w-full max-w-md card space-y-4">
						<div>
							<h3 className="text-label-large text-content-primary font-semibold">Manual Wallet Balance Adjustment</h3>
							<p className="text-paragraph-small text-content-secondary">Adjust balance for user {selectedWallet.user_id.substring(0, 8)} ({selectedWallet.user_type}). All actions are audited.</p>
						</div>
						<div className="space-y-3">
							<div className="flex gap-2">
								{(['CREDIT', 'DEBIT'] as const).map((t) => (
									<button
										key={t}
										type="button"
										onClick={() => setAdjustType(t)}
										className={`flex-1 py-1.5 rounded-sm text-label-small font-semibold border transition-base ${
											adjustType === t
												? t === 'CREDIT' ? 'bg-surface-positive text-content-positive border-positive-300' : 'bg-surface-negative text-content-negative border-negative-300'
												: 'bg-background-primary text-content-primary border-border-opaque hover:bg-background-secondary'
										}`}
									>
										{t === 'CREDIT' ? 'Credit (Add)' : 'Debit (Deduct)'}
									</button>
								))}
							</div>
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Adjustment Amount (₹)</label>
								<input type="number" step="0.01" required placeholder="0.00" className="w-full h-9 rounded-sm bg-background-secondary border border-border-opaque px-3 font-mono text-paragraph-small text-content-primary text-right placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} />
							</div>
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Reason Code</label>
								<select className="w-full h-9 rounded-sm bg-background-secondary border border-border-opaque px-3 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" value={adjustReasonCode} onChange={(e) => setAdjustReasonCode(e.target.value)}>
									<option value="MANUAL_ADJUSTMENT">Manual adjustment / correction</option>
									<option value="PROMO_CREDIT">Promo credit reward</option>
									<option value="FINE">Deduction / Fine</option>
									<option value="REFUND">Refund settlement</option>
								</select>
							</div>
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Detailed Description</label>
								<textarea required placeholder="Detailed reasoning for the adjustment record..." className="w-full rounded-sm bg-background-secondary border border-border-opaque p-3 h-20 text-paragraph-small text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" value={adjustDesc} onChange={(e) => setAdjustDesc(e.target.value)} />
							</div>
						</div>
						<div className="flex justify-end gap-2">
							<button type="button" onClick={() => setShowAdjustModal(false)} className="border border-border-opaque hover:border-content-primary text-label-small font-semibold rounded-pill px-4 py-2 text-content-secondary hover:text-content-primary transition-base">Cancel</button>
							<button type="submit" className="btn-primary">Submit Adjustment</button>
						</div>
					</form>
				</div>
			)}

			{/* ── DISPUTE EVIDENCE MODAL ── */}
			{showEvidenceModal && selectedDispute && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
					<div className="absolute inset-0 bg-background-secondary0/40 backdrop-blur-sm" onClick={() => setShowEvidenceModal(false)} />
					<form onSubmit={handleSubmitEvidence} className="relative w-full max-w-md card space-y-4">
						<div>
							<h3 className="text-label-large text-content-primary font-semibold">Submit Dispute Evidence</h3>
							<p className="text-paragraph-small text-content-secondary">Provide a file URL or description to submit as evidence to the gateway for dispute {selectedDispute.id}.</p>
						</div>
						<div className="space-y-3">
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Disputed Amount</label>
								<span className="font-mono font-semibold text-content-negative block text-heading-medium">{monoAmt(selectedDispute.amount_paise)}</span>
							</div>
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Evidence File Path / URL</label>
								<input type="text" required placeholder="https://example.com/evidence_receipt.pdf" className="w-full h-9 rounded-sm bg-background-secondary border border-border-opaque px-3 font-mono text-paragraph-small text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} />
							</div>
						</div>
						<div className="flex justify-end gap-2">
							<button type="button" onClick={() => setShowEvidenceModal(false)} className="border border-border-opaque hover:border-content-primary text-label-small font-semibold rounded-pill px-4 py-2 text-content-secondary hover:text-content-primary transition-base">Cancel</button>
							<button type="submit" className="btn-primary">Submit Evidence</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
};
