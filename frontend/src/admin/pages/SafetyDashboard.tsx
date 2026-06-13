import React, { useState, useEffect, useRef } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface SOSAlert {
	id: string;
	trip_id: string;
	reporter_type: 'RIDER' | 'DRIVER' | 'SYSTEM';
	status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
	assigned_agent_id?: string | null;
	assigned_agent_name?: string | null;
	audio_stream_url?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	emergency_contacts_notified: boolean;
	authorities_dispatched: boolean;
	notes?: string | null;
	created_at: string;
	updated_at: string;
	resolved_at?: string | null;
}

interface SafetyIncident {
	id: string;
	sos_alert_id?: string | null;
	trip_id: string;
	category: 'ACCIDENT' | 'HARASSMENT' | 'THEFT' | 'RASH_DRIVING' | 'VEHICLE_ISSUE' | 'OTHER';
	reporter_id: string;
	reporter_type: 'RIDER' | 'DRIVER' | 'SYSTEM';
	description: string;
	status: 'OPEN' | 'UNDER_INVESTIGATION' | 'RESOLVED' | 'CLOSED';
	evidence_urls: string[];
	outcome_type?: string | null;
	outcome_details?: string | null;
	d4m_care_claim_id?: string | null;
	d4m_care_claim_status: 'NOT_FILED' | 'FILED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
	d4m_care_claim_amount_paise: number;
	assigned_agent_id?: string | null;
	assigned_agent_name?: string | null;
	created_at: string;
	updated_at: string;
	resolved_at?: string | null;
}

interface RideCheckAnomaly {
	id: number;
	trip_id: string;
	anomaly_type: 'LONG_STOP' | 'OFF_ROUTE' | 'SUDDEN_SPEED_CHANGE';
	description: string;
	severity: 'LOW' | 'MEDIUM' | 'HIGH';
	latitude?: number | null;
	longitude?: number | null;
	status: 'PENDING' | 'DISMISSED' | 'ESCALATED_TO_SOS';
	created_at: string;
}

interface BlacklistEntry {
	id: number;
	user_id: string;
	user_type: 'RIDER' | 'DRIVER';
	block_type: 'GLOBAL' | 'MUTUAL';
	target_user_id?: string | null;
	target_user_type?: string | null;
	reason: string;
	created_at: string;
	created_by?: string | null;
	created_by_name?: string | null;
}

type SafetyTab = 'SOS' | 'INCIDENTS' | 'ANOMALIES' | 'BLACKLIST';

/* ─── DS4 helpers ────────────────────────────────────────────────────── */
const thCls = 'p-4 text-label-small uppercase tracking-wider text-content-tertiary font-semibold';
const tdCls = 'p-4 text-paragraph-small text-content-primary';

function incidentBadge(category: string) {
	switch (category) {
		case 'ACCIDENT':
		case 'HARASSMENT': return 'badge badge-negative';
		case 'VEHICLE_ISSUE':
		case 'RASH_DRIVING': return 'badge badge-warning';
		default: return 'badge badge-neutral';
	}
}

function severityBadge(severity: string) {
	if (severity === 'HIGH') return 'badge badge-negative';
	if (severity === 'MEDIUM') return 'badge badge-warning';
	return 'badge badge-accent';
}

function anomalyStatusBadge(status: string) {
	if (status === 'PENDING') return 'badge badge-warning';
	if (status === 'ESCALATED_TO_SOS') return 'badge badge-negative';
	return 'badge badge-neutral';
}

function sosBadge(status: string) {
	if (status === 'ACTIVE') return 'badge badge-negative';
	if (status === 'ACKNOWLEDGED') return 'badge badge-warning';
	return 'badge badge-positive';
}

function incidentStatusBadge(status: string) {
	if (status === 'RESOLVED' || status === 'CLOSED') return 'badge badge-positive';
	if (status === 'UNDER_INVESTIGATION') return 'badge badge-warning';
	return 'badge badge-accent';
}

