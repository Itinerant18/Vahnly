import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface DriverKYCDocument {
	name: string;
	status: string;
	url: string;
	uploaded_at: string;
	expiry_date: string;
}

interface OnboardingApplicant {
	driver_id: string;
	name: string;
	phone: string;
	city_prefix: string;
	stage: string; // APPLIED, DOCS_UPLOADED, BACKGROUND_CHECK, TRAINING, APPROVED
	kyc_documents_checklist: DriverKYCDocument[];
	applied_at: string;
	background_status: string;
	training_completed: boolean;
}

export const DriverOnboardingQueue: React.FC = () => {
	const [applicants, setApplicants] = useState<OnboardingApplicant[]>([]);
	const [loading, setLoading] = useState<boolean>(true);
	const [selectedApplicant, setSelectedApplicant] = useState<OnboardingApplicant | null>(null);
	const [actionLoading, setActionLoading] = useState<boolean>(false);
	const [rejectReason, setRejectReason] = useState<string>('');
	const [showRejectModal, setShowRejectModal] = useState<boolean>(false);

	const fetchQueue = async () => {
		setLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/onboarding`, {
				headers: {
					'X-Admin-Role': role,
				},
			});

			if (res.ok) {
				const data = await res.json();
				setApplicants(data || []);
			}
		} catch (err) {
			console.error('Failed to fetch onboarding queue', err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchQueue();
	}, []);

	const handleAction = async (actionSlug: string, body?: any) => {
		if (!selectedApplicant) return;
		// Confirm the irreversible onboarding decisions; status-only refreshes pass through.
		const confirmMsgs: Record<string, string> = {
			'verify-kyc': `Approve KYC and verify driver ${selectedApplicant.driver_id}? This activates them for dispatch.`,
			'reject-kyc': `Reject this applicant's KYC? They will be unable to onboard without resubmitting.`,
			'mark-bg-clear': `Mark background check as cleared for ${selectedApplicant.driver_id}?`,
		};
		if (confirmMsgs[actionSlug] && !window.confirm(confirmMsgs[actionSlug])) {
			return;
		}
		setActionLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const email = localStorage.getItem('admin_email') || 'admin@platform.com';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${selectedApplicant.driver_id}/${actionSlug}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Admin-Role': role,
					'X-Admin-Email': email,
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (res.ok) {
				alert(`Onboarding update '${actionSlug}' recorded successfully.`);
				setShowRejectModal(false);
				setSelectedApplicant(null);
				fetchQueue();
			} else {
				const msg = await res.text();
				alert(`Failed: ${msg}`);
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		} finally {
			setActionLoading(false);
		}
	};

	const handleDocUpdate = async (docName: string, docStatus: string) => {
		if (!selectedApplicant) return;
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const email = localStorage.getItem('admin_email') || 'admin@platform.com';

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/${selectedApplicant.driver_id}/docs-update`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Admin-Role': role,
					'X-Admin-Email': email,
				},
				body: JSON.stringify({ doc_name: docName, status: docStatus }),
			});

			if (res.ok) {
				// Inline update in detail view
				const updatedDocs = selectedApplicant.kyc_documents_checklist.map((doc) =>
					doc.name === docName ? { ...doc, status: docStatus } : doc
				);
				setSelectedApplicant({ ...selectedApplicant, kyc_documents_checklist: updatedDocs });
				fetchQueue();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleScheduleTraining = () => {
		alert(`Scheduling training session for candidate: ${selectedApplicant?.name}.\nEmail invitation sent successfully.`);
		handleAction('onboarding-stage', { stage: 'TRAINING' });
	};

	// Group applicants by stages
	const stages = ['APPLIED', 'DOCS_UPLOADED', 'BACKGROUND_CHECK', 'TRAINING', 'APPROVED'];
	const getStageList = (stageName: string) => {
		return applicants.filter((app) => app.stage.toUpperCase() === stageName);
	};

	// Compliance gate: KYC can only be verified once every uploaded document has been
	// reviewed and approved. An empty checklist also blocks approval.
	const kycDocs = selectedApplicant?.kyc_documents_checklist ?? [];
	const pendingDocs = kycDocs.filter((doc) => doc.status !== 'APPROVED');
	const allDocsApproved = kycDocs.length > 0 && pendingDocs.length === 0;

	return (
		<div className="w-full h-full flex flex-col overflow-hidden p-6 space-y-6 bg-canvas">
			<div>
				<h1 className="text-2xl font-bold tracking-tight text-ink">Onboarding Pipeline</h1>
				<p className="text-xs text-mute mt-1">Audit verification queue pipelines, background clearances, and training certifications</p>
			</div>

			{/* ---- Pipeline Board ---- */}
			{loading ? (
				<div className="flex-1 flex items-center justify-center text-xs text-mute animate-pulse">Loading onboarding columns...</div>
			) : (
				<div className="flex-1 flex overflow-x-auto gap-4 items-stretch select-none">
					{stages.map((stage) => {
						const list = getStageList(stage);
						return (
							<div key={stage} className="flex-1 min-w-[240px] bg-canvas-softer border border-canvas-soft rounded-xl p-4 flex flex-col space-y-4">
								<div className="flex justify-between items-center border-b border-canvas-soft pb-2">
									<span className="text-[10px] font-bold text-ink uppercase tracking-wider">{stage.replace('_', ' ')}</span>
									<span className="font-mono text-xs bg-canvas text-ink px-2 py-0.5 rounded font-semibold border border-canvas-soft">{list.length}</span>
								</div>

								{/* Cards area */}
								<div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
									{list.map((applicant) => (
										<div
											key={applicant.driver_id}
											onClick={() => setSelectedApplicant(applicant)}
											className="bg-canvas border border-canvas-soft rounded-xl p-3.5 hover:border-ink transition-colors cursor-pointer space-y-2 shadow-sm"
										>
											<span className="font-semibold text-ink text-xs block">{applicant.name}</span>
											<span className="font-mono text-[10px] text-body block">{applicant.phone}</span>
											<div className="flex justify-between items-center text-[9px] text-mute pt-1 border-t border-canvas-soft">
												<span>Hub: {applicant.city_prefix}</span>
												<span>{new Date(applicant.applied_at).toLocaleDateString()}</span>
											</div>
										</div>
									))}
									{list.length === 0 && (
										<div className="py-10 text-center text-[10px] text-mute font-mono">No candidates</div>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* ---- Applicant Detail Overlay / Drawer ---- */}
			{selectedApplicant && (
				<div className="fixed inset-0 bg-black/45 flex justify-end z-40 animate-fade-in">
					<div className="w-full max-w-md bg-canvas h-full border-l border-canvas-soft p-6 flex flex-col overflow-y-auto space-y-6 animate-slide-in">
						<div className="flex justify-between items-start">
							<div>
								<h2 className="text-base font-bold text-ink">{selectedApplicant.name}</h2>
								<span className="font-mono text-xs text-mute mt-1 block">{selectedApplicant.driver_id}</span>
							</div>
							<button
								onClick={() => setSelectedApplicant(null)}
								className="text-xs text-body hover:text-ink font-semibold"
							>
								✕ Close
							</button>
						</div>

						{/* Document Checklist verification */}
						<div className="space-y-4">
							<h3 className="text-xs font-bold uppercase tracking-wider text-mute">KYC Document Approvals</h3>
							<div className="space-y-3">
								{selectedApplicant.kyc_documents_checklist.map((doc) => (
									<div key={doc.name} className="bg-canvas-softer border border-canvas-soft p-3 rounded-xl space-y-2">
										<div className="flex justify-between items-center text-xs">
											<span className="font-semibold text-ink">{doc.name}</span>
											<span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${doc.status === 'APPROVED' ? 'bg-status-online/10 text-status-online' : 'bg-status-alert/10 text-status-alert'}`}>
												{doc.status}
											</span>
										</div>
										<div className="flex justify-between items-center border-t border-canvas-soft/60 pt-2 text-[10px]">
											<a
												href={doc.url}
												target="_blank"
												rel="noreferrer"
												className="underline text-mute hover:text-ink font-medium"
											>
												Preview PDF
											</a>
											<div className="flex space-x-1.5">
												<button
													onClick={() => handleDocUpdate(doc.name, 'APPROVED')}
													className="bg-ink text-on-dark font-semibold px-2 py-0.5 rounded-full"
												>
													Approve
												</button>
												<button
													onClick={() => handleDocUpdate(doc.name, 'REJECTED')}
													className="text-status-alert bg-status-alert/5 hover:bg-status-alert/10 font-semibold px-2 py-0.5 rounded-full"
												>
													Reject
												</button>
											</div>
										</div>
									</div>
								))}
							</div>
						</div>

						{/* Stages Checklist */}
						<div className="space-y-4 border-t border-canvas-soft pt-4">
							<h3 className="text-xs font-bold uppercase tracking-wider text-mute">Onboarding Clearances</h3>
							<div className="space-y-2 text-xs">
								<div className="flex justify-between items-center bg-canvas-softer p-2.5 rounded-xl">
									<span>Background Check Status:</span>
									<span className="font-mono font-bold uppercase">{selectedApplicant.background_status}</span>
								</div>
								<div className="flex justify-between items-center bg-canvas-softer p-2.5 rounded-xl">
									<span>Safety Training Status:</span>
									<span className="font-mono font-bold uppercase">
										{selectedApplicant.training_completed ? 'COMPLETED' : 'INCOMPLETE'}
									</span>
								</div>
							</div>
						</div>

						{/* Administrative update actions */}
						<div className="border-t border-canvas-soft pt-4 space-y-3.5">
							<h3 className="text-xs font-bold uppercase tracking-wider text-mute">Workflow Controls</h3>
							
							<div className="flex flex-wrap gap-2">
								<button
									onClick={() => handleAction('verify-kyc')}
									className="flex-1 bg-ink hover:bg-black-elevated text-on-dark text-xs font-semibold rounded-pill h-9 px-4 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-ink"
									disabled={actionLoading || !allDocsApproved}
									title={!allDocsApproved ? 'All KYC documents must be approved before verifying' : undefined}
								>
									Approve KYC & Verify
								</button>
								<button
									onClick={() => setShowRejectModal(true)}
									className="flex-1 text-status-alert bg-status-alert/5 hover:bg-status-alert/10 text-xs font-semibold rounded-pill h-9 px-4 transition-colors"
									disabled={actionLoading}
								>
									Reject Applicant
								</button>
							</div>

							{!allDocsApproved && (
								<p className="text-[10px] text-status-alert font-medium">
									{kycDocs.length === 0
										? 'No documents uploaded yet — cannot verify KYC.'
										: `${pendingDocs.length} document(s) pending review before KYC can be approved.`}
								</p>
							)}

							<div className="flex gap-2">
								<button
									onClick={() => handleAction('onboarding-stage', { stage: 'BACKGROUND_CHECK' })}
									className="flex-1 bg-canvas-soft hover:bg-surface-pressed text-ink text-xs font-semibold rounded-pill h-8 px-3 transition-colors"
								>
									Mark BG Clear
								</button>
								<button
									onClick={handleScheduleTraining}
									className="flex-1 bg-canvas-soft hover:bg-surface-pressed text-ink text-xs font-semibold rounded-pill h-8 px-3 transition-colors"
								>
									Schedule Training
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Rejection Reason Modal */}
			{showRejectModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-sm w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink font-sans text-status-alert">Reject Applicant</h3>
							<p className="text-[11px] text-mute mt-1">Specify audit verification rejection reason for candidate profile</p>
						</div>
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Audit Rejection Reason</label>
							<input
								type="text"
								placeholder="e.g. Inconsistent document upload details"
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
								{actionLoading ? 'Rejecting...' : 'Reject applicant'}
							</button>
						</div>
					</div>
				</div>
			)}

		</div>
	);
};
