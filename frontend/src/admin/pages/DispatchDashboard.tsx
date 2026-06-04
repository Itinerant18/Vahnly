import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

export interface CityHub {
	city_prefix: string;
	city_name: string;
	timezone: string;
	is_active: boolean;
	polygon_coordinates: [number, number][];
	operating_hours_start: string;
	operating_hours_end: string;
	supported_trip_types: string[];
	supported_car_types: string[];
}

export interface GeofenceZone {
	id?: string;
	zone_name: string;
	city_prefix: string;
	is_active: boolean;
	polygon_coordinates: [number, number][];
	policy_type: string; // ACTIVE_DISPATCH, BLACKLIST_BLOCK, SURGE_FLOOR_FORCE, TRANSMISSION_RESTRICT
	surge_multiplier: number;
	allowed_transmissions: string; // ALL, AUTOMATIC_ONLY, MANUAL_ONLY
	activation_start?: string;
	activation_end?: string;
	notes?: string;
}

export interface DispatchRules {
	matching_radius_map: Record<string, number>;
	max_wait_time_seconds: number;
	max_retries: number;
	min_driver_rating: number;
	min_driver_acceptance_rate: number;
	transmission_capability: string;
	priority_order: string;
	outstation_pre_assignment_minutes: number;
	outstation_advance_payment_pct: number;
}

