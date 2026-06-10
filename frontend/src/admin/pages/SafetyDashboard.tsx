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

export const SafetyDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<SafetyTab>('SOS');

	// List states
	const [sosAlerts, setSosAlerts] = useState<SOSAlert[]>([]);
	const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
	const [anomalies, setAnomalies] = useState<RideCheckAnomaly[]>([]);
	const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);

	// Selected entities
	const [selectedSos, setSelectedSos] = useState<SOSAlert | null>(null);
	const [selectedIncident, setSelectedIncident] = useState<SafetyIncident | null>(null);

	// Action loading / notes states
	const [sosNotes, setSosNotes] = useState<string>('');
	const [incidentOutcomeType, setIncidentOutcomeType] = useState<string>('WARNING');
	const [incidentOutcomeDetails, setIncidentOutcomeDetails] = useState<string>('');
	const [claimStatus, setClaimStatus] = useState<string>('FILED');
	const [claimAmountRupees, setClaimAmountRupees] = useState<string>('');

	// Create Blacklist Block Form
	const [showAddBlockModal, setShowAddBlockModal] = useState<boolean>(false);
	const [newBlockForm, setNewBlockForm] = useState({
		user_id: '',
		user_type: 'DRIVER',
		block_type: 'GLOBAL',
		target_user_id: '',
		target_user_type: 'RIDER',
		reason: '',
	});

	// Call simulation
	const [isDialing, setIsDialing] = useState<boolean>(false);
	const [dialLabel, setDialLabel] = useState<string>('');
	const [dialDuration, setDialDuration] = useState<number>(0);

	// Simulation Toolbar states
	const [simulating, setSimulating] = useState<boolean>(false);

	const token = localStorage.getItem('admin_jwt_token') || '';
	const adminRole = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
	const adminId = '255e9024-d123-4063-9c6f-1662b7f2e8a5'; // standard super admin id

	const headers = {
		Authorization: `Bearer ${token}`,
		'X-Admin-Role': adminRole,
		'X-Admin-ID': adminId,
		'Content-Type': 'application/json',
	};

	// Audio Waveform Animation ref
	const audioIntervalRef = useRef<any>(null);
	const [waveHeights, setWaveHeights] = useState<number[]>([12, 18, 8, 22, 14, 28, 10, 16, 20, 12, 6, 18, 14, 24, 8]);

	const startAudioVisualizer = () => {
		if (audioIntervalRef.current) clearInterval(audioIntervalRef.current);
		audioIntervalRef.current = setInterval(() => {
			setWaveHeights(prev => prev.map(() => Math.floor(Math.random() * 24) + 6));
		}, 180);
	};

	const stopAudioVisualizer = () => {
		if (audioIntervalRef.current) {
			clearInterval(audioIntervalRef.current);
			audioIntervalRef.current = null;
		}
		setWaveHeights([12, 18, 8, 22, 14, 28, 10, 16, 20, 12, 6, 18, 14, 24, 8]);
	};

	// Fetch Data
	const fetchSOS = async () => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos`, { headers });
			if (res.ok) setSosAlerts(await res.json());
		} catch (err) {
			console.error('Failed fetching SOS alerts:', err);
		}
	};

	const fetchIncidents = async () => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents`, { headers });
			if (res.ok) setIncidents(await res.json());
		} catch (err) {
			console.error('Failed fetching incidents:', err);
		}
	};

	const fetchAnomalies = async () => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/anomalies`, { headers });
			if (res.ok) setAnomalies(await res.json());
		} catch (err) {
			console.error('Failed fetching anomalies:', err);
		}
	};

	const fetchBlacklist = async () => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/blacklist`, { headers });
			if (res.ok) setBlacklist(await res.json());
		} catch (err) {
			console.error('Failed fetching blacklist:', err);
		}
	};

	const reloadAll = () => {
		fetchSOS();
		fetchIncidents();
		fetchAnomalies();
		fetchBlacklist();
	};

	useEffect(() => {
		reloadAll();
	}, []);

	useEffect(() => {
		let timer: any;
		if (isDialing) {
			timer = setInterval(() => {
				setDialDuration(prev => prev + 1);
			}, 1000);
		}
		return () => clearInterval(timer);
	}, [isDialing]);

	// Actions
	const handleAcknowledgeSos = async (id: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos/${id}/acknowledge`, {
				method: 'POST',
				headers,
			});
			if (res.ok) {
				fetchSOS();
				if (selectedSos?.id === id) {
					setSelectedSos(prev => prev ? { ...prev, status: 'ACKNOWLEDGED' } : null);
				}
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleResolveSos = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedSos) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos/${selectedSos.id}/resolve`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ notes: sosNotes }),
			});
			if (res.ok) {
				setSosNotes('');
				setSelectedSos(null);
				fetchSOS();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleSosAction = async (action: string) => {
		if (!selectedSos) return;
		const confirmMsgs: Record<string, string> = {
			DISPATCH_AUTHORITIES: 'Dispatch police/authorities for this SOS? This escalates to emergency services.',
			NOTIFY_CONTACTS: "Notify the user's emergency contacts about this incident?",
		};
		if (confirmMsgs[action] && !window.confirm(confirmMsgs[action])) {
			return;
		}
		if (action === 'DIAL_RIDER' || action === 'DIAL_DRIVER') {
			setDialLabel(action === 'DIAL_RIDER' ? 'Rider Emergency Contact' : 'Driver Partner Line');
			setIsDialing(true);
			setDialDuration(0);
			startAudioVisualizer();
		}

		try {
			await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos/${selectedSos.id}/actions`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ action_type: action }),
			});
			fetchSOS();
			// Update selected state
			setSelectedSos(prev => {
				if (!prev) return null;
				if (action === 'DISPATCH_AUTHORITIES') return { ...prev, authorities_dispatched: true };
				if (action === 'NOTIFY_CONTACTS') return { ...prev, emergency_contacts_notified: true };
				return prev;
			});
		} catch (err) {
			console.error(err);
		}
	};

	const handleHangUp = () => {
		setIsDialing(false);
		stopAudioVisualizer();
	};

	const handleResolveIncidentOutcome = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedIncident) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents/${selectedIncident.id}/outcome`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					outcome_type: incidentOutcomeType,
					outcome_details: incidentOutcomeDetails,
					agent_id: adminId,
				}),
			});
			if (res.ok) {
				setIncidentOutcomeDetails('');
				fetchIncidents();
				fetchBlacklist();
				// Refresh details
				const detailRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents/${selectedIncident.id}`, { headers });
				if (detailRes.ok) setSelectedIncident(await detailRes.json());
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleProcessClaim = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedIncident) return;
		const amountPaise = Math.round(parseFloat(claimAmountRupees || '0') * 100);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents/${selectedIncident.id}/claim`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					claim_status: claimStatus,
					claim_amount_paise: amountPaise,
				}),
			});
			if (res.ok) {
				setClaimAmountRupees('');
				fetchIncidents();
				// Refresh details
				const detailRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents/${selectedIncident.id}`, { headers });
				if (detailRes.ok) setSelectedIncident(await detailRes.json());
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleResolveAnomaly = async (id: number, action: 'DISMISS' | 'ESCALATE_TO_SOS') => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/anomalies/${id}/resolve`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ action }),
			});
			if (res.ok) {
				fetchAnomalies();
				if (action === 'ESCALATE_TO_SOS') fetchSOS();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleAddBlacklist = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!window.confirm(
			`Deploy a ${newBlockForm.block_type} block on ${newBlockForm.user_type} ${newBlockForm.user_id}?\n\nThis blocks the user from the platform.`
		)) {
			return;
		}
		try {
			const payload: any = {
				user_id: newBlockForm.user_id,
				user_type: newBlockForm.user_type,
				block_type: newBlockForm.block_type,
				reason: newBlockForm.reason,
				created_by: adminId,
			};
			if (newBlockForm.block_type === 'MUTUAL') {
				payload.target_user_id = newBlockForm.target_user_id;
				payload.target_user_type = newBlockForm.target_user_type;
			}

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/blacklist`, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			});
			if (res.ok) {
				setShowAddBlockModal(false);
				setNewBlockForm({
					user_id: '',
					user_type: 'DRIVER',
					block_type: 'GLOBAL',
					target_user_id: '',
					target_user_type: 'RIDER',
					reason: '',
				});
				fetchBlacklist();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleRemoveBlacklist = async (id: number) => {
		if (!confirm('Are you sure you want to lift this block?')) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/blacklist/${id}`, {
				method: 'DELETE',
				headers,
			});
			if (res.ok) {
				fetchBlacklist();
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Simulation Triggers
	const triggerSimulateSos = async () => {
		setSimulating(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					trip_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
					reporter_type: 'RIDER',
					latitude: 22.5726,
					longitude: 88.3639,
					notes: 'SIMULATION: Automated SOS triggered by Rider in-app panic key.',
				}),
			});
			if (res.ok) {
				alert('Simulated SOS triggered successfully in active queue.');
				fetchSOS();
			}
		} catch (err) {
			console.error(err);
		} finally {
			setSimulating(false);
		}
	};

	const triggerSimulateIncident = async () => {
		setSimulating(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/incidents`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					trip_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
					category: 'RASH_DRIVING',
					reporter_id: '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c',
					reporter_type: 'RIDER',
					description: 'SIMULATION: Customer reported driver driving on sidewalks and running red lights in salt lake grid.',
					evidence_urls: ['https://platform-safety-recordings.s3.amazonaws.com/sim/evidence_dashcam.jpg'],
				}),
			});
			if (res.ok) {
				alert('Simulated Incident reported and queued in investigations.');
				fetchIncidents();
			}
		} catch (err) {
			console.error(err);
		} finally {
			setSimulating(false);
		}
	};

	const formatDuration = (sec: number): string => {
		const mins = Math.floor(sec / 60);
		const secs = sec % 60;
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	};

	return (
		<div className="w-full h-full flex flex-col bg-canvas text-ink font-sans">
			{/* ---- Header ---- */}
			<header className="h-[72px] min-h-[72px] border-b border-canvas-soft flex justify-between items-center px-6 bg-canvas">
				<div className="flex items-center gap-6">
					<h1 className="text-xl font-bold tracking-tight text-ink">Safety Command Center</h1>
					<nav className="flex bg-canvas-softer p-1 rounded-pill-tab">
						{([
							{ key: 'SOS', label: 'Live SOS alerts' },
							{ key: 'INCIDENTS', label: 'Incidents & claims' },
							{ key: 'ANOMALIES', label: 'Ride anomalies' },
							{ key: 'BLACKLIST', label: 'Blacklist blocks' },
						] as { key: SafetyTab; label: string }[]).map((tab) => (
							<button
								key={tab.key}
								onClick={() => {
									setActiveTab(tab.key);
									setSelectedSos(null);
									setSelectedIncident(null);
								}}
								className={`px-4 py-1.5 rounded-pill text-xs font-semibold tracking-wide transition ${
									activeTab === tab.key ? 'bg-canvas text-ink shadow-sm' : 'text-body hover:text-ink'
								}`}
							>
								{tab.label}
							</button>
						))}
					</nav>
				</div>

				{import.meta.env.DEV && (
					<div className="flex items-center gap-2">
						<span className="text-[10px] uppercase font-bold text-mute mr-1 font-mono">Simulation Tools:</span>
						<button
							onClick={triggerSimulateSos}
							disabled={simulating}
							className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 border border-rose-500/20 text-[10px] font-bold px-3 py-1.5 rounded-md transition disabled:opacity-50"
						>
							Trigger Simulated SOS
						</button>
						<button
							onClick={triggerSimulateIncident}
							disabled={simulating}
							className="bg-canvas-soft hover:bg-canvas-softer border border-canvas-soft text-[10px] font-bold px-3 py-1.5 rounded-md transition disabled:opacity-50"
						>
							File Post-Trip Incident
						</button>
					</div>
				)}
			</header>

			{/* ---- Tab Panels ---- */}
			<div className="flex-1 overflow-hidden">
				{/* 1. LIVE SOS ALERTS */}
				{activeTab === 'SOS' && (
					<div className="w-full h-full flex divide-x divide-canvas-soft">
						{/* Alerts List */}
						<div className="w-[360px] min-w-[360px] h-full flex flex-col bg-canvas">
							<div className="p-4 border-b border-canvas-soft bg-canvas-softer">
								<h2 className="text-xs font-bold uppercase tracking-wider text-body">Emergency Response Queue</h2>
							</div>
							<div className="flex-1 overflow-y-auto divide-y divide-canvas-soft">
								{sosAlerts.length === 0 ? (
									<div className="p-8 text-center text-xs text-mute font-medium">No active emergency alerts</div>
								) : (
									sosAlerts.map((sos) => {
										const isActive = sos.status === 'ACTIVE';
										const isSelected = selectedSos?.id === sos.id;
										return (
											<div
												key={sos.id}
												onClick={() => setSelectedSos(sos)}
												className={`p-4 cursor-pointer transition flex items-start gap-3 relative ${
													isSelected ? 'bg-canvas-softer' : 'hover:bg-canvas-softer/50'
												} ${isActive ? 'border-l-4 border-status-alert' : ''}`}
											>
												<div className="flex-1 min-w-0 space-y-1.5">
													<div className="flex justify-between items-center">
														<span className="font-mono text-[10px] font-bold text-mute">{sos.id}</span>
														<span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded ${
															sos.status === 'ACTIVE' 
																? 'bg-rose-100 text-rose-700 animate-pulse' 
																: sos.status === 'ACKNOWLEDGED' 
																? 'bg-yellow-100 text-yellow-700' 
																: 'bg-green-100 text-green-700'
														}`}>
															{sos.status}
														</span>
													</div>
													<h4 className="text-xs font-bold text-ink truncate">Trip ID: {sos.trip_id.substring(0, 8)}...</h4>
													<p className="text-[10px] text-body line-clamp-2">{sos.notes || 'No description provided'}</p>
													<div className="flex justify-between items-center text-[9px] text-mute pt-1">
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
						<div className="flex-1 h-full flex flex-col bg-canvas-softer overflow-y-auto">
							{selectedSos ? (
								<div className="p-6 space-y-6 max-w-4xl">
									{/* Top Warning Banner */}
									<div className={`p-4 rounded-xl border flex items-center justify-between ${
										selectedSos.status === 'ACTIVE'
											? 'bg-rose-500/10 border-rose-500/20 text-rose-700'
											: 'bg-canvas border-canvas-soft text-ink'
									}`}>
										<div className="space-y-1">
											<h3 className="text-sm font-bold tracking-tight">
												{selectedSos.status === 'ACTIVE' ? '🔴 CRITICAL EMERGENCY: Panic Button Triggered' : 'SOS Case Review'}
											</h3>
											<p className="text-[11px] opacity-80">Alert ID: {selectedSos.id} | Trip: {selectedSos.trip_id}</p>
										</div>
										{selectedSos.status === 'ACTIVE' && (
											<button
												onClick={() => handleAcknowledgeSos(selectedSos.id)}
												className="bg-rose-600 hover:bg-rose-700 text-on-dark text-xs font-bold px-4 py-2 rounded-md transition shadow-sm"
											>
												Acknowledge & Investigate
											</button>
										)}
									</div>

									{/* Dual Grid Details */}
									<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
										{/* Location / Telemetry */}
										<div className="md:col-span-2 bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4 shadow-sm">
											<h4 className="text-xs font-bold uppercase tracking-wider text-body border-b border-canvas-soft pb-2">Location & Telemetry Map</h4>
											<div className="h-[220px] bg-canvas-softer rounded-lg border border-canvas-soft relative flex flex-col items-center justify-center overflow-hidden">
												{/* Mock Map Layout */}
												<div className="absolute inset-0 opacity-15 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]" />
												<div className="z-10 text-center space-y-1.5 p-4">
													<div className="w-4 h-4 rounded-full bg-rose-500 animate-ping mx-auto" />
													<span className="text-[10px] font-extrabold uppercase font-mono tracking-widest text-rose-500">Live Telemetry Fix</span>
													<p className="text-[10px] text-mute font-mono">Lat: {selectedSos.latitude || '22.5726'} | Lng: {selectedSos.longitude || '88.3639'}</p>
												</div>
												<div className="absolute bottom-2 right-2 bg-ink text-on-dark font-mono text-[8px] px-2 py-0.5 rounded uppercase font-bold tracking-wider">
													Kolkata Shard
												</div>
											</div>
										</div>

										{/* Audio Stream */}
										<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
											<div>
												<h4 className="text-xs font-bold uppercase tracking-wider text-body border-b border-canvas-soft pb-2">Audio Stream In-Vehicle</h4>
												{selectedSos.audio_stream_url ? (
													<div className="mt-6 space-y-4">
														<div className="h-10 flex items-center justify-center gap-1 bg-rose-500/5 rounded-lg border border-rose-500/10 px-4">
															{waveHeights.map((h, i) => (
																<div
																	key={i}
																	className={`w-0.5 rounded-full ${selectedSos.status === 'ACTIVE' ? 'bg-rose-500' : 'bg-mute'}`}
																	style={{ height: `${h}px` }}
																/>
															))}
														</div>
														<p className="text-[10px] text-center text-mute font-semibold">Live audio stream active (24kbps OPUS)</p>
													</div>
												) : (
													<div className="mt-8 text-center text-[10px] text-mute font-medium py-4">
														No audio recording available for this alert.
													</div>
												)}
											</div>
											<div className="space-y-2 pt-4 border-t border-canvas-soft">
												<div className="flex justify-between text-[10px]">
													<span className="text-body font-medium">Emergency Contacts Notified:</span>
													<span className={selectedSos.emergency_contacts_notified ? 'text-green-600 font-bold' : 'text-mute font-medium'}>
														{selectedSos.emergency_contacts_notified ? 'YES' : 'NO'}
													</span>
												</div>
												<div className="flex justify-between text-[10px]">
													<span className="text-body font-medium">Authorities Dispatched:</span>
													<span className={selectedSos.authorities_dispatched ? 'text-green-600 font-bold' : 'text-mute font-medium'}>
														{selectedSos.authorities_dispatched ? 'YES' : 'NO'}
													</span>
												</div>
											</div>
										</div>
									</div>

									{/* Action Console */}
									{selectedSos.status !== 'RESOLVED' && (
										<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4 shadow-sm">
											<h4 className="text-xs font-bold uppercase tracking-wider text-body border-b border-canvas-soft pb-2">Emergency Response Actions</h4>
											<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
												<button
													onClick={() => handleSosAction('DIAL_RIDER')}
													className="bg-canvas-soft hover:bg-canvas-softer border border-canvas-soft text-ink text-xs font-bold py-2.5 rounded-md transition shadow-sm"
												>
													📞 Call Rider
												</button>
												<button
													onClick={() => handleSosAction('DIAL_DRIVER')}
													className="bg-canvas-soft hover:bg-canvas-softer border border-canvas-soft text-ink text-xs font-bold py-2.5 rounded-md transition shadow-sm"
												>
													📞 Call Driver
												</button>
												<button
													onClick={() => handleSosAction('DISPATCH_AUTHORITIES')}
													disabled={selectedSos.authorities_dispatched}
													className="bg-rose-600 hover:bg-rose-700 disabled:bg-canvas-soft text-on-dark disabled:text-mute disabled:border disabled:border-canvas-soft text-xs font-bold py-2.5 rounded-md transition shadow-sm"
												>
													🚨 Dispatch Police
												</button>
												<button
													onClick={() => handleSosAction('NOTIFY_CONTACTS')}
													disabled={selectedSos.emergency_contacts_notified}
													className="bg-ink hover:bg-black-elevated disabled:bg-canvas-soft text-on-dark disabled:text-mute disabled:border disabled:border-canvas-soft text-xs font-bold py-2.5 rounded-md transition shadow-sm"
												>
													✉️ Alert Contacts
												</button>
											</div>
										</div>
									)}

									{/* Resolve SOS Case Form */}
									{selectedSos.status !== 'RESOLVED' ? (
										<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4 shadow-sm">
											<h4 className="text-xs font-bold uppercase tracking-wider text-body border-b border-canvas-soft pb-2">Resolve Emergency Case</h4>
											<form onSubmit={handleResolveSos} className="space-y-4">
												<div>
													<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Post-Incident Report / Resolution Notes</label>
													<textarea
														value={sosNotes}
														onChange={(e) => setSosNotes(e.target.value)}
														required
														placeholder="Enter detailed outcome notes. What was the incident? Were emergency services required? What actions were taken?"
														className="w-full h-24 bg-canvas-soft border border-canvas-soft focus:border-ink rounded-lg p-3 text-xs text-ink placeholder-mute focus:outline-none resize-none"
													/>
												</div>
												<div className="flex justify-end">
													<button
														type="submit"
														className="bg-green-600 hover:bg-green-700 text-on-dark text-xs font-bold px-5 py-2.5 rounded-md transition shadow-sm active:scale-[0.97]"
													>
														✅ Resolve Alert & Close Case
													</button>
												</div>
											</form>
										</div>
									) : (
										<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3 shadow-sm text-xs text-body">
											<h4 className="text-xs font-bold uppercase tracking-wider text-body border-b border-canvas-soft pb-2">Case Resolution Details</h4>
											<div className="flex justify-between text-[11px] pt-1">
												<span className="font-semibold text-ink">Resolved At:</span>
												<span className="font-mono text-mute">{selectedSos.resolved_at ? new Date(selectedSos.resolved_at).toLocaleString() : 'N/A'}</span>
											</div>
											<div className="space-y-1.5 pt-2">
												<span className="font-bold text-ink uppercase tracking-wider text-[10px]">Notes:</span>
												<p className="p-3 bg-canvas-soft rounded-lg text-ink font-mono text-[11px] leading-relaxed border border-canvas-soft">{selectedSos.notes}</p>
											</div>
										</div>
									)}
								</div>
							) : (
								<div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-mute select-none">
									<span className="text-3xl mb-2">🛡️</span>
									<p className="text-xs font-medium">Select an SOS emergency alert from the queue to investigate</p>
								</div>
							)}
						</div>
					</div>
				)}

				{/* 2. INCIDENT REPORTS & CLAIMS */}
				{activeTab === 'INCIDENTS' && (
					<div className="w-full h-full flex divide-x divide-canvas-soft">
						{/* Incidents Queue */}
						<div className="w-[360px] min-w-[360px] h-full flex flex-col bg-canvas">
							<div className="p-4 border-b border-canvas-soft bg-canvas-softer">
								<h2 className="text-xs font-bold uppercase tracking-wider text-body">Investigation Reports</h2>
							</div>
							<div className="flex-1 overflow-y-auto divide-y divide-canvas-soft">
								{incidents.length === 0 ? (
									<div className="p-8 text-center text-xs text-mute font-medium">No incident reports logged</div>
								) : (
									incidents.map((inc) => {
										const isSelected = selectedIncident?.id === inc.id;
										return (
											<div
												key={inc.id}
												onClick={() => setSelectedIncident(inc)}
												className={`p-4 cursor-pointer transition flex flex-col gap-1.5 ${
													isSelected ? 'bg-canvas-softer' : 'hover:bg-canvas-softer/50'
												}`}
											>
												<div className="flex justify-between items-center">
													<span className="font-mono text-[10px] font-bold text-mute">{inc.id}</span>
													<span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
														inc.status === 'RESOLVED' || inc.status === 'CLOSED'
															? 'bg-green-100 text-green-700'
															: 'bg-blue-100 text-blue-700'
													}`}>
														{inc.status}
													</span>
												</div>
												<h4 className="text-xs font-bold text-ink truncate sentence-case">{inc.category.replace('_', ' ')}</h4>
												<p className="text-[10px] text-body line-clamp-2">{inc.description}</p>
												<div className="flex justify-between items-center text-[9px] text-mute pt-1">
													<span>Trip: {inc.trip_id.substring(0, 8)}...</span>
													<span>{new Date(inc.created_at).toLocaleDateString()}</span>
												</div>
											</div>
										);
									})
								)}
							</div>
						</div>

						{/* Detail panel */}
						<div className="flex-1 h-full flex flex-col bg-canvas-softer overflow-y-auto">
							{selectedIncident ? (
								<div className="p-6 space-y-6 max-w-4xl">
									{/* Top header */}
									<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4 shadow-sm">
										<div className="flex justify-between items-start border-b border-canvas-soft pb-4">
											<div className="space-y-1">
												<h3 className="text-sm font-bold tracking-tight uppercase text-ink">
													Incident Investigation: {selectedIncident.category.replace('_', ' ')}
												</h3>
												<p className="text-[10px] text-mute font-mono">Case ID: {selectedIncident.id} | Trip ID: {selectedIncident.trip_id}</p>
											</div>
											<span className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-pill ${
												selectedIncident.status === 'RESOLVED' || selectedIncident.status === 'CLOSED'
													? 'bg-green-100 text-green-800 border border-green-200'
													: 'bg-blue-100 text-blue-800 border border-blue-200'
											}`}>
												{selectedIncident.status}
											</span>
										</div>

										<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
											<div>
												<span className="text-[9px] text-mute font-bold uppercase tracking-wider block">Reporter</span>
												<span className="font-semibold text-ink">{selectedIncident.reporter_type} (UUID: {selectedIncident.reporter_id.substring(0, 8)}...)</span>
											</div>
											<div>
												<span className="text-[9px] text-mute font-bold uppercase tracking-wider block">Incident Date</span>
												<span className="font-semibold text-ink">{new Date(selectedIncident.created_at).toLocaleString()}</span>
											</div>
											<div>
												<span className="text-[9px] text-mute font-bold uppercase tracking-wider block">Claim Status</span>
												<span className="font-semibold text-ink">{selectedIncident.d4m_care_claim_status}</span>
											</div>
											<div>
												<span className="text-[9px] text-mute font-bold uppercase tracking-wider block">Claim Amount</span>
												<span className="font-semibold text-ink">
													{selectedIncident.d4m_care_claim_amount_paise > 0 
														? `₹${(selectedIncident.d4m_care_claim_amount_paise / 100).toLocaleString()}` 
														: '₹0'}
												</span>
											</div>
										</div>

										<div className="space-y-1.5 pt-2">
											<span className="text-[9px] text-mute font-bold uppercase tracking-wider block">Description of events</span>
											<p className="p-3 bg-canvas-soft rounded-lg text-xs leading-relaxed text-ink border border-canvas-soft">{selectedIncident.description}</p>
										</div>

										{/* Evidence */}
										{selectedIncident.evidence_urls.length > 0 && (
											<div className="space-y-2">
												<span className="text-[9px] text-mute font-bold uppercase tracking-wider block">Investigation Evidence</span>
												<div className="flex flex-wrap gap-3">
													{selectedIncident.evidence_urls.map((url, i) => (
														<a
															key={i}
															href={url}
															target="_blank"
															rel="noreferrer"
															className="inline-flex items-center gap-1.5 bg-canvas-soft hover:bg-canvas-softer border border-canvas-soft text-[10px] font-bold px-3 py-2 rounded transition font-mono text-ink shadow-sm"
														>
															📁 {url.substring(url.lastIndexOf('/') + 1)}
														</a>
													))}
												</div>
											</div>
										)}
									</div>

									{/* Claims Management Section */}
									<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4 shadow-sm">
										<h4 className="text-xs font-bold uppercase tracking-wider text-body border-b border-canvas-soft pb-2">🛡️ D4M Care Insurance Claims</h4>
										<form onSubmit={handleProcessClaim} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
											<div>
												<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Claim Status</label>
												<select
													value={claimStatus}
													onChange={(e) => setClaimStatus(e.target.value)}
													className="w-full h-9 bg-canvas border border-canvas-soft rounded-md px-2.5 text-xs text-ink focus:outline-none focus:border-ink cursor-pointer"
												>
													<option value="FILED">Filed</option>
													<option value="UNDER_REVIEW">Under Review</option>
													<option value="APPROVED">Approved</option>
													<option value="REJECTED">Rejected</option>
												</select>
											</div>
											<div>
												<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Claimed Amount (Rupees)</label>
												<input
													type="number"
													step="0.01"
													required
													placeholder="e.g. 5000.00"
													value={claimAmountRupees}
													onChange={(e) => setClaimAmountRupees(e.target.value)}
													className="w-full h-9 bg-canvas border border-canvas-soft rounded-md px-3 text-xs text-ink placeholder-mute focus:outline-none focus:border-ink font-mono"
												/>
											</div>
											<button
												type="submit"
												className="bg-ink hover:bg-black-elevated text-on-dark text-xs font-bold h-9 rounded-md transition shadow-sm active:scale-[0.97]"
											>
												Update Claim Info
											</button>
										</form>
									</div>

									{/* Investigation Outcome Section */}
									{selectedIncident.status !== 'RESOLVED' && selectedIncident.status !== 'CLOSED' ? (
										<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-4 shadow-sm">
											<h4 className="text-xs font-bold uppercase tracking-wider text-body border-b border-canvas-soft pb-2">Apply Resolution Outcome</h4>
											<form onSubmit={handleResolveIncidentOutcome} className="space-y-4">
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<div>
														<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Outcome action</label>
														<select
															value={incidentOutcomeType}
															onChange={(e) => setIncidentOutcomeType(e.target.value)}
															className="w-full h-9 bg-canvas border border-canvas-soft rounded-md px-2.5 text-xs text-ink focus:outline-none focus:border-ink cursor-pointer font-semibold"
														>
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
													<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Investigation details / justification</label>
													<textarea
														required
														placeholder="Enter detailed outcome notes..."
														value={incidentOutcomeDetails}
														onChange={(e) => setIncidentOutcomeDetails(e.target.value)}
														className="w-full h-24 bg-canvas-soft border border-canvas-soft focus:border-ink rounded-lg p-3 text-xs text-ink placeholder-mute focus:outline-none resize-none"
													/>
												</div>
												<div className="flex justify-end">
													<button
														type="submit"
														className="bg-green-600 hover:bg-green-700 text-on-dark text-xs font-bold px-5 py-2.5 rounded-md transition shadow-sm active:scale-[0.97]"
													>
														Close Case & Commit Outcome
													</button>
												</div>
											</form>
										</div>
									) : (
										<div className="bg-canvas border border-canvas-soft rounded-xl p-5 space-y-3 shadow-sm text-xs text-body">
											<h4 className="text-xs font-bold uppercase tracking-wider text-body border-b border-canvas-soft pb-2">Investigation Outcome Closed</h4>
											<div className="flex justify-between text-[11px] pt-1">
												<span className="font-semibold text-ink">Outcome:</span>
												<span className="font-bold text-rose-500 uppercase tracking-widest text-[10px]">{selectedIncident.outcome_type}</span>
											</div>
											<div className="space-y-1.5 pt-2">
												<span className="font-bold text-ink uppercase tracking-wider text-[10px]">Justification & details:</span>
												<p className="p-3 bg-canvas-soft rounded-lg text-ink font-mono text-[11px] leading-relaxed border border-canvas-soft">{selectedIncident.outcome_details}</p>
											</div>
										</div>
									)}
								</div>
							) : (
								<div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-mute select-none">
									<span className="text-3xl mb-2">📁</span>
									<p className="text-xs font-medium">Select an incident case file to review details and assign outcomes</p>
								</div>
							)}
						</div>
					</div>
				)}

				{/* 3. RIDE CHECK ANOMALIES */}
				{activeTab === 'ANOMALIES' && (
					<div className="w-full h-full flex flex-col bg-canvas p-6 overflow-y-auto">
						<div className="max-w-6xl space-y-4">
							<div className="flex justify-between items-center pb-2">
								<h2 className="text-sm font-bold uppercase tracking-wider text-body">Live Ride Check Telemetry Anomalies</h2>
								<span className="text-[10px] text-mute font-mono bg-canvas-soft border border-canvas-soft px-3 py-1 rounded">Polling real-time telemetry every 8s</span>
							</div>

							<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
								<table className="w-full text-left text-xs border-collapse">
									<thead>
										<tr className="bg-canvas-softer border-b border-canvas-soft text-body font-bold text-[10px] uppercase tracking-wider">
											<th className="p-4">ID</th>
											<th className="p-4">Anomaly Type</th>
											<th className="p-4">Trip ID</th>
											<th className="p-4">Severity</th>
											<th className="p-4">Description</th>
											<th className="p-4">Status</th>
											<th className="p-4 text-right">Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-canvas-soft font-mono text-[11px]">
										{anomalies.length === 0 ? (
											<tr>
												<td colSpan={7} className="p-8 text-center text-xs text-mute font-medium">No telemetry anomalies flagged</td>
											</tr>
										) : (
											anomalies.map((anom) => (
												<tr key={anom.id} className="hover:bg-canvas-softer/30 transition-colors">
													<td className="p-4 font-bold text-ink">{anom.id}</td>
													<td className="p-4">
														<span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
															anom.anomaly_type === 'LONG_STOP' 
																? 'bg-yellow-100 text-yellow-800' 
																: anom.anomaly_type === 'OFF_ROUTE' 
																? 'bg-orange-100 text-orange-800' 
																: 'bg-red-100 text-red-800'
														}`}>
															{anom.anomaly_type.replace('_', ' ')}
														</span>
													</td>
													<td className="p-4 text-mute">{anom.trip_id}</td>
													<td className="p-4">
														<span className={`font-bold ${
															anom.severity === 'HIGH' ? 'text-status-alert' : 'text-body'
														}`}>{anom.severity}</span>
													</td>
													<td className="p-4 text-ink font-sans max-w-[280px] truncate">{anom.description}</td>
													<td className="p-4">
														<span className={`text-[10px] font-extrabold uppercase ${
															anom.status === 'PENDING' ? 'text-yellow-600' : 'text-green-600'
														}`}>{anom.status}</span>
													</td>
													<td className="p-4 text-right space-x-1.5 font-sans">
														{anom.status === 'PENDING' && (
															<>
																<button
																	onClick={() => handleResolveAnomaly(anom.id, 'DISMISS')}
																	className="bg-canvas-soft hover:bg-canvas-softer border border-canvas-soft text-[10px] font-bold px-2 py-1 rounded transition"
																>
																	Dismiss
																</button>
																<button
																	onClick={() => handleResolveAnomaly(anom.id, 'ESCALATE_TO_SOS')}
																	className="bg-rose-600 hover:bg-rose-700 text-on-dark text-[10px] font-bold px-2 py-1 rounded transition shadow-sm"
																>
																	Escalate to SOS
																</button>
															</>
														)}
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				)}

				{/* 4. BLACKLIST BLOCKS */}
				{activeTab === 'BLACKLIST' && (
					<div className="w-full h-full flex flex-col bg-canvas p-6 overflow-y-auto">
						<div className="max-w-6xl space-y-4">
							<div className="flex justify-between items-center pb-2">
								<h2 className="text-sm font-bold uppercase tracking-wider text-body font-sans">Global & Mutual Account Block Lists</h2>
								<button
									onClick={() => setShowAddBlockModal(true)}
									className="bg-ink hover:bg-black-elevated text-on-dark text-xs font-semibold px-4 py-2 rounded-md transition shadow-sm active:scale-[0.97]"
								>
									+ Deploy Blacklist Block
								</button>
							</div>

							<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
								<table className="w-full text-left text-xs border-collapse">
									<thead>
										<tr className="bg-canvas-softer border-b border-canvas-soft text-body font-bold text-[10px] uppercase tracking-wider">
											<th className="p-4">Blocked User (Rider/Driver)</th>
											<th className="p-4">Block Type</th>
											<th className="p-4">Target (Mutual Block Link)</th>
											<th className="p-4">Reason</th>
											<th className="p-4">Created By</th>
											<th className="p-4">Date Added</th>
											<th className="p-4 text-right">Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-canvas-soft font-mono text-[11px]">
										{blacklist.length === 0 ? (
											<tr>
												<td colSpan={7} className="p-8 text-center text-xs text-mute font-medium font-sans">No users blocked on blacklist</td>
											</tr>
										) : (
											blacklist.map((entry) => (
												<tr key={entry.id} className="hover:bg-canvas-softer/30 transition-colors">
													<td className="p-4">
														<div className="flex flex-col">
															<span className="font-bold text-ink">{entry.user_id}</span>
															<span className="text-[9px] text-mute font-bold uppercase tracking-widest font-sans">{entry.user_type}</span>
														</div>
													</td>
													<td className="p-4">
														<span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
															entry.block_type === 'GLOBAL' 
																? 'bg-rose-100 text-rose-800' 
																: 'bg-yellow-100 text-yellow-800'
														}`}>
															{entry.block_type}
														</span>
													</td>
													<td className="p-4">
														{entry.block_type === 'MUTUAL' && entry.target_user_id ? (
															<div className="flex flex-col">
																<span className="font-bold text-ink">{entry.target_user_id}</span>
																<span className="text-[9px] text-mute font-bold uppercase tracking-widest font-sans">{entry.target_user_type}</span>
															</div>
														) : (
															<span className="text-mute font-sans">-</span>
														)}
													</td>
													<td className="p-4 text-ink font-sans max-w-[220px] truncate">{entry.reason}</td>
													<td className="p-4 font-sans text-mute font-medium">{entry.created_by_name || 'System'}</td>
													<td className="p-4 text-mute">{new Date(entry.created_at).toLocaleDateString()}</td>
													<td className="p-4 text-right font-sans">
														<button
															onClick={() => handleRemoveBlacklist(entry.id)}
															className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 text-[10px] font-bold px-3 py-1.5 rounded transition"
														>
															Lift Block
														</button>
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* ---- Create Block Modal ---- */}
			{showAddBlockModal && (
				<div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
					<div className="bg-canvas border border-canvas-soft rounded-xl shadow-xl w-full max-w-md overflow-hidden">
						<div className="px-6 py-4 border-b border-canvas-soft flex justify-between items-center bg-canvas-softer">
							<h3 className="font-bold text-sm text-ink uppercase tracking-wider">Deploy Blacklist Block</h3>
							<button onClick={() => setShowAddBlockModal(false)} className="text-mute hover:text-ink text-sm font-bold">✕</button>
						</div>
						<form onSubmit={handleAddBlacklist} className="p-6 space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div>
									<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">User type</label>
									<select
										value={newBlockForm.user_type}
										onChange={(e) => setNewBlockForm(prev => ({ ...prev, user_type: e.target.value }))}
										className="w-full h-9 bg-canvas border border-canvas-soft rounded-md px-2 text-xs text-ink focus:outline-none focus:border-ink cursor-pointer"
									>
										<option value="DRIVER">Driver Partner</option>
										<option value="RIDER">Rider Customer</option>
									</select>
								</div>
								<div>
									<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Block type</label>
									<select
										value={newBlockForm.block_type}
										onChange={(e) => setNewBlockForm(prev => ({ ...prev, block_type: e.target.value }))}
										className="w-full h-9 bg-canvas border border-canvas-soft rounded-md px-2 text-xs text-ink focus:outline-none focus:border-ink cursor-pointer"
									>
										<option value="GLOBAL">Global Account Ban</option>
										<option value="MUTUAL">Mutual Matching Block</option>
									</select>
								</div>
							</div>

							<div>
								<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">User account ID (UUID)</label>
								<input
									type="text"
									required
									placeholder="e.g. a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
									value={newBlockForm.user_id}
									onChange={(e) => setNewBlockForm(prev => ({ ...prev, user_id: e.target.value }))}
									className="w-full h-9 bg-canvas border border-canvas-soft rounded-md px-3 text-xs text-ink placeholder-mute focus:outline-none focus:border-ink font-mono"
								/>
							</div>

							{newBlockForm.block_type === 'MUTUAL' && (
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Target user type</label>
										<select
											value={newBlockForm.target_user_type}
											onChange={(e) => setNewBlockForm(prev => ({ ...prev, target_user_type: e.target.value }))}
											className="w-full h-9 bg-canvas border border-canvas-soft rounded-md px-2 text-xs text-ink focus:outline-none focus:border-ink cursor-pointer"
										>
											<option value="RIDER">Rider Customer</option>
											<option value="DRIVER">Driver Partner</option>
										</select>
									</div>
									<div>
										<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Target account ID (UUID)</label>
										<input
											type="text"
											required
											placeholder="e.g. 1e8a8b8c-8d8e..."
											value={newBlockForm.target_user_id}
											onChange={(e) => setNewBlockForm(prev => ({ ...prev, target_user_id: e.target.value }))}
											className="w-full h-9 bg-canvas border border-canvas-soft rounded-md px-3 text-xs text-ink placeholder-mute focus:outline-none focus:border-ink font-mono"
										/>
									</div>
								</div>
							)}

							<div>
								<label className="block text-[10px] font-bold text-body uppercase tracking-wider mb-1">Block reason</label>
								<textarea
									required
									placeholder="Explain safety or operational context for this block action..."
									value={newBlockForm.reason}
									onChange={(e) => setNewBlockForm(prev => ({ ...prev, reason: e.target.value }))}
									className="w-full h-20 bg-canvas-soft border border-canvas-soft focus:border-ink rounded-lg p-3 text-xs text-ink placeholder-mute focus:outline-none resize-none"
								/>
							</div>

							<div className="flex gap-3 justify-end pt-2">
								<button
									type="button"
									onClick={() => setShowAddBlockModal(false)}
									className="bg-canvas-soft hover:bg-canvas-softer border border-canvas-soft text-xs font-semibold px-4 py-2 rounded-md transition"
								>
									Cancel
								</button>
								<button
									type="submit"
									className="bg-rose-600 hover:bg-rose-700 text-on-dark text-xs font-bold px-4 py-2 rounded-md transition shadow-sm active:scale-[0.97]"
								>
									Deploy Block
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* ---- Calling Visual Overlay Popover ---- */}
			{isDialing && (
				<div className="fixed bottom-6 right-6 bg-ink text-on-dark w-80 rounded-xl shadow-2xl border border-canvas-soft p-5 z-[100] flex flex-col gap-4 animate-slide-up">
					<div className="flex justify-between items-start">
						<div className="space-y-1">
							<span className="text-[9px] text-mute uppercase font-bold tracking-wider font-mono">Active call stream</span>
							<h4 className="text-xs font-bold">{dialLabel}</h4>
						</div>
						<div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse mt-1" />
					</div>
					<div className="h-10 flex items-center justify-center gap-1 bg-white/5 rounded-lg px-4 border border-white/10">
						{waveHeights.map((h, i) => (
							<div
								key={i}
								className="w-0.5 rounded-full bg-rose-400"
								style={{ height: `${h}px` }}
							/>
						))}
					</div>
					<div className="flex justify-between items-center">
						<span className="text-xs font-mono font-semibold opacity-80">{formatDuration(dialDuration)}</span>
						<button
							onClick={handleHangUp}
							className="bg-rose-600 hover:bg-rose-700 text-on-dark text-xs font-bold px-4 py-2 rounded-md transition shadow-sm active:scale-[0.97]"
						>
							Hang Up
						</button>
					</div>
				</div>
			)}
		</div>
	);
};
