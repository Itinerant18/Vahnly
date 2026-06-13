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
	model_type: string;
	tiers?: TakeRateTier[];
	subscription_flat_paise?: number;
	subscription_period?: string;
}

const inputCls =
	'w-full h-8 rounded-sm bg-background-secondary border-0 px-3 text-mono-small font-mono text-right text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base';

const selectCls =
	'h-8 rounded-sm bg-background-secondary border border-border-opaque px-3 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base';

export const PricingDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<'fares' | 'surge' | 'commission'>('fares');
	const [cities] = useState<string[]>(['KOL', 'BLR', 'DEL', 'MUM']);
	const [carTypes] = useState<string[]>(['Hatchback', 'Sedan', 'SUV', 'Premium']);
	const [tripTypes] = useState<string[]>(['in-city round', 'one-way', 'mini-outstation', 'outstation']);

	const [selectedCity, setSelectedCity] = useState<string>('KOL');
	const [selectedCar, setSelectedCar] = useState<string>('Hatchback');
	const [selectedTrip, setSelectedTrip] = useState<string>('one-way');
	const [fare, setFare] = useState<FareConfig | null>(null);
	const [history, setHistory] = useState<FareConfig[]>([]);
	const [fareLoading, setFareLoading] = useState<boolean>(true);
	const [showHistoryDrawer, setShowHistoryDrawer] = useState<boolean>(false);

	const [surgeRules, setSurgeRules] = useState<SurgeRules | null>(null);
	const [surgeLoading, setSurgeLoading] = useState<boolean>(true);
	const [overrideCity, setOverrideCity] = useState<string>('KOL');
	const [overrideCell, setOverrideCell] = useState<string>('893085811bbffff');
	const [overrideMultiplier, setOverrideMultiplier] = useState<string>('2.0');
	const [overrideDuration, setOverrideDuration] = useState<string>('30');
	const [overrideLoading, setOverrideLoading] = useState<boolean>(false);

	const [selectedCommCity, setSelectedCommCity] = useState<string>('KOL');
	const [selectedCommCar, setSelectedCommCar] = useState<string>('Hatchback');
	const [commission, setCommission] = useState<CommissionSettings | null>(null);
	const [commLoading, setCommLoading] = useState<boolean>(true);

	const fetchFares = async () => {
		setFareLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/fares?city=${selectedCity}&car_type=${selectedCar}&trip_type=${selectedTrip}`, {
				headers: { 'X-Admin-Role': role },
			});
			if (res.ok) setFare(await res.json());
			const histRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/fares/history?city=${selectedCity}&car_type=${selectedCar}&trip_type=${selectedTrip}`, {
				headers: { 'X-Admin-Role': role },
			});
			if (histRes.ok) setHistory((await histRes.json()) || []);
		} catch (err) {
			console.error('Failed to fetch fares', err);
		} finally {
			setFareLoading(false);
		}
	};

	const fetchSurgeRules = async () => {
		setSurgeLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/surge/rules`, { headers: { 'X-Admin-Role': role } });
			if (res.ok) setSurgeRules(await res.json());
		} catch (err) {
			console.error('Failed to fetch surge rules', err);
		} finally {
			setSurgeLoading(false);
		}
	};

	const fetchCommission = async () => {
		setCommLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/commission?city=${selectedCommCity}&car_type=${selectedCommCar}`, {
				headers: { 'X-Admin-Role': role },
			});
			if (res.ok) setCommission(await res.json());
		} catch (err) {
			console.error('Failed to fetch commissions', err);
		} finally {
			setCommLoading(false);
		}
	};

	useEffect(() => { fetchFares(); }, [selectedCity, selectedCar, selectedTrip]);
	useEffect(() => {
		if (activeTab === 'surge') fetchSurgeRules();
		if (activeTab === 'commission') fetchCommission();
	}, [activeTab, selectedCommCity, selectedCommCar]);

	const handleSaveFare = async () => {
		if (!fare) return;
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/fares`, {
				method: 'POST',
				headers: { 'X-Admin-Role': role, 'Content-Type': 'application/json' },
				body: JSON.stringify(fare),
			});
			if (res.ok) { alert('Fare configuration version committed successfully.'); fetchFares(); }
			else alert('Failed to save fare configuration');
		} catch (err) { console.error(err); alert('Network request execution failure.'); }
	};

	const handleRevertVersion = async (versionID: number) => {
		if (!confirm('Revert the active fare configuration to this version?')) return;
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/fares/revert`, {
				method: 'POST',
				headers: { 'X-Admin-Role': role, 'Content-Type': 'application/json' },
				body: JSON.stringify({ city_prefix: selectedCity, car_type: selectedCar, trip_type: selectedTrip, version_id: versionID }),
			});
			if (res.ok) { alert('Active configuration successfully reverted to historical version.'); setShowHistoryDrawer(false); fetchFares(); }
			else alert('Reversion execution failed');
		} catch (err) { console.error(err); alert('Network request execution failure.'); }
	};

	const handleSaveSurgeRules = async () => {
		if (!surgeRules) return;
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/surge/rules`, {
				method: 'POST',
				headers: { 'X-Admin-Role': role, 'Content-Type': 'application/json' },
				body: JSON.stringify(surgeRules),
			});
			if (res.ok) { alert('Surge thresholds updated successfully.'); fetchSurgeRules(); }
			else alert('Failed to save surge thresholds');
		} catch (err) { console.error(err); alert('Network request execution failure.'); }
	};

	const handlePostManualSurge = async () => {
		setOverrideLoading(true);
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/freeze`, {
				method: 'POST',
				headers: { 'X-Admin-Role': role, 'Content-Type': 'application/json' },
				body: JSON.stringify({ city_prefix: overrideCity, h3_cell: overrideCell, max_multiplier: parseFloat(overrideMultiplier), duration_minutes: parseInt(overrideDuration) }),
			});
			if (res.ok) alert('Emergency Surge Deflation Valve successfully engaged.');
			else alert('Emergency pricing override failed. Check authorization clearances.');
		} catch (err) { console.error(err); alert('Network request execution failure.'); }
		finally { setOverrideLoading(false); }
	};

	const handleSaveCommission = async () => {
		if (!commission) return;
		try {
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/commission`, {
				method: 'POST',
				headers: { 'X-Admin-Role': role, 'Content-Type': 'application/json' },
				body: JSON.stringify(commission),
			});
			if (res.ok) { alert('Driver take-rate commission settings updated.'); fetchCommission(); }
			else alert('Failed to save commission configurations');
		} catch (err) { console.error(err); alert('Network request execution failure.'); }
	};

	const pToR = (paise: number) => (paise / 100).toFixed(2);
	const rToP = (rupeesStr: string) => Math.round(parseFloat(rupeesStr) * 100) || 0;

	const TabBtn = ({ k, label }: { k: 'fares' | 'surge' | 'commission'; label: string }) => (
		<button
			onClick={() => setActiveTab(k)}
			className={`flex-1 h-9 rounded-pill text-label-small font-semibold transition-base ${
				activeTab === k ? 'bg-interactive-primary text-interactive-primary-text shadow-sm' : 'text-content-secondary hover:text-content-primary'
			}`}
		>
			{label}
		</button>
	);

	const FareRow = ({ label, value, onChange, step = '0.01', type = 'number' }: { label: string; value: string | number; onChange: (v: string) => void; step?: string; type?: string }) => (
		<div className="flex items-center justify-between py-2.5 border-b border-border-opaque last:border-0 gap-4">
			<span className="text-label-small uppercase tracking-wide text-content-secondary whitespace-nowrap shrink-0">{label}</span>
			<input
				type={type}
				step={step}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="h-8 rounded-sm bg-background-secondary border-0 px-3 text-mono-small font-mono text-right text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base w-32"
			/>
		</div>
	);

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6 bg-background-primary">
			<div>
				<h1 className="text-heading-xl text-content-primary">Pricing &amp; Surge Configurations</h1>
				<p className="text-paragraph-small text-content-secondary mt-1">
					Configure versioned fare schedules, emergency auto-surge thresholds, manual pricing locks, and driver commissions
				</p>
			</div>

			{/* Tab Bar */}
			<div className="flex bg-background-secondary rounded-pill p-1 gap-1 max-w-sm">
				<TabBtn k="fares" label="Fare Settings" />
				<TabBtn k="surge" label="Surge & Caps" />
				<TabBtn k="commission" label="Driver Take-Rates" />
			</div>

			{/* ── FARES TAB ── */}
			{activeTab === 'fares' && (
				<div className="space-y-6">
					<div className="card flex flex-wrap items-center justify-between gap-4">
						<div className="flex items-center gap-4">
							{[
								{ lbl: 'City Shard', val: selectedCity, set: setSelectedCity, opts: cities },
								{ lbl: 'Car Class', val: selectedCar, set: setSelectedCar, opts: carTypes },
								{ lbl: 'Trip Class', val: selectedTrip, set: setSelectedTrip, opts: tripTypes },
							].map(({ lbl, val, set, opts }) => (
								<div key={lbl} className="flex flex-col gap-1">
									<label className="text-label-small uppercase text-content-tertiary">{lbl}</label>
									<select className={selectCls} value={val} onChange={(e) => set(e.target.value)}>
										{opts.map((o) => <option key={o} value={o}>{o}</option>)}
									</select>
								</div>
							))}
						</div>
						<button
							onClick={() => setShowHistoryDrawer(true)}
							className="inline-flex items-center gap-2 border border-border-opaque hover:border-content-primary text-label-small font-semibold rounded-pill h-9 px-4 text-content-secondary hover:text-content-primary transition-base"
						>
							View History Timeline ({history.length}) ⏱
						</button>
					</div>

					{fareLoading || !fare ? (
						<div className="p-12 text-center text-paragraph-small text-content-tertiary animate-pulse">Loading fare schedule configurations...</div>
					) : (
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
							<div className="lg:col-span-2 card space-y-4">
								<div>
									<h2 className="text-label-large uppercase tracking-wider text-content-primary">Fare Matrix Configuration</h2>
									<p className="text-paragraph-small text-content-secondary mt-0.5">Parameters driving the real-time match dispatch fee generator</p>
								</div>

								<div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
									<FareRow label="Base Fare (₹)" value={pToR(fare.base_fare_paise)} onChange={(v) => setFare({ ...fare, base_fare_paise: rToP(v) })} />
									<FareRow label="Per Km Fare (₹)" value={pToR(fare.per_km_fare_paise)} onChange={(v) => setFare({ ...fare, per_km_fare_paise: rToP(v) })} />
									<FareRow label="Per Minute Fare (₹)" value={pToR(fare.per_minute_fare_paise)} onChange={(v) => setFare({ ...fare, per_minute_fare_paise: rToP(v) })} />
									<FareRow label="Minimum Fare (₹)" value={pToR(fare.minimum_fare_paise)} onChange={(v) => setFare({ ...fare, minimum_fare_paise: rToP(v) })} />
								</div>

								<div className="border-t border-border-opaque pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8">
									<FareRow label="Night Charge Start" type="text" step="" value={fare.night_charge_start} onChange={(v) => setFare({ ...fare, night_charge_start: v })} />
									<FareRow label="Night Charge End" type="text" step="" value={fare.night_charge_end} onChange={(v) => setFare({ ...fare, night_charge_end: v })} />
									<FareRow label="Night Multiplier (×)" step="0.05" value={fare.night_charge_multiplier} onChange={(v) => setFare({ ...fare, night_charge_multiplier: parseFloat(v) || 1.0 })} />
								</div>

								<div className="border-t border-border-opaque pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8">
									<FareRow label="Wait Time Limit (mins)" step="1" value={fare.wait_charge_after_minutes} onChange={(v) => setFare({ ...fare, wait_charge_after_minutes: parseInt(v) || 0 })} />
									<FareRow label="Wait Fee Per Min (₹)" value={pToR(fare.wait_charge_per_minute_paise)} onChange={(v) => setFare({ ...fare, wait_charge_per_minute_paise: rToP(v) })} />
									<FareRow label="Rider Cancel Fee (₹)" value={pToR(fare.cancellation_fee_rider_paise)} onChange={(v) => setFare({ ...fare, cancellation_fee_rider_paise: rToP(v) })} />
									<FareRow label="Driver Cancel Fee (₹)" value={pToR(fare.cancellation_fee_driver_paise)} onChange={(v) => setFare({ ...fare, cancellation_fee_driver_paise: rToP(v) })} />
								</div>

								<div className="border-t border-border-opaque pt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8">
									<FareRow label="Tax GST (%)" step="0.1" value={fare.tax_percent} onChange={(v) => setFare({ ...fare, tax_percent: parseFloat(v) || 0 })} />
									<FareRow label="Platform Fee (₹)" value={pToR(fare.platform_fee_paise)} onChange={(v) => setFare({ ...fare, platform_fee_paise: rToP(v) })} />
									<FareRow label="Convenience Fee (₹)" value={pToR(fare.convenience_fee_paise)} onChange={(v) => setFare({ ...fare, convenience_fee_paise: rToP(v) })} />
									<FareRow label="D4M Care Charge (₹)" value={pToR(fare.d4m_care_charge_paise)} onChange={(v) => setFare({ ...fare, d4m_care_charge_paise: rToP(v) })} />
								</div>

								{(selectedTrip === 'outstation' || selectedTrip === 'mini-outstation') && (
									<div className="border-t border-border-opaque pt-4 bg-background-tertiary rounded-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-x-8">
										<FareRow label="Outstation Per Day (₹)" value={pToR(fare.outstation_per_day_paise)} onChange={(v) => setFare({ ...fare, outstation_per_day_paise: rToP(v) })} />
										<FareRow label="Per Km Outside Shard (₹)" value={pToR(fare.outstation_km_outside_city_paise)} onChange={(v) => setFare({ ...fare, outstation_km_outside_city_paise: rToP(v) })} />
										<FareRow label="Driver Daily Allowance (₹)" value={pToR(fare.outstation_driver_allowance_paise)} onChange={(v) => setFare({ ...fare, outstation_driver_allowance_paise: rToP(v) })} />
										<FareRow label="Night Halt Charge (₹)" value={pToR(fare.outstation_night_halt_paise)} onChange={(v) => setFare({ ...fare, outstation_night_halt_paise: rToP(v) })} />
									</div>
								)}

								<div className="border-t border-border-opaque pt-4 space-y-3">
									<div>
										<label className="block text-label-small uppercase text-content-tertiary mb-1">Audit Change Description (Reason)</label>
										<input
											type="text"
											placeholder="e.g. Setting seasonal monsoon adjustments"
											className="w-full h-9 rounded-sm bg-background-secondary border border-border-opaque px-3 text-label-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-400 transition-base"
											value={fare.change_reason}
											onChange={(e) => setFare({ ...fare, change_reason: e.target.value })}
										/>
									</div>
									<div className="flex justify-end">
										<button onClick={handleSaveFare} disabled={!fare.change_reason.trim()} className="btn-primary disabled:opacity-50">
											Commit Config Version
										</button>
									</div>
								</div>
							</div>

							{/* Metadata card */}
							<div className="card space-y-4 h-fit">
								<h3 className="text-label-medium uppercase tracking-wider text-content-primary">Active Configuration Info</h3>
								<div className="divide-y divide-border-opaque text-paragraph-small">
									<div className="py-2 flex justify-between">
										<span className="text-content-secondary">Version Code ID</span>
										<span className="font-mono text-content-primary font-semibold">{fare.version_id || 'Initial'}</span>
									</div>
									<div className="py-2 flex justify-between">
										<span className="text-content-secondary">Authorized Editor</span>
										<span className="font-mono text-content-primary">{fare.created_by || 'system'}</span>
									</div>
									<div className="py-2 flex justify-between">
										<span className="text-content-secondary">Last Committed</span>
										<span className="font-mono text-content-primary">
											{fare.created_at ? new Date(fare.created_at).toLocaleString() : 'Baseline'}
										</span>
									</div>
								</div>
							</div>
						</div>
					)}
				</div>
			)}

			{/* ── SURGE TAB ── */}
			{activeTab === 'surge' && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					<div className="lg:col-span-2 card space-y-6">
						<div>
							<h2 className="text-label-large uppercase tracking-wider text-content-primary">Auto-Surge Thresholds</h2>
							<p className="text-paragraph-small text-content-secondary">Define rule multipliers mapping demand/supply imbalances instantly</p>
						</div>

						{surgeLoading || !surgeRules ? (
							<div className="text-paragraph-small text-content-tertiary animate-pulse">Loading surge configurations...</div>
						) : (
							<div className="space-y-4">
								<div className="space-y-2">
									{surgeRules.auto_rules.map((rule, idx) => (
										<div key={idx} className="flex items-center gap-4 p-4 rounded-sm border border-border-opaque bg-background-secondary transition-base hover:bg-background-tertiary">
											<div className="flex items-center gap-2 flex-1">
												<span className="text-label-small text-content-tertiary whitespace-nowrap">Min D/S Ratio</span>
												<input
													type="number"
													step="0.1"
													className="w-20 bg-transparent border-b border-border-opaque focus:border-accent-400 focus:outline-none font-mono text-mono-small text-content-primary text-right"
													value={rule.min_demand_supply_ratio}
													onChange={(e) => {
														const updated = [...surgeRules.auto_rules];
														updated[idx].min_demand_supply_ratio = parseFloat(e.target.value) || 0;
														setSurgeRules({ ...surgeRules, auto_rules: updated });
													}}
												/>
											</div>
											<div className="flex items-center gap-2">
												<span className="text-label-small text-content-tertiary whitespace-nowrap">Multiplier</span>
												<input
													type="number"
													step="0.05"
													className="w-20 bg-transparent border-b border-border-opaque focus:border-accent-400 focus:outline-none font-mono text-mono-small text-content-warning font-semibold text-right"
													value={rule.multiplier}
													onChange={(e) => {
														const updated = [...surgeRules.auto_rules];
														updated[idx].multiplier = parseFloat(e.target.value) || 0;
														setSurgeRules({ ...surgeRules, auto_rules: updated });
													}}
												/>
											</div>
											<button
												onClick={() => setSurgeRules({ ...surgeRules, auto_rules: surgeRules.auto_rules.filter((_, i) => i !== idx) })}
												className="text-content-negative text-label-small font-semibold hover:underline transition-base"
											>
												Remove
											</button>
										</div>
									))}
								</div>

								<button
									onClick={() => setSurgeRules({ ...surgeRules, auto_rules: [...surgeRules.auto_rules, { min_demand_supply_ratio: 1.0, multiplier: 1.0 }] })}
									className="border border-border-opaque hover:border-content-primary text-label-small font-semibold rounded-pill h-8 px-4 text-content-secondary hover:text-content-primary transition-base"
								>
									Add Threshold Rule +
								</button>

								<div className="grid grid-cols-2 gap-4 border-t border-border-opaque pt-4">
									<div>
										<label className="block text-label-small uppercase text-content-tertiary mb-1">Absolute Surge Cap Multiplier</label>
										<input type="number" step="0.1" className={inputCls} value={surgeRules.surge_cap} onChange={(e) => setSurgeRules({ ...surgeRules, surge_cap: parseFloat(e.target.value) || 1.0 })} />
									</div>
									<div>
										<label className="block text-label-small uppercase text-content-tertiary mb-1">Cooldown Period (seconds)</label>
										<input type="number" className={inputCls} value={surgeRules.cooldown_seconds} onChange={(e) => setSurgeRules({ ...surgeRules, cooldown_seconds: parseInt(e.target.value) || 0 })} />
									</div>
								</div>

								<div className="flex justify-end border-t border-border-opaque pt-4">
									<button onClick={handleSaveSurgeRules} className="btn-primary">Save Auto-Surge Rules</button>
								</div>
							</div>
						)}
					</div>

					<div className="card space-y-4 h-fit">
						<div>
							<h3 className="text-label-medium uppercase tracking-wider text-content-primary">Emergency Surge Overlay</h3>
							<p className="text-paragraph-small text-content-secondary mt-0.5">Directly engage deflation locks or manual multiplier limits on specific cells</p>
						</div>
						<div className="space-y-3">
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">City Shard</label>
								<select className={`${selectCls} w-full`} value={overrideCity} onChange={(e) => setOverrideCity(e.target.value)}>
									{cities.map((c) => <option key={c} value={c}>{c}</option>)}
								</select>
							</div>
							<div>
								<label className="block text-label-small uppercase text-content-tertiary mb-1">Spatial H3 Cell Index (Hex)</label>
								<input type="text" className={`${inputCls} text-left`} value={overrideCell} onChange={(e) => setOverrideCell(e.target.value)} />
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className="block text-label-small uppercase text-content-tertiary mb-1">Max Multiplier</label>
									<input type="number" step="0.1" className={inputCls} value={overrideMultiplier} onChange={(e) => setOverrideMultiplier(e.target.value)} />
								</div>
								<div>
									<label className="block text-label-small uppercase text-content-tertiary mb-1">Duration (mins)</label>
									<input type="number" className={inputCls} value={overrideDuration} onChange={(e) => setOverrideDuration(e.target.value)} />
								</div>
							</div>
							<button
								onClick={handlePostManualSurge}
								disabled={overrideLoading}
								className="w-full bg-surface-negative text-content-negative border border-negative-200 text-label-small font-semibold rounded-pill h-9 hover:bg-negative-100 transition-base disabled:opacity-50"
							>
								{overrideLoading ? 'Engaging Override...' : 'Engage Emergency Pricing Valve'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── COMMISSION TAB ── */}
			{activeTab === 'commission' && (
				<div className="space-y-6">
					<div className="card flex flex-wrap items-center gap-4">
						<div className="flex flex-col gap-1">
							<label className="text-label-small uppercase text-content-tertiary">City Shard</label>
							<select className={selectCls} value={selectedCommCity} onChange={(e) => setSelectedCommCity(e.target.value)}>
								{cities.map((c) => <option key={c} value={c}>{c}</option>)}
							</select>
						</div>
						<div className="flex flex-col gap-1">
							<label className="text-label-small uppercase text-content-tertiary">Car Class</label>
							<select className={selectCls} value={selectedCommCar} onChange={(e) => setSelectedCommCar(e.target.value)}>
								{carTypes.map((c) => <option key={c} value={c}>{c}</option>)}
							</select>
						</div>
					</div>

					{commLoading || !commission ? (
						<div className="p-12 text-center text-paragraph-small text-content-tertiary animate-pulse">Loading commission settings...</div>
					) : (
						<div className="card max-w-2xl space-y-6">
							<div>
								<h2 className="text-label-large uppercase tracking-wider text-content-primary">Driver Commission Model</h2>
								<p className="text-paragraph-small text-content-secondary mt-0.5">Define take-rate structures or flat-fee flat subscriptions for drivers</p>
							</div>

							<div className="flex bg-background-secondary rounded-pill p-1 gap-1 max-w-xs">
								{(['TIERED', 'SUBSCRIPTION'] as const).map((mt) => (
									<button
										key={mt}
										onClick={() => setCommission({ ...commission, model_type: mt })}
										className={`flex-1 h-8 rounded-pill text-label-small font-semibold transition-base ${
											commission.model_type === mt ? 'bg-interactive-primary text-interactive-primary-text shadow-sm' : 'text-content-secondary hover:text-content-primary'
										}`}
									>
										{mt === 'TIERED' ? 'Volume Tiers' : 'Flat Subscription'}
									</button>
								))}
							</div>

							{commission.model_type === 'TIERED' && (
								<div className="space-y-3">
									<h4 className="text-label-small uppercase text-content-tertiary">Completed trips volume brackets</h4>
									<div className="rounded-sm border border-border-opaque overflow-hidden">
										<table className="w-full text-left border-collapse">
											<thead>
												<tr className="bg-background-tertiary border-b border-border-opaque">
													<th className="p-3 text-label-small uppercase text-content-tertiary">Min Trips</th>
													<th className="p-3 text-label-small uppercase text-content-tertiary">Max Trips</th>
													<th className="p-3 text-label-small uppercase text-content-tertiary text-right">Take Rate %</th>
													<th className="p-3 text-label-small uppercase text-content-tertiary text-right">Action</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-border-opaque">
												{(commission.tiers || []).map((tier, idx) => (
													<tr key={idx} className="hover:bg-background-secondary transition-base">
														<td className="p-3">
															<input type="number" className="bg-transparent border-b border-border-opaque focus:border-accent-400 focus:outline-none w-16 font-mono text-mono-small text-content-primary text-right" value={tier.min_trips} onChange={(e) => { const updated = [...(commission.tiers || [])]; updated[idx].min_trips = parseInt(e.target.value) || 0; setCommission({ ...commission, tiers: updated }); }} />
														</td>
														<td className="p-3">
															<input type="number" className="bg-transparent border-b border-border-opaque focus:border-accent-400 focus:outline-none w-16 font-mono text-mono-small text-content-primary text-right" value={tier.max_trips} onChange={(e) => { const updated = [...(commission.tiers || [])]; updated[idx].max_trips = parseInt(e.target.value) || 9999; setCommission({ ...commission, tiers: updated }); }} />
														</td>
														<td className="p-3 text-right">
															<input type="number" step="0.5" className="bg-transparent border-b border-border-opaque focus:border-accent-400 focus:outline-none w-16 font-mono text-mono-small text-content-warning font-semibold text-right" value={tier.take_rate_percent} onChange={(e) => { const updated = [...(commission.tiers || [])]; updated[idx].take_rate_percent = parseFloat(e.target.value) || 0; setCommission({ ...commission, tiers: updated }); }} />
															<span className="text-content-tertiary ml-1">%</span>
														</td>
														<td className="p-3 text-right">
															<button onClick={() => setCommission({ ...commission, tiers: (commission.tiers || []).filter((_, i) => i !== idx) })} className="text-content-negative text-label-small font-semibold hover:underline transition-base">Remove</button>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
									<button
										onClick={() => setCommission({ ...commission, tiers: [...(commission.tiers || []), { min_trips: 0, max_trips: 10, take_rate_percent: 15.0 }] })}
										className="border border-border-opaque hover:border-content-primary text-label-small font-semibold rounded-pill h-8 px-4 text-content-secondary hover:text-content-primary transition-base"
									>
										Add Tier Bracket +
									</button>
								</div>
							)}

							{commission.model_type === 'SUBSCRIPTION' && (
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className="block text-label-small uppercase text-content-tertiary mb-1">Flat Subscription Fee (₹)</label>
										<input type="number" step="1.0" className={inputCls} value={pToR(commission.subscription_flat_paise || 0)} onChange={(e) => setCommission({ ...commission, subscription_flat_paise: rToP(e.target.value) })} />
									</div>
									<div>
										<label className="block text-label-small uppercase text-content-tertiary mb-1">Period Cycle</label>
										<select className={`${selectCls} w-full`} value={commission.subscription_period || 'DAILY'} onChange={(e) => setCommission({ ...commission, subscription_period: e.target.value })}>
											<option value="DAILY">Daily Flat Ticket</option>
											<option value="WEEKLY">Weekly Flat Ticket</option>
										</select>
									</div>
								</div>
							)}

							<div className="flex justify-end border-t border-border-opaque pt-4">
								<button onClick={handleSaveCommission} className="btn-primary">Save Take-Rate Parameters</button>
							</div>
						</div>
					)}
				</div>
			)}

			{/* ── HISTORY DRAWER ── */}
			{showHistoryDrawer && (
				<div className="fixed inset-0 bg-background-secondary0/40 flex justify-end z-50">
					<div className="bg-background-primary border-l border-border-opaque w-96 h-full p-5 space-y-4 shadow-xl flex flex-col overflow-y-auto">
						<div className="flex justify-between items-center">
							<h3 className="text-label-large uppercase tracking-wider text-content-primary">Fare Revisions History</h3>
							<button onClick={() => setShowHistoryDrawer(false)} className="text-label-small text-content-secondary hover:text-content-primary font-bold transition-base">Close ✕</button>
						</div>
						<p className="text-paragraph-small text-content-secondary">List of historical modifications committed for active segment parameters</p>
						{history.length === 0 ? (
							<div className="text-paragraph-small text-content-tertiary py-8 text-center">No historic version logs found.</div>
						) : (
							<div className="space-y-3">
								{history.map((hItem, idx) => (
									<div key={idx} className="card space-y-2">
										<div className="flex justify-between items-center">
											<span className="font-mono text-mono-small text-content-primary font-semibold">Ver ID: {hItem.version_id}</span>
											<span className="badge badge-neutral">Rev #{history.length - idx}</span>
										</div>
										<div className="text-label-medium text-content-primary">Reason: {hItem.change_reason || 'Manual revision change'}</div>
										<div className="flex justify-between text-paragraph-small text-content-tertiary font-mono">
											<span>By: {hItem.created_by}</span>
											<span>{hItem.created_at ? new Date(hItem.created_at).toLocaleDateString() : '—'}</span>
										</div>
										<div className="flex justify-end">
											<button
												onClick={() => hItem.version_id && handleRevertVersion(hItem.version_id)}
												className="border border-border-opaque hover:border-content-primary text-label-small font-semibold rounded-sm px-3 py-1.5 text-content-secondary hover:text-content-primary transition-base"
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
			)}
		</div>
	);
};
