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

	const token = localStorage.getItem('admin_jwt_token') || '';
	const role = localStorage.getItem('admin_role') || 'ADMIN';
	const headers = {
		Authorization: `Bearer ${token}`,
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
		window.open(`${API_GATEWAY_BASE_URL}/api/v1/admin/finance/payouts/export-batch?Authorization=Bearer ${token}`);
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
			case 'PENDING': return 'text-amber-600 bg-amber-50 border-amber-200';
			case 'APPROVED': return 'text-emerald-700 bg-emerald-50 border-emerald-200';
			case 'PROCESSING': return 'text-blue-700 bg-blue-50 border-blue-200';
			case 'PAID': return 'text-slate-900 bg-slate-100 border-slate-300';
			case 'FAILED': return 'text-red-700 bg-red-50 border-red-200';
			case 'HELD': return 'text-purple-700 bg-purple-50 border-purple-200';
			default: return 'text-mute bg-canvas-soft border-canvas-soft';
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
		<div className="w-full h-full overflow-y-auto p-6 space-y-6 bg-canvas font-sans selection:bg-black selection:text-white">
			{/* ---- Header ---- */}
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
						Payouts & Settlements ({total})
						{loading && (
							<span className="inline-flex w-3.5 h-3.5 rounded-full border-2 border-canvas-soft border-t-ink animate-spin" />
						)}
					</h1>
					<p className="text-xs text-mute mt-1">Review driver bank verification parameters, hold funds, bulk-approve payouts, and export banking batches.</p>
				</div>
				<div className="flex gap-2">
					<button
						onClick={handleExportBatch}
						className="px-4 py-2 border border-canvas-soft bg-canvas hover:bg-canvas-soft text-ink rounded-pill text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
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
				<div className="bg-canvas border border-canvas-soft rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Pending Approvals</span>
					<span className="text-2xl font-bold font-mono text-ink mt-2">
						{payouts.filter(p => p.status === 'PENDING').length}
					</span>
					<span className="text-[10px] text-mute font-mono mt-1">Requires manual validation</span>
				</div>
				<div className="bg-canvas border border-canvas-soft rounded-xl p-5 flex flex-col justify-between shadow-sm font-semibold">
					<span className="text-[11px] font-semibold text-mute uppercase tracking-wider font-semibold text-emerald-700">Ready for Batch Export</span>
					<span className="text-2xl font-bold font-mono text-emerald-700 mt-2">
						{payouts.filter(p => p.status === 'APPROVED').length}
					</span>
					<span className="text-[10px] text-mute font-mono mt-1">Eligible, approved payout runs</span>
				</div>
				<div className="bg-canvas border border-canvas-soft rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Failed Settlements</span>
					<span className="text-2xl font-bold font-mono text-red-600 mt-2">
						{payouts.filter(p => p.status === 'FAILED').length}
					</span>
					<span className="text-[10px] text-mute font-mono mt-1">Requires review/bank retry</span>
				</div>
				<div className="bg-canvas border border-canvas-soft rounded-xl p-5 flex flex-col justify-between shadow-sm">
					<span className="text-[11px] font-semibold text-mute uppercase tracking-wider">Held Funds</span>
					<span className="text-2xl font-bold font-mono text-purple-700 mt-2">
						₹{((payouts.filter(p => p.status === 'HELD').reduce((acc, curr) => acc + curr.amount_paise, 0)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
					</span>
					<span className="text-[10px] text-mute font-mono mt-1">Flagged due to fraud/dispute</span>
				</div>
			</div>

			{/* ---- Tab Navigation & Filters ---- */}
			<div className="space-y-4">
				<div className="flex border-b border-canvas-soft bg-canvas-soft p-1 rounded-xl">
					{(['ALL', 'PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'HELD'] as TabType[]).map((tab) => (
						<button
							key={tab}
							onClick={() => {
								setActiveTab(tab);
								setPage(0);
								setSelectedIds([]);
							}}
							className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition ${
								activeTab === tab ? 'bg-canvas text-ink shadow-sm' : 'text-body hover:text-ink'
							}`}
						>
							{tab.toLowerCase()}
						</button>
					))}
				</div>

				<div className="bg-canvas border border-canvas-soft rounded-xl p-4 flex gap-3 shadow-sm items-center">
					<div className="flex-1">
						<input
							type="text"
							placeholder="Search Payout ID, Driver Name, or Batch Code..."
							className="w-full h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-mono"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
				</div>
			</div>

			{error && <div className="p-4 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">{error}</div>}

			{/* ---- Datagrid Table ---- */}
			<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
				<table className="w-full text-left border-collapse">
					<thead>
						<tr className="bg-canvas-soft border-b border-canvas-soft">
							{activeTab === 'PENDING' && (
								<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute w-10">
									<input
										type="checkbox"
										className="w-3.5 h-3.5 rounded border-canvas-soft text-ink focus:ring-0 focus:outline-none cursor-pointer"
										checked={selectedIds.length > 0 && selectedIds.length === payouts.filter(p => p.status === 'PENDING').length}
										onChange={toggleSelectAll}
									/>
								</th>
							)}
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Payout ID</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Driver Partner</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-center">Eligibility Checks</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Gross Amount</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Deductions (TDS+Fees)</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right font-semibold">Net Settlement</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-center">Status</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Batch ID</th>
							<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Actions</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-canvas-soft text-xs">
						{loading ? (
							<tr>
								<td colSpan={activeTab === 'PENDING' ? 10 : 9} className="p-8 text-center text-mute animate-pulse">Loading settlements queue...</td>
							</tr>
						) : payouts.length === 0 ? (
							<tr>
								<td colSpan={activeTab === 'PENDING' ? 10 : 9} className="p-8 text-center text-mute font-medium">No payouts matching filter parameters</td>
							</tr>
						) : (
							payouts.map((p) => {
								const elig = checkEligibility(p);
								const isSelected = selectedIds.includes(p.id);

								return (
									<tr
										key={p.id}
										className={`hover:bg-canvas-softer cursor-pointer transition-colors ${
											isSelected ? 'bg-canvas-softer/50' : ''
										}`}
										onClick={() => setSelectedPayout(p)}
									>
										{activeTab === 'PENDING' && (
											<td className="p-3" onClick={(e) => e.stopPropagation()}>
												<input
													type="checkbox"
													className="w-3.5 h-3.5 rounded border-canvas-soft text-ink focus:ring-0 focus:outline-none cursor-pointer"
													checked={isSelected}
													onChange={() => toggleSelect(p.id)}
												/>
											</td>
										)}
										<td className="p-3 font-mono text-ink font-semibold">{p.id}</td>
										<td className="p-3">
											<div className="font-semibold text-ink">{p.driver_name}</div>
											<div className="text-[10px] text-mute font-mono">{p.driver_phone}</div>
										</td>
										<td className="p-3" onClick={(e) => e.stopPropagation()}>
											<div className="flex justify-center gap-1">
												<span
													title={elig.kyc ? "KYC Complete" : "KYC Pending"}
													className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
														elig.kyc ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
													}`}
												>
													K
												</span>
												<span
													title={elig.bank ? "Bank Verified" : "Bank Unverified"}
													className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
														elig.bank ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
													}`}
												>
													B
												</span>
												<span
													title={elig.hold ? "No Payout Holds" : "Payout On Hold"}
													className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
														elig.hold ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800'
													}`}
												>
													H
												</span>
											</div>
										</td>
										<td className="p-3 font-mono text-right text-mute">₹{(p.amount_paise / 100).toFixed(2)}</td>
										<td className="p-3 font-mono text-right text-mute">
											₹{((p.tds_paise + p.professional_fees_paise) / 100).toFixed(2)}
											<span className="text-[9px] text-mute block">
												(₹{(p.tds_paise / 100).toFixed(0)} + ₹{(p.professional_fees_paise / 100).toFixed(0)})
											</span>
										</td>
										<td className="p-3 font-mono text-right font-bold text-ink">₹{(p.net_amount_paise / 100).toFixed(2)}</td>
										<td className="p-3 text-center">
											<span className={`inline-flex items-center text-[9px] font-bold border rounded-pill h-5 px-2 tracking-wider ${getStatusColor(p.status)}`}>
												{p.status}
											</span>
										</td>
										<td className="p-3 font-mono text-mute">{p.payout_batch_id || '—'}</td>
										<td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
											<div className="flex gap-1.5 justify-end">
												{p.status === 'PENDING' && (
													<button
														onClick={() => setHoldPayoutId(p.id)}
														className="px-2.5 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded text-[10px] font-bold border border-purple-200 transition"
													>
														Hold
													</button>
												)}
												{p.status === 'HELD' && (
													<button
														onClick={() => handleRelease(p.id)}
														className="px-2.5 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-[10px] font-bold border border-emerald-200 transition"
													>
														Release
													</button>
												)}
												{p.status === 'FAILED' && (
													<button
														onClick={() => handleRetry(p.id)}
														className="px-2.5 py-1 bg-ink text-on-dark rounded text-[10px] font-bold hover:bg-black-elevated transition"
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
				<div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink text-on-dark px-6 py-3.5 rounded-xl flex items-center gap-6 shadow-2xl z-40 animate-fade-in border border-black-elevated">
					<span className="text-xs font-semibold">{selectedIds.length} Payout Request(s) selected</span>
					<div className="flex gap-2.5">
						<button
							onClick={handleBulkApprove}
							disabled={bulkProcessing}
							className="px-4 py-1.5 bg-canvas hover:bg-canvas-soft text-ink text-xs font-bold rounded-pill shadow-sm disabled:opacity-50"
						>
							{bulkProcessing ? 'Approving...' : 'Approve Selected'}
						</button>
						<button
							onClick={() => setSelectedIds([])}
							className="px-3 py-1.5 hover:bg-white/10 text-on-dark text-xs font-semibold rounded-pill transition"
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* ---- 1. Detail Slide-over / Modal ---- */}
			{selectedPayout && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-lg w-full space-y-4 shadow-2xl">
						<div className="border-b border-canvas-soft pb-3 flex justify-between items-start">
							<div>
								<h3 className="text-sm font-bold text-ink">Payout Settlement Request</h3>
								<span className="text-[10px] text-mute font-mono block mt-0.5">{selectedPayout.id}</span>
							</div>
							<button onClick={() => setSelectedPayout(null)} className="text-mute hover:text-ink text-sm font-bold">✕</button>
						</div>

						<div className="grid grid-cols-2 gap-4 text-xs">
							{/* Driver Detail */}
							<div>
								<span className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Beneficiary Driver</span>
								<div className="font-semibold text-ink">{selectedPayout.driver_name}</div>
								<div className="font-mono text-mute">{selectedPayout.driver_phone}</div>
							</div>

							{/* Bank Info */}
							<div>
								<span className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Bank Destination</span>
								{selectedPayout.bank_name ? (
									<>
										<div className="font-semibold text-ink">{selectedPayout.bank_name}</div>
										<div className="font-mono text-mute">Acc: {selectedPayout.bank_account_number}</div>
										<div className="font-mono text-mute">IFSC: {selectedPayout.bank_ifsc}</div>
									</>
								) : (
									<div className="text-red-600 font-semibold">Missing Bank Details</div>
								)}
							</div>

							{/* Cost Breakdown */}
							<div className="col-span-2 bg-canvas-soft p-3.5 rounded-lg space-y-2 font-mono">
								<span className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-sans font-semibold">Financial Breakdown</span>
								<div className="flex justify-between">
									<span>Gross Amount:</span>
									<span>₹{(selectedPayout.amount_paise / 100).toFixed(2)}</span>
								</div>
								<div className="flex justify-between text-red-700">
									<span>TDS Tax Deduction (1%):</span>
									<span>- ₹{(selectedPayout.tds_paise / 100).toFixed(2)}</span>
								</div>
								<div className="flex justify-between text-red-700">
									<span>Professional Commission Fee:</span>
									<span>- ₹{(selectedPayout.professional_fees_paise / 100).toFixed(2)}</span>
								</div>
								<div className="border-t border-canvas-soft pt-1.5 flex justify-between font-bold text-ink">
									<span>Net Settlement:</span>
									<span>₹{(selectedPayout.net_amount_paise / 100).toFixed(2)}</span>
								</div>
							</div>

							{/* Failure / Hold reasons */}
							{selectedPayout.failure_reason && (
								<div className="col-span-2 p-3 bg-red-50 text-red-700 rounded-lg border border-red-200">
									<span className="block text-[9px] uppercase tracking-wider font-semibold mb-1">Failure Log Reason</span>
									<p className="font-sans leading-snug">{selectedPayout.failure_reason}</p>
								</div>
							)}
							{selectedPayout.hold_reason && (
								<div className="col-span-2 p-3 bg-purple-50 text-purple-700 rounded-lg border border-purple-200">
									<span className="block text-[9px] uppercase tracking-wider font-semibold mb-1">Hold Investigation Log</span>
									<p className="font-sans leading-snug">{selectedPayout.hold_reason}</p>
								</div>
							)}

							{/* Status */}
							<div>
								<span className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Payout Status</span>
								<span className={`inline-flex items-center text-[9px] font-bold border rounded-pill h-5 px-2 tracking-wider ${getStatusColor(selectedPayout.status)}`}>
									{selectedPayout.status}
								</span>
							</div>

							{/* Batch / Reference */}
							<div>
								<span className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Reference Parameters</span>
								<div className="font-mono text-ink">Batch: {selectedPayout.payout_batch_id || '—'}</div>
								<div className="font-mono text-ink">Ref: {selectedPayout.bank_reference || '—'}</div>
							</div>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							{selectedPayout.status === 'HELD' && (
								<button
									onClick={() => { handleRelease(selectedPayout.id); }}
									className="px-4 py-1.5 border border-canvas-soft hover:bg-canvas-soft text-xs font-semibold rounded-pill"
								>
									Release Hold
								</button>
							)}
							{selectedPayout.status === 'PENDING' && (
								<button
									onClick={() => { setHoldPayoutId(selectedPayout.id); setSelectedPayout(null); }}
									className="px-4 py-1.5 border border-canvas-soft hover:bg-canvas-soft text-xs font-semibold rounded-pill"
								>
									Put On Hold
								</button>
							)}
							{selectedPayout.status === 'FAILED' && (
								<button
									onClick={() => { handleRetry(selectedPayout.id); }}
									className="px-4 py-1.5 bg-ink text-on-dark text-xs font-semibold rounded-pill hover:bg-black-elevated transition"
								>
									Queue Retry
								</button>
							)}
							<button
								onClick={() => setSelectedPayout(null)}
								className="px-4 py-1.5 bg-canvas-soft text-body hover:text-ink text-xs font-semibold rounded-pill transition"
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
					<form onSubmit={handleHold} className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-2xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Place Payout on Hold</h3>
							<p className="text-[11px] text-mute mt-1">Provide a compliance or fraud investigation reason code to lock this payout request.</p>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-semibold">Hold Reason</label>
							<textarea
								required
								rows={3}
								placeholder="e.g. KYC audit failed, suspected duplicate bank details, or matching engine alert."
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2.5 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-sans leading-snug"
								value={holdReasonText}
								onChange={(e) => setHoldReasonText(e.target.value)}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								type="button"
								onClick={() => { setHoldPayoutId(null); setHoldReasonText(''); }}
								className="px-4 py-1.5 bg-canvas-soft text-body hover:text-ink text-xs font-semibold rounded-pill transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-1.5 bg-ink text-on-dark text-xs font-semibold rounded-pill hover:bg-black-elevated transition"
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
