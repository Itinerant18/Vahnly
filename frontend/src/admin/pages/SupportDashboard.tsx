import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface Ticket {
	id: string;
	creator_id: string;
	creator_type: 'RIDER' | 'DRIVER';
	creator_name: string;
	creator_phone: string;
	channel: 'CHAT' | 'EMAIL' | 'PHONE' | 'SOS';
	subject: string;
	description: string;
	priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
	status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
	category: 'TRIP' | 'PAYMENT' | 'DRIVER_BEHAVIOR' | 'LOST_ITEM' | 'ACCOUNT' | 'SAFETY' | 'OTHER';
	assigned_agent_id?: string | null;
	assigned_agent_name?: string | null;
	tags: string[];
	sla_deadline: string;
	sla_breach: boolean;
	escalated_to?: string | null;
	linked_trip_id?: string | null;
	resolution_type?: string | null;
	resolution_reason?: string | null;
	created_at: string;
	updated_at: string;
	closed_at?: string | null;
}

interface Message {
	id: number;
	ticket_id: string;
	sender_id: string;
	sender_name: string;
	sender_type: 'AGENT' | 'USER' | 'SYSTEM';
	message_type: 'CHAT' | 'EMAIL' | 'CALL_NOTE' | 'INTERNAL_NOTE';
	content: string;
	attachment_urls: string[];
	created_at: string;
}

interface CSAT {
	ticket_id: string;
	rating: number;
	comment?: string | null;
	submitted_at: string;
}

interface LostItem {
	id: number;
	ticket_id?: string | null;
	trip_id?: string | null;
	reporter_id: string;
	reporter_type: string;
	item_description: string;
	status: 'REPORTED' | 'FOUND' | 'RETURNED' | 'CLOSED';
	driver_contacted: boolean;
	return_tracking_code?: string | null;
	return_method?: string | null;
	notes?: string | null;
	created_at: string;
	updated_at: string;
}

interface Macro {
	shortcut_code: string;
	category: string;
	title: string;
	template_text: string;
}

interface FAQ {
	id: number;
	title: string;
	category: string;
	content: string;
}

interface Stats {
	my_queue_count: number;
	breached_count: number;
	resolved_today: number;
	resolved_this_week: number;
	average_csat: number;
}

type MainTab = 'TICKETS' | 'LOST_FOUND' | 'KNOWLEDGE_BASE';
type TicketTab = 'ALL' | 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';

