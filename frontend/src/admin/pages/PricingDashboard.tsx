import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

export interface FareConfig {
	city_prefix: string;
	car_type: string;
	trip_type: string;
	base_fare_paise: number;
	per_km_fare_paise: number;
	per_minute_fare_paise: number;
	minimum_fare_paise: number;
	night_charge_start: string;
	night_charge_end: string;
	night_charge_multiplier: number;
	wait_charge_after_minutes: number;
	wait_charge_per_minute_paise: number;
	cancellation_fee_rider_paise: number;
	cancellation_fee_driver_paise: number;
	d4m_care_charge_paise: number;
	outstation_per_day_paise: number;
	outstation_km_outside_city_paise: number;
	outstation_driver_allowance_paise: number;
	outstation_night_halt_paise: number;
	tax_percent: number;
	platform_fee_paise: number;
	convenience_fee_paise: number;
	effective_from: string;
	effective_to: string;
	version_id?: number;
	created_by?: string;
	change_reason: string;
	created_at?: string;
}

export interface AutoSurgeRule {
	min_demand_supply_ratio: number;
	multiplier: number;
}

export interface SurgeRules {
	auto_rules: AutoSurgeRule[];
	surge_cap: number;
	cooldown_seconds: number;
}

export interface TakeRateTier {
	min_trips: number;
	max_trips: number;
	take_rate_percent: number;
}

export interface CommissionSettings {
	city_prefix: string;
	car_type: string;
	model_type: string; // TIERED, SUBSCRIPTION
	tiers?: TakeRateTier[];
	subscription_flat_paise?: number;
	subscription_period?: string; // DAILY, WEEKLY
}