export const SafetyDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<SafetyTab>('SOS');

	const [sosAlerts, setSosAlerts] = useState<SOSAlert[]>([]);
	const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
	const [anomalies, setAnomalies] = useState<RideCheckAnomaly[]>([]);
	const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);

	const [selectedSos, setSelectedSos] = useState<SOSAlert | null>(null);
	const [selectedIncident, setSelectedIncident] = useState<SafetyIncident | null>(null);

	const [sosNotes, setSosNotes] = useState<string>('');
	const [incidentOutcomeType, setIncidentOutcomeType] = useState<string>('WARNING');
	const [incidentOutcomeDetails, setIncidentOutcomeDetails] = useState<string>('');
	const [claimStatus, setClaimStatus] = useState<string>('FILED');
	const [claimAmountRupees, setClaimAmountRupees] = useState<string>('');

	const [showAddBlockModal, setShowAddBlockModal] = useState<boolean>(false);
	const [newBlockForm, setNewBlockForm] = useState({
		user_id: '', user_type: 'DRIVER', block_type: 'GLOBAL', target_user_id: '', target_user_type: 'RIDER', reason: '',
	});

	const [isDialing, setIsDialing] = useState<boolean>(false);
	const [dialLabel, setDialLabel] = useState<string>('');
	const [dialDuration, setDialDuration] = useState<number>(0);
	const [simulating, setSimulating] = useState<boolean>(false);

	const adminRole = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
	const adminId = '255e9024-d123-4063-9c6f-1662b7f2e8a5';
	const headers = { 'X-Admin-Role': adminRole, 'X-Admin-ID': adminId, 'Content-Type': 'application/json' };

	const audioIntervalRef = useRef<any>(null);
	const [waveHeights, setWaveHeights] = useState<number[]>([12, 18, 8, 22, 14, 28, 10, 16, 20, 12, 6, 18, 14, 24, 8]);

	const startAudioVisualizer = () => {
		if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
		audioIntervalRef.current = setInterval(() => {
			setWaveHeights((prev) => prev.map(() => Math.floor(Math.random() * 24) + 6));
		}, 180);
	};

	const stopAudioVisualizer = () => {
		if (audioIntervalRef.current) { clearInterval(audioIntervalRef.current); audioIntervalRef.current = null; }
		setWaveHeights([12, 18, 8, 22, 14, 28, 10, 16, 20, 12, 6, 18, 14, 24, 8]);
	};

	const fetchSOS = async () => {
		try { const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos`, { headers }); if (res.ok) setSosAlerts(await res.json()); }
		catch (err) { console.error('Failed fetching SOS alerts:', err); }
	};
	const fetchIncidents = async () => {
		try { const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents`, { headers }); if (res.ok) setIncidents(await res.json()); }
		catch (err) { console.error('Failed fetching incidents:', err); }
	};
	const fetchAnomalies = async () => {
		try { const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/anomalies`, { headers }); if (res.ok) setAnomalies(await res.json()); }
		catch (err) { console.error('Failed fetching anomalies:', err); }
	};
	const fetchBlacklist = async () => {
		try { const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/blacklist`, { headers }); if (res.ok) setBlacklist(await res.json()); }
		catch (err) { console.error('Failed fetching blacklist:', err); }
	};
	const reloadAll = () => { fetchSOS(); fetchIncidents(); fetchAnomalies(); fetchBlacklist(); };

	useEffect(() => { reloadAll(); }, []);

	useEffect(() => {
		let timer: any;
		if (isDialing) { timer = setInterval(() => setDialDuration((prev) => prev + 1), 1000); }
		return () => clearInterval(timer);
	}, [isDialing]);

	const handleAcknowledgeSos = async (id: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos/${id}/acknowledge`, { method: 'POST', headers });
			if (res.ok) { fetchSOS(); if (selectedSos?.id === id) setSelectedSos((prev) => prev ? { ...prev, status: 'ACKNOWLEDGED' } : null); }
		} catch (err) { console.error(err); }
	};

	const handleResolveSos = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedSos) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos/${selectedSos.id}/resolve`, {
				method: 'POST', headers, body: JSON.stringify({ notes: sosNotes }),
			});
			if (res.ok) { setSosNotes(''); setSelectedSos(null); fetchSOS(); }
		} catch (err) { console.error(err); }
	};

	const handleSosAction = async (action: string) => {
		if (!selectedSos) return;
		const confirmMsgs: Record<string, string> = {
			DISPATCH_AUTHORITIES: 'Dispatch police/authorities for this SOS? This escalates to emergency services.',
			NOTIFY_CONTACTS: "Notify the user's emergency contacts about this incident?",
		};
		if (confirmMsgs[action] && !window.confirm(confirmMsgs[action])) return;
		if (action === 'DIAL_RIDER' || action === 'DIAL_DRIVER') {
			setDialLabel(action === 'DIAL_RIDER' ? 'Rider Emergency Contact' : 'Driver Partner Line');
			setIsDialing(true); setDialDuration(0); startAudioVisualizer();
		}
		try {
			await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos/${selectedSos.id}/actions`, {
				method: 'POST', headers, body: JSON.stringify({ action_type: action }),
			});
			fetchSOS();
			setSelectedSos((prev) => {
				if (!prev) return null;
				if (action === 'DISPATCH_AUTHORITIES') return { ...prev, authorities_dispatched: true };
				if (action === 'NOTIFY_CONTACTS') return { ...prev, emergency_contacts_notified: true };
				return prev;
			});
		} catch (err) { console.error(err); }
	};

	const handleHangUp = () => { setIsDialing(false); stopAudioVisualizer(); };

	const handleResolveIncidentOutcome = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedIncident) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents/${selectedIncident.id}/outcome`, {
				method: 'POST', headers, body: JSON.stringify({ outcome_type: incidentOutcomeType, outcome_details: incidentOutcomeDetails, agent_id: adminId }),
			});
			if (res.ok) {
				setIncidentOutcomeDetails(''); fetchIncidents(); fetchBlacklist();
				const detailRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents/${selectedIncident.id}`, { headers });
				if (detailRes.ok) setSelectedIncident(await detailRes.json());
			}
		} catch (err) { console.error(err); }
	};

	const handleProcessClaim = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedIncident) return;
		const amountPaise = Math.round(parseFloat(claimAmountRupees || '0') * 100);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents/${selectedIncident.id}/claim`, {
				method: 'POST', headers, body: JSON.stringify({ claim_status: claimStatus, claim_amount_paise: amountPaise }),
			});
			if (res.ok) {
				setClaimAmountRupees(''); fetchIncidents();
				const detailRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents/${selectedIncident.id}`, { headers });
				if (detailRes.ok) setSelectedIncident(await detailRes.json());
			}
		} catch (err) { console.error(err); }
	};

	const handleResolveAnomaly = async (id: number, action: 'DISMISS' | 'ESCALATE_TO_SOS') => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/anomalies/${id}/resolve`, {
				method: 'POST', headers, body: JSON.stringify({ action }),
			});
			if (res.ok) { fetchAnomalies(); if (action === 'ESCALATE_TO_SOS') fetchSOS(); }
		} catch (err) { console.error(err); }
	};

	const handleAddBlacklist = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!window.confirm(`Deploy a ${newBlockForm.block_type} block on ${newBlockForm.user_type} ${newBlockForm.user_id}?\n\nThis blocks the user from the platform.`)) return;
		try {
			const payload: any = { user_id: newBlockForm.user_id, user_type: newBlockForm.user_type, block_type: newBlockForm.block_type, reason: newBlockForm.reason, created_by: adminId };
			if (newBlockForm.block_type === 'MUTUAL') { payload.target_user_id = newBlockForm.target_user_id; payload.target_user_type = newBlockForm.target_user_type; }
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/blacklist`, { method: 'POST', headers, body: JSON.stringify(payload) });
			if (res.ok) {
				setShowAddBlockModal(false);
				setNewBlockForm({ user_id: '', user_type: 'DRIVER', block_type: 'GLOBAL', target_user_id: '', target_user_type: 'RIDER', reason: '' });
				fetchBlacklist();
			}
		} catch (err) { console.error(err); }
	};

	const handleRemoveBlacklist = async (id: number) => {
		if (!confirm('Are you sure you want to lift this block?')) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/blacklist/${id}`, { method: 'DELETE', headers });
			if (res.ok) fetchBlacklist();
		} catch (err) { console.error(err); }
	};

	const triggerSimulateSos = async () => {
		setSimulating(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos`, {
				method: 'POST', headers,
				body: JSON.stringify({ trip_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', reporter_type: 'RIDER', latitude: 22.5726, longitude: 88.3639, notes: 'SIMULATION: Automated SOS triggered by Rider in-app panic key.' }),
			});
			if (res.ok) { alert('Simulated SOS triggered successfully in active queue.'); fetchSOS(); }
		} catch (err) { console.error(err); } finally { setSimulating(false); }
	};

	const triggerSimulateIncident = async () => {
		setSimulating(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents`, {
				method: 'POST', headers,
				body: JSON.stringify({ trip_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', category: 'RASH_DRIVING', reporter_id: '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c', reporter_type: 'RIDER', description: 'SIMULATION: Customer reported driver driving on sidewalks and running red lights in salt lake grid.', evidence_urls: ['https://platform-safety-recordings.s3.amazonaws.com/sim/evidence_dashcam.jpg'] }),
			});
			if (res.ok) { alert('Simulated Incident reported and queued in investigations.'); fetchIncidents(); }
		} catch (err) { console.error(err); } finally { setSimulating(false); }
	};

	const formatDuration = (sec: number): string => {
		const mins = Math.floor(sec / 60);
		const secs = sec % 60;
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	};

	const tabDef: { key: SafetyTab; label: string }[] = [
		{ key: 'SOS', label: 'Live SOS alerts' },
		{ key: 'INCIDENTS', label: 'Incidents & claims' },
		{ key: 'ANOMALIES', label: 'Ride anomalies' },
		{ key: 'BLACKLIST', label: 'Blacklist blocks' },
	];

	return (
		<div className="w-full h-full flex flex-col bg-background-primary text-content-primary font-sans">
			{/* ─── Header ──────────────────────────────────────────────── */}
			<header className="h-[72px] min-h-[72px] border-b border-border-opaque flex justify-between items-center px-6 bg-background-primary">
				<div className="flex items-center gap-6">
					<h1 className="text-heading-large text-content-primary">Safety Command Center</h1>
					<nav className="flex bg-background-secondary p-1 rounded-pill gap-0.5">
						{tabDef.map((tab) => (
							<button
								key={tab.key}
								onClick={() => { setActiveTab(tab.key); setSelectedSos(null); setSelectedIncident(null); }}
								className={`px-4 py-1.5 rounded-pill text-label-small font-semibold tracking-wide transition-base ${
									activeTab === tab.key ? 'bg-interactive-primary text-interactive-primary-text shadow-sm' : 'text-content-secondary hover:text-content-primary'
								}`}
							>
								{tab.label}
							</button>
						))}
					</nav>
				</div>

				{import.meta.env.DEV && (
					<div className="flex items-center gap-2">
						<span className="text-label-small uppercase font-bold text-content-tertiary mr-1 font-mono">Simulation Tools:</span>
						<button
							onClick={triggerSimulateSos}
							disabled={simulating}
							className="bg-surface-negative hover:bg-negative-100 text-content-negative border border-negative-200 text-label-small font-bold px-3 py-1.5 rounded-sm transition-base disabled:opacity-50"
						>
							Trigger Simulated SOS
						</button>
						<button
							onClick={triggerSimulateIncident}
							disabled={simulating}
							className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque text-label-small font-bold px-3 py-1.5 rounded-sm transition-base disabled:opacity-50"
						>
							File Post-Trip Incident
						</button>
					</div>
				)}
			</header>

			{/* ─── Tab Panels ──────────────────────────────────────────── */}
			<div className="flex-1 overflow-hidden">
				{/* ══════════════════════════════════════════════════════ */}
				{/* 1. LIVE SOS ALERTS                                      */}
				{/* ══════════════════════════════════════════════════════ */}
				{activeTab === 'SOS' && (
					<div className="w-full h-full flex divide-x divide-border-opaque">
						{/* SOS List */}
						<div className="w-[360px] min-w-[360px] h-full flex flex-col bg-background-primary">
							<div className="p-4 border-b border-border-opaque bg-background-secondary">
								<h2 className="text-label-small font-bold uppercase tracking-wider text-content-secondary">Emergency Response Queue</h2>
							</div>
							<div className="flex-1 overflow-y-auto divide-y divide-border-opaque">
								{sosAlerts.length === 0 ? (
									<div className="p-8 text-center text-paragraph-small text-content-tertiary font-medium">No active emergency alerts</div>
								) : (
									sosAlerts.map((sos) => {
										const isActive = sos.status === 'ACTIVE';
										const isSelected = selectedSos?.id === sos.id;
										return (
											<div
												key={sos.id}
												onClick={() => setSelectedSos(sos)}
												className={`p-4 cursor-pointer transition-base flex items-start gap-3 ${
													isActive
														? 'border-l-4 border-l-negative-400 bg-surface-negative'
														: `border-l-4 border-l-border-opaque bg-background-secondary ${isSelected ? 'bg-background-tertiary' : 'hover:bg-background-tertiary'}`
												}`}
											>
												<div className="flex-1 min-w-0 space-y-1.5">
													<div className="flex justify-between items-center">
														<span className="font-mono text-label-small font-bold text-content-tertiary truncate">{sos.id}</span>
														<div className="flex items-center gap-1.5">
															{isActive && <span className="w-2 h-2 rounded-full bg-negative-400 animate-pulse inline-block" />}
															<span className={sosBadge(sos.status)}>{sos.status}</span>
														</div>
													</div>
													<h4 className="text-label-medium font-bold text-content-primary truncate">Trip ID: {sos.trip_id.substring(0, 8)}...</h4>
													<p className="text-paragraph-small text-content-secondary line-clamp-2">{sos.notes || 'No description provided'}</p>
													<div className="flex justify-between items-center text-paragraph-small text-content-tertiary pt-1">
														<span>Triggered by: {sos.reporter_type}</span>
														<span>{new Date(sos.created_at).toLocaleTimeString()}</span>
													</div>
												</div>
											</div>
										);
									})
								)}
							</div>
						</div>

						{/* Detail Panel */}
						<div className="flex-1 h-full flex flex-col bg-background-secondary overflow-y-auto">
							{selectedSos ? (
								<div className="p-6 space-y-6 max-w-4xl">
									{/* Status banner */}
									<div className={`p-4 rounded-md border flex items-center justify-between ${
										selectedSos.status === 'ACTIVE'
											? 'bg-surface-negative border-negative-200 text-content-negative'
											: 'bg-background-primary border-border-opaque text-content-primary'
									}`}>
										<div className="space-y-1">
											<h3 className="text-label-large font-bold tracking-tight">
												{selectedSos.status === 'ACTIVE' ? '🔴 CRITICAL EMERGENCY: Panic Button Triggered' : 'SOS Case Review'}
											</h3>
											<p className="text-paragraph-small opacity-80">Alert ID: {selectedSos.id} | Trip: {selectedSos.trip_id}</p>
										</div>
										{selectedSos.status === 'ACTIVE' && (
											<button
												onClick={() => handleAcknowledgeSos(selectedSos.id)}
												className="btn-primary bg-negative-500 hover:bg-negative-600 border-0"
											>
												Acknowledge &amp; Investigate
											</button>
										)}
									</div>

									{/* Location / Audio grid */}
									<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
										<div className="md:col-span-2 card space-y-4">
											<h4 className="text-label-small font-bold uppercase tracking-wider text-content-secondary border-b border-border-opaque pb-2">Location &amp; Telemetry Map</h4>
											<div className="h-[220px] bg-background-secondary rounded-sm border border-border-opaque relative flex flex-col items-center justify-center overflow-hidden">
												<div className="z-10 text-center space-y-1.5 p-4">
													<div className="w-4 h-4 rounded-full bg-negative-400 animate-ping mx-auto" />
													<span className="text-label-small font-extrabold uppercase font-mono tracking-widest text-content-negative">Live Telemetry Fix</span>
													<p className="text-paragraph-small text-content-tertiary font-mono">Lat: {selectedSos.latitude || '22.5726'} | Lng: {selectedSos.longitude || '88.3639'}</p>
												</div>
												<div className="absolute bottom-2 right-2 bg-background-primary border border-border-opaque font-mono text-label-small px-2 py-0.5 rounded-sm uppercase font-bold text-content-secondary tracking-wider">
													Kolkata Shard
												</div>
											</div>
										</div>

										<div className="card space-y-4 flex flex-col justify-between">
											<div>
												<h4 className="text-label-small font-bold uppercase tracking-wider text-content-secondary border-b border-border-opaque pb-2">Audio Stream In-Vehicle</h4>
												{selectedSos.audio_stream_url ? (
													<div className="mt-4 space-y-3">
														<div className="h-10 flex items-center justify-center gap-1 bg-background-secondary rounded-sm border border-border-opaque px-4">
															{waveHeights.map((h, i) => (
																<div
																	key={i}
																	className={`w-0.5 rounded-full ${selectedSos.status === 'ACTIVE' ? 'bg-negative-400' : 'bg-border-opaque'}`}
																	style={{ height: `${h}px` }}
																/>
															))}
														</div>
														<p className="text-paragraph-small text-center text-content-tertiary font-semibold">Live audio stream active (24kbps OPUS)</p>
													</div>
												) : (
													<div className="mt-8 text-center text-paragraph-small text-content-tertiary font-medium py-4">No audio recording available for this alert.</div>
												)}
											</div>
											<div className="space-y-2 pt-4 border-t border-border-opaque">
												<div className="flex justify-between text-paragraph-small">
													<span className="text-content-secondary font-medium">Emergency Contacts Notified:</span>
													<span className={selectedSos.emergency_contacts_notified ? 'text-content-positive font-bold' : 'text-content-tertiary font-medium'}>
														{selectedSos.emergency_contacts_notified ? 'YES' : 'NO'}
													</span>
												</div>
												<div className="flex justify-between text-paragraph-small">
													<span className="text-content-secondary font-medium">Authorities Dispatched:</span>
													<span className={selectedSos.authorities_dispatched ? 'text-content-positive font-bold' : 'text-content-tertiary font-medium'}>
														{selectedSos.authorities_dispatched ? 'YES' : 'NO'}
													</span>
												</div>
											</div>
										</div>
									</div>

									{/* Action Console */}
									{selectedSos.status !== 'RESOLVED' && (
										<div className="card space-y-4">
											<h4 className="text-label-small font-bold uppercase tracking-wider text-content-secondary border-b border-border-opaque pb-2">Emergency Response Actions</h4>
											<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
												<button
													onClick={() => handleSosAction('DIAL_RIDER')}
													className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque text-content-primary text-label-small font-bold py-2.5 rounded-sm transition-base"
												>
													📞 Call Rider
												</button>
												<button
													onClick={() => handleSosAction('DIAL_DRIVER')}
													className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque text-content-primary text-label-small font-bold py-2.5 rounded-sm transition-base"
												>
													📞 Call Driver
												</button>
												<button
													onClick={() => handleSosAction('DISPATCH_AUTHORITIES')}
													disabled={selectedSos.authorities_dispatched}
													className="bg-negative-500 hover:bg-negative-600 disabled:bg-background-secondary text-white disabled:text-content-tertiary disabled:border disabled:border-border-opaque text-label-small font-bold py-2.5 rounded-sm transition-base"
												>
													🚨 Dispatch Police
												</button>
												<button
													onClick={() => handleSosAction('NOTIFY_CONTACTS')}
													disabled={selectedSos.emergency_contacts_notified}
													className="btn-primary disabled:bg-background-secondary disabled:text-content-tertiary disabled:border disabled:border-border-opaque py-2.5"
												>
													✉️ Alert Contacts
												</button>
											</div>
										</div>
									)}

									{/* Resolve form */}
									{selectedSos.status !== 'RESOLVED' ? (
										<div className="card space-y-4">
											<h4 className="text-label-small font-bold uppercase tracking-wider text-content-secondary border-b border-border-opaque pb-2">Resolve Emergency Case</h4>
											<form onSubmit={handleResolveSos} className="space-y-4">
												<div>
													<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Post-Incident Report / Resolution Notes</label>
													<textarea
														value={sosNotes}
														onChange={(e) => setSosNotes(e.target.value)}
														required
														placeholder="Enter detailed outcome notes. What was the incident? Were emergency services required? What actions were taken?"
														className="w-full h-24 bg-background-secondary border border-border-opaque focus:border-accent-400 rounded-sm p-3 text-paragraph-small text-content-primary placeholder:text-content-tertiary focus:outline-none resize-none transition-base"
													/>
												</div>
												<div className="flex justify-end">
													<button type="submit" className="btn-primary bg-positive-500 hover:bg-positive-600 border-0">
														✅ Resolve Alert &amp; Close Case
													</button>
												</div>
											</form>
										</div>
									) : (
										<div className="card space-y-3">
											<h4 className="text-label-small font-bold uppercase tracking-wider text-content-secondary border-b border-border-opaque pb-2">Case Resolution Details</h4>
											<div className="flex justify-between text-paragraph-small pt-1">
												<span className="font-semibold text-content-primary">Resolved At:</span>
												<span className="font-mono text-content-tertiary">{selectedSos.resolved_at ? new Date(selectedSos.resolved_at).toLocaleString() : 'N/A'}</span>
											</div>
											<div className="space-y-1.5 pt-2">
												<span className="font-bold text-content-primary uppercase tracking-wider text-label-small">Notes:</span>
												<p className="p-3 bg-background-secondary rounded-sm text-content-primary font-mono text-paragraph-small leading-relaxed border border-border-opaque">{selectedSos.notes}</p>
											</div>
										</div>
									)}
								</div>
							) : (
								<div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-content-tertiary select-none">
									<span className="text-4xl mb-2">🛡️</span>
									<p className="text-paragraph-small font-medium">Select an SOS emergency alert from the queue to investigate</p>
								</div>
							)}
						</div>
					</div>
				)}

				{/* ══════════════════════════════════════════════════════ */}
				{/* 2. INCIDENT REPORTS & CLAIMS                            */}
				{/* ══════════════════════════════════════════════════════ */}
				{activeTab === 'INCIDENTS' && (
					<div className="w-full h-full flex divide-x divide-border-opaque">
						{/* Incidents list */}
						<div className="w-[360px] min-w-[360px] h-full flex flex-col bg-background-primary">
							<div className="p-4 border-b border-border-opaque bg-background-secondary">
								<h2 className="text-label-small font-bold uppercase tracking-wider text-content-secondary">Investigation Reports</h2>
							</div>
							<div className="flex-1 overflow-y-auto divide-y divide-border-opaque">
								{incidents.length === 0 ? (
									<div className="p-8 text-center text-paragraph-small text-content-tertiary font-medium">No incident reports logged</div>
								) : incidents.map((inc) => {
									const isSelected = selectedIncident?.id === inc.id;
									return (
										<div
											key={inc.id}
											onClick={() => setSelectedIncident(inc)}
											className={`p-4 cursor-pointer transition-base flex flex-col gap-1.5 ${isSelected ? 'bg-background-secondary' : 'hover:bg-background-secondary'}`}
										>
											<div className="flex justify-between items-center">
												<span className="font-mono text-label-small font-bold text-content-tertiary">{inc.id}</span>
												<span className={incidentStatusBadge(inc.status)}>{inc.status}</span>
											</div>
											<h4 className="text-label-medium font-bold text-content-primary truncate">{inc.category.replace('_', ' ')}</h4>
											<p className="text-paragraph-small text-content-secondary line-clamp-2">{inc.description}</p>
											<div className="flex justify-between items-center text-paragraph-small text-content-tertiary pt-1">
												<span>Trip: {inc.trip_id.substring(0, 8)}...</span>
												<span>{new Date(inc.created_at).toLocaleDateString()}</span>
											</div>
										</div>
									);
								})}
							</div>
						</div>

						{/* Detail panel */}
						<div className="flex-1 h-full flex flex-col bg-background-secondary overflow-y-auto">
							{selectedIncident ? (
								<div className="p-6 space-y-6 max-w-4xl">
									<div className="card space-y-4">
										<div className="flex justify-between items-start border-b border-border-opaque pb-4">
											<div className="space-y-1">
												<h3 className="text-label-large font-bold tracking-tight uppercase text-content-primary">
													Incident Investigation: {selectedIncident.category.replace('_', ' ')}
												</h3>
												<p className="text-paragraph-small text-content-tertiary font-mono">Case ID: {selectedIncident.id} | Trip ID: {selectedIncident.trip_id}</p>
											</div>
											<div className="flex items-center gap-2">
												<span className={incidentBadge(selectedIncident.category)}>{selectedIncident.category.replace('_', ' ')}</span>
												<span className={incidentStatusBadge(selectedIncident.status)}>{selectedIncident.status}</span>
											</div>
										</div>

										<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-paragraph-small">
											<div>
												<span className="text-label-small text-content-tertiary font-bold uppercase tracking-wider block">Reporter</span>
												<span className="font-semibold text-content-primary">{selectedIncident.reporter_type} (UUID: {selectedIncident.reporter_id.substring(0, 8)}...)</span>
											</div>
											<div>
												<span className="text-label-small text-content-tertiary font-bold uppercase tracking-wider block">Incident Date</span>
												<span className="font-semibold text-content-primary">{new Date(selectedIncident.created_at).toLocaleString()}</span>
											</div>
											<div>
												<span className="text-label-small text-content-tertiary font-bold uppercase tracking-wider block">Claim Status</span>
												<span className="font-semibold text-content-primary">{selectedIncident.d4m_care_claim_status}</span>
											</div>
											<div>
												<span className="text-label-small text-content-tertiary font-bold uppercase tracking-wider block">Claim Amount</span>
												<span className="font-mono font-semibold text-content-primary">
													{selectedIncident.d4m_care_claim_amount_paise > 0 ? `₹${(selectedIncident.d4m_care_claim_amount_paise / 100).toLocaleString()}` : '₹0'}
												</span>
											</div>
										</div>

										<div className="space-y-1.5 pt-2">
											<span className="text-label-small text-content-tertiary font-bold uppercase tracking-wider block">Description of events</span>
											<p className="p-3 bg-background-secondary rounded-sm text-paragraph-small leading-relaxed text-content-primary border border-border-opaque">{selectedIncident.description}</p>
										</div>

										{selectedIncident.evidence_urls.length > 0 && (
											<div className="space-y-2">
												<span className="text-label-small text-content-tertiary font-bold uppercase tracking-wider block">Investigation Evidence</span>
												<div className="flex flex-wrap gap-3">
													{selectedIncident.evidence_urls.map((url, i) => (
														<a key={i} href={url} target="_blank" rel="noreferrer"
															className="inline-flex items-center gap-1.5 bg-background-secondary hover:bg-background-tertiary border border-border-opaque text-label-small font-bold px-3 py-2 rounded-sm transition-base font-mono text-content-primary">
															📁 {url.substring(url.lastIndexOf('/') + 1)}
														</a>
													))}
												</div>
											</div>
										)}
									</div>

									{/* D4M Care Claims */}
									<div className="card space-y-4">
										<h4 className="text-label-small font-bold uppercase tracking-wider text-content-secondary border-b border-border-opaque pb-2">🛡️ D4M Care Insurance Claims</h4>
										<form onSubmit={handleProcessClaim} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
											<div>
												<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Claim Status</label>
												<select value={claimStatus} onChange={(e) => setClaimStatus(e.target.value)} className="w-full h-9 bg-background-secondary border border-border-opaque rounded-sm px-2.5 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base">
													<option value="FILED">Filed</option>
													<option value="UNDER_REVIEW">Under Review</option>
													<option value="APPROVED">Approved</option>
													<option value="REJECTED">Rejected</option>
												</select>
											</div>
											<div>
												<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Claimed Amount (Rupees)</label>
												<input type="number" step="0.01" required placeholder="e.g. 5000.00" value={claimAmountRupees} onChange={(e) => setClaimAmountRupees(e.target.value)} className="w-full h-9 bg-background-secondary border border-border-opaque rounded-sm px-3 text-paragraph-small text-content-primary font-mono text-right placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" />
											</div>
											<button type="submit" className="btn-primary h-9">Update Claim Info</button>
										</form>
									</div>

									{/* Outcome */}
									{selectedIncident.status !== 'RESOLVED' && selectedIncident.status !== 'CLOSED' ? (
										<div className="card space-y-4">
											<h4 className="text-label-small font-bold uppercase tracking-wider text-content-secondary border-b border-border-opaque pb-2">Apply Resolution Outcome</h4>
											<form onSubmit={handleResolveIncidentOutcome} className="space-y-4">
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<div>
														<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Outcome action</label>
														<select value={incidentOutcomeType} onChange={(e) => setIncidentOutcomeType(e.target.value)} className="w-full h-9 bg-background-secondary border border-border-opaque rounded-sm px-2.5 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base font-semibold">
															<option value="WARNING">Issue Formal Warning</option>
															<option value="SUSPENSION">Temporary Suspension</option>
															<option value="BAN">🔴 Global Ban (Blacklist)</option>
															<option value="POLICE_CASE">Escalate to Police Case</option>
															<option value="INSURANCE_CLAIM">Process Insurance Claim</option>
															<option value="NO_ACTION">No Action / Dismiss Case</option>
														</select>
													</div>
												</div>
												<div>
													<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Investigation details / justification</label>
													<textarea required placeholder="Enter detailed outcome notes..." value={incidentOutcomeDetails} onChange={(e) => setIncidentOutcomeDetails(e.target.value)} className="w-full h-24 bg-background-secondary border border-border-opaque focus:border-accent-400 rounded-sm p-3 text-paragraph-small text-content-primary placeholder:text-content-tertiary focus:outline-none resize-none transition-base" />
												</div>
												<div className="flex justify-end">
													<button type="submit" className="btn-primary bg-positive-500 hover:bg-positive-600 border-0">Close Case &amp; Commit Outcome</button>
												</div>
											</form>
										</div>
									) : (
										<div className="card space-y-3">
											<h4 className="text-label-small font-bold uppercase tracking-wider text-content-secondary border-b border-border-opaque pb-2">Investigation Outcome Closed</h4>
											<div className="flex justify-between text-paragraph-small pt-1">
												<span className="font-semibold text-content-primary">Outcome:</span>
												<span className="badge badge-negative uppercase tracking-widest">{selectedIncident.outcome_type}</span>
											</div>
											<div className="space-y-1.5 pt-2">
												<span className="font-bold text-content-primary uppercase tracking-wider text-label-small">Justification &amp; details:</span>
												<p className="p-3 bg-background-secondary rounded-sm text-content-primary font-mono text-paragraph-small leading-relaxed border border-border-opaque">{selectedIncident.outcome_details}</p>
											</div>
										</div>
									)}
								</div>
							) : (
								<div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-content-tertiary select-none">
									<span className="text-3xl mb-2">📁</span>
									<p className="text-paragraph-small font-medium">Select an incident case file to review details and assign outcomes</p>
								</div>
							)}
						</div>
					</div>
				)}

				{/* ══════════════════════════════════════════════════════ */}
				{/* 3. RIDE CHECK ANOMALIES                                 */}
				{/* ══════════════════════════════════════════════════════ */}
				{activeTab === 'ANOMALIES' && (
					<div className="w-full h-full flex flex-col bg-background-primary p-6 overflow-y-auto">
						<div className="max-w-6xl space-y-4">
							<div className="flex justify-between items-center pb-2">
								<h2 className="text-label-large font-bold uppercase tracking-wider text-content-secondary">Live Ride Check Telemetry Anomalies</h2>
								<span className="text-paragraph-small text-content-tertiary font-mono bg-background-secondary border border-border-opaque px-3 py-1 rounded-sm">Polling real-time telemetry every 8s</span>
							</div>

							<div className="card overflow-hidden p-0">
								<table className="w-full text-left text-paragraph-small border-collapse">
									<thead>
										<tr className="bg-background-tertiary border-b border-border-opaque text-content-tertiary font-bold text-label-small uppercase tracking-wider">
											<th className={thCls}>ID</th>
											<th className={thCls}>Anomaly Type</th>
											<th className={thCls}>Trip ID</th>
											<th className={thCls}>Severity</th>
											<th className={thCls}>Description</th>
											<th className={thCls}>Status</th>
											<th className={`${thCls} text-right`}>Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-border-opaque font-mono">
										{anomalies.length === 0 ? (
											<tr><td colSpan={7} className="p-8 text-center text-paragraph-small text-content-tertiary font-medium">No telemetry anomalies flagged</td></tr>
										) : anomalies.map((anom) => (
											<tr key={anom.id} className="hover:bg-background-secondary transition-base">
												<td className={`${tdCls} font-bold`}>{anom.id}</td>
												<td className="p-4">
													<span className="badge badge-warning">{anom.anomaly_type.replace('_', ' ')}</span>
												</td>
												<td className="p-4 text-content-secondary">{anom.trip_id}</td>
												<td className="p-4"><span className={severityBadge(anom.severity)}>{anom.severity}</span></td>
												<td className="p-4 text-content-primary font-sans max-w-[280px] truncate">{anom.description}</td>
												<td className="p-4"><span className={anomalyStatusBadge(anom.status)}>{anom.status}</span></td>
												<td className="p-4 text-right space-x-1.5 font-sans">
													{anom.status === 'PENDING' && (
														<>
															<button onClick={() => handleResolveAnomaly(anom.id, 'DISMISS')} className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque text-label-small font-bold px-2 py-1 rounded-sm transition-base">Dismiss</button>
															<button onClick={() => handleResolveAnomaly(anom.id, 'ESCALATE_TO_SOS')} className="bg-negative-500 hover:bg-negative-600 text-white text-label-small font-bold px-2 py-1 rounded-sm transition-base">Escalate to SOS</button>
														</>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				)}

				{/* ══════════════════════════════════════════════════════ */}
				{/* 4. BLACKLIST BLOCKS                                     */}
				{/* ══════════════════════════════════════════════════════ */}
				{activeTab === 'BLACKLIST' && (
					<div className="w-full h-full flex flex-col bg-background-primary p-6 overflow-y-auto">
						<div className="max-w-6xl space-y-4">
							<div className="flex justify-between items-center pb-2">
								<h2 className="text-label-large font-bold uppercase tracking-wider text-content-secondary">Global &amp; Mutual Account Block Lists</h2>
								<button onClick={() => setShowAddBlockModal(true)} className="btn-primary">
									+ Deploy Blacklist Block
								</button>
							</div>

							<div className="card overflow-hidden p-0">
								<table className="w-full text-left text-paragraph-small border-collapse">
									<thead>
										<tr className="bg-background-tertiary border-b border-border-opaque text-content-tertiary font-bold text-label-small uppercase tracking-wider">
											<th className={thCls}>Blocked User</th>
											<th className={thCls}>Block Type</th>
											<th className={thCls}>Target (Mutual Block)</th>
											<th className={thCls}>Reason</th>
											<th className={thCls}>Created By</th>
											<th className={thCls}>Date Added</th>
											<th className={`${thCls} text-right`}>Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-border-opaque font-mono">
										{blacklist.length === 0 ? (
											<tr><td colSpan={7} className="p-8 text-center text-paragraph-small text-content-tertiary font-medium font-sans">No users blocked on blacklist</td></tr>
										) : blacklist.map((entry) => (
											<tr key={entry.id} className="hover:bg-background-secondary transition-base">
												<td className="p-4">
													<div className="flex flex-col">
														<span className="font-bold text-content-primary">{entry.user_id}</span>
														<span className="badge badge-neutral mt-1 w-fit">{entry.user_type}</span>
													</div>
												</td>
												<td className="p-4">
													<span className={entry.block_type === 'GLOBAL' ? 'badge badge-negative' : 'badge badge-warning'}>{entry.block_type}</span>
												</td>
												<td className="p-4">
													{entry.block_type === 'MUTUAL' && entry.target_user_id ? (
														<div className="flex flex-col">
															<span className="font-bold text-content-primary">{entry.target_user_id}</span>
															<span className="badge badge-neutral mt-1 w-fit">{entry.target_user_type}</span>
														</div>
													) : <span className="text-content-tertiary font-sans">-</span>}
												</td>
												<td className="p-4 text-content-primary font-sans max-w-[220px] truncate">{entry.reason}</td>
												<td className="p-4 font-sans text-content-secondary font-medium">{entry.created_by_name || 'System'}</td>
												<td className="p-4 text-content-secondary">{new Date(entry.created_at).toLocaleDateString()}</td>
												<td className="p-4 text-right font-sans">
													<button
														onClick={() => handleRemoveBlacklist(entry.id)}
														className="bg-surface-negative hover:bg-negative-100 text-content-negative border border-negative-200 text-label-small font-bold px-3 py-1.5 rounded-sm transition-base"
													>
														Lift Block
													</button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* ─── Create Block Modal ───────────────────────────────────── */}
			{showAddBlockModal && (
				<div className="fixed inset-0 bg-background-secondary0/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
					<div className="bg-background-primary border border-border-opaque rounded-md shadow-xl w-full max-w-md overflow-hidden">
						<div className="px-6 py-4 border-b border-border-opaque flex justify-between items-center bg-background-secondary">
							<h3 className="font-bold text-label-large text-content-primary uppercase tracking-wider">Deploy Blacklist Block</h3>
							<button onClick={() => setShowAddBlockModal(false)} className="text-content-secondary hover:text-content-primary text-label-small font-bold transition-base">✕</button>
						</div>
						<form onSubmit={handleAddBlacklist} className="p-6 space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div>
									<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">User type</label>
									<select value={newBlockForm.user_type} onChange={(e) => setNewBlockForm((prev) => ({ ...prev, user_type: e.target.value }))} className="w-full h-9 bg-background-secondary border border-border-opaque rounded-sm px-2 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base">
										<option value="DRIVER">Driver Partner</option>
										<option value="RIDER">Rider Customer</option>
									</select>
								</div>
								<div>
									<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Block type</label>
									<select value={newBlockForm.block_type} onChange={(e) => setNewBlockForm((prev) => ({ ...prev, block_type: e.target.value }))} className="w-full h-9 bg-background-secondary border border-border-opaque rounded-sm px-2 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base">
										<option value="GLOBAL">Global Account Ban</option>
										<option value="MUTUAL">Mutual Matching Block</option>
									</select>
								</div>
							</div>

							<div>
								<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">User account ID (UUID)</label>
								<input type="text" required placeholder="e.g. a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" value={newBlockForm.user_id} onChange={(e) => setNewBlockForm((prev) => ({ ...prev, user_id: e.target.value }))} className="w-full h-9 bg-background-secondary border border-border-opaque rounded-sm px-3 text-paragraph-small text-content-primary font-mono placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" />
							</div>

							{newBlockForm.block_type === 'MUTUAL' && (
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Target user type</label>
										<select value={newBlockForm.target_user_type} onChange={(e) => setNewBlockForm((prev) => ({ ...prev, target_user_type: e.target.value }))} className="w-full h-9 bg-background-secondary border border-border-opaque rounded-sm px-2 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base">
											<option value="RIDER">Rider Customer</option>
											<option value="DRIVER">Driver Partner</option>
										</select>
									</div>
									<div>
										<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Target account ID (UUID)</label>
										<input type="text" required placeholder="e.g. 1e8a8b8c-8d8e..." value={newBlockForm.target_user_id} onChange={(e) => setNewBlockForm((prev) => ({ ...prev, target_user_id: e.target.value }))} className="w-full h-9 bg-background-secondary border border-border-opaque rounded-sm px-3 text-paragraph-small text-content-primary font-mono placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base" />
									</div>
								</div>
							)}

							<div>
								<label className="block text-label-small font-bold text-content-secondary uppercase tracking-wider mb-1">Block reason</label>
								<textarea required placeholder="Explain safety or operational context for this block action..." value={newBlockForm.reason} onChange={(e) => setNewBlockForm((prev) => ({ ...prev, reason: e.target.value }))} className="w-full h-20 bg-background-secondary border border-border-opaque focus:border-accent-400 rounded-sm p-3 text-paragraph-small text-content-primary placeholder:text-content-tertiary focus:outline-none resize-none transition-base" />
							</div>

							<div className="flex gap-3 justify-end pt-2">
								<button type="button" onClick={() => setShowAddBlockModal(false)} className="bg-background-secondary hover:bg-background-tertiary border border-border-opaque text-label-small font-semibold px-4 py-2 rounded-sm transition-base text-content-secondary hover:text-content-primary">Cancel</button>
								<button type="submit" className="bg-negative-500 hover:bg-negative-600 text-white text-label-small font-bold px-4 py-2 rounded-sm transition-base">Deploy Block</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* ─── Call Overlay ─────────────────────────────────────────── */}
			{isDialing && (
				<div className="fixed bottom-6 right-6 bg-content-primary text-interactive-primary-text w-80 rounded-md shadow-2xl border border-border-opaque p-5 z-[100] flex flex-col gap-4">
					<div className="flex justify-between items-start">
						<div className="space-y-1">
							<span className="text-label-small text-content-tertiary uppercase font-bold tracking-wider font-mono">Active call stream</span>
							<h4 className="text-label-medium font-bold">{dialLabel}</h4>
						</div>
						<span className="w-2.5 h-2.5 rounded-full bg-negative-400 animate-pulse mt-1 inline-block" />
					</div>
					<div className="h-10 flex items-center justify-center gap-1 bg-gray-900 rounded-sm px-4 border border-gray-800">
						{waveHeights.map((h, i) => (
							<div key={i} className="w-0.5 rounded-full bg-negative-400" style={{ height: `${h}px` }} />
						))}
					</div>
					<div className="flex justify-between items-center">
						<span className="text-label-small font-mono font-semibold">{formatDuration(dialDuration)}</span>
						<button onClick={handleHangUp} className="bg-negative-500 hover:bg-negative-600 text-white text-label-small font-bold px-4 py-2 rounded-sm transition-base">Hang Up</button>
					</div>
				</div>
			)}
		</div>
	);
};