export const SupportDashboard: React.FC = () => {
	const [activeMainTab, setActiveMainTab] = useState<MainTab>('TICKETS');
	const [activeTicketTab, setActiveTicketTab] = useState<TicketTab>('ALL');

	// List states
	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [ticketsTotal, setTicketsTotal] = useState<number>(0);
	const [lostItems, setLostItems] = useState<LostItem[]>([]);
	const [macros, setMacros] = useState<Macro[]>([]);
	const [faqs, setFaqs] = useState<FAQ[]>([]);
	const [stats, setStats] = useState<Stats>({
		my_queue_count: 0,
		breached_count: 0,
		resolved_today: 0,
		resolved_this_week: 0,
		average_csat: 5.0,
	});

	// Detail state
	const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
	const [selectedTicketDetail, setSelectedTicketDetail] = useState<{
		ticket: Ticket;
		messages: Message[];
		csat?: CSAT | null;
	} | null>(null);

	// Filters
	const [searchQuery, setSearchQuery] = useState<string>('');
	const [filterPriority, setFilterPriority] = useState<string>('');
	const [filterCategory, setFilterCategory] = useState<string>('');
	const [filterSlaBreach, setFilterSlaBreach] = useState<boolean>(false);
	const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);

	// Editor states
	const [replyContent, setReplyContent] = useState<string>('');
	const [replyMessageType, setReplyMessageType] = useState<'CHAT' | 'EMAIL' | 'INTERNAL_NOTE'>('CHAT');

	// Modals & Popovers
	const [dialingPhone, setDialingPhone] = useState<string | null>(null);
	const [dialSeconds, setDialSeconds] = useState<number>(0);
	const [isDialing, setIsDialing] = useState<boolean>(false);

	const [escalateTicketId, setEscalateTicketId] = useState<string | null>(null);
	const [escalateTo, setEscalateTo] = useState<string>('L2');
	const [escalateNotes, setEscalateNotes] = useState<string>('');

	const [resolveTicketId, setResolveTicketId] = useState<string | null>(null);
	const [resolveType, setResolveType] = useState<string>('MESSAGE');
	const [resolveReason, setResolveReason] = useState<string>('');

	// Create New entities forms
	const [showCreateTicketModal, setShowCreateTicketModal] = useState<boolean>(false);
	const [newTicketForm, setNewTicketForm] = useState({
		creator_id: '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c',
		creator_type: 'RIDER',
		creator_name: '',
		creator_phone: '',
		channel: 'CHAT',
		subject: '',
		description: '',
		priority: 'MEDIUM',
		category: 'OTHER',
		linked_trip_id: '',
	});

	const [showCreateLostModal, setShowCreateLostModal] = useState<boolean>(false);
	const [newLostForm, setNewLostForm] = useState({
		trip_id: '',
		reporter_id: '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c',
		reporter_type: 'RIDER',
		item_description: '',
		notes: '',
	});

	const [showCreateMacroModal, setShowCreateMacroModal] = useState<boolean>(false);
	const [newMacroForm, setNewMacroForm] = useState({
		shortcut_code: '',
		category: 'General',
		title: '',
		template_text: '',
	});

	const [showCreateFaqModal, setShowCreateFaqModal] = useState<boolean>(false);
	const [newFaqForm, setNewFaqForm] = useState({
		title: '',
		category: 'General',
		content: '',
	});

	const [loading, setLoading] = useState<boolean>(false);
	const [detailLoading, setDetailLoading] = useState<boolean>(false);

	const agentRole = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
	const agentEmail = 'aniketkarmakar018@gmail.com';
	const agentName = 'Aniket karmakar';
	const agentId = '00000000-0000-0000-0000-000000000000'; // mock fallback

	const headers = {
		'X-Admin-Role': agentRole,
		'X-Admin-Email': agentEmail,
		'Content-Type': 'application/json',
	};

	// Fetch Stats
	const fetchStats = async () => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/stats`, { headers });
			if (res.ok) {
				const data = await res.json();
				setStats(data);
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Fetch Tickets
	const fetchTickets = async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (activeTicketTab !== 'ALL') params.append('status', activeTicketTab);
			if (filterPriority) params.append('priority', filterPriority);
			if (filterCategory) params.append('category', filterCategory);
			if (filterSlaBreach) params.append('sla_breach', 'true');
			if (searchQuery) params.append('search', searchQuery);
			params.append('limit', '50');

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/tickets?${params.toString()}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setTickets(data.tickets || []);
				setTicketsTotal(data.total || 0);
			}
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	// Fetch Ticket Detail
	const fetchTicketDetail = async (id: string) => {
		setDetailLoading(true);
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/tickets/${id}`, { headers });
			if (res.ok) {
				const data = await res.json();
				setSelectedTicketDetail(data);
			}
		} catch (err) {
			console.error(err);
		} finally {
			setDetailLoading(false);
		}
	};

	// Fetch Lost & Found Items
	const fetchLostFound = async () => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/lost-found`, { headers });
			if (res.ok) {
				const data = await res.json();
				setLostItems(data || []);
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Fetch KB (Macros & FAQs)
	const fetchKB = async () => {
		try {
			const mRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/macros`, { headers });
			const fRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/faqs`, { headers });
			if (mRes.ok) setMacros(await mRes.json());
			if (fRes.ok) setFaqs(await fRes.json());
		} catch (err) {
			console.error(err);
		}
	};

	useEffect(() => {
		fetchStats();
	}, []);

	useEffect(() => {
		if (activeMainTab === 'TICKETS') {
			fetchTickets();
		} else if (activeMainTab === 'LOST_FOUND') {
			fetchLostFound();
		} else if (activeMainTab === 'KNOWLEDGE_BASE') {
			fetchKB();
		}
	}, [activeMainTab, activeTicketTab, filterPriority, filterCategory, filterSlaBreach, searchQuery]);

	// Auto-reload active ticket details when it changes
	useEffect(() => {
		if (selectedTicket) {
			fetchTicketDetail(selectedTicket.id);
		} else {
			setSelectedTicketDetail(null);
		}
	}, [selectedTicket]);

	// Handlers
	const handleSelectTicket = (tkt: Ticket) => {
		setSelectedTicket(tkt);
	};

	const handlePostMessage = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedTicket || !replyContent.trim()) return;

		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/tickets/${selectedTicket.id}/message`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					sender_id: agentId,
					sender_name: agentName,
					sender_type: 'AGENT',
					message_type: replyMessageType,
					content: replyContent,
				}),
			});

			if (res.ok) {
				setReplyContent('');
				fetchTicketDetail(selectedTicket.id);
				fetchTickets();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleBulkAssign = async () => {
		if (selectedTicketIds.length === 0) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/tickets/bulk-assign`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ ids: selectedTicketIds, agent_id: agentId }),
			});
			if (res.ok) {
				alert(`Successfully assigned ${selectedTicketIds.length} tickets to you.`);
				setSelectedTicketIds([]);
				fetchTickets();
				fetchStats();
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Dialing simulation
	const handleTriggerCall = (phone: string) => {
		setDialingPhone(phone);
		setIsDialing(true);
		setDialSeconds(0);
	};

	// Increment call duration
	useEffect(() => {
		let timer: any;
		if (isDialing) {
			timer = setInterval(() => {
				setDialSeconds((prev) => prev + 1);
			}, 1000);
		}
		return () => clearInterval(timer);
	}, [isDialing]);

	const handleHangUpCall = async () => {
		if (!dialingPhone) return;
		setIsDialing(false);
		const phone = dialingPhone;
		setDialingPhone(null);

		// Post call recording log to selected ticket if any
		if (selectedTicket) {
			try {
				await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/click-to-call`, {
					method: 'POST',
					headers,
					body: JSON.stringify({
						ticket_id: selectedTicket.id,
						phone: phone,
						agent_name: agentName,
						agent_id: agentId,
					}),
				});
				fetchTicketDetail(selectedTicket.id);
			} catch (err) {
				console.error(err);
			}
		}
	};

	// Escalation
	const handleEscalate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!escalateTicketId) return;

		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/tickets/${escalateTicketId}/escalate`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					escalated_to: escalateTo,
					notes: escalateNotes,
					agent_name: agentName,
					agent_id: agentId,
				}),
			});
			if (res.ok) {
				setEscalateTicketId(null);
				setEscalateNotes('');
				if (selectedTicket?.id === escalateTicketId) {
					fetchTicketDetail(escalateTicketId);
				}
				fetchTickets();
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Resolution
	const handleResolve = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!resolveTicketId) return;

		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/tickets/${resolveTicketId}/resolve`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					resolution_type: resolveType,
					resolution_reason: resolveReason,
					agent_name: agentName,
					agent_id: agentId,
				}),
			});
			if (res.ok) {
				setResolveTicketId(null);
				setResolveReason('');
				if (selectedTicket?.id === resolveTicketId) {
					fetchTicketDetail(resolveTicketId);
				}
				fetchTickets();
				fetchStats();
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Close
	const handleClose = async (id: string) => {
		if (!confirm('Are you sure you want to close this ticket?')) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/tickets/${id}/close`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ agent_name: agentName, agent_id: agentId }),
			});
			if (res.ok) {
				fetchTickets();
				fetchStats();
				if (selectedTicket?.id === id) {
					fetchTicketDetail(id);
				}
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Lost item handlers
	const handleUpdateLostItem = async (itemId: number, fields: any) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/lost-found/${itemId}`, {
				method: 'POST', // handler maps POST/PATCH
				headers,
				body: JSON.stringify(fields),
			});
			if (res.ok) {
				fetchLostFound();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleCreateTicket = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/tickets`, {
				method: 'POST',
				headers,
				body: JSON.stringify(newTicketForm),
			});
			if (res.ok) {
				setShowCreateTicketModal(false);
				setNewTicketForm({
					creator_id: '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c',
					creator_type: 'RIDER',
					creator_name: '',
					creator_phone: '',
					channel: 'CHAT',
					subject: '',
					description: '',
					priority: 'MEDIUM',
					category: 'OTHER',
					linked_trip_id: '',
				});
				fetchTickets();
				fetchStats();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleCreateLost = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/lost-found`, {
				method: 'POST',
				headers,
				body: JSON.stringify(newLostForm),
			});
			if (res.ok) {
				setShowCreateLostModal(false);
				setNewLostForm({
					trip_id: '',
					reporter_id: '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c',
					reporter_type: 'RIDER',
					item_description: '',
					notes: '',
				});
				fetchLostFound();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleCreateMacro = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/macros`, {
				method: 'POST',
				headers,
				body: JSON.stringify(newMacroForm),
			});
			if (res.ok) {
				setShowCreateMacroModal(false);
				setNewMacroForm({
					shortcut_code: '',
					category: 'General',
					title: '',
					template_text: '',
				});
				fetchKB();
			}
		} catch (err) {
			console.error(err);
		}
	};

	const handleCreateFAQ = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/support/faqs`, {
				method: 'POST',
				headers,
				body: JSON.stringify(newFaqForm),
			});
			if (res.ok) {
				setShowCreateFaqModal(false);
				setNewFaqForm({
					title: '',
					category: 'General',
					content: '',
				});
				fetchKB();
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Format Duration
	const formatSeconds = (sec: number): string => {
		const mins = Math.floor(sec / 60);
		const secs = sec % 60;
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	};

	// Inject canned response macro
	const applyMacro = (macroText: string) => {
		const customerName = selectedTicket?.creator_name || 'Customer';
		const processed = macroText
			.replace('{{name}}', customerName)
			.replace('{{agent_name}}', agentName);
		setReplyContent((prev) => (prev ? prev + '\n' + processed : processed));
	};

	const toggleSelectTicketId = (id: string) => {
		setSelectedTicketIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
		);
	};

	const isSlaBreached = (deadline: string, status: string): boolean => {
		if (status === 'RESOLVED' || status === 'CLOSED') return false;
		return new Date(deadline).getTime() < Date.now();
	};

	return (
		<div className="w-full h-full flex flex-col bg-canvas text-ink font-sans">
			{/* ---- Main Top Navigation Shell ---- */}
			<header className="h-[72px] min-h-[72px] border-b border-canvas-soft flex justify-between items-center px-6 bg-canvas">
				<div className="flex items-center gap-6">
					<h1 className="text-xl font-bold tracking-tight text-ink">Support Command Center ({ticketsTotal})</h1>
					<nav className="flex bg-canvas-softer p-1 rounded-pill-tab">
						{(['TICKETS', 'LOST_FOUND', 'KNOWLEDGE_BASE'] as MainTab[]).map((tab) => (
							<button
								key={tab}
								onClick={() => setActiveMainTab(tab)}
								className={`px-4 py-1.5 rounded-pill text-xs font-semibold tracking-wide capitalize transition ${
									activeMainTab === tab ? 'bg-canvas text-ink shadow-sm' : 'text-body hover:text-ink'
								}`}
							>
								{tab.replace('_', ' ').toLowerCase()}
							</button>
						))}
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<span className="inline-flex items-center gap-1.5 text-xs text-body font-medium">
						<span className="w-2 h-2 rounded-full bg-status-online" />
						Agent Active
					</span>
					<button
						onClick={() => {
							if (activeMainTab === 'TICKETS') setShowCreateTicketModal(true);
							if (activeMainTab === 'LOST_FOUND') setShowCreateLostModal(true);
							if (activeMainTab === 'KNOWLEDGE_BASE') setShowCreateMacroModal(true);
						}}
						className="bg-ink hover:bg-black-elevated text-on-dark text-xs font-semibold px-4 py-2 rounded-pill shadow-sm transition active:scale-[0.97]"
					>
						+ Create New
					</button>
				</div>
			</header>

			{/* ---- Workspace Stats Banner (Only on tickets view) ---- */}
			{activeMainTab === 'TICKETS' && (
				<section className="bg-canvas border-b border-canvas-soft grid grid-cols-2 md:grid-cols-5 divide-x divide-canvas-soft">
					<div className="p-4 flex flex-col justify-center text-center">
						<span className="text-[10px] text-mute uppercase font-bold tracking-wider">My Queue</span>
						<span className="text-xl font-bold font-mono text-ink mt-1">{stats.my_queue_count}</span>
					</div>
					<div className="p-4 flex flex-col justify-center text-center">
						<span className="text-[10px] text-mute uppercase font-bold tracking-wider">SLA Breaches</span>
						<span className={`text-xl font-bold font-mono mt-1 ${stats.breached_count > 0 ? 'text-status-alert' : 'text-ink'}`}>
							{stats.breached_count}
						</span>
					</div>
					<div className="p-4 flex flex-col justify-center text-center">
						<span className="text-[10px] text-mute uppercase font-bold tracking-wider">Resolved Today</span>
						<span className="text-xl font-bold font-mono text-ink mt-1">{stats.resolved_today}</span>
					</div>
					<div className="p-4 flex flex-col justify-center text-center">
						<span className="text-[10px] text-mute uppercase font-bold tracking-wider">Resolved This Week</span>
						<span className="text-xl font-bold font-mono text-ink mt-1">{stats.resolved_this_week}</span>
					</div>
					<div className="p-4 flex flex-col justify-center text-center">
						<span className="text-[10px] text-mute uppercase font-bold tracking-wider">CSAT Score</span>
						<span className="text-xl font-bold font-mono text-ink mt-1">
							{stats.average_csat.toFixed(1)} / 5.0
						</span>
					</div>
				</section>
			)}

			{/* ---- Tab Panels ---- */}
			<div className="flex-1 overflow-hidden">
				{/* 1. TICKETS WORKSPACE */}
				{activeMainTab === 'TICKETS' && (
					<div className="w-full h-full flex divide-x divide-canvas-soft">
						{/* --- Ticket List Panel --- */}
						<div className="w-[380px] min-w-[380px] h-full flex flex-col bg-canvas">
							{/* Filter Header */}
							<div className="p-4 border-b border-canvas-soft space-y-3">
								<input
									type="text"
									placeholder="Search Subject, User Name, ID..."
									className="w-full h-9 bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md px-3 text-xs text-ink placeholder-mute focus:outline-none"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
								/>
								<div className="flex gap-2">
									<select
										className="flex-1 bg-canvas border border-canvas-soft rounded-md px-2.5 py-1 text-xs text-body focus:outline-none focus:border-ink"
										value={filterPriority}
										onChange={(e) => setFilterPriority(e.target.value)}
									>
										<option value="">All Priorities</option>
										<option value="LOW">Low</option>
										<option value="MEDIUM">Medium</option>
										<option value="HIGH">High</option>
										<option value="URGENT">Urgent</option>
									</select>
									<select
										className="flex-1 bg-canvas border border-canvas-soft rounded-md px-2.5 py-1 text-xs text-body focus:outline-none focus:border-ink"
										value={filterCategory}
										onChange={(e) => setFilterCategory(e.target.value)}
									>
										<option value="">All Categories</option>
										<option value="TRIP">Trip</option>
										<option value="PAYMENT">Payment</option>
										<option value="DRIVER_BEHAVIOR">Driver Behavior</option>
										<option value="LOST_ITEM">Lost Item</option>
										<option value="ACCOUNT">Account</option>
										<option value="SAFETY">Safety</option>
										<option value="OTHER">Other</option>
									</select>
								</div>
								<label className="flex items-center gap-2 text-[11px] text-body select-none cursor-pointer">
									<input
										type="checkbox"
										className="rounded border-canvas-soft text-ink focus:ring-0 focus:outline-none cursor-pointer w-3.5 h-3.5"
										checked={filterSlaBreach}
										onChange={(e) => setFilterSlaBreach(e.target.checked)}
									/>
									Hide tickets within SLA (breaches only)
								</label>
							</div>

							{/* Tab Sub-bar */}
							<div className="flex border-b border-canvas-soft bg-canvas-softer p-1 m-3 rounded-lg text-[10px] font-bold tracking-wider">
								{(['ALL', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED'] as TicketTab[]).map((tab) => (
									<button
										key={tab}
										onClick={() => {
											setActiveTicketTab(tab);
											setSelectedTicketIds([]);
										}}
										className={`flex-1 py-1.5 rounded text-center uppercase tracking-wide transition ${
											activeTicketTab === tab ? 'bg-canvas text-ink shadow-sm' : 'text-body hover:text-ink'
										}`}
									>
										{tab.toLowerCase()}
									</button>
								))}
							</div>

							{/* Ticket Cards List */}
							<div className="flex-1 overflow-y-auto divide-y divide-canvas-soft">
								{loading ? (
									<div className="p-8 text-center text-xs text-mute animate-pulse">Scanning tickets repository...</div>
								) : tickets.length === 0 ? (
									<div className="p-8 text-center text-xs text-mute font-medium">No support tickets found</div>
								) : (
									tickets.map((tkt) => {
										const breached = isSlaBreached(tkt.sla_deadline, tkt.status);
										const isSelected = selectedTicket?.id === tkt.id;

										return (
											<div
												key={tkt.id}
												onClick={() => handleSelectTicket(tkt)}
												className={`p-4 cursor-pointer transition-colors relative flex gap-3 ${
													isSelected ? 'bg-canvas-softer' : 'hover:bg-canvas-softer/50'
												}`}
											>
												<div onClick={(e) => e.stopPropagation()} className="pt-0.5">
													<input
														type="checkbox"
														className="rounded border-canvas-soft text-ink focus:ring-0 focus:outline-none cursor-pointer w-3.5 h-3.5"
														checked={selectedTicketIds.includes(tkt.id)}
														onChange={() => toggleSelectTicketId(tkt.id)}
													/>
												</div>
												<div className="flex-1 min-w-0 space-y-1.5">
													<div className="flex justify-between items-start">
														<span className="font-mono text-[10px] font-bold text-mute">{tkt.id}</span>
														<div className="flex items-center gap-1.5">
															{breached && (
																<span className="w-1.5 h-1.5 rounded-full bg-status-alert animate-ping" title="SLA Breached" />
															)}
															<span className={`text-[9px] font-extrabold uppercase border px-1.5 py-0.5 rounded-pill ${
																tkt.priority === 'URGENT' ? 'border-status-alert text-status-alert bg-surface-negative' : 'border-canvas-soft text-body bg-canvas-soft'
															}`}>
																{tkt.priority}
															</span>
														</div>
													</div>
													<h4 className="text-xs font-bold text-ink truncate sentence-case">{tkt.subject}</h4>
													<div className="flex justify-between text-[10px] text-body">
														<span className="font-semibold text-ink">{tkt.creator_name} ({tkt.creator_type.toLowerCase()})</span>
														<span>{new Date(tkt.created_at).toLocaleDateString()}</span>
													</div>
													<div className="flex flex-wrap gap-1">
														<span className="bg-canvas-soft text-ink font-medium px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide">
															{tkt.category.replace('_', ' ')}
														</span>
														{tkt.tags.map((tg) => (
															<span key={tg} className="bg-canvas-softer text-body border border-canvas-soft px-1.5 py-0.5 rounded text-[9px] font-mono">
																#{tg}
															</span>
														))}
													</div>
												</div>
											</div>
										);
									})
								)}
							</div>

							{/* Bulk Actions Footer */}
							{selectedTicketIds.length > 0 && (
								<div className="p-3 bg-ink text-on-dark flex justify-between items-center gap-2 border-t border-black-elevated">
									<span className="text-[10px] font-semibold">{selectedTicketIds.length} selected</span>
									<div className="flex gap-2">
										<button
											onClick={handleBulkAssign}
											className="bg-canvas text-ink text-[10px] font-bold px-3 py-1 rounded-pill hover:bg-canvas-soft"
										>
											Claim Selected
										</button>
										<button
											onClick={() => setSelectedTicketIds([])}
											className="text-on-dark text-[10px] hover:underline"
										>
											Cancel
										</button>
									</div>
								</div>
							)}
						</div>

						{/* --- Ticket Detail Workspace --- */}
						<div className="flex-1 h-full bg-canvas-softer overflow-y-auto p-6">
							{detailLoading ? (
								<div className="w-full h-full flex items-center justify-center">
									<div className="text-xs text-mute animate-pulse">Loading ticket thread details...</div>
								</div>
							) : !selectedTicketDetail ? (
								<div className="w-full h-full flex items-center justify-center">
									<div className="text-center max-w-sm">
										<h3 className="text-sm font-bold text-ink">Agent Workspace Terminal</h3>
										<p className="text-xs text-body mt-2 leading-relaxed">Select a support ticket from the inbox to initialize the conversation thread, apply macro replies, review SLAs, or escalate incidents.</p>
									</div>
								</div>
							) : (
								<div className="w-full space-y-6 animate-fade-in">
									{/* Detail Header Card */}
									<div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-4">
										<div className="flex justify-between items-start">
											<div className="space-y-1">
												<div className="flex items-center gap-2">
													<span className="font-mono text-xs text-mute font-bold">{selectedTicketDetail.ticket.id}</span>
													<span className="w-1.5 h-1.5 rounded-full bg-canvas-soft" />
													<span className="text-xs text-body capitalize font-semibold">{selectedTicketDetail.ticket.channel.toLowerCase()} intake</span>
												</div>
												<h2 className="text-base font-bold text-ink leading-tight sentence-case">{selectedTicketDetail.ticket.subject}</h2>
											</div>
											<div className="flex items-center gap-2">
												<span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-pill border tracking-wide uppercase ${
													selectedTicketDetail.ticket.status === 'OPEN' ? 'border-status-alert text-status-alert bg-surface-negative' : 'border-canvas-soft text-body bg-canvas-soft'
												}`}>
													{selectedTicketDetail.ticket.status}
												</span>
												<button
													onClick={() => setResolveTicketId(selectedTicketDetail.ticket.id)}
													disabled={selectedTicketDetail.ticket.status === 'CLOSED'}
													className="bg-canvas border border-canvas-soft hover:bg-canvas-soft text-ink text-[10px] font-bold px-3 py-1 rounded-pill disabled:opacity-50"
												>
													Resolve
												</button>
												<button
													onClick={() => handleClose(selectedTicketDetail.ticket.id)}
													disabled={selectedTicketDetail.ticket.status === 'CLOSED'}
													className="bg-ink hover:bg-black-elevated text-on-dark text-[10px] font-bold px-3 py-1 rounded-pill disabled:opacity-50"
												>
													Close Ticket
												</button>
											</div>
										</div>

										<div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-canvas-soft">
											{/* Customer info */}
											<div>
												<span className="text-[9px] uppercase tracking-wider text-mute font-bold">Customer Beneficiary</span>
												<div className="text-xs font-bold text-ink mt-1">{selectedTicketDetail.ticket.creator_name}</div>
												<div className="text-[10px] text-body font-mono mt-0.5 flex items-center gap-2">
													{selectedTicketDetail.ticket.creator_phone}
													<button
														onClick={() => handleTriggerCall(selectedTicketDetail.ticket.creator_phone)}
														className="text-ink hover:underline text-[9px] font-bold bg-canvas-soft px-1.5 py-0.5 rounded"
													>
														Call
													</button>
												</div>
												<div className="text-[9px] text-mute font-medium uppercase mt-0.5">Account Role: {selectedTicketDetail.ticket.creator_type}</div>
											</div>

											{/* Ticket info */}
											<div>
												<span className="text-[9px] uppercase tracking-wider text-mute font-bold">Metadata & Assignee</span>
												<div className="text-xs text-ink mt-1 font-semibold">
													Category: <span className="uppercase">{selectedTicketDetail.ticket.category.replace('_', ' ')}</span>
												</div>
												<div className="text-[10px] text-body mt-0.5">
													Agent: {selectedTicketDetail.ticket.assigned_agent_name || 'Unassigned'}
												</div>
												{selectedTicketDetail.ticket.escalated_to && (
													<div className="text-[9px] text-status-warn font-bold uppercase mt-0.5">Escalated to: {selectedTicketDetail.ticket.escalated_to}</div>
												)}
											</div>

											{/* SLA Countdown */}
											<div>
												<span className="text-[9px] uppercase tracking-wider text-mute font-bold">SLA Target Deadline</span>
												<div className="text-xs font-mono font-bold text-ink mt-1">
													{new Date(selectedTicketDetail.ticket.sla_deadline).toLocaleString()}
												</div>
												<div className={`text-[10px] font-bold mt-0.5 ${
													isSlaBreached(selectedTicketDetail.ticket.sla_deadline, selectedTicketDetail.ticket.status)
														? 'text-status-alert'
														: 'text-status-online'
												}`}>
													{isSlaBreached(selectedTicketDetail.ticket.sla_deadline, selectedTicketDetail.ticket.status)
														? '⚠️ SLA breached'
														: '✓ Within SLA target'}
												</div>
											</div>
										</div>

										{selectedTicketDetail.ticket.resolution_type && (
											<div className="p-3 bg-canvas-softer rounded-lg border border-canvas-soft text-xs space-y-1 font-sans">
												<span className="text-[9px] uppercase tracking-wider text-mute font-bold">Resolution Closed Log</span>
												<div className="text-ink font-semibold">Type: {selectedTicketDetail.ticket.resolution_type}</div>
												<p className="text-body leading-snug">{selectedTicketDetail.ticket.resolution_reason}</p>
											</div>
										)}
									</div>

									{/* Dual Column: Conversation thread & KB side-by-side */}
									<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
										{/* Conversation and Reply Column (Col span 2) */}
										<div className="lg:col-span-2 space-y-4">
											{/* Messages Thread Container */}
											<div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden flex flex-col h-[350px] shadow-sm">
												<div className="p-3 bg-canvas-soft border-b border-canvas-soft">
													<span className="text-[10px] uppercase tracking-wider text-mute font-bold">Conversation Log History</span>
												</div>
												<div className="flex-1 overflow-y-auto p-4 space-y-4">
													{selectedTicketDetail.messages.map((msg) => {
														const isAgent = msg.sender_type === 'AGENT';
														const isSystem = msg.sender_type === 'SYSTEM';
														const isInternal = msg.message_type === 'INTERNAL_NOTE';

														if (isSystem) {
															return (
																<div key={msg.id} className="text-center">
																	<span className="inline-block px-3 py-1 bg-canvas-softer border border-canvas-soft rounded text-[10px] text-body font-mono">
																		{msg.content}
																	</span>
																</div>
															);
														}

														return (
															<div
																key={msg.id}
																className={`flex flex-col max-w-[85%] ${
																	isAgent ? 'ml-auto items-end' : 'mr-auto items-start'
																}`}
															>
																<div className="flex items-center gap-1.5 text-[9px] text-mute mb-1 font-semibold">
																	<span>{msg.sender_name} ({msg.sender_type.toLowerCase()})</span>
																	<span>•</span>
																	<span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
																</div>
																<div className={`p-3 rounded-xl text-xs leading-relaxed ${
																	isInternal
																		? 'bg-surface-warning text-content-warning border border-warning-400'
																		: isAgent
																			? 'bg-ink text-on-dark'
																			: 'bg-canvas-soft text-ink'
																}`}>
																	{isInternal && (
																		<span className="block text-[8px] font-extrabold uppercase tracking-wide text-content-warning mb-1">
																			🔒 Internal note (team only)
																		</span>
																	)}
																	{msg.content}
																</div>
															</div>
														);
													})}
												</div>
											</div>

											{/* Reply Editor */}
											<form onSubmit={handlePostMessage} className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-3 shadow-sm">
												<div className="flex justify-between items-center">
													<div className="flex bg-canvas-softer p-0.5 rounded-lg text-[9px] font-bold">
														{(['CHAT', 'EMAIL', 'INTERNAL_NOTE'] as const).map((type) => (
															<button
																key={type}
																type="button"
																onClick={() => setReplyMessageType(type)}
																className={`px-3 py-1 rounded capitalize transition ${
																	replyMessageType === type ? 'bg-canvas text-ink shadow-sm' : 'text-body hover:text-ink'
																}`}
															>
																{type.replace('_', ' ').toLowerCase()}
															</button>
														))}
													</div>
													<div className="flex gap-1.5">
														<button
															type="button"
															onClick={() => setEscalateTicketId(selectedTicketDetail.ticket.id)}
															className="bg-canvas border border-canvas-soft hover:bg-canvas-soft text-[10px] font-bold px-3 py-1 rounded-pill"
														>
															Escalate
														</button>
													</div>
												</div>
												<textarea
													required
													rows={3}
													placeholder={replyMessageType === 'INTERNAL_NOTE' ? "Type team notes... (hidden from customer)" : "Type your response here..."}
													className="w-full rounded bg-canvas-soft border border-canvas-soft focus:border-ink p-3 text-xs text-ink placeholder-mute focus:outline-none"
													value={replyContent}
													onChange={(e) => setReplyContent(e.target.value)}
												/>
												<div className="flex justify-end">
													<button
														type="submit"
														className="bg-ink hover:bg-black-elevated text-on-dark text-[10px] font-bold px-5 py-2 rounded-pill shadow-sm transition active:scale-[0.98]"
													>
														Send Reply
													</button>
												</div>
											</form>
										</div>

										{/* Sidebar KB Macros Column */}
										<div className="space-y-4">
											{/* Canned Macros */}
											<div className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-3 shadow-sm max-h-[250px] overflow-y-auto">
												<span className="text-[10px] uppercase tracking-wider text-mute font-bold block mb-1">Macros Template Shortcuts</span>
												<div className="space-y-2">
													{macros.length === 0 ? (
														<div className="text-xs text-mute py-2">No macros saved. Populate under Knowledge Base.</div>
													) : (
														macros.map((m) => (
															<button
																key={m.shortcut_code}
																type="button"
																onClick={() => applyMacro(m.template_text)}
																className="w-full text-left p-2.5 rounded bg-canvas-soft hover:bg-canvas-softer text-xs border border-canvas-soft flex flex-col gap-1 transition"
															>
																<div className="flex justify-between w-full">
																	<span className="font-bold text-ink">/{m.shortcut_code}</span>
																	<span className="text-[9px] text-mute font-medium uppercase">{m.category}</span>
																</div>
																<p className="text-[10px] text-body truncate w-full">{m.template_text}</p>
															</button>
														))
													)}
												</div>
											</div>

											{/* CSAT Display if resolved */}
											{selectedTicketDetail.csat && (
												<div className="bg-canvas rounded-xl border border-canvas-soft p-4 space-y-2 shadow-sm font-sans">
													<span className="text-[10px] uppercase tracking-wider text-mute font-bold block">CSAT Survey Rating</span>
													<div className="flex items-center gap-1">
														{[1, 2, 3, 4, 5].map((star) => (
															<svg
																key={star}
																className={`w-4 h-4 ${star <= selectedTicketDetail.csat!.rating ? 'text-black fill-current' : 'text-canvas-soft'}`}
																viewBox="0 0 20 20"
															>
																<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
															</svg>
														))}
													</div>
													{selectedTicketDetail.csat.comment && (
														<p className="text-[11px] text-body italic mt-1 leading-snug">"{selectedTicketDetail.csat.comment}"</p>
													)}
												</div>
											)}
										</div>
									</div>
								</div>
							)}
						</div>
					</div>
				)}

				{/* 2. LOST & FOUND LOG */}
				{activeMainTab === 'LOST_FOUND' && (
					<div className="w-full h-full p-6 bg-canvas overflow-y-auto space-y-6">
						<div className="flex justify-between items-center">
							<div>
								<h2 className="text-base font-bold text-ink">Lost & Found Inventory Tracker</h2>
								<p className="text-xs text-mute mt-1">Review reported forgotten items, coordinates driver hand-over, and configure Blue Dart return tracking packages.</p>
							</div>
							<button
								onClick={() => setShowCreateLostModal(true)}
								className="bg-ink hover:bg-black-elevated text-on-dark text-xs font-semibold px-4 py-2 rounded-pill shadow-sm transition"
							>
								Report Lost Item
							</button>
						</div>

						<div className="bg-canvas border border-canvas-soft rounded-xl overflow-hidden shadow-sm">
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="bg-canvas-soft border-b border-canvas-soft">
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Item ID</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Linked Ticket</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Reporter User</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Forgotten Item Description</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-center">Driver Contacted</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute">Return Method / Tracking Code</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-center">Status</th>
										<th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-mute text-right">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-canvas-soft text-xs">
									{lostItems.length === 0 ? (
										<tr>
											<td colSpan={8} className="p-8 text-center text-mute font-medium">No items reported lost in vehicles</td>
										</tr>
									) : (
										lostItems.map((item) => (
											<tr key={item.id} className="hover:bg-canvas-softer/50">
												<td className="p-3 font-mono text-ink font-semibold">#{item.id}</td>
												<td className="p-3 font-mono text-body font-semibold">{item.ticket_id || '—'}</td>
												<td className="p-3 capitalize font-semibold text-ink">
													{item.reporter_type.toLowerCase()}
												</td>
												<td className="p-3 font-medium text-ink max-w-[200px] truncate">{item.item_description}</td>
												<td className="p-3 text-center">
													<input
														type="checkbox"
														className="rounded border-canvas-soft text-ink focus:ring-0 focus:outline-none cursor-pointer w-3.5 h-3.5"
														checked={item.driver_contacted}
														onChange={(e) => handleUpdateLostItem(item.id, { driver_contacted: e.target.checked })}
													/>
												</td>
												<td className="p-3">
													{item.return_method ? (
														<div>
															<span className="font-semibold text-ink">{item.return_method}</span>
															<span className="block font-mono text-[10px] text-mute">{item.return_tracking_code || 'No tracking code'}</span>
														</div>
													) : (
														<span className="text-mute italic">Pending recovery</span>
													)}
												</td>
												<td className="p-3 text-center">
													<span className={`inline-flex items-center text-[9px] font-bold border rounded-pill h-5 px-2 tracking-wider ${
														item.status === 'RETURNED' ? 'border-status-online text-status-online bg-surface-positive' : 'border-canvas-soft text-body bg-canvas-soft'
													}`}>
														{item.status}
													</span>
												</td>
												<td className="p-3 text-right">
													<div className="flex gap-1.5 justify-end">
														{item.status !== 'RETURNED' && item.status !== 'CLOSED' && (
															<button
																onClick={() => {
																	const code = prompt('Enter return tracking code (e.g. Blue Dart ID):');
																	const method = prompt('Enter return method (e.g. Courier):');
																	if (code && method) {
																		handleUpdateLostItem(item.id, {
																			status: 'RETURNED',
																			return_tracking_code: code,
																			return_method: method,
																		});
																	}
																}}
																className="bg-ink hover:bg-black-elevated text-on-dark text-[10px] font-bold px-2.5 py-1 rounded-pill"
															>
																Mark Returned
															</button>
														)}
													</div>
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>
				)}

				{/* 3. KNOWLEDGE BASE FAQ / MACROS */}
				{activeMainTab === 'KNOWLEDGE_BASE' && (
					<div className="w-full h-full p-6 bg-canvas overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-8">
						{/* Macros block */}
						<div className="space-y-4">
							<div className="flex justify-between items-center">
								<div>
									<h2 className="text-sm font-bold text-ink">Canned Reply Templates (Macros)</h2>
									<p className="text-xs text-mute mt-0.5">Shortcuts available inside chat replying widgets.</p>
								</div>
								<button
									onClick={() => setShowCreateMacroModal(true)}
									className="border border-canvas-soft hover:bg-canvas-soft text-ink text-xs font-semibold px-3 py-1.5 rounded-pill shadow-sm"
								>
									+ Add Macro
								</button>
							</div>

							<div className="bg-canvas border border-canvas-soft rounded-xl divide-y divide-canvas-soft overflow-hidden shadow-sm">
								{macros.length === 0 ? (
									<div className="p-6 text-center text-xs text-mute">No canned replies defined</div>
								) : (
									macros.map((m) => (
										<div key={m.shortcut_code} className="p-4 space-y-1.5">
											<div className="flex justify-between">
												<span className="font-mono text-xs font-bold text-ink">/{m.shortcut_code}</span>
												<span className="bg-canvas-soft text-body text-[9px] font-extrabold uppercase px-1.5 rounded">{m.category}</span>
											</div>
											<h4 className="text-xs font-bold text-ink">{m.title}</h4>
											<p className="text-[11px] text-body leading-relaxed bg-canvas-softer p-2.5 rounded border border-canvas-soft font-mono">
												{m.template_text}
											</p>
										</div>
									))
								)}
							</div>
						</div>

						{/* FAQs block */}
						<div className="space-y-4">
							<div className="flex justify-between items-center">
								<div>
									<h2 className="text-sm font-bold text-ink">App FAQ Knowledge Base</h2>
									<p className="text-xs text-mute mt-0.5">Published articles serving client app search queries.</p>
								</div>
								<button
									onClick={() => setShowCreateFaqModal(true)}
									className="border border-canvas-soft hover:bg-canvas-soft text-ink text-xs font-semibold px-3 py-1.5 rounded-pill shadow-sm"
								>
									+ Add FAQ
								</button>
							</div>

							<div className="bg-canvas border border-canvas-soft rounded-xl divide-y divide-canvas-soft overflow-hidden shadow-sm">
								{faqs.length === 0 ? (
									<div className="p-6 text-center text-xs text-mute">No FAQ articles published</div>
								) : (
									faqs.map((f) => (
										<div key={f.id} className="p-4 space-y-2">
											<div className="flex justify-between">
												<h4 className="text-xs font-bold text-ink">{f.title}</h4>
												<span className="bg-canvas-soft text-body text-[9px] font-extrabold uppercase px-1.5 rounded">{f.category}</span>
											</div>
											<p className="text-[11px] text-body leading-relaxed">{f.content}</p>
										</div>
									))
								)}
							</div>
						</div>
					</div>
				)}
			</div>

			{/* ============================================================== */}
			{/* ======================= DIALER MODAL ========================= */}
			{/* ============================================================== */}
			{isDialing && dialingPhone && (
				<div className="fixed bottom-6 right-6 bg-ink text-on-dark px-6 py-4 rounded-xl flex flex-col gap-3 shadow-2xl z-50 border border-black-elevated w-[260px] animate-fade-in font-mono">
					<div className="flex justify-between items-start">
						<div>
							<span className="text-[9px] uppercase tracking-wider text-mute block font-bold font-sans">Active Call Connection</span>
							<span className="text-xs font-bold text-on-dark">{dialingPhone}</span>
						</div>
						<span className="w-2.5 h-2.5 rounded-full bg-status-alert animate-ping" />
					</div>
					<div className="flex justify-between items-center">
						<span className="text-xs font-bold">{formatSeconds(dialSeconds)}</span>
						<button
							onClick={handleHangUpCall}
							className="bg-negative-400 hover:bg-negative-400 text-on-dark text-[10px] font-bold px-4 py-1.5 rounded-pill font-sans transition"
						>
							Hang Up
						</button>
					</div>
				</div>
			)}

			{/* ============================================================== */}
			{/* ===================== ESCALATE MODAL ========================= */}
			{/* ============================================================== */}
			{escalateTicketId && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<form onSubmit={handleEscalate} className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-2xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Escalate Incident Ticket</h3>
							<p className="text-[11px] text-mute mt-1">Route this support ticket to a specialized team tier.</p>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Escalate Department</label>
							<select
								className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none focus:border-ink"
								value={escalateTo}
								onChange={(e) => setEscalateTo(e.target.value)}
							>
								<option value="L2">Tier 2 Support Lead</option>
								<option value="SAFETY">Safety Command Team</option>
								<option value="FINANCE">Finance & billing Desk</option>
							</select>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Escalation Reason Notes</label>
							<textarea
								required
								rows={3}
								placeholder="Provide reason detail for L2 dispatcher triage..."
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2.5 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-sans leading-snug"
								value={escalateNotes}
								onChange={(e) => setEscalateNotes(e.target.value)}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								type="button"
								onClick={() => { setEscalateTicketId(null); setEscalateNotes(''); }}
								className="px-4 py-1.5 bg-canvas-soft text-body hover:text-ink text-xs font-semibold rounded-pill transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-1.5 bg-ink text-on-dark text-xs font-semibold rounded-pill hover:bg-black-elevated transition"
							>
								Escalate Ticket
							</button>
						</div>
					</form>
				</div>
			)}

			{/* ============================================================== */}
			{/* ====================== RESOLVE MODAL ========================= */}
			{/* ============================================================== */}
			{resolveTicketId && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<form onSubmit={handleResolve} className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-2xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Resolve Support Ticket</h3>
							<p className="text-[11px] text-mute mt-1">Submit a resolution code and explain details to the customer.</p>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Resolution Type</label>
							<select
								className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none focus:border-ink"
								value={resolveType}
								onChange={(e) => setResolveType(e.target.value)}
							>
								<option value="MESSAGE">Issue resolved via message instructions</option>
								<option value="REFUND">Refund processed to customer wallet</option>
								<option value="VOUCHER">Issued promotional voucher coupon</option>
								<option value="NO_ACTION">No action required / dispute rejected</option>
							</select>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Resolution Reason Explanation</label>
							<textarea
								required
								rows={3}
								placeholder="Enter explanation text sent to user client app logs..."
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2.5 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-sans leading-snug"
								value={resolveReason}
								onChange={(e) => setResolveReason(e.target.value)}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								type="button"
								onClick={() => { setResolveTicketId(null); setResolveReason(''); }}
								className="px-4 py-1.5 bg-canvas-soft text-body hover:text-ink text-xs font-semibold rounded-pill transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-1.5 bg-ink text-on-dark text-xs font-semibold rounded-pill hover:bg-black-elevated transition"
							>
								Submit Resolution
							</button>
						</div>
					</form>
				</div>
			)}

			{/* ============================================================== */}
			{/* =================== CREATE TICKET MODAL ====================== */}
			{/* ============================================================== */}
			{showCreateTicketModal && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<form onSubmit={handleCreateTicket} className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-lg w-full space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
						<div>
							<h3 className="text-sm font-bold text-ink">Create Support Ticket Manual Intake</h3>
							<p className="text-[11px] text-mute mt-1">Log a ticket directly into the active dispatcher queue.</p>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-bold">Creator Type</label>
								<select
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newTicketForm.creator_type}
									onChange={(e) => setNewTicketForm({ ...newTicketForm, creator_type: e.target.value })}
								>
									<option value="RIDER">Rider Partner</option>
									<option value="DRIVER">Driver Partner</option>
								</select>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-bold">Creator Name</label>
								<input
									type="text"
									required
									placeholder="e.g. Ramesh Kumar"
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newTicketForm.creator_name}
									onChange={(e) => setNewTicketForm({ ...newTicketForm, creator_name: e.target.value })}
								/>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-bold">Creator Phone</label>
								<input
									type="text"
									required
									placeholder="e.g. +91 9999912345"
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newTicketForm.creator_phone}
									onChange={(e) => setNewTicketForm({ ...newTicketForm, creator_phone: e.target.value })}
								/>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-bold">Intake Channel</label>
								<select
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newTicketForm.channel}
									onChange={(e) => setNewTicketForm({ ...newTicketForm, channel: e.target.value })}
								>
									<option value="CHAT">Live App Chat</option>
									<option value="EMAIL">Email Note</option>
									<option value="PHONE">Phone Recording</option>
									<option value="SOS">SOS Distress Signal</option>
								</select>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-bold">Priority</label>
								<select
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newTicketForm.priority}
									onChange={(e) => setNewTicketForm({ ...newTicketForm, priority: e.target.value })}
								>
									<option value="LOW">Low (72 hr SLA)</option>
									<option value="MEDIUM">Medium (24 hr SLA)</option>
									<option value="HIGH">High (4 hr SLA)</option>
									<option value="URGENT">Urgent (1 hr SLA)</option>
								</select>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-bold">Category</label>
								<select
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newTicketForm.category}
									onChange={(e) => setNewTicketForm({ ...newTicketForm, category: e.target.value })}
								>
									<option value="TRIP">Trip / Route Issues</option>
									<option value="PAYMENT">Payment & Refund Dispute</option>
									<option value="DRIVER_BEHAVIOR">Driver Behavior</option>
									<option value="LOST_ITEM">Lost & Found Recovery</option>
									<option value="ACCOUNT">Account Suspension</option>
									<option value="SAFETY">SafetySOS Threat</option>
									<option value="OTHER">Other Query</option>
								</select>
							</div>
							<div className="col-span-2">
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-bold">Subject Headline</label>
								<input
									type="text"
									required
									placeholder="e.g. Disputed charge on Kolkata ride"
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newTicketForm.subject}
									onChange={(e) => setNewTicketForm({ ...newTicketForm, subject: e.target.value })}
								/>
							</div>
							<div className="col-span-2">
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1 font-bold">Ticket Intake Notes Description</label>
								<textarea
									required
									rows={3}
									placeholder="Provide description details reported by user..."
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newTicketForm.description}
									onChange={(e) => setNewTicketForm({ ...newTicketForm, description: e.target.value })}
								/>
							</div>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								type="button"
								onClick={() => setShowCreateTicketModal(false)}
								className="px-4 py-1.5 bg-canvas-soft text-body hover:text-ink text-xs font-semibold rounded-pill transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-1.5 bg-ink text-on-dark text-xs font-semibold rounded-pill hover:bg-black-elevated transition"
							>
								Log Ticket
							</button>
						</div>
					</form>
				</div>
			)}

			{/* ============================================================== */}
			{/* ===================== CREATE LOST ITEM ======================= */}
			{/* ============================================================== */}
			{showCreateLostModal && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<form onSubmit={handleCreateLost} className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-2xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Report Forgotten Item</h3>
							<p className="text-[11px] text-mute mt-1">Log a reported item left in a ride vehicle.</p>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Linked Trip Order ID (UUID)</label>
							<input
								type="text"
								required
								placeholder="e.g. a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01"
								className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
								value={newLostForm.trip_id}
								onChange={(e) => setNewLostForm({ ...newLostForm, trip_id: e.target.value })}
							/>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Forgotten Item Description</label>
							<textarea
								required
								rows={2}
								placeholder="e.g. Leather wallet containing ID cards and cash"
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2.5 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-sans leading-snug"
								value={newLostForm.item_description}
								onChange={(e) => setNewLostForm({ ...newLostForm, item_description: e.target.value })}
							/>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Agent Audit Notes</label>
							<textarea
								rows={2}
								placeholder="e.g. Reported by rider via incoming phone recording."
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2.5 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-sans leading-snug"
								value={newLostForm.notes}
								onChange={(e) => setNewLostForm({ ...newLostForm, notes: e.target.value })}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								type="button"
								onClick={() => setShowCreateLostModal(false)}
								className="px-4 py-1.5 bg-canvas-soft text-body hover:text-ink text-xs font-semibold rounded-pill transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-1.5 bg-ink text-on-dark text-xs font-semibold rounded-pill hover:bg-black-elevated transition"
							>
								Log Lost Item
							</button>
						</div>
					</form>
				</div>
			)}

			{/* ============================================================== */}
			{/* ===================== CREATE MACRO MODAL ===================== */}
			{/* ============================================================== */}
			{showCreateMacroModal && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<form onSubmit={handleCreateMacro} className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-2xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Add Canned Reply Macro</h3>
							<p className="text-[11px] text-mute mt-1">Configure macro responses with auto-injected customer placeholders.</p>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Shortcut Code</label>
							<input
								type="text"
								required
								placeholder="e.g. lost_keys"
								className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none font-mono"
								value={newMacroForm.shortcut_code}
								onChange={(e) => setNewMacroForm({ ...newMacroForm, shortcut_code: e.target.value })}
							/>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Macro Category</label>
								<select
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newMacroForm.category}
									onChange={(e) => setNewMacroForm({ ...newMacroForm, category: e.target.value })}
								>
									<option value="General">General Greeting</option>
									<option value="Billing">Billing & Refunds</option>
									<option value="Lost & Found">Lost & Found</option>
									<option value="Safety">Safety & Incidents</option>
								</select>
							</div>
							<div>
								<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Title Name</label>
								<input
									type="text"
									required
									placeholder="e.g. Keys Recovery Flow"
									className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
									value={newMacroForm.title}
									onChange={(e) => setNewMacroForm({ ...newMacroForm, title: e.target.value })}
								/>
							</div>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Template Text</label>
							<p className="text-[9px] text-mute mb-1">Placeholders: {"{{name}}"} for customer, {"{{agent_name}}"} for agent.</p>
							<textarea
								required
								rows={3}
								placeholder="e.g. Hello {{name}}, we have checked..."
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2.5 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-sans leading-snug"
								value={newMacroForm.template_text}
								onChange={(e) => setNewMacroForm({ ...newMacroForm, template_text: e.target.value })}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								type="button"
								onClick={() => setShowCreateMacroModal(false)}
								className="px-4 py-1.5 bg-canvas-soft text-body hover:text-ink text-xs font-semibold rounded-pill transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-1.5 bg-ink text-on-dark text-xs font-semibold rounded-pill hover:bg-black-elevated transition"
							>
								Add Macro
							</button>
						</div>
					</form>
				</div>
			)}

			{/* ============================================================== */}
			{/* ===================== CREATE FAQ MODAL ======================= */}
			{/* ============================================================== */}
			{showCreateFaqModal && (
				<div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
					<form onSubmit={handleCreateFAQ} className="bg-canvas rounded-xl border border-canvas-soft p-5 max-w-md w-full space-y-4 shadow-2xl">
						<div>
							<h3 className="text-sm font-bold text-ink">Add FAQ Article</h3>
							<p className="text-[11px] text-mute mt-1">Configure a new FAQ article in the Knowledge Base.</p>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Article Title</label>
							<input
								type="text"
								required
								placeholder="e.g. How to claim refund?"
								className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
								value={newFaqForm.title}
								onChange={(e) => setNewFaqForm({ ...newFaqForm, title: e.target.value })}
							/>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Category</label>
							<select
								className="w-full bg-canvas border border-canvas-soft rounded-md p-2 text-xs text-ink focus:outline-none"
								value={newFaqForm.category}
								onChange={(e) => setNewFaqForm({ ...newFaqForm, category: e.target.value })}
							>
								<option value="General">General</option>
								<option value="Lost & Found">Lost & Found</option>
								<option value="Pricing">Pricing</option>
								<option value="Safety">Safety</option>
							</select>
						</div>

						<div>
							<label className="block text-[9px] uppercase tracking-wider text-mute mb-1.5 font-bold">Article Content</label>
							<textarea
								required
								rows={4}
								placeholder="Type FAQ answer content..."
								className="w-full rounded bg-canvas-soft border border-canvas-soft p-2.5 text-xs text-ink placeholder:text-mute focus:outline-none focus:border-ink font-sans leading-snug"
								value={newFaqForm.content}
								onChange={(e) => setNewFaqForm({ ...newFaqForm, content: e.target.value })}
							/>
						</div>

						<div className="flex justify-end space-x-2 border-t border-canvas-soft pt-3">
							<button
								type="button"
								onClick={() => setShowCreateFaqModal(false)}
								className="px-4 py-1.5 bg-canvas-soft text-body hover:text-ink text-xs font-semibold rounded-pill transition"
							>
								Cancel
							</button>
							<button
								type="submit"
								className="px-4 py-1.5 bg-ink text-on-dark text-xs font-semibold rounded-pill hover:bg-black-elevated transition"
							>
								Publish FAQ
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
};