export const PricingDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<'fares' | 'surge' | 'commission'>('fares');
	const [cities] = useState<string[]>(['KOL', 'BLR', 'DEL', 'MUM']);
	const [carTypes] = useState<string[]>(['Hatchback', 'Sedan', 'SUV', 'Premium']);
	const [tripTypes] = useState<string[]>(['in-city round', 'one-way', 'mini-outstation', 'outstation']);

	// Core Fares States
	const [selectedCity, setSelectedCity] = useState<string>('KOL');
	const [selectedCar, setSelectedCar] = useState<string>('Hatchback');
	const [selectedTrip, setSelectedTrip] = useState<string>('one-way');
	const [fare, setFare] = useState<FareConfig | null>(null);
	const [history, setHistory] = useState<FareConfig[]>([]);
	const [fareLoading, setFareLoading] = useState<boolean>(true);
	const [showHistoryDrawer, setShowHistoryDrawer] = useState<boolean>(false);

	// Surge States
	const [surgeRules, setSurgeRules] = useState<SurgeRules | null>(null);
	const [surgeLoading, setSurgeLoading] = useState<boolean>(true);
	// Manual override fields
	const [overrideCity, setOverrideCity] = useState<string>('KOL');
	const [overrideCell, setOverrideCell] = useState<string>('893085811bbffff');
	const [overrideMultiplier, setOverrideMultiplier] = useState<string>('2.0');
	const [overrideDuration, setOverrideDuration] = useState<string>('30');
	const [overrideLoading, setOverrideLoading] = useState<boolean>(false);

	// Commission States
	const [selectedCommCity, setSelectedCommCity] = useState<string>('KOL');
	const [selectedCommCar, setSelectedCommCar] = useState<string>('Hatchback');
	const [commission, setCommission] = useState<CommissionSettings | null>(null);
	const [commLoading, setCommLoading] = useState<boolean>(true);

	const fetchFares = async () => {
		setFareLoading(true);
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/fares?city=${selectedCity}&car_type=${selectedCar}&trip_type=${selectedTrip}`, {
				headers: { Authorization: `Bearer ${token}`, 'X-Admin-Role': role },
			});
			if (res.ok) {
				const data = await res.json();
				setFare(data);
			}
			// Fetch history
			const histRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/fares/history?city=${selectedCity}&car_type=${selectedCar}&trip_type=${selectedTrip}`, {
				headers: { Authorization: `Bearer ${token}`, 'X-Admin-Role': role },
			});
			if (histRes.ok) {
				const histData = await histRes.json();
				setHistory(histData || []);
			}
		} catch (err) {
			console.error('Failed to fetch fares', err);
		} finally {
			setFareLoading(false);
		}
	};

	const fetchSurgeRules = async () => {
		setSurgeLoading(true);
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/surge/rules`, {
				headers: { Authorization: `Bearer ${token}`, 'X-Admin-Role': role },
			});
			if (res.ok) {
				const data = await res.json();
				setSurgeRules(data);
			}
		} catch (err) {
			console.error('Failed to fetch surge rules', err);
		} finally {
			setSurgeLoading(false);
		}
	};

	const fetchCommission = async () => {
		setCommLoading(true);
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/commission?city=${selectedCommCity}&car_type=${selectedCommCar}`, {
				headers: { Authorization: `Bearer ${token}`, 'X-Admin-Role': role },
			});
			if (res.ok) {
				const data = await res.json();
				setCommission(data);
			}
		} catch (err) {
			console.error('Failed to fetch commissions', err);
		} finally {
			setCommLoading(false);
		}
	};

	useEffect(() => {
		fetchFares();
	}, [selectedCity, selectedCar, selectedTrip]);

	useEffect(() => {
		if (activeTab === 'surge') fetchSurgeRules();
		if (activeTab === 'commission') fetchCommission();
	}, [activeTab, selectedCommCity, selectedCommCar]);

	// Save Fare Config
	const handleSaveFare = async () => {
		if (!fare) return;
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/fares`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(fare),
			});
			if (res.ok) {
				alert('Fare configuration version committed successfully.');
				fetchFares();
			} else {
				alert('Failed to save fare configuration');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Revert to history version
	const handleRevertVersion = async (versionID: number) => {
		if (!confirm('Revert the active fare configuration to this version?')) return;
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/fares/revert`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					city_prefix: selectedCity,
					car_type: selectedCar,
					trip_type: selectedTrip,
					version_id: versionID,
				}),
			});
			if (res.ok) {
				alert('Active configuration successfully reverted to historical version.');
				setShowHistoryDrawer(false);
				fetchFares();
			} else {
				alert('Reversion execution failed');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Save Auto Surge Rules
	const handleSaveSurgeRules = async () => {
		if (!surgeRules) return;
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/surge/rules`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(surgeRules),
			});
			if (res.ok) {
				alert('Surge thresholds updated successfully.');
				fetchSurgeRules();
			} else {
				alert('Failed to save surge thresholds');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Post Manual Freeze Cap
	const handlePostManualSurge = async () => {
		setOverrideLoading(true);
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/freeze`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					city_prefix: overrideCity,
					h3_cell: overrideCell,
					max_multiplier: parseFloat(overrideMultiplier),
					duration_minutes: parseInt(overrideDuration),
				}),
			});
			if (res.ok) {
				alert('Emergency Surge Deflation Valve successfully engaged.');
			} else {
				alert('Emergency pricing override failed. Check authorization clearances.');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		} finally {
			setOverrideLoading(false);
		}
	};

	// Save Take-Rate Settings
	const handleSaveCommission = async () => {
		if (!commission) return;
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/commission`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(commission),
			});
			if (res.ok) {
				alert('Driver take-rate commission settings updated.');
				fetchCommission();
			} else {
				alert('Failed to save commission configurations');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Helpers to format paise to rupees and vice versa
	const pToR = (paise: number) => (paise / 100).toFixed(2);
	const rToP = (rupeesStr: string) => Math.round(parseFloat(rupeesStr) * 100) || 0;

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight text-ink">Pricing & Surge Configurations</h1>
				<p className="text-xs text-mute mt-1">Configure versioned fare schedules, emergency auto-surge thresholds, manual pricing locks, and driver commissions</p>
			</div>

			{/* Tab Headers */}
			<div className="flex border-b border-canvas-soft bg-canvas rounded-xl p-1 shadow-sm max-w-sm">
				<button
					onClick={() => setActiveTab('fares')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'fares' ? 'bg-canvas-soft text-ink border-canvas-soft border' : 'text-mute hover:text-ink'
					}`}
				>
					Fare Settings
				</button>
				<button
					onClick={() => setActiveTab('surge')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'surge' ? 'bg-canvas-soft text-ink border-canvas-soft border' : 'text-mute hover:text-ink'
					}`}
				>
					Surge & Caps
				</button>
				<button
					onClick={() => setActiveTab('commission')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'commission' ? 'bg-canvas-soft text-ink border-canvas-soft border' : 'text-mute hover:text-ink'
					}`}
				>
					Driver Take-Rates
				</button>
			</div>

			{/* TAB: FARE CONFIGURATIONS */}
			{activeTab === 'fares' && (
				<div className="space-y-6 animate-fade-in">
					{/* Selection Header */}
					<div className="flex flex-wrap items-center justify-between gap-4 bg-canvas p-4 rounded-xl border border-canvas-soft shadow-sm">
						<div className="flex items-center space-x-4">
							<div className="flex flex-col">
								<label className="text-[10px] uppercase font-bold text-mute mb-1 font-sans">City Shard</label>
								<select
									className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono font-bold"
									value={selectedCity}
									onChange={(e) => setSelectedCity(e.target.value)}
								>
									{cities.map((c) => <option key={c} value={c}>{c}</option>)}
								</select>
							</div>

							<div className="flex flex-col">
								<label className="text-[10px] uppercase font-bold text-mute mb-1 font-sans">Car Class</label>
								<select
									className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
									value={selectedCar}
									onChange={(e) => setSelectedCar(e.target.value)}
								>
									{carTypes.map((c) => <option key={c} value={c}>{c}</option>)}
								</select>
							</div>

							<div className="flex flex-col">
								<label className="text-[10px] uppercase font-bold text-mute mb-1 font-sans">Trip Class</label>
								<select
									className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-semibold capitalize"
									value={selectedTrip}
									onChange={(e) => setSelectedTrip(e.target.value)}
								>
									{tripTypes.map((t) => <option key={t} value={t}>{t}</option>)}
								</select>
							</div>
						</div>

						<button
							onClick={() => setShowHistoryDrawer(true)}
							className="inline-flex items-center border border-canvas-soft hover:border-ink text-xs font-semibold rounded-pill h-8 px-4 transition-colors"
						>
							View History Timeline ({history.length}) ⏱
						</button>
					</div>

					{fareLoading || !fare ? (
						<div className="p-12 text-center text-xs text-mute animate-pulse">Loading fare schedule configurations...</div>
					) : (
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
							{/* Form Panel */}
							<div className="lg:col-span-2 bg-canvas p-6 rounded-xl border border-canvas-soft shadow-sm space-y-6">
								<div>
									<h2 className="text-sm font-bold text-ink uppercase tracking-wider">Fare Matrix Configuration</h2>
									<p className="text-[11px] text-mute mt-0.5">Parameters driving the real-time match dispatch fee generator</p>
								</div>

								{/* Core Fares */}
								<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Base Fare (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
											value={pToR(fare.base_fare_paise)}
											onChange={(e) => setFare({ ...fare, base_fare_paise: rToP(e.target.value) })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Per Km Fare (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
											value={pToR(fare.per_km_fare_paise)}
											onChange={(e) => setFare({ ...fare, per_km_fare_paise: rToP(e.target.value) })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Per Minute Fare (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
											value={pToR(fare.per_minute_fare_paise)}
											onChange={(e) => setFare({ ...fare, per_minute_fare_paise: rToP(e.target.value) })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Minimum Fare (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
											value={pToR(fare.minimum_fare_paise)}
											onChange={(e) => setFare({ ...fare, minimum_fare_paise: rToP(e.target.value) })}
										/>
									</div>
								</div>

								{/* Night Charge Parameters */}
								<div className="grid grid-cols-3 gap-4 border-t border-canvas-soft pt-4">
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Night Charge Start</label>
										<input
											type="text"
											placeholder="23:00"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
											value={fare.night_charge_start}
											onChange={(e) => setFare({ ...fare, night_charge_start: e.target.value })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Night Charge End</label>
										<input
											type="text"
											placeholder="05:00"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
											value={fare.night_charge_end}
											onChange={(e) => setFare({ ...fare, night_charge_end: e.target.value })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Night Multiplier</label>
										<input
											type="number"
											step="0.05"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
											value={fare.night_charge_multiplier}
											onChange={(e) => setFare({ ...fare, night_charge_multiplier: parseFloat(e.target.value) || 1.0 })}
										/>
									</div>
								</div>

								{/* Waiting & Cancellation Fees */}
								<div className="grid grid-cols-4 gap-4 border-t border-canvas-soft pt-4">
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Wait Time Limit (mins)</label>
										<input
											type="number"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
											value={fare.wait_charge_after_minutes}
											onChange={(e) => setFare({ ...fare, wait_charge_after_minutes: parseInt(e.target.value) || 0 })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Wait Fee Per Min (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
											value={pToR(fare.wait_charge_per_minute_paise)}
											onChange={(e) => setFare({ ...fare, wait_charge_per_minute_paise: rToP(e.target.value) })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Rider Cancel Fee (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold text-status-alert"
											value={pToR(fare.cancellation_fee_rider_paise)}
											onChange={(e) => setFare({ ...fare, cancellation_fee_rider_paise: rToP(e.target.value) })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Driver Cancel Fee (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono text-status-alert"
											value={pToR(fare.cancellation_fee_driver_paise)}
											onChange={(e) => setFare({ ...fare, cancellation_fee_driver_paise: rToP(e.target.value) })}
										/>
									</div>
								</div>

								{/* Tax & Extra Fees */}
								<div className="grid grid-cols-4 gap-4 border-t border-canvas-soft pt-4">
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Tax GST (%)</label>
										<input
											type="number"
											step="0.1"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
											value={fare.tax_percent}
											onChange={(e) => setFare({ ...fare, tax_percent: parseFloat(e.target.value) || 0 })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Platform Fee (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
											value={pToR(fare.platform_fee_paise)}
											onChange={(e) => setFare({ ...fare, platform_fee_paise: rToP(e.target.value) })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Convenience Fee (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
											value={pToR(fare.convenience_fee_paise)}
											onChange={(e) => setFare({ ...fare, convenience_fee_paise: rToP(e.target.value) })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">D4M Care Charge (₹)</label>
										<input
											type="number"
											step="0.01"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
											value={pToR(fare.d4m_care_charge_paise)}
											onChange={(e) => setFare({ ...fare, d4m_care_charge_paise: rToP(e.target.value) })}
										/>
									</div>
								</div>

								{/* Outstation Specifics */}
								{(selectedTrip === 'outstation' || selectedTrip === 'mini-outstation') && (
									<div className="grid grid-cols-4 gap-4 border-t border-canvas-soft pt-4 bg-canvas-softer p-3 rounded-lg">
										<div>
											<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Outstation Per Day (₹)</label>
											<input
												type="number"
												step="0.01"
												className="w-full h-8 rounded bg-canvas border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
												value={pToR(fare.outstation_per_day_paise)}
												onChange={(e) => setFare({ ...fare, outstation_per_day_paise: rToP(e.target.value) })}
											/>
										</div>
										<div>
											<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Per Km Outside Shard (₹)</label>
											<input
												type="number"
												step="0.01"
												className="w-full h-8 rounded bg-canvas border border-canvas-soft px-2.5 text-xs text-ink font-mono"
												value={pToR(fare.outstation_km_outside_city_paise)}
												onChange={(e) => setFare({ ...fare, outstation_km_outside_city_paise: rToP(e.target.value) })}
											/>
										</div>
										<div>
											<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Driver Daily Allowance (₹)</label>
											<input
												type="number"
												step="0.01"
												className="w-full h-8 rounded bg-canvas border border-canvas-soft px-2.5 text-xs text-ink font-mono"
												value={pToR(fare.outstation_driver_allowance_paise)}
												onChange={(e) => setFare({ ...fare, outstation_driver_allowance_paise: rToP(e.target.value) })}
											/>
										</div>
										<div>
											<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Night Halt Charge (₹)</label>
											<input
												type="number"
												step="0.01"
												className="w-full h-8 rounded bg-canvas border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
												value={pToR(fare.outstation_night_halt_paise)}
												onChange={(e) => setFare({ ...fare, outstation_night_halt_paise: rToP(e.target.value) })}
											/>
										</div>
									</div>
								)}

								{/* Audit Reason & Commit */}
								<div className="border-t border-canvas-soft pt-4 space-y-4">
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Audit Change Description (Reason)</label>
										<input
											type="text"
											placeholder="e.g. Setting seasonal monsoon adjustments"
											className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
											value={fare.change_reason}
											onChange={(e) => setFare({ ...fare, change_reason: e.target.value })}
										/>
									</div>
									<div className="flex justify-end">
										<button
											onClick={handleSaveFare}
											disabled={!fare.change_reason.trim()}
											className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-9 px-6 hover:bg-black-elevated transition-colors disabled:opacity-50"
										>
											Commit Config Version
										</button>
									</div>
								</div>
							</div>

							{/* Right Metadata Overview Card */}
							<div className="bg-canvas p-5 rounded-xl border border-canvas-soft shadow-sm space-y-4 h-fit">
								<h3 className="text-xs font-bold text-ink uppercase tracking-wider">Active Configuration Info</h3>
								<div className="divide-y divide-canvas-soft text-xs">
									<div className="py-2 flex justify-between">
										<span className="text-mute">Version Code ID</span>
										<span className="font-mono font-bold text-ink">{fare.version_id || 'Initial'}</span>
									</div>
									<div className="py-2 flex justify-between">
										<span className="text-mute">Authorized Editor</span>
										<span className="font-mono text-ink text-[11px]">{fare.created_by || 'system'}</span>
									</div>
									<div className="py-2 flex justify-between">
										<span className="text-mute">Last Committed</span>
										<span className="font-mono text-ink">
											{fare.created_at ? new Date(fare.created_at).toLocaleString() : 'Baseline'}
										</span>
									</div>
								</div>
							</div>
						</div>
					)}
				</div>
			)}

			{/* TAB: SURGE PRICING */}
			{activeTab === 'surge' && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
					{/* Left: Auto Surge Rules */}
					<div className="lg:col-span-2 bg-canvas p-6 rounded-xl border border-canvas-soft shadow-sm space-y-6">
						<div>
							<h2 className="text-sm font-bold text-ink uppercase tracking-wider">Auto-Surge Thresholds</h2>
							<p className="text-[11px] text-mute">Define rule multipliers mapping demand/supply imbalances instantly</p>
						</div>

						{surgeLoading || !surgeRules ? (
							<div className="text-xs text-mute animate-pulse">Loading surge configurations...</div>
						) : (
							<div className="space-y-4">
								<table className="w-full text-left border-collapse text-xs">
									<thead>
										<tr className="border-b border-canvas-soft bg-canvas-soft">
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Min Demand/Supply Ratio</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Surge Multiplier</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute text-right">Action</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-canvas-soft font-mono">
										{surgeRules.auto_rules.map((rule, idx) => (
											<tr key={idx} className="hover:bg-canvas-softer transition-colors">
												<td className="p-3 font-bold text-ink">
													<input
														type="number"
														step="0.1"
														className="bg-transparent border-b border-transparent focus:border-ink focus:outline-none w-20"
														value={rule.min_demand_supply_ratio}
														onChange={(e) => {
															const val = parseFloat(e.target.value) || 0;
															const updated = [...surgeRules.auto_rules];
															updated[idx].min_demand_supply_ratio = val;
															setSurgeRules({ ...surgeRules, auto_rules: updated });
														}}
													/>
													x
												</td>
												<td className="p-3 font-bold text-status-warn">
													<input
														type="number"
														step="0.05"
														className="bg-transparent border-b border-transparent focus:border-ink focus:outline-none w-20"
														value={rule.multiplier}
														onChange={(e) => {
															const val = parseFloat(e.target.value) || 0;
															const updated = [...surgeRules.auto_rules];
															updated[idx].multiplier = val;
															setSurgeRules({ ...surgeRules, auto_rules: updated });
														}}
													/>
													x
												</td>
												<td className="p-3 text-right">
													<button
														onClick={() => {
															const updated = surgeRules.auto_rules.filter((_, i) => i !== idx);
															setSurgeRules({ ...surgeRules, auto_rules: updated });
														}}
														className="text-status-alert text-[10px] font-semibold hover:underline"
													>
														Remove
													</button>
												</td>
											</tr>
										))}
									</tbody>
								</table>

								<div className="flex justify-between items-center pt-3 border-t border-canvas-soft">
									<button
										onClick={() => {
											setSurgeRules({
												...surgeRules,
												auto_rules: [...surgeRules.auto_rules, { min_demand_supply_ratio: 1.0, multiplier: 1.0 }],
											});
										}}
										className="border border-canvas-soft hover:border-ink text-xs font-semibold rounded-pill h-7 px-3 transition-colors"
									>
										Add Threshold Rule +
									</button>
								</div>

								<div className="grid grid-cols-2 gap-4 border-t border-canvas-soft pt-4">
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Absolute Surge Cap Multiplier</label>
										<input
											type="number"
											step="0.1"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
											value={surgeRules.surge_cap}
											onChange={(e) => setSurgeRules({ ...surgeRules, surge_cap: parseFloat(e.target.value) || 1.0 })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Cooldown Period (seconds)</label>
										<input
											type="number"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
											value={surgeRules.cooldown_seconds}
											onChange={(e) => setSurgeRules({ ...surgeRules, cooldown_seconds: parseInt(e.target.value) || 0 })}
										/>
									</div>
								</div>

								<div className="flex justify-end pt-4 border-t border-canvas-soft">
									<button
										onClick={handleSaveSurgeRules}
										className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-9 px-5 hover:bg-black-elevated transition-colors"
									>
										Save Auto-Surge Rules
									</button>
								</div>
							</div>
						)}
					</div>

					{/* Right: Emergency Override Price Cap */}
					<div className="bg-canvas p-5 rounded-xl border border-canvas-soft shadow-sm space-y-4 h-fit">
						<div>
							<h3 className="text-xs font-bold text-ink uppercase tracking-wider">Emergency Surge Overlay</h3>
							<p className="text-[10px] text-mute mt-0.5">Directly engage deflation locks or manual multiplier limits on specific cells</p>
						</div>

						<div className="space-y-3">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">City Shard</label>
								<select
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono font-bold"
									value={overrideCity}
									onChange={(e) => setOverrideCity(e.target.value)}
								>
									{cities.map((c) => <option key={c} value={c}>{c}</option>)}
								</select>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Spatial H3 Cell Index (Hex)</label>
								<input
									type="text"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
									value={overrideCell}
									onChange={(e) => setOverrideCell(e.target.value)}
								/>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Max Multiplier</label>
									<input
										type="number"
										step="0.1"
										className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
										value={overrideMultiplier}
										onChange={(e) => setOverrideMultiplier(e.target.value)}
									/>
								</div>
								<div>
									<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Duration (mins)</label>
									<input
										type="number"
										className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono"
										value={overrideDuration}
										onChange={(e) => setOverrideDuration(e.target.value)}
									/>
								</div>
							</div>

							<button
								onClick={handlePostManualSurge}
								disabled={overrideLoading}
								className="w-full bg-status-alert text-on-dark text-xs font-semibold rounded-pill h-8 hover:bg-status-alert/90 transition-colors mt-2"
							>
								{overrideLoading ? 'Engaging Override...' : 'Engage Emergency Pricing Valve'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* TAB: DRIVER COMMISSION */}
			{activeTab === 'commission' && (
				<div className="space-y-6 animate-fade-in">
					<div className="flex flex-wrap items-center justify-between gap-4 bg-canvas p-4 rounded-xl border border-canvas-soft shadow-sm">
						<div className="flex items-center space-x-4">
							<div className="flex flex-col">
								<label className="text-[10px] uppercase font-bold text-mute mb-1 font-sans">City Shard</label>
								<select
									className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono font-bold"
									value={selectedCommCity}
									onChange={(e) => setSelectedCommCity(e.target.value)}
								>
									{cities.map((c) => <option key={c} value={c}>{c}</option>)}
								</select>
							</div>

							<div className="flex flex-col">
								<label className="text-[10px] uppercase font-bold text-mute mb-1 font-sans">Car Class</label>
								<select
									className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
									value={selectedCommCar}
									onChange={(e) => setSelectedCommCar(e.target.value)}
								>
									{carTypes.map((c) => <option key={c} value={c}>{c}</option>)}
								</select>
							</div>
						</div>
					</div>

					{commLoading || !commission ? (
						<div className="p-12 text-center text-xs text-mute animate-pulse">Loading commission settings...</div>
					) : (
						<div className="bg-canvas p-6 rounded-xl border border-canvas-soft shadow-sm max-w-xl space-y-6">
							<div>
								<h2 className="text-sm font-bold text-ink uppercase tracking-wider">Driver Commission Model</h2>
								<p className="text-[11px] text-mute mt-0.5">Define take-rate structures or flat-fee flat subscriptions for drivers</p>
							</div>

							{/* Select Model Type */}
							<div className="flex items-center space-x-4 bg-canvas-soft p-1 rounded-pill max-w-xs">
								<button
									onClick={() => setCommission({ ...commission, model_type: 'TIERED' })}
									className={`flex-1 h-8 rounded-pill text-xs font-semibold transition-colors ${
										commission.model_type === 'TIERED' ? 'bg-canvas text-ink border border-canvas-soft' : 'text-mute hover:text-ink'
									}`}
								>
									Volume Tiers
								</button>
								<button
									onClick={() => setCommission({ ...commission, model_type: 'SUBSCRIPTION' })}
									className={`flex-1 h-8 rounded-pill text-xs font-semibold transition-colors ${
										commission.model_type === 'SUBSCRIPTION' ? 'bg-canvas text-ink border border-canvas-soft' : 'text-mute hover:text-ink'
									}`}
								>
									Flat Subscription
								</button>
							</div>

							{/* Model: Tiered volume percentage take rate */}
							{commission.model_type === 'TIERED' && (
								<div className="space-y-4">
									<h4 className="text-[10px] font-bold text-mute uppercase tracking-wider">Completed Trips volume brackets</h4>
									<table className="w-full text-left border-collapse text-xs">
										<thead>
											<tr className="border-b border-canvas-soft bg-canvas-soft">
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Min Completed Trips</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Max Completed Trips</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Take Rate Percent (%)</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute text-right">Action</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-canvas-soft font-mono">
											{(commission.tiers || []).map((tier, idx) => (
												<tr key={idx} className="hover:bg-canvas-softer transition-colors">
													<td className="p-3 font-semibold text-ink">
														<input
															type="number"
															className="bg-transparent border-b border-transparent focus:border-ink focus:outline-none w-16"
															value={tier.min_trips}
															onChange={(e) => {
																const val = parseInt(e.target.value) || 0;
																const updated = [...(commission.tiers || [])];
																updated[idx].min_trips = val;
																setCommission({ ...commission, tiers: updated });
															}}
														/>
													</td>
													<td className="p-3 font-semibold text-ink">
														<input
															type="number"
															className="bg-transparent border-b border-transparent focus:border-ink focus:outline-none w-16"
															value={tier.max_trips}
															onChange={(e) => {
																const val = parseInt(e.target.value) || 9999;
																const updated = [...(commission.tiers || [])];
																updated[idx].max_trips = val;
																setCommission({ ...commission, tiers: updated });
															}}
														/>
													</td>
													<td className="p-3 font-bold text-ink">
														<input
															type="number"
															step="0.5"
															className="bg-transparent border-b border-transparent focus:border-ink focus:outline-none w-16 text-status-warn"
															value={tier.take_rate_percent}
															onChange={(e) => {
																const val = parseFloat(e.target.value) || 0.0;
																const updated = [...(commission.tiers || [])];
																updated[idx].take_rate_percent = val;
																setCommission({ ...commission, tiers: updated });
															}}
														/>
														%
													</td>
													<td className="p-3 text-right">
														<button
															onClick={() => {
																const updated = (commission.tiers || []).filter((_, i) => i !== idx);
																setCommission({ ...commission, tiers: updated });
															}}
															className="text-status-alert text-[10px] font-semibold hover:underline"
														>
															Remove
														</button>
													</td>
												</tr>
											))}
										</tbody>
									</table>

									<button
										onClick={() => {
											setCommission({
												...commission,
												tiers: [...(commission.tiers || []), { min_trips: 0, max_trips: 10, take_rate_percent: 15.0 }],
											});
										}}
										className="border border-canvas-soft hover:border-ink text-xs font-semibold rounded-pill h-7 px-3 transition-colors"
									>
										Add Tier Bracket +
									</button>
								</div>
							)}

							{/* Model: Subscription Flat Fee */}
							{commission.model_type === 'SUBSCRIPTION' && (
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Flat Subscription Fee (₹)</label>
										<input
											type="number"
											step="1.0"
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink font-mono font-bold"
											value={pToR(commission.subscription_flat_paise || 0)}
											onChange={(e) => setCommission({ ...commission, subscription_flat_paise: rToP(e.target.value) })}
										/>
									</div>
									<div>
										<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Period cycle</label>
										<select
											className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
											value={commission.subscription_period || 'DAILY'}
											onChange={(e) => setCommission({ ...commission, subscription_period: e.target.value })}
										>
											<option value="DAILY">Daily Flat Ticket</option>
											<option value="WEEKLY">Weekly Flat Ticket</option>
										</select>
									</div>
								</div>
							)}

							<div className="flex justify-end pt-4 border-t border-canvas-soft">
								<button
									onClick={handleSaveCommission}
									className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-9 px-6 hover:bg-black-elevated transition-colors"
								>
									Save Take-Rate Parameters
								</button>
							</div>
						</div>
					)}
				</div>
			)}

			{/* Fares Versioning History Drawer Modal */}
			{showHistoryDrawer && (
				<div className="fixed inset-0 bg-black/45 flex justify-end z-50 animate-fade-in">
					<div className="bg-canvas border-l border-canvas-soft w-96 h-full p-5 space-y-4 shadow-xl flex flex-col justify-between overflow-y-auto">
						<div className="space-y-4">
							<div className="flex justify-between items-center">
								<h3 className="text-sm font-bold text-ink uppercase tracking-wider">Fare Revisions History</h3>
								<button
									onClick={() => setShowHistoryDrawer(false)}
									className="text-xs text-mute hover:text-ink font-bold"
								>
									Close ✕
								</button>
							</div>
							<p className="text-[11px] text-mute">List of historical modifications committed for active segment parameters</p>

							{history.length === 0 ? (
								<div className="text-xs text-mute py-8 text-center">No historic version logs found.</div>
							) : (
								<div className="space-y-3">
									{history.map((hItem, idx) => (
										<div key={idx} className="bg-canvas-softer p-3 rounded-lg border border-canvas-soft space-y-2 text-xs">
											<div className="flex justify-between items-center font-mono">
												<span className="font-bold text-ink text-[10px]">Ver ID: {hItem.version_id}</span>
												<span className="text-[9px] bg-canvas border border-canvas-soft px-1.5 py-0.5 rounded text-mute uppercase font-bold">
													Rev #{history.length - idx}
												</span>
											</div>
											<div className="text-ink text-[11px] font-sans font-semibold">
												Reason: {hItem.change_reason || 'Manual revision change'}
											</div>
											<div className="text-[10px] text-mute font-mono flex justify-between pt-1">
												<span>By: {hItem.created_by}</span>
												<span>{hItem.created_at ? new Date(hItem.created_at).toLocaleDateString() : '—'}</span>
											</div>
											<div className="flex justify-end pt-1">
												<button
													onClick={() => hItem.version_id && handleRevertVersion(hItem.version_id)}
													className="bg-canvas hover:bg-canvas-soft text-[10px] font-bold border border-canvas-soft text-ink rounded px-2.5 py-1"
												>
													Restore Version
												</button>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