export const DispatchDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<'cities' | 'zones' | 'geofences' | 'rules'>('cities');
	const [cities, setCities] = useState<CityHub[]>([]);
	const [zones, setZones] = useState<GeofenceZone[]>([]);
	const [loading, setLoading] = useState<boolean>(true);

	// Selected Shard for Rules Editor
	const [selectedRulesCity, setSelectedRulesCity] = useState<string>('KOL');
	const [rules, setRules] = useState<DispatchRules | null>(null);
	const [rulesLoading, setRulesLoading] = useState<boolean>(false);

	// Dialog Forms States
	const [showCityModal, setShowCityModal] = useState<boolean>(false);
	const [newCityPrefix, setNewCityPrefix] = useState<string>('');
	const [newCityName, setNewCityName] = useState<string>('');
	const [newCityTimezone, setNewCityTimezone] = useState<string>('Asia/Kolkata');
	const [newCityActive, setNewCityActive] = useState<boolean>(true);
	const [newCityHoursStart, setNewCityHoursStart] = useState<string>('00:00');
	const [newCityHoursEnd, setNewCityHoursEnd] = useState<string>('23:59');
	const [newCityTripTypes, setNewCityTripTypes] = useState<string[]>(['in-city round', 'one-way', 'mini-outstation', 'outstation']);
	const [newCityCarTypes, setNewCityCarTypes] = useState<string[]>(['Hatchback', 'Sedan', 'SUV', 'Premium']);
	const [newCityCoordsText, setNewCityCoordsText] = useState<string>('22.5726 88.3639, 22.5800 88.3700, 22.5900 88.3500');

	// Zone / Geofence Form States
	const [showZoneModal, setShowZoneModal] = useState<boolean>(false);
	const [zoneName, setZoneName] = useState<string>('');
	const [zoneCity, setZoneCity] = useState<string>('KOL');
	const [zoneActive, setZoneActive] = useState<boolean>(true);
	const [zonePolicy, setZonePolicy] = useState<string>('ACTIVE_DISPATCH');
	const [zoneSurge, setZoneSurge] = useState<number>(1.00);
	const [zoneTransmission, setZoneTransmission] = useState<string>('ALL');
	const [zoneNotes, setZoneNotes] = useState<string>('');
	const [zoneCoordsText, setZoneCoordsText] = useState<string>('22.5600 88.3500, 22.5650 88.3550, 22.5550 88.3600');

	const fetchCities = async () => {
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/dispatch/cities`, {
				headers: { Authorization: `Bearer ${token}`, 'X-Admin-Role': role },
			});
			if (res.ok) {
				const data = await res.json();
				setCities(data || []);
			}
		} catch (err) {
			console.error('Failed to fetch cities', err);
		}
	};

	const fetchZonesAndGeofences = async () => {
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/geofence`, {
				headers: { Authorization: `Bearer ${token}`, 'X-Admin-Role': role },
			});
			if (res.ok) {
				const data = await res.json();
				setZones(data.zones || []);
			}
		} catch (err) {
			console.error('Failed to fetch zones', err);
		}
	};

	const fetchRulesForCity = async (prefix: string) => {
		setRulesLoading(true);
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/dispatch/rules/${prefix}`, {
				headers: { Authorization: `Bearer ${token}`, 'X-Admin-Role': role },
			});
			if (res.ok) {
				const data = await res.json();
				setRules(data);
			}
		} catch (err) {
			console.error('Failed to fetch rules', err);
		} finally {
			setRulesLoading(false);
		}
	};

	const loadAllData = async () => {
		setLoading(true);
		await Promise.all([fetchCities(), fetchZonesAndGeofences()]);
		setLoading(false);
	};

	useEffect(() => {
		loadAllData();
	}, []);

	useEffect(() => {
		if (selectedRulesCity) {
			fetchRulesForCity(selectedRulesCity);
		}
	}, [selectedRulesCity]);

	// City Submit Actions
	const handleSaveCity = async () => {
		if (!newCityPrefix || !newCityName) {
			alert('City Prefix and Name are required');
			return;
		}

		// Parse WKT polygon points
		const coords: [number, number][] = [];
		try {
			const points = newCityCoordsText.split(',');
			for (const pt of points) {
				const parts = pt.trim().split(/\s+/);
				if (parts.length === 2) {
					coords.push([parseFloat(parts[0]), parseFloat(parts[1])]);
				}
			}
		} catch (e) {
			alert('Invalid coordinates format. Use: lat lon, lat lon');
			return;
		}

		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/dispatch/cities`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					city_prefix: newCityPrefix.toUpperCase(),
					city_name: newCityName,
					timezone: newCityTimezone,
					is_active: newCityActive,
					operating_hours_start: newCityHoursStart,
					operating_hours_end: newCityHoursEnd,
					supported_trip_types: newCityTripTypes,
					supported_car_types: newCityCarTypes,
					polygon_coordinates: coords,
				}),
			});

			if (res.ok) {
				alert('City hub configuration committed successfully.');
				setShowCityModal(false);
				loadAllData();
			} else {
				alert('Failed to save city configuration');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Zone / Geofence Submit Actions
	const handleSaveZone = async () => {
		if (!zoneName) {
			alert('Zone Name is required');
			return;
		}

		const coords: [number, number][] = [];
		try {
			const points = zoneCoordsText.split(',');
			for (const pt of points) {
				const parts = pt.trim().split(/\s+/);
				if (parts.length === 2) {
					coords.push([parseFloat(parts[0]), parseFloat(parts[1])]);
				}
			}
		} catch (e) {
			alert('Invalid coordinates format. Use: lat lon, lat lon');
			return;
		}

		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/geofence`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					zone_name: zoneName,
					city_prefix: zoneCity,
					is_active: zoneActive,
					policy_type: zonePolicy,
					surge_multiplier: parseFloat(zoneSurge.toString()),
					allowed_transmissions: zoneTransmission,
					polygon_coordinates: coords,
					notes: zoneNotes,
				}),
			});

			if (res.ok) {
				alert('Geofence zone geometry upserted successfully.');
				setShowZoneModal(false);
				fetchZonesAndGeofences();
			} else {
				alert('Failed to save geofence configuration');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Save Dispatch Rules Config
	const handleSaveRules = async () => {
		if (!rules) return;
		try {
			const token = localStorage.getItem('admin_jwt_token') || '';
			const role = localStorage.getItem('admin_role') || 'ADMIN';
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/dispatch/rules/${selectedRulesCity}`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Admin-Role': role,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(rules),
			});

			if (res.ok) {
				alert(`Rules configuration for ${selectedRulesCity} updated successfully.`);
				fetchRulesForCity(selectedRulesCity);
			} else {
				alert('Failed to update dispatch rules');
			}
		} catch (err) {
			console.error(err);
			alert('Network request execution failure.');
		}
	};

	// Checkbox toggle helpers
	const toggleTripType = (type: string) => {
		setNewCityTripTypes((prev) =>
			prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
		);
	};

	const toggleCarType = (type: string) => {
		setNewCityCarTypes((prev) =>
			prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
		);
	};

	// Sub-zones inside city filter
	const subZonesOnly = zones.filter((z) => z.policy_type !== 'BLACKLIST_BLOCK');
	const geofencesOnly = zones.filter((z) => z.policy_type === 'BLACKLIST_BLOCK');

	return (
		<div className="w-full h-full overflow-y-auto p-6 space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight text-ink">Dispatch & Zones Configuration</h1>
				<p className="text-xs text-mute mt-1">Configure service area polygons, sub-zones, routing matching parameters, and restricted geofences</p>
			</div>

			{/* Navigation Tabs */}
			<div className="flex border-b border-canvas-soft bg-canvas rounded-xl p-1 shadow-sm max-w-lg">
				<button
					onClick={() => setActiveTab('cities')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'cities' ? 'bg-canvas-soft text-ink border-canvas-soft border' : 'text-mute hover:text-ink'
					}`}
				>
					Cities & Service Areas
				</button>
				<button
					onClick={() => setActiveTab('zones')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'zones' ? 'bg-canvas-soft text-ink border-canvas-soft border' : 'text-mute hover:text-ink'
					}`}
				>
					Sub-Zones
				</button>
				<button
					onClick={() => setActiveTab('geofences')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'geofences' ? 'bg-canvas-soft text-ink border-canvas-soft border' : 'text-mute hover:text-ink'
					}`}
				>
					Geofences
				</button>
				<button
					onClick={() => setActiveTab('rules')}
					className={`flex-1 h-9 rounded-pill text-xs font-semibold transition-colors ${
						activeTab === 'rules' ? 'bg-canvas-soft text-ink border-canvas-soft border' : 'text-mute hover:text-ink'
					}`}
				>
					Rules Engine
				</button>
			</div>

			{loading ? (
				<div className="p-12 text-center text-xs text-mute animate-pulse">Loading dispatch configurations...</div>
			) : (
				<>
					{/* TAB: CITIES & SERVICE AREAS */}
					{activeTab === 'cities' && (
						<div className="space-y-6">
							<div className="flex justify-between items-center bg-canvas p-4 rounded-xl border border-canvas-soft shadow-sm">
								<div>
									<h2 className="text-sm font-bold text-ink">Active Service Cities</h2>
									<p className="text-[11px] text-mute">Manage core operating regional polygons and active service slots</p>
								</div>
								<button
									onClick={() => {
										setNewCityPrefix('');
										setNewCityName('');
										setNewCityCoordsText('22.5726 88.3639, 22.5800 88.3700, 22.5900 88.3500');
										setShowCityModal(true);
									}}
									className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
								>
									Add Regional City +
								</button>
							</div>

							<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
								{/* Left: Cities Table list */}
								<div className="lg:col-span-2 bg-canvas rounded-xl border border-canvas-soft overflow-hidden shadow-sm">
									<table className="w-full text-left border-collapse text-xs">
										<thead>
											<tr className="border-b border-canvas-soft bg-canvas-soft">
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Prefix</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">City Name</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Operating Hours</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Trip Types</th>
												<th className="p-3 text-[10px] font-semibold uppercase text-mute">Status</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-canvas-soft">
											{cities.map((city) => (
												<tr key={city.city_prefix} className="hover:bg-canvas-softer transition-colors">
													<td className="p-3 font-mono font-bold text-ink">{city.city_prefix}</td>
													<td className="p-3 font-semibold text-ink">{city.city_name}</td>
													<td className="p-3 font-mono text-body">
														{city.operating_hours_start} - {city.operating_hours_end}
													</td>
													<td className="p-3">
														<div className="flex flex-wrap gap-1.5">
															{city.supported_trip_types.map((type) => (
																<span key={type} className="text-[9px] uppercase tracking-wider bg-canvas-soft border border-canvas-soft rounded-pill px-2 py-0.5 text-mute font-bold">
																	{type}
																</span>
															))}
														</div>
													</td>
													<td className="p-3">
														<span className={`inline-flex items-center text-[9px] font-bold uppercase border rounded-pill h-5 px-2.5 tracking-wider ${
															city.is_active ? 'bg-canvas text-ink border-canvas-soft' : 'bg-canvas-soft text-mute border-canvas-soft'
														}`}>
															<span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${city.is_active ? 'bg-status-online' : 'bg-mute'}`} />
															{city.is_active ? 'active' : 'disabled'}
														</span>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>

								{/* Right: City Boundary Vector Visualizer (Mock Map) */}
								<div className="bg-canvas p-4 rounded-xl border border-canvas-soft shadow-sm flex flex-col justify-between space-y-4">
									<div>
										<h3 className="text-xs font-bold text-ink uppercase tracking-wider">Service Boundary Map</h3>
										<p className="text-[10px] text-mute">Geometric layout visualization of city boundary coordinates</p>
									</div>

									<div className="aspect-square bg-canvas-soft rounded-xl border border-canvas-soft flex items-center justify-center relative overflow-hidden">
										{/* Mock SVG Map coordinates */}
										<svg className="w-full h-full p-4" viewBox="0 0 100 100">
											<polygon points="50,20 80,45 70,80 30,80 20,45" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink stroke-dasharray-[2,2]" />
											<circle cx="50" cy="20" r="2" className="fill-ink" />
											<circle cx="80" cy="45" r="2" className="fill-ink" />
											<circle cx="70" cy="80" r="2" className="fill-ink" />
											<circle cx="30" cy="80" r="2" className="fill-ink" />
											<circle cx="20" cy="45" r="2" className="fill-ink" />
										</svg>
										<div className="absolute bottom-2 right-2 bg-canvas px-2 py-1 rounded border border-canvas-soft text-[9px] font-mono text-mute">
											Lon/Lat Vector Scaled
										</div>
									</div>

									<div className="text-[10px] text-mute">
										Select a city prefix on the rules engine tab to adjust its matching radius coordinates.
									</div>
								</div>
							</div>
						</div>
					)}

					{/* TAB: SUB-ZONES */}
					{activeTab === 'zones' && (
						<div className="space-y-6">
							<div className="flex justify-between items-center bg-canvas p-4 rounded-xl border border-canvas-soft shadow-sm">
								<div>
									<h2 className="text-sm font-bold text-ink">Sub-Zones inside Cities</h2>
									<p className="text-[11px] text-mute">Create rules overrides (airports, stations, high demand points) within regional bounds</p>
								</div>
								<button
									onClick={() => {
										setZoneName('');
										setZonePolicy('SURGE_FLOOR_FORCE');
										setZoneCoordsText('22.5600 88.3500, 22.5650 88.3550, 22.5550 88.3600');
										setShowZoneModal(true);
									}}
									className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
								>
									Add Sub-Zone +
								</button>
							</div>

							<div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden shadow-sm">
								<table className="w-full text-left border-collapse text-xs">
									<thead>
										<tr className="border-b border-canvas-soft bg-canvas-soft">
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Zone Name</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">City prefix</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Policy rules</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute text-center">Surge floor</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Allowed Transmissions</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Notes</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-canvas-soft">
										{subZonesOnly.map((z) => (
											<tr key={z.id || z.zone_name} className="hover:bg-canvas-softer transition-colors">
												<td className="p-3 font-semibold text-ink">{z.zone_name}</td>
												<td className="p-3 font-mono font-semibold text-body">{z.city_prefix}</td>
												<td className="p-3">
													<span className="text-[10px] uppercase font-bold text-ink bg-canvas-soft px-2 py-0.5 rounded border border-canvas-soft">
														{z.policy_type.replace('_', ' ').toLowerCase()}
													</span>
												</td>
												<td className="p-3 font-mono font-bold text-ink text-center">
													{z.surge_multiplier.toFixed(2)}x
												</td>
												<td className="p-3 uppercase font-semibold text-mute text-[10px]">
													{z.allowed_transmissions}
												</td>
												<td className="p-3 text-mute max-w-xs truncate">{z.notes || '—'}</td>
												<td className="p-3">
													<span className={`inline-flex items-center text-[9px] font-bold uppercase border rounded-pill h-5 px-2 tracking-wider ${
														z.is_active ? 'bg-canvas text-ink border-canvas-soft' : 'bg-canvas-soft text-mute border-canvas-soft'
													}`}>
														<span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${z.is_active ? 'bg-status-online' : 'bg-mute'}`} />
														{z.is_active ? 'active' : 'disabled'}
													</span>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{/* TAB: RESTRICTED GEOFENCES */}
					{activeTab === 'geofences' && (
						<div className="space-y-6">
							<div className="flex justify-between items-center bg-canvas p-4 rounded-xl border border-canvas-soft shadow-sm">
								<div>
									<h2 className="text-sm font-bold text-ink">Restricted Geofence Blacklists</h2>
									<p className="text-[11px] text-mute">Establish sensitive polygons blocklisting pickup/drop operations or enforcing surcharges</p>
								</div>
								<button
									onClick={() => {
										setZoneName('');
										setZonePolicy('BLACKLIST_BLOCK');
										setZoneCoordsText('22.5400 88.3300, 22.5450 88.3350, 22.5350 88.3400');
										setShowZoneModal(true);
									}}
									className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
								>
									Add Restricted Fence +
								</button>
							</div>

							<div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden shadow-sm">
								<table className="w-full text-left border-collapse text-xs">
									<thead>
										<tr className="border-b border-canvas-soft bg-canvas-soft">
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Fence Name</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">City Shard</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Restrictions</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Coordinates Polygon</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Notes</th>
											<th className="p-3 text-[10px] font-semibold uppercase text-mute">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-canvas-soft">
										{geofencesOnly.map((z) => (
											<tr key={z.id || z.zone_name} className="hover:bg-canvas-softer transition-colors">
												<td className="p-3 font-semibold text-ink text-status-alert">{z.zone_name}</td>
												<td className="p-3 font-mono font-semibold text-body">{z.city_prefix}</td>
												<td className="p-3">
													<span className="text-[9px] uppercase font-bold text-on-dark bg-status-alert px-2 py-0.5 rounded-pill tracking-wider">
														BLOCK ALL DISPATCH
													</span>
												</td>
												<td className="p-3 font-mono text-mute text-[10px]">
													{z.polygon_coordinates ? `${z.polygon_coordinates.length} vertices` : 'None'}
												</td>
												<td className="p-3 text-mute max-w-xs truncate">{z.notes || '—'}</td>
												<td className="p-3">
													<span className={`inline-flex items-center text-[9px] font-bold uppercase border rounded-pill h-5 px-2 tracking-wider bg-canvas border-canvas-soft text-ink`}>
														<span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-status-alert" />
														blocked
													</span>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{/* TAB: DISPATCH RULES ENGINE */}
					{activeTab === 'rules' && (
						<div className="space-y-6">
							<div className="flex justify-between items-center bg-canvas p-4 rounded-xl border border-canvas-soft shadow-sm">
								<div>
									<h2 className="text-sm font-bold text-ink">Rules & Radius Configurations</h2>
									<p className="text-[11px] text-mute">Modify dispatch filters, wait limits, eligibility thresholds, and priority strategy per city</p>
								</div>
								<div className="flex items-center space-x-3">
									<label className="text-[10px] uppercase font-bold text-mute font-sans">Select City Shard:</label>
									<select
										className="h-8 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono font-bold"
										value={selectedRulesCity}
										onChange={(e) => setSelectedRulesCity(e.target.value)}
									>
										{cities.map((c) => (
											<option key={c.city_prefix} value={c.city_prefix}>
												{c.city_prefix} ({c.city_name})
											</option>
										))}
									</select>
								</div>
							</div>

							{rulesLoading || !rules ? (
								<div className="p-12 text-center text-xs text-mute animate-pulse">Fetching rules parameters...</div>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-canvas p-6 rounded-xl border border-canvas-soft shadow-sm">
									{/* Column 1: Matching Radius & Dispatch Waits */}
									<div className="space-y-5">
										<h3 className="text-xs font-bold uppercase text-ink border-b border-canvas-soft pb-2 tracking-wider">Matching Radius & Timing</h3>

										{/* Radius Sliders */}
										<div className="space-y-4">
											<h4 className="text-[10px] font-bold text-mute uppercase">Matching Radius bounds (km)</h4>
											{Object.keys(rules.matching_radius_map || {}).map((tripType) => (
												<div key={tripType} className="flex items-center justify-between space-x-4">
													<label className="text-xs capitalize font-semibold text-body w-32">{tripType}</label>
													<input
														type="range"
														min="1"
														max="25"
														step="0.5"
														className="flex-1 accent-ink cursor-pointer"
														value={rules.matching_radius_map[tripType]}
														onChange={(e) => {
															const newVal = parseFloat(e.target.value);
															setRules((prev) => {
																if (!prev) return null;
																return {
																	...prev,
																	matching_radius_map: {
																		...prev.matching_radius_map,
																		[tripType]: newVal,
																	},
																};
															});
														}}
													/>
													<span className="text-xs font-mono font-bold text-ink w-12 text-right">
														{rules.matching_radius_map[tripType].toFixed(1)} km
													</span>
												</div>
											))}
										</div>

										<div className="grid grid-cols-2 gap-4">
											{/* Max Wait Time */}
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Max Match Wait Time (seconds)</label>
												<input
													type="number"
													className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
													value={rules.max_wait_time_seconds}
													onChange={(e) => {
														const val = parseInt(e.target.value) || 0;
														setRules((prev) => prev ? { ...prev, max_wait_time_seconds: val } : null);
													}}
												/>
											</div>

											{/* Max Retries */}
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Max Match Retries</label>
												<input
													type="number"
													className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
													value={rules.max_retries}
													onChange={(e) => {
														const val = parseInt(e.target.value) || 0;
														setRules((prev) => prev ? { ...prev, max_retries: val } : null);
													}}
												/>
											</div>
										</div>
									</div>

									{/* Column 2: Driver Eligibility & Priorities */}
									<div className="space-y-5">
										<h3 className="text-xs font-bold uppercase text-ink border-b border-canvas-soft pb-2 tracking-wider">Driver Eligibility & Strategy</h3>

										<div className="grid grid-cols-2 gap-4">
											{/* Min Rating */}
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Min Driver Rating Threshold</label>
												<input
													type="number"
													step="0.1"
													min="3.0"
													max="5.0"
													className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono font-bold"
													value={rules.min_driver_rating}
													onChange={(e) => {
														const val = parseFloat(e.target.value) || 0;
														setRules((prev) => prev ? { ...prev, min_driver_rating: val } : null);
													}}
												/>
											</div>

											{/* Min Acceptance */}
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Min Acceptance Rate (%)</label>
												<input
													type="number"
													min="0"
													max="100"
													className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
													value={Math.round(rules.min_driver_acceptance_rate * 100)}
													onChange={(e) => {
														const val = (parseInt(e.target.value) || 0) / 100;
														setRules((prev) => prev ? { ...prev, min_driver_acceptance_rate: val } : null);
													}}
												/>
											</div>
										</div>

										<div className="grid grid-cols-2 gap-4">
											{/* Transmission Matching */}
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Transmission Match Rules</label>
												<select
													className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
													value={rules.transmission_capability}
													onChange={(e) => {
														const val = e.target.value;
														setRules((prev) => prev ? { ...prev, transmission_capability: val } : null);
													}}
												>
													<option value="ALL">Allow All Drivers</option>
													<option value="MATCH">Enforce Strict Transmission Match</option>
												</select>
											</div>

											{/* Dispatch Priority */}
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Prioritization Strategy</label>
												<select
													className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink"
													value={rules.priority_order}
													onChange={(e) => {
														const val = e.target.value;
														setRules((prev) => prev ? { ...prev, priority_order: val } : null);
													}}
												>
													<option value="NEAREST">Nearest Available (Radial Grid)</option>
													<option value="HIGHEST_RATED">Highest Rating First</option>
													<option value="ROUND_ROBIN">Round-Robin Cycle</option>
												</select>
											</div>
										</div>

										<div className="grid grid-cols-2 gap-4 border-t border-canvas-soft pt-3">
											{/* Outstation Window */}
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Outstation Pre-assignment (mins)</label>
												<input
													type="number"
													className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
													value={rules.outstation_pre_assignment_minutes}
													onChange={(e) => {
														const val = parseInt(e.target.value) || 0;
														setRules((prev) => prev ? { ...prev, outstation_pre_assignment_minutes: val } : null);
													}}
												/>
											</div>

											{/* Advance Payment % */}
											<div>
												<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Outstation Advance Deposit %</label>
												<input
													type="number"
													min="0"
													max="100"
													className="w-full h-9 rounded bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink focus:outline-none focus:border-ink font-mono"
													value={rules.outstation_advance_payment_pct}
													onChange={(e) => {
														const val = parseInt(e.target.value) || 0;
														setRules((prev) => prev ? { ...prev, outstation_advance_payment_pct: val } : null);
													}}
												/>
											</div>
										</div>
									</div>

									{/* Save Action */}
									<div className="col-span-1 md:col-span-2 flex justify-end pt-4 border-t border-canvas-soft">
										<button
											onClick={handleSaveRules}
											className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-9 px-6 hover:bg-black-elevated transition-colors"
										>
											Commit Dispatch Rules Engine Changes
										</button>
									</div>
								</div>
							)}
						</div>
					)}
				</>
			)}

			{/* City Creation Modal */}
			{showCityModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink font-sans">Add Regional City Hub</h3>
							<p className="text-[11px] text-mute mt-1">Register prefix codes and establish vector polygon geofences</p>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">City Prefix (Code)</label>
								<input
									type="text"
									placeholder="e.g. KOL"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono uppercase font-bold"
									value={newCityPrefix}
									onChange={(e) => setNewCityPrefix(e.target.value)}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">City Name</label>
								<input
									type="text"
									placeholder="e.g. Kolkata"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
									value={newCityName}
									onChange={(e) => setNewCityName(e.target.value)}
								/>
							</div>
						</div>

						<div className="grid grid-cols-3 gap-3">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Timezone</label>
								<input
									type="text"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={newCityTimezone}
									onChange={(e) => setNewCityTimezone(e.target.value)}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Hours Start</label>
								<input
									type="text"
									placeholder="00:00"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={newCityHoursStart}
									onChange={(e) => setNewCityHoursStart(e.target.value)}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Hours End</label>
								<input
									type="text"
									placeholder="23:59"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
									value={newCityHoursEnd}
									onChange={(e) => setNewCityHoursEnd(e.target.value)}
								/>
							</div>
						</div>

						{/* Supported Trip Types Checkboxes */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-semibold">Supported Trip Types</label>
							<div className="flex flex-wrap gap-3">
								{['in-city round', 'one-way', 'mini-outstation', 'outstation'].map((type) => (
									<label key={type} className="flex items-center space-x-1.5 text-xs font-semibold text-ink cursor-pointer">
										<input
											type="checkbox"
											className="w-4 h-4 rounded border-canvas-soft accent-ink"
											checked={newCityTripTypes.includes(type)}
											onChange={() => toggleTripType(type)}
										/>
										<span className="capitalize">{type}</span>
									</label>
								))}
							</div>
						</div>

						{/* Supported Car Types Checkboxes */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-semibold">Supported Car Classes</label>
							<div className="flex flex-wrap gap-4">
								{['Hatchback', 'Sedan', 'SUV', 'Premium'].map((type) => (
									<label key={type} className="flex items-center space-x-1.5 text-xs font-semibold text-ink cursor-pointer">
										<input
											type="checkbox"
											className="w-4 h-4 rounded border-canvas-soft accent-ink"
											checked={newCityCarTypes.includes(type)}
											onChange={() => toggleCarType(type)}
										/>
										<span>{type}</span>
									</label>
								))}
							</div>
						</div>

						{/* Active operating status */}
						<div className="flex items-center space-x-2 pt-1">
							<input
								type="checkbox"
								id="newCityActiveCheckbox"
								className="w-4 h-4 rounded border-canvas-soft accent-ink cursor-pointer"
								checked={newCityActive}
								onChange={(e) => setNewCityActive(e.target.checked)}
							/>
							<label htmlFor="newCityActiveCheckbox" className="text-xs font-semibold text-ink cursor-pointer">
								Active Operating Status
							</label>
						</div>

						{/* Boundary Coordinates Polygon Input */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Geofence Polygon Points (lat lon, lat lon...)</label>
							<textarea
								rows={2}
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2 text-xs text-ink focus:outline-none focus:border-ink font-mono"
								value={newCityCoordsText}
								onChange={(e) => setNewCityCoordsText(e.target.value)}
							/>
							<span className="text-[9px] text-mute mt-1 block">Specify vertices clockwise, closed automatically on save</span>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowCityModal(false)}
								className="text-xs text-body hover:text-ink px-3"
							>
								Cancel
							</button>
							<button
								onClick={handleSaveCity}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
							>
								Commit Shard
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Zone / Geofence Creation Modal */}
			{showZoneModal && (
				<div className="fixed inset-0 bg-black/45 flex items-center justify-center p-4 z-50 animate-fade-in">
					<div className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-xl">
						<div>
							<h3 className="text-sm font-bold text-ink font-sans">
								{zonePolicy === 'BLACKLIST_BLOCK' ? 'Add Restricted Geofence Blacklist' : 'Add Sub-Zone Rules'}
							</h3>
							<p className="text-[11px] text-mute mt-1">Configure vector boundaries and match policies</p>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Zone/Fence Name</label>
								<input
									type="text"
									placeholder="e.g. Airport Area"
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-semibold"
									value={zoneName}
									onChange={(e) => setZoneName(e.target.value)}
								/>
							</div>

							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">City Shard</label>
								<select
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono font-bold"
									value={zoneCity}
									onChange={(e) => setZoneCity(e.target.value)}
								>
									{cities.map((c) => (
										<option key={c.city_prefix} value={c.city_prefix}>{c.city_prefix}</option>
									))}
								</select>
							</div>
						</div>

						{zonePolicy !== 'BLACKLIST_BLOCK' && (
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Policy Action Rule</label>
									<select
										className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink"
										value={zonePolicy}
										onChange={(e) => setZonePolicy(e.target.value)}
									>
										<option value="ACTIVE_DISPATCH">Standard Dispatch Area</option>
										<option value="SURGE_FLOOR_FORCE">Enforce Surge Floor</option>
										<option value="TRANSMISSION_RESTRICT">Restrict Transmission Cap</option>
									</select>
								</div>

								<div>
									<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Surge Floor Multiplier</label>
									<input
										type="number"
										step="0.1"
										min="1.0"
										max="4.0"
										className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink font-mono"
										value={zoneSurge}
										onChange={(e) => setZoneSurge(parseFloat(e.target.value) || 1.00)}
									/>
								</div>
							</div>
						)}

						{zonePolicy === 'TRANSMISSION_RESTRICT' && (
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Enforced Transmission Cert</label>
								<select
									className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink"
									value={zoneTransmission}
									onChange={(e) => setZoneTransmission(e.target.value)}
								>
									<option value="ALL">Allow All Types</option>
									<option value="AUTOMATIC_ONLY">Automatic Only</option>
									<option value="MANUAL_ONLY">Manual Only</option>
								</select>
							</div>
						)}

						{/* Zone active status */}
						<div className="flex items-center space-x-2 pt-1">
							<input
								type="checkbox"
								id="zoneActiveCheckbox"
								className="w-4 h-4 rounded border-canvas-soft accent-ink cursor-pointer"
								checked={zoneActive}
								onChange={(e) => setZoneActive(e.target.checked)}
							/>
							<label htmlFor="zoneActiveCheckbox" className="text-xs font-semibold text-ink cursor-pointer">
								Zone Enabled & Active
							</label>
						</div>

						{/* Geofence Points */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Boundary Coordinates Polygon (lat lon, lat lon...)</label>
							<textarea
								rows={2}
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2 text-xs text-ink focus:outline-none focus:border-ink font-mono"
								value={zoneCoordsText}
								onChange={(e) => setZoneCoordsText(e.target.value)}
							/>
						</div>

						{/* Notes */}
						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-semibold">Notes / Audit Remarks</label>
							<input
								type="text"
								placeholder="e.g. Enforcing airport toll rules override"
								className="w-full h-8 rounded bg-canvas-soft border border-canvas-soft px-2.5 text-xs text-ink focus:outline-none focus:border-ink"
								value={zoneNotes}
								onChange={(e) => setZoneNotes(e.target.value)}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								onClick={() => setShowZoneModal(false)}
								className="text-xs text-body hover:text-ink px-3"
							>
								Cancel
							</button>
							<button
								onClick={handleSaveZone}
								className="bg-ink text-on-dark text-xs font-semibold rounded-pill h-8 px-4 hover:bg-black-elevated transition-colors"
							>
								Upsert Zone
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
