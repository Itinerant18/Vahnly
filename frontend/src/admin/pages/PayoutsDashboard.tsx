import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface Payout {
	id: string;
	driver_id: string;
	driver_name: string;
	driver_phone: string;
	background_check_status: string; // APPROVED, PENDING, REJECTED
	bank_name?: string | null;
	bank_account_number?: string | null;
	bank_ifsc?: string | null;
	bank_verified: boolean;
	payout_hold: boolean;
	payout_hold_reason?: string | null;
	amount_paise: number;
	tds_paise: number;
	professional_fees_paise: number;
	net_amount_paise: number;
	status: string; // PENDING, APPROVED, PROCESSING, PAID, FAILED, HELD
	failure_reason?: string | null;
	hold_reason?: string | null;
	payout_batch_id?: string | null;
	bank_reference?: string | null;
	created_at: string;
	updated_at: string;
}

type TabType = 'ALL' | 'PENDING' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'HELD';

export const PayoutsDashboard: React.FC = () => {
	const [payouts, setPayouts] = useState<Payout[]>([]);
	const [total, setTotal] = useState<number>(0);
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);

	// Filter states
	const [activeTab, setActiveTab] = useState<TabType>('ALL');
	const [searchQuery, setSearchQuery] = useState<string>('');
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [page, setPage] = useState<number>(0);

	// Detail Modal state
	const [selectedPayout, setSelectedPayout] = useState<Payout | null>(null);

	// Hold Modal state
	const [holdPayoutId, setHoldPayoutId] = useState<string | null>(null);
	const [holdReasonText, setHoldReasonText] = useState<string>('');

	// Bulk operations status
	const [bulkProcessing, setBulkProcessing] = useState<boolean>(false);

	const role = localStorage.getItem('admin_role') || 'ADMIN';
	const headers = {
		'X-Admin-Role': role,
		'Content-Type': 'application/json',
		'X-Admin-Email': 'finance_admin@platform.com',
	};

	const fetchPayouts = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (activeTab !== 'ALL') params.append('status', activeTab);
			if (searchQuery) params.append('search', searchQuery);
			params.append('limit', '50');
			params.append('offset', (page * 50).toString());

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/payouts?${params.toString()}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setPayouts(data.payouts || []);
				setTotal(data.total || 0);
			} else {
				setError('Failed to fetch payout requests');
			}
		} catch (err) {
			console.error('Failed to fetch payouts:', err);
			setError('Network error: Failed to connect to server');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchPayouts();
	}, [activeTab, searchQuery, page]);

	// Handlers
	const toggleSelect = (id: string) => {
		setSelectedIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
		);
	};

	const toggleSelectAll = () => {
		const pendingPayouts = payouts.filter((p) => p.status === 'PENDING').map((p) => p.id);
		if (selectedIds.length === pendingPayouts.length) {
			setSelectedIds([]);
		} else {
			setSelectedIds(pendingPayouts);
		}
	};

	const handleBulkApprove = async () => {
		if (selectedIds.length === 0) return;
		if (!window.confirm(
			`Approve ${selectedIds.length} payout${selectedIds.length === 1 ? '' : 's'}?\n\n` +
			`This releases real-money payouts to drivers. Ineligible ones (KYC/bank/hold) are skipped.`
		)) {
			return;
		}
		setBulkProcessing(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/payouts/bulk-approve`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ ids: selectedIds }),
			});
			if (res.ok) {
				const result = await res.json();
				alert(`Successfully approved ${result.approved_count} payouts. ${result.skipped_count} were skipped due to eligibility holds.`);
				setSelectedIds([]);
				fetchPayouts();
			} else {
				alert('Failed to process bulk approval');
			}
		} catch (err) {
			console.error(err);
			alert('Network error during bulk approval');
		} finally {
			setBulkProcessing(false);
		}
	};

	const handleExportBatch = () => {
		// Open the file in a new tab/trigger browser download
		window.open(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/payouts/export-batch`);
		// Wait a second and refresh to show state transitioned to PROCESSING
		setTimeout(() => {
			fetchPayouts();
		}, 1500);
	};

	const handleRetry = async (id: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/payouts/${id}/retry`, {
				method: 'POST',
				headers,
			});
			if (res.ok) {
				alert('Payout request successfully queued back for processing');
				fetchPayouts();
				if (selectedPayout?.id === id) {
					setSelectedPayout(null);
				}
			} else {
				alert(`Retry failed: ${await res.text()}`);
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleHold = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!holdPayoutId || !holdReasonText.trim()) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/payouts/${holdPayoutId}/hold`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ reason: holdReasonText }),
			});
			if (res.ok) {
				alert('Payout successfully placed on hold');
				setHoldPayoutId(null);
				setHoldReasonText('');
				fetchPayouts();
				if (selectedPayout?.id === holdPayoutId) {
					setSelectedPayout(null);
				}
			} else {
				alert('Failed to put payout on hold');
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleRelease = async (id: string) => {
		if (!window.confirm(
			`Release the hold on payout ${id}?\n\nThis returns a fraud/dispute-flagged payout to the payable queue.`
		)) {
			return;
		}
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/payouts/${id}/release`, {
				method: 'POST',
				headers,
			});
			if (res.ok) {
				alert('Payout hold released, moved back to pending queue');
				fetchPayouts();
				if (selectedPayout?.id === id) {
					setSelectedPayout(null);
				}
			} else {
				alert('Failed to release hold');
			}
		} catch (err) {
			console.error(err);
		}
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case 'PENDING': return 'text-content-warning bg-surface-warning border-warning-400';
			case 'APPROVED': return 'text-content-positive bg-surface-positive border-positive-400';
			case 'PROCESSING': return 'text-content-accent bg-surface-accent border-border-accent';
			case 'PAID': return 'text-content-primary bg-background-secondary border-border-opaque';
			case 'FAILED': return 'text-content-negative bg-surface-negative border-negative-400';
			case 'HELD': return 'text-content-accent bg-surface-accent border-border-accent';
			default: return 'text-content-tertiary bg-background-secondary border-background-secondary';
		}
	};

	const checkEligibility = (p: Payout) => {
		const isKycOk = p.background_check_status === 'APPROVED';
		const isBankOk = p.bank_verified;
		const isNoHold = !p.payout_hold;
		return {
			eligible: isKycOk && isBankOk && isNoHold,
			kyc: isKycOk,
			bank: isBankOk,
			hold: isNoHold,
		};
	};

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6 bg-background-primary font-sans selection:bg-black selection:text-white">
			{/* ---- Header ---- */}
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-content-primary flex items-center gap-2">
						Payouts & Settlements ({total})
						{loading && (
							<span className="inline-flex w-3.5 h-3.5 rounded-full border-2 border-background-secondary border-t-ink animate-spin" />
						)}
					</h1>
					<p className="text-xs text-content-tertiary mt-1">Review driver bank verification parameters, hold funds, bulk-approve payouts, and export banking batches.</p>
				</div>
				<div className="flex gap-2">
					<button
						onClick={handleExportBatch}
						className="px-4 py-2 border border-background-secondary bg-background-primary hover:bg-background-secondary text-content-primary rounded-pill text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
					>
						<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
						Export Bank Batch CSV
					</button>
				</div>
			</div>

			{/* ---- KPI Metrics Cards ---- */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
				<div className="bg-background-primary border border-background-secondary rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-content-tertiary uppercase tracking-wider">Pending Approvals</span>
					<span className="text-2xl font-bold font-mono text-content-primary mt-2">
						{payouts.filter(p => p.status === 'PENDING').length}
					</span>
					<span className="text-[10px] text-content-tertiary font-mono mt-1">Requires manual validation</span>
				</div>
				<div className="bg-background-primary border border-background-secondary rounded-xl p-5 flex flex-col justify-between shadow-sm font-semibold">
					<span className="text-[11px] font-semibold text-content-tertiary uppercase tracking-wider font-semibold text-content-positive">Ready for Batch Export</span>
					<span className="text-2xl font-bold font-mono text-content-positive mt-2">
						{payouts.filter(p => p.status === 'APPROVED').length}
					</span>
					<span className="text-[10px] text-content-tertiary font-mono mt-1">Eligible, approved payout runs</span>
				</div>
				<div className="bg-background-primary border border-background-secondary rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-content-tertiary uppercase tracking-wider">Failed Settlements</span>
					<span className="text-2xl font-bold font-mono text-content-negative mt-2">
						{payouts.filter(p => p.status === 'FAILED').length}
					</span>
					<span className="text-[10px] text-content-tertiary font-mono mt-1">Requires review/bank retry</span>
				</div>
				<div className="bg-background-primary border border-background-secondary rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-content-tertiary uppercase tracking-wider">Held Funds</span>
					<span className="text-2xl font-bold font-mono text-content-accent mt-2">
						₹{((payouts.filter(p => p.status === 'HELD').reduce((acc, curr) => acc + curr.amount_paise, 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
					</span>
					<span className="text-[10px] text-content-tertiary font-mono mt-1">Flagged due to fraud/dispute</span>
				</div>
			</div>

			{/* ---- Tab Navigation & Filters ---- */}
			<div className="space-y-4">
				<div className="flex border-b border-background-secondary bg-background-secondary p-1 rounded-xl">
					{(['ALL', 'PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'HELD'] as TabType[]).map((tab) => (
						<button
							key={tab}
							onClick={() => {
								setActiveTab(tab);
								setPage(0);
								setSelectedIds([]);
							}}
							className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition ${
								activeTab === tab ? 'bg-background-primary text-content-primary shadow-sm' : 'text-content-secondary hover:text-content-primary'
							}`}
						>
							{tab.toLowerCase()}
						</button>
					))}
				</div>

				<div className="bg-background-primary border border-background-secondary rounded-xl p-4 flex gap-3 shadow-sm items-center">
					<div className="flex-1">
						<input
							type="text"
							placeholder="Search Payout ID, Driver Name, or Batch Code..."
							className="w-full h-8 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
				</div>
			</div>

			{error && <div className="p-4 bg-surface-negative text-content-negative text-xs rounded-lg border border-negative-400">{error}</div>}

			{/* ---- Datagrid Table ---- */}
			<div className="bg-background-primary border border-background-secondary rounded-xl overflow-hidden shadow-sm">
				<table className="w-full text-left border-collapse">
					<thead>
						<tr className="bg-background-secondary border-b border-background-secondary">
							{activeTab === 'PENDING' && (
								<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary w-10">
									<input
										type="checkbox"
										className="w-3.5 h-3.5 rounded border-background-secondary text-content-primary focus:ring-0 focus:outline-none cursor-pointer"
										checked={selectedIds.length > 0 && selectedIds.length === payouts.filter(p => p.status === 'PENDING').length}
										onChange={toggleSelectAll}
									/>
								</th>
							)}
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Payout ID</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Driver Partner</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary text-center">Eligibility Checks</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary text-right">Gross Amount</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary text-right">Deductions (TDS+Fees)</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary text-right font-semibold">Net Settlement</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary text-center">Status</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary">Batch ID</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-content-tertiary text-right">Actions</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-background-secondary text-xs">
						{loading ? (
							<tr>
								<td colSpan={activeTab === 'PENDING' ? 10 : 9} className="p-8 text-center text-content-tertiary animate-pulse">Loading settlements queue...</td>
							</tr>
						) : payouts.length === 0 ? (
							<tr>
								<td colSpan={activeTab === 'PENDING' ? 10 : 9} className="p-8 text-center text-content-tertiary font-medium">No payouts matching filter parameters</td>
							</tr>
						) : (
							payouts.map((p) => {
								const elig = checkEligibility(p);
								const isSelected = selectedIds.includes(p.id);

								return (
									<tr
										key={p.id}
										className={`hover:bg-background-tertiary cursor-pointer transition-colors ${
											isSelected ? 'bg-background-tertiary/50' : ''
										}`}
										onClick={() => setSelectedPayout(p)}
									>
										{activeTab === 'PENDING' && (
											<td className="p-3" onClick={(e) => e.stopPropagation()}>
												<input
													type="checkbox"
													className="w-3.5 h-3.5 rounded border-background-secondary text-content-primary focus:ring-0 focus:outline-none cursor-pointer"
													checked={isSelected}
													onChange={() => toggleSelect(p.id)}
												/>
											</td>
										)}
										<td className="p-3 font-mono text-content-primary font-semibold">{p.id}</td>
										<td className="p-3">
											<div className="font-semibold text-content-primary">{p.driver_name}</div>
											<div className="text-[10px] text-content-tertiary font-mono">{p.driver_phone}</div>
										</td>
										<td className="p-3" onClick={(e) => e.stopPropagation()}>
											<div className="flex justify-center gap-1">
												<span
													title={elig.kyc ? "KYC Complete" : "KYC Pending"}
													className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
														elig.kyc ? 'bg-surface-positive text-content-positive' : 'bg-surface-warning text-content-warning'
													}`}
												>
													K
												</span>
												<span
													title={elig.bank ? "Bank Verified" : "Bank Unverified"}
													className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
														elig.bank ? 'bg-surface-positive text-content-positive' : 'bg-surface-negative text-content-negative'
													}`}
												>
													B
												</span>
												<span
													title={elig.hold ? "No Payout Holds" : "Payout On Hold"}
													className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
														elig.hold ? 'bg-surface-positive text-content-positive' : 'bg-surface-accent text-content-accent'
													}`}
												>
													H
												</span>
											</div>
										</td>
										<td className="p-3 font-mono text-right text-content-tertiary">₹{(p.amount_paise / 100).toFixed(2)}</td>
										<td className="p-3 font-mono text-right text-content-tertiary">
											₹{((p.tds_paise + p.professional_fees_paise) / 100).toFixed(2)}
											<span className="text-[9px] text-content-tertiary block">
												(₹{(p.tds_paise / 100).toFixed(0)} + ₹{(p.professional_fees_paise / 100).toFixed(0)})
											</span>
										</td>
										<td className="p-3 font-mono text-right font-bold text-content-primary">₹{(p.net_amount_paise / 100).toFixed(2)}</td>
										<td className="p-3 text-center">
											<span className={`inline-flex items-center text-[9px] font-bold border rounded-pill h-5 px-2 tracking-wider ${getStatusColor(p.status)}`}>
												{p.status}
											</span>
										</td>
										<td className="p-3 font-mono text-content-tertiary">{p.payout_batch_id || '—'}</td>
										<td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
											<div className="flex gap-1.5 justify-end">
												{p.status === 'PENDING' && (
													<button
														onClick={() => setHoldPayoutId(p.id)}
														className="px-2.5 py-1 bg-surface-accent text-content-accent hover:bg-surface-accent rounded text-[10px] font-bold border border-border-accent transition"
													>
														Hold
													</button>
												)}
												{p.status === 'HELD' && (
													<button
														onClick={() => handleRelease(p.id)}
														className="px-2.5 py-1 bg-surface-positive text-content-positive hover:bg-surface-positive rounded text-[10px] font-bold border border-positive-400 transition"
													>
														Release
													</button>
												)}
												{p.status === 'FAILED' && (
													<button
														onClick={() => handleRetry(p.id)}
														className="px-2.5 py-1 bg-content-primary text-gray-0 rounded text-[10px] font-bold hover:bg-gray-800 transition"
													>
														Retry
													</button>
												)}
											</div>
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>

			{/* ---- Bulk Actions Bar ---- */}
			{selectedIds.length > 0 && (
				<div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-content-primary text-gray-0 px-6 py-3.5 rounded-xl flex items-center gap-6 shadow-2xl z-40 animate-fade-in border border-gray-800">
					<span className="text-xs font-semibold">{selectedIds.length} Payout Request(s) selected</span>
					<div className="flex gap-2.5">
						<button
							onClick={handleBulkApprove}
							disabled={bulkProcessing}
							className="px-4 py-1.5 bg-background-primary hover:bg-background-secondary text-content-primary text-xs font-bold rounded-pill shadow-sm disabled:opacity-50"
						>
							{bulkProcessing ? 'Approving...' : 'Approve Selected'}
						</button>
						<button
							onClick={() => setSelectedIds([])}
							className="px-3 py-1.5 hover:bg-white/10 text-gray-0 text-xs font-semibold rounded-pill transition"
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* ---- 1. Detail Slide-over / Modal ---- */}
			{selectedPayout && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-lg w-full space-y-4 shadow-2xl">
						<div className="border-b border-background-secondary pb-3 flex justify-between items-start">
							<div>
								<h3 className="text-sm font-bold text-content-primary">Payout Settlement Request</h3>
								<span className="text-[10px] text-content-tertiary font-mono block mt-0.5">{selectedPayout.id}</span>
							</div>
							<button onClick={() => setSelectedPayout(null)} className="text-content-tertiary hover:text-content-primary text-sm font-bold">✕</button>
						</div>

						<div className="grid grid-cols-2 gap-4 text-xs">
							{/* Driver Detail */}
							<div>
								<span className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Beneficiary Driver</span>
								<div className="font-semibold text-content-primary">{selectedPayout.driver_name}</div>
								<div className="font-mono text-content-tertiary">{selectedPayout.driver_phone}</div>
							</div>

							{/* Bank Info */}
							<div>
								<span className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Bank Destination</span>
								{selectedPayout.bank_name ? (
									<>
										<div className="font-semibold text-content-primary">{selectedPayout.bank_name}</div>
										<div className="font-mono text-content-tertiary">Acc: {selectedPayout.bank_account_number}</div>
										<div className="font-mono text-content-tertiary">IFSC: {selectedPayout.bank_ifsc}</div>
									</>
								) : (
									<div className="text-content-negative font-semibold">Missing Bank Details</div>
								)}
							</div>

							{/* Cost Breakdown */}
							<div className="col-span-2 bg-background-secondary p-3.5 rounded-lg space-y-2 font-mono">
								<span className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1.5 font-sans font-semibold">Financial Breakdown</span>
								<div className="flex justify-between">
									<span>Gross Amount:</span>
									<span>₹{(selectedPayout.amount_paise / 100).toFixed(2)}</span>
								</div>
								<div className="flex justify-between text-content-negative">
									<span>TDS Tax Deduction (1%):</span>
									<span>- ₹{(selectedPayout.tds_paise / 100).toFixed(2)}</span>
								</div>
								<div className="flex justify-between text-content-negative">
									<span>Professional Commission Fee:</span>
									<span>- ₹{(selectedPayout.professional_fees_paise / 100).toFixed(2)}</span>
								</div>
								<div className="border-t border-background-secondary pt-1.5 flex justify-between font-bold text-content-primary">
									<span>Net Settlement:</span>
									<span>₹{(selectedPayout.net_amount_paise / 100).toFixed(2)}</span>
								</div>
							</div>

							{/* Failure / Hold reasons */}
							{selectedPayout.failure_reason && (
								<div className="col-span-2 p-3 bg-surface-negative text-content-negative rounded-lg border border-negative-400">
									<span className="block text-[9px] uppercase tracking-wider font-semibold mb-1">Failure Log Reason</span>
									<p className="font-sans leading-snug">{selectedPayout.failure_reason}</p>
								</div>
							)}
							{selectedPayout.hold_reason && (
								<div className="col-span-2 p-3 bg-surface-accent text-content-accent rounded-lg border border-border-accent">
									<span className="block text-[9px] uppercase tracking-wider font-semibold mb-1">Hold Investigation Log</span>
									<p className="font-sans leading-snug">{selectedPayout.hold_reason}</p>
								</div>
							)}

							{/* Status */}
							<div>
								<span className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Payout Status</span>
								<span className={`inline-flex items-center text-[9px] font-bold border rounded-pill h-5 px-2 tracking-wider ${getStatusColor(selectedPayout.status)}`}>
									{selectedPayout.status}
								</span>
							</div>

							{/* Batch / Reference */}
							<div>
								<span className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1 font-semibold">Reference Parameters</span>
								<div className="font-mono text-content-primary">Batch: {selectedPayout.payout_batch_id || '—'}</div>
								<div className="font-mono text-content-primary">Ref: {selectedPayout.bank_reference || '—'}</div>
							</div>
						</div>

						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							{selectedPayout.status === 'HELD' && (
								<button
									onClick={() => { handleRelease(selectedPayout.id); }}
									className="px-4 py-1.5 border border-background-secondary hover:bg-background-secondary text-xs font-semibold rounded-pill"
								>
									Release Hold
								</button>
							)}
							{selectedPayout.status === 'PENDING' && (
								<button
									onClick={() => { setHoldPayoutId(selectedPayout.id); setSelectedPayout(null); }}
									className="px-4 py-1.5 border border-background-secondary hover:bg-background-secondary text-xs font-semibold rounded-pill"
								>
									Put On Hold
								</button>
							)}
							{selectedPayout.status === 'FAILED' && (
								<button
									onClick={() => { handleRetry(selectedPayout.id); }}
									className="px-4 py-1.5 bg-content-primary text-gray-0 text-xs font-semibold rounded-pill hover:bg-gray-800 transition"
								>
									Queue Retry
								</button>
							)}
							<button
								onClick={() => setSelectedPayout(null)}
								className="px-4 py-1.5 bg-background-secondary text-content-secondary hover:text-content-primary text-xs font-semibold rounded-pill transition"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ---- 2. Hold Reason Modal ---- */}
			{holdPayoutId && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<form onSubmit={handleHold} className="bg-background-primary rounded-xl border border-background-secondary p-5 max-w-md w-full space-y-4 shadow-2xl">
						<div>
							<h3 className="text-sm font-bold text-content-primary">Place Payout on Hold</h3>
							<p className="text-[11px] text-content-tertiary mt-1">Provide a compliance or fraud investigation reason code to lock this payout request.</p>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-content-tertiary mb-1.5 font-semibold">Hold Reason</label>
							<textarea
								required
								rows={3}
								placeholder="e.g. KYC audit failed, suspected duplicate bank details, or matching engine alert."
								className="w-full rounded bg-background-secondary border border-background-secondary p-2.5 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-sans leading-snug"
								value={holdReasonText}
								onChange={(e) => setHoldReasonText(e.target.value)}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-background-secondary pt-3">
							<button
								type="button"
								onClick={() => { setHoldPayoutId(null); setHoldReasonText(''); }}
								className="px-4 py-1.5 bg-background-secondary text-content-secondary hover:text-content-primary text-xs font-semibold rounded-pill transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-1.5 bg-content-primary text-gray-0 text-xs font-semibold rounded-pill hover:bg-gray-800 transition"
							>
								Lock Funds
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
};
