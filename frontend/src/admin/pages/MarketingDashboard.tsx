import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { exportToCsv, type CsvColumn } from '../lib/tableTools';
import { AdminBadge } from '../../components/ds/AdminBadge';

interface MarketingSegment {
	id: number;
	name: string;
	description?: string;
	filters: Record<string, any>;
	size: number;
	created_at: string;
	updated_at: string;
}

interface CampaignVariant {
	id?: number;
	campaign_id?: number;
	name: string;
	content: Record<string, any>;
	weight: number;
	created_at?: string;
}

interface MarketingCampaign {
	id: number;
	name: string;
	segment_id?: number | null;
	segment_name?: string | null;
	channel: string;
	schedule_type: string;
	schedule_time?: string | null;
	recurrence_cron?: string | null;
	trigger_event?: string | null;
	throttling_limit?: number | null;
	quiet_hours_start?: number | null;
	quiet_hours_end?: number | null;
	status: string;
	created_at: string;
	updated_at: string;
	variants: CampaignVariant[];
}

interface VariantMetric {
	variant_id: number;
	delivered: number;
	opened: number;
	clicked: number;
	booking: number;
}

interface InAppBanner {
	id: number;
	title: string;
	body: string;
	image_url?: string | null;
	deep_link?: string | null;
	placement: string;
	segment_id?: number | null;
	segment_name?: string | null;
	status: string;
	start_time: string;
	end_time: string;
	created_at: string;
}

interface PushTemplate {
	id: number;
	name: string;
	title_template: string;
	body_template: string;
	image_url?: string | null;
	deep_link?: string | null;
	variables: string[];
	created_at: string;
}

interface DLTSMSTemplate {
	id: number;
	sender_id: string;
	dlt_template_id: string;
	approved_content: string;
	status: string;
	created_at: string;
}

interface EmailTemplate {
	id: number;
	name: string;
	subject: string;
	html_content: string;
	variables: string[];
	created_at: string;
}

interface SenderDomain {
	id: number;
	domain: string;
	verified: boolean;
	dkim_status: string;
	spf_status: string;
	created_at: string;
}

type TabType = 'CAMPAIGNS' | 'SEGMENTS' | 'BANNERS' | 'TEMPLATES' | 'DOMAINS';

export const MarketingDashboard: React.FC = () => {
	const [activeTab, setActiveTab] = useState<TabType>('CAMPAIGNS');

	// Lists
	const [segments, setSegments] = useState<MarketingSegment[]>([]);
	const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
	const [banners, setBanners] = useState<InAppBanner[]>([]);
	const [pushTemplates, setPushTemplates] = useState<PushTemplate[]>([]);
	const [smsTemplates, setSmsTemplates] = useState<DLTSMSTemplate[]>([]);
	const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
	const [domains, setDomains] = useState<SenderDomain[]>([]);

	// Loaded analytics state
	const [activeAnalyticsId, setActiveAnalyticsId] = useState<number | null>(null);
	const [analyticsMetrics, setAnalyticsMetrics] = useState<VariantMetric[]>([]);

	// Loaders
	const [loading, setLoading] = useState<boolean>(false);

	// Auth token
	const adminRole = localStorage.getItem('admin_role') || 'SUPER_ADMIN';
	const headers = {
		'X-Admin-Role': adminRole,
		'Content-Type': 'application/json',
	};

	// --- Audience Estimator State ---
	const [estimatorFilters, setEstimatorFilters] = useState({
		city: '',
		min_trips: '',
		last_active_days: '',
		min_ltv: '',
		car_type: '',
		transmission: '',
	});
	const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
	const [estimating, setEstimating] = useState<boolean>(false);

	// --- Save Segment Modal Form ---
	const [showSaveSegmentModal, setShowSaveSegmentModal] = useState<boolean>(false);
	const [newSegmentForm, setNewSegmentForm] = useState({
		name: '',
		description: '',
	});

	// --- Campaign Builder Form ---
	const [newCampaign, setNewCampaign] = useState({
		name: '',
		segment_id: '',
		channel: 'PUSH',
		schedule_type: 'IMMEDIATE',
		schedule_time: '',
		recurrence_cron: '',
		trigger_event: '',
		throttling_limit: '1000',
		quiet_hours_start: '22',
		quiet_hours_end: '08',
	});
	// A/B test variants list
	const [newCampaignVariants, setNewCampaignVariants] = useState<CampaignVariant[]>([
		{ name: 'Variant A', weight: 0.5, content: { title_template: 'Discount Alert!', body_template: 'Hey {first_name}, enjoy 20% off today!' } },
		{ name: 'Variant B', weight: 0.5, content: { title_template: 'Limited Offer', body_template: 'Hi {first_name}, flat Rs.50 off your next ride.' } },
	]);

	// --- Banner Form ---
	const [newBanner, setNewBanner] = useState({
		title: '',
		body: '',
		image_url: '',
		deep_link: '',
		placement: 'HOME_SCREEN',
		segment_id: '',
		start_time: new Date().toISOString().slice(0, 16),
		end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
	});

	// --- Push Template Form ---
	const [newPushTemplate, setNewPushTemplate] = useState({
		name: '',
		title_template: '',
		body_template: '',
		image_url: '',
		deep_link: '',
		variables: 'first_name, discount',
	});

	// --- DLT SMS Form ---
	const [newSmsTemplate, setNewSmsTemplate] = useState({
		sender_id: 'DFUSMS',
		dlt_template_id: '',
		approved_content: '',
	});

	// --- Email Template Form ---
	const [newEmailTemplate, setNewEmailTemplate] = useState({
		name: '',
		subject: '',
		html_content: '<html><body><h1>Hi {first_name},</h1><p>Enjoy your ride!</p></body></html>',
		variables: 'first_name',
	});

	// --- Add Domain Form ---
	const [newDomain, setNewDomain] = useState({
		domain: '',
	});

	// --- Load API Data ---
	const fetchAll = async () => {
		setLoading(true);
		try {
			const headersObj = { headers };
			const [resSeg, resCamp, resBan, resPush, resSms, resEmail, resDom] = await Promise.all([
				fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/segments`, headersObj),
				fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns`, headersObj),
				fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/banners`, headersObj),
				fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/push`, headersObj),
				fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/sms`, headersObj),
				fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/email`, headersObj),
				fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/domains`, headersObj),
			]);

			if (resSeg.ok) setSegments(await resSeg.json());
			if (resCamp.ok) setCampaigns(await resCamp.json());
			if (resBan.ok) setBanners(await resBan.json());
			if (resPush.ok) setPushTemplates(await resPush.json());
			if (resSms.ok) setSmsTemplates(await resSms.json());
			if (resEmail.ok) setEmailTemplates(await resEmail.json());
			if (resDom.ok) setDomains(await resDom.json());
		} catch (err) {
			console.error('Failed fetching marketing details:', err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchAll();
	}, []);

	// --- Actions ---

	// Audience Segment Size Estimator
	const runEstimateSize = async () => {
		setEstimating(true);
		try {
			const cleanedFilters: Record<string, any> = {};
			if (estimatorFilters.city) cleanedFilters.city = estimatorFilters.city;
			if (estimatorFilters.min_trips) cleanedFilters.min_trips = parseInt(estimatorFilters.min_trips);
			if (estimatorFilters.last_active_days) cleanedFilters.last_active_days = parseInt(estimatorFilters.last_active_days);
			if (estimatorFilters.min_ltv) cleanedFilters.min_ltv = parseInt(estimatorFilters.min_ltv);
			if (estimatorFilters.car_type) cleanedFilters.car_type = estimatorFilters.car_type;
			if (estimatorFilters.transmission) cleanedFilters.transmission = estimatorFilters.transmission;

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/segments/estimate`, {
				method: 'POST',
				headers,
				body: JSON.stringify(cleanedFilters),
			});
			if (res.ok) {
				const data = await res.json();
				setEstimatedSize(data.estimated_size);
			}
		} catch (err) {
			console.error(err);
		} finally {
			setEstimating(false);
		}
	};

	const saveAudienceSegment = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const cleanedFilters: Record<string, any> = {};
			if (estimatorFilters.city) cleanedFilters.city = estimatorFilters.city;
			if (estimatorFilters.min_trips) cleanedFilters.min_trips = parseInt(estimatorFilters.min_trips);
			if (estimatorFilters.last_active_days) cleanedFilters.last_active_days = parseInt(estimatorFilters.last_active_days);
			if (estimatorFilters.min_ltv) cleanedFilters.min_ltv = parseInt(estimatorFilters.min_ltv);
			if (estimatorFilters.car_type) cleanedFilters.car_type = estimatorFilters.car_type;
			if (estimatorFilters.transmission) cleanedFilters.transmission = estimatorFilters.transmission;

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/segments`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					name: newSegmentForm.name,
					description: newSegmentForm.description,
					filters: cleanedFilters,
				}),
			});
			if (res.ok) {
				setShowSaveSegmentModal(false);
				setNewSegmentForm({ name: '', description: '' });
				const resSeg = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/segments`, { headers });
				if (resSeg.ok) setSegments(await resSeg.json());
				alert('Segment saved successfully.');
			}
		} catch (err) {
			console.error(err);
		}
	};

	const deleteSegment = async (id: number) => {
		if (!confirm('Are you sure you want to delete this segment?')) return;
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/segments/${id}`, {
				method: 'DELETE',
				headers,
			});
			if (res.ok) {
				setSegments(prev => prev.filter(s => s.id !== id));
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Create Campaign
	const submitCampaign = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const payload: any = {
				name: newCampaign.name,
				channel: newCampaign.channel,
				schedule_type: newCampaign.schedule_type,
				variants: newCampaignVariants.map(v => ({
					name: v.name,
					content: v.content,
					weight: v.weight,
				})),
			};

			if (newCampaign.segment_id) {
				payload.segment_id = parseInt(newCampaign.segment_id);
			}
			if (newCampaign.schedule_time) {
				payload.schedule_time = new Date(newCampaign.schedule_time).toISOString();
			}
			if (newCampaign.recurrence_cron) {
				payload.recurrence_cron = newCampaign.recurrence_cron;
			}
			if (newCampaign.trigger_event) {
				payload.trigger_event = newCampaign.trigger_event;
			}
			if (newCampaign.throttling_limit) {
				payload.throttling_limit = parseInt(newCampaign.throttling_limit);
			}
			if (newCampaign.quiet_hours_start) {
				payload.quiet_hours_start = parseInt(newCampaign.quiet_hours_start);
			}
			if (newCampaign.quiet_hours_end) {
				payload.quiet_hours_end = parseInt(newCampaign.quiet_hours_end);
			}

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns`, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			});
			if (res.ok) {
				setNewCampaign({
					name: '',
					segment_id: '',
					channel: 'PUSH',
					schedule_type: 'IMMEDIATE',
					schedule_time: '',
					recurrence_cron: '',
					trigger_event: '',
					throttling_limit: '1000',
					quiet_hours_start: '22',
					quiet_hours_end: '08',
				});
				setNewCampaignVariants([
					{ name: 'Variant A', weight: 0.5, content: { title_template: 'Discount Alert!', body_template: 'Hey {first_name}, enjoy 20% off today!' } },
					{ name: 'Variant B', weight: 0.5, content: { title_template: 'Limited Offer', body_template: 'Hi {first_name}, flat Rs.50 off your next ride.' } },
				]);
				const resCamp = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns`, { headers });
				if (resCamp.ok) setCampaigns(await resCamp.json());
				alert('Campaign created successfully in Draft state.');
			}
		} catch (err) {
			console.error(err);
		}
	};

	const updateCampaignStatus = async (id: number, status: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns/${id}/status`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ status }),
			});
			if (res.ok) {
				setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status } : c));
			}
		} catch (err) {
			console.error(err);
		}
	};

	const viewCampaignAnalytics = async (id: number) => {
		if (activeAnalyticsId === id) {
			setActiveAnalyticsId(null);
			setAnalyticsMetrics([]);
			return;
		}
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns/${id}/analytics`, { headers });
			if (res.ok) {
				setAnalyticsMetrics(await res.json());
				setActiveAnalyticsId(id);
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Save Banner
	const submitBanner = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const payload: any = {
				title: newBanner.title,
				body: newBanner.body,
				placement: newBanner.placement,
				start_time: new Date(newBanner.start_time).toISOString(),
				end_time: new Date(newBanner.end_time).toISOString(),
			};
			if (newBanner.image_url) payload.image_url = newBanner.image_url;
			if (newBanner.deep_link) payload.deep_link = newBanner.deep_link;
			if (newBanner.segment_id) payload.segment_id = parseInt(newBanner.segment_id);

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/banners`, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			});
			if (res.ok) {
				setNewBanner({
					title: '',
					body: '',
					image_url: '',
					deep_link: '',
					placement: 'HOME_SCREEN',
					segment_id: '',
					start_time: new Date().toISOString().slice(0, 16),
					end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
				});
				const resBan = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/banners`, { headers });
				if (resBan.ok) setBanners(await resBan.json());
				alert('In-app banner created successfully.');
			}
		} catch (err) {
			console.error(err);
		}
	};

	const toggleBannerStatus = async (id: number, currentStatus: string) => {
		const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/banners/${id}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ status: nextStatus }),
			});
			if (res.ok) {
				setBanners(prev => prev.map(b => b.id === id ? { ...b, status: nextStatus } : b));
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Save templates
	const submitPushTemplate = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const variables = newPushTemplate.variables.split(',').map(v => v.trim()).filter(Boolean);
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/push`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					name: newPushTemplate.name,
					title_template: newPushTemplate.title_template,
					body_template: newPushTemplate.body_template,
					image_url: newPushTemplate.image_url || null,
					deep_link: newPushTemplate.deep_link || null,
					variables,
				}),
			});
			if (res.ok) {
				setNewPushTemplate({ name: '', title_template: '', body_template: '', image_url: '', deep_link: '', variables: 'first_name, discount' });
				const resPush = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/push`, { headers });
				if (resPush.ok) setPushTemplates(await resPush.json());
				alert('Push Notification Template created.');
			}
		} catch (err) {
			console.error(err);
		}
	};

	const submitSMSTemplate = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/sms`, {
				method: 'POST',
				headers,
				body: JSON.stringify(newSmsTemplate),
			});
			if (res.ok) {
				setNewSmsTemplate({ sender_id: 'DFUSMS', dlt_template_id: '', approved_content: '' });
				const resSms = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/sms`, { headers });
				if (resSms.ok) setSmsTemplates(await resSms.json());
				alert('DLT SMS template registered.');
			}
		} catch (err) {
			console.error(err);
		}
	};

	const submitEmailTemplate = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const variables = newEmailTemplate.variables.split(',').map(v => v.trim()).filter(Boolean);
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/email`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					name: newEmailTemplate.name,
					subject: newEmailTemplate.subject,
					html_content: newEmailTemplate.html_content,
					variables,
				}),
			});
			if (res.ok) {
				setNewEmailTemplate({ name: '', subject: '', html_content: '<html><body><h1>Hi {first_name},</h1><p>Enjoy your ride!</p></body></html>', variables: 'first_name' });
				const resEmail = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/templates/email`, { headers });
				if (resEmail.ok) setEmailTemplates(await resEmail.json());
				alert('Email HTML template created.');
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Save Domain & Verify
	const submitDomain = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/domains`, {
				method: 'POST',
				headers,
				body: JSON.stringify(newDomain),
			});
			if (res.ok) {
				setNewDomain({ domain: '' });
				const resDom = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/domains`, { headers });
				if (resDom.ok) setDomains(await resDom.json());
				alert('Sender domain added successfully.');
			}
		} catch (err) {
			console.error(err);
		}
	};

	const verifyDomain = async (id: number) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/domains/${id}/verify`, {
				method: 'POST',
				headers,
			});
			if (res.ok) {
				const resDom = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/domains`, { headers });
				if (resDom.ok) setDomains(await resDom.json());
				alert('Domain DNS verified successfully.');
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Conversion simulation helper
	const simulateConversion = async (campaignId: number, variantId: number, action: string) => {
		try {
			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns/${campaignId}/conversions`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					variant_id: variantId,
					user_id: '1e8a8b8c-8d8e-8f9a-9b9c-9d9e9f0a0b0c',
					user_type: 'RIDER',
					action_type: action,
				}),
			});
			if (res.ok) {
				// Refresh active analytics if open
				if (activeAnalyticsId === campaignId) {
					const analyticsRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns/${campaignId}/analytics`, { headers });
					if (analyticsRes.ok) setAnalyticsMetrics(await analyticsRes.json());
				}
				alert(`Simulated conversion event: ${action}`);
			}
		} catch (err) {
			console.error(err);
		}
	};

	// Form Variant helpers
	const updateFormVariant = (index: number, key: string, value: any) => {
		setNewCampaignVariants(prev => prev.map((v, i) => {
			if (i === index) {
				if (key === 'name' || key === 'weight') return { ...v, [key]: value };
				return { ...v, content: { ...v.content, [key]: value } };
			}
			return v;
		}));
	};

	const addFormVariant = () => {
		setNewCampaignVariants(prev => [
			...prev,
			{ name: `Variant ${String.fromCharCode(65 + prev.length)}`, weight: 0.1, content: { title_template: '', body_template: '' } }
		]);
	};

	// --- CSV exports for registry lists ---
	const exportCampaignsCsv = () => {
		const cols: CsvColumn<MarketingCampaign>[] = [
			{ key: 'id', label: 'ID' },
			{ key: 'name', label: 'Name' },
			{ key: 'channel', label: 'Channel' },
			{ key: 'segment_name', label: 'Segment' },
			{ key: 'schedule_type', label: 'Schedule' },
			{ key: 'status', label: 'Status' },
			{ key: 'created_at', label: 'Created' },
		];
		exportToCsv<MarketingCampaign>(`campaigns_${new Date().toISOString().slice(0, 10)}.csv`, cols, campaigns);
	};

	const exportSegmentsCsv = () => {
		const cols: CsvColumn<MarketingSegment>[] = [
			{ key: 'id', label: 'ID' },
			{ key: 'name', label: 'Name' },
			{ key: 'description', label: 'Description' },
			{ key: 'size', label: 'Size' },
			{ key: 'created_at', label: 'Created' },
		];
		exportToCsv<MarketingSegment>(`segments_${new Date().toISOString().slice(0, 10)}.csv`, cols, segments);
	};

	// --- Send Push to Segment (standalone, non-campaign-builder flow) ---
	const [showPushModal, setShowPushModal] = useState<boolean>(false);
	const [pushForm, setPushForm] = useState({ name: '', segment_id: '', title: '', body: '' });
	const [sendingPush, setSendingPush] = useState<boolean>(false);

	const sendPushToSegment = async (e: React.FormEvent) => {
		e.preventDefault();
		setSendingPush(true);
		try {
			const payload: Record<string, unknown> = {
				name: pushForm.name || `Push blast ${new Date().toLocaleString()}`,
				channel: 'PUSH',
				schedule_type: 'IMMEDIATE',
				variants: [{
					name: 'Push',
					weight: 1,
					content: { title_template: pushForm.title, body_template: pushForm.body },
				}],
			};
			if (pushForm.segment_id) payload.segment_id = parseInt(pushForm.segment_id);

			const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns`, {
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			});
			if (res.ok) {
				setShowPushModal(false);
				setPushForm({ name: '', segment_id: '', title: '', body: '' });
				const resCamp = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketing/campaigns`, { headers });
				if (resCamp.ok) setCampaigns(await resCamp.json());
				alert('Push blast queued to the selected segment.');
			}
		} catch (err) {
			console.error(err);
		} finally {
			setSendingPush(false);
		}
	};

	return (
		<div className="w-full h-full flex flex-col bg-background-primary text-content-primary font-sans">
			{/* ---- Header ---- */}
			<header className="h-[72px] min-h-[72px] border-b border-background-secondary flex justify-between items-center px-6 bg-background-primary">
				<div className="flex items-center gap-6">
					<h1 className="text-xl font-bold tracking-tight text-content-primary flex items-center gap-2">
						Campaigns & Marketing Console
						{loading && <span className="text-xs text-content-tertiary font-normal animate-pulse">(syncing...)</span>}
					</h1>
					<nav className="flex bg-background-tertiary p-1 rounded-pill-tab">
						{([
							{ key: 'CAMPAIGNS', label: 'Campaign Builder' },
							{ key: 'SEGMENTS', label: 'Audience Segments' },
							{ key: 'BANNERS', label: 'In-App Placements' },
							{ key: 'TEMPLATES', label: 'Push & SMS Templates' },
							{ key: 'DOMAINS', label: 'Verified Domains' },
						] as { key: TabType; label: string }[]).map((tab) => (
							<button
								key={tab.key}
								onClick={() => {
									setActiveTab(tab.key);
									setActiveAnalyticsId(null);
								}}
								className={`px-4 py-1.5 rounded-pill text-xs font-semibold tracking-wide transition ${
									activeTab === tab.key ? 'bg-background-primary text-content-primary shadow-sm' : 'text-content-secondary hover:text-content-primary'
								}`}
							>
								{tab.label}
							</button>
						))}
					</nav>
				</div>
			</header>

			{/* ---- Content panels ---- */}
			<div className="flex-1 overflow-y-auto p-6 space-y-6">
				{/* 1. CAMPAIGNS TAB */}
				{activeTab === 'CAMPAIGNS' && (
					<div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
						{/* Left / Center: Campaign Builder Form */}
						<div className="xl:col-span-1 bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4 shadow-sm">
							<div className="border-b border-background-secondary pb-2">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary">Create Campaign Blast</h2>
								<p className="text-[10px] text-content-tertiary">Design multi-variant A/B campaign options.</p>
							</div>

							<form onSubmit={submitCampaign} className="space-y-4 text-xs text-content-secondary">
								<div className="space-y-1">
									<label className="block text-[10px] uppercase font-bold text-content-tertiary">Campaign Name</label>
									<input
										type="text"
										required
										placeholder="e.g. BLR Weekend Off"
										value={newCampaign.name}
										onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })}
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-semibold"
									/>
								</div>

								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">Target Audience Segment</label>
										<select
											value={newCampaign.segment_id}
											onChange={e => setNewCampaign({ ...newCampaign, segment_id: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
										>
											<option value="">All Segment Users</option>
											{segments.map(s => (
												<option key={s.id} value={s.id}>{s.name} (~{s.size} users)</option>
											))}
										</select>
									</div>
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">Delivery Channel</label>
										<select
											value={newCampaign.channel}
											onChange={e => setNewCampaign({ ...newCampaign, channel: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
										>
											<option value="PUSH">Push Notification</option>
											<option value="SMS">SMS Message</option>
											<option value="EMAIL">HTML Email</option>
											<option value="IN_APP_BANNER">In-App banner card</option>
											<option value="WHATSAPP">WhatsApp Direct</option>
										</select>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">Schedule Type</label>
										<select
											value={newCampaign.schedule_type}
											onChange={e => setNewCampaign({ ...newCampaign, schedule_type: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
										>
											<option value="IMMEDIATE">Immediate Blast</option>
											<option value="SCHEDULED">Scheduled Date/Time</option>
											<option value="RECURRING">Recurring (Cron schedule)</option>
											<option value="TRIGGER_BASED">Trigger-based event</option>
										</select>
									</div>

									{newCampaign.schedule_type === 'SCHEDULED' && (
										<div className="space-y-1">
											<label className="block text-[10px] uppercase font-bold text-content-tertiary">Schedule Time</label>
											<input
												type="datetime-local"
												required
												value={newCampaign.schedule_time}
												onChange={e => setNewCampaign({ ...newCampaign, schedule_time: e.target.value })}
												className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono"
											/>
										</div>
									)}

									{newCampaign.schedule_type === 'RECURRING' && (
										<div className="space-y-1">
											<label className="block text-[10px] uppercase font-bold text-content-tertiary">Cron Expression</label>
											<input
												type="text"
												required
												placeholder="0 9 * * 1-5"
												value={newCampaign.recurrence_cron}
												onChange={e => setNewCampaign({ ...newCampaign, recurrence_cron: e.target.value })}
												className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 font-mono"
											/>
										</div>
									)}

									{newCampaign.schedule_type === 'TRIGGER_BASED' && (
										<div className="space-y-1">
											<label className="block text-[10px] uppercase font-bold text-content-tertiary">Trigger Event Code</label>
											<select
												value={newCampaign.trigger_event}
												onChange={e => setNewCampaign({ ...newCampaign, trigger_event: e.target.value })}
												className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
											>
												<option value="">Select Event...</option>
												<option value="USER_SIGNUP">User Signup Complete</option>
												<option value="POST_TRIP_COMPLETED">Post Trip Completed</option>
												<option value="PAYMENT_FAILED">Booking Payment Failed</option>
											</select>
										</div>
									)}
								</div>

								{/* A/B Test Variant Section */}
								<div className="border-t border-background-secondary pt-3 space-y-3">
									<div className="flex justify-between items-center">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">A/B Split Test Variants</label>
										<button
											type="button"
											onClick={addFormVariant}
											className="text-[10px] font-bold text-content-primary underline"
										>
											+ Add Variant
										</button>
									</div>

									{newCampaignVariants.map((v, idx) => (
										<div key={idx} className="p-3 bg-background-tertiary rounded-lg border border-background-secondary space-y-2">
											<div className="flex justify-between items-center">
												<span className="font-bold font-mono text-[10px] text-content-primary">{v.name}</span>
												<div className="flex items-center gap-1">
													<label className="text-[9px] text-content-tertiary uppercase font-bold">Weight:</label>
													<input
														type="number"
														step="0.05"
														min="0"
														max="1"
														required
														value={v.weight}
														onChange={e => updateFormVariant(idx, 'weight', parseFloat(e.target.value))}
														className="w-12 h-6 rounded bg-background-primary border border-background-secondary text-center font-mono font-bold"
													/>
												</div>
											</div>
											<div className="space-y-1">
												<input
													type="text"
													required
													placeholder="Title Template / Subject line"
													value={v.content.title_template || ''}
													onChange={e => updateFormVariant(idx, 'title_template', e.target.value)}
													className="w-full h-7 rounded bg-background-primary border border-background-secondary px-2 font-semibold"
												/>
												<textarea
													required
													placeholder="Body Template / Message content"
													value={v.content.body_template || ''}
													onChange={e => updateFormVariant(idx, 'body_template', e.target.value)}
													className="w-full h-12 rounded bg-background-primary border border-background-secondary p-2 font-semibold resize-none"
												/>
											</div>
										</div>
									))}
								</div>

								{/* Throttling & Quiet Hours */}
								<div className="border-t border-background-secondary pt-3 grid grid-cols-3 gap-2">
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Throttle limit/hr</label>
										<input
											type="number"
											value={newCampaign.throttling_limit}
											onChange={e => setNewCampaign({ ...newCampaign, throttling_limit: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono font-bold"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Quiet Start (hr)</label>
										<input
											type="number"
											min="0"
											max="23"
											value={newCampaign.quiet_hours_start}
											onChange={e => setNewCampaign({ ...newCampaign, quiet_hours_start: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Quiet End (hr)</label>
										<input
											type="number"
											min="0"
											max="23"
											value={newCampaign.quiet_hours_end}
											onChange={e => setNewCampaign({ ...newCampaign, quiet_hours_end: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono"
										/>
									</div>
								</div>

								<button
									type="submit"
									className="w-full bg-content-primary text-gray-0 text-xs font-bold py-2 rounded-md hover:bg-gray-800 transition shadow-sm active:scale-[0.97]"
								>
									🚀 Register Campaign (Draft)
								</button>
							</form>
						</div>

						{/* Right: Active Campaigns & Analytics Queue */}
						<div className="xl:col-span-2 space-y-4">
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 shadow-sm space-y-4">
								<div className="flex justify-between items-center border-b border-background-secondary pb-2">
									<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary">Campaign Registry & Performance</h2>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => setShowPushModal(true)}
											className="text-[10px] font-bold bg-content-primary text-gray-0 px-2.5 py-1 rounded hover:bg-gray-800 transition"
										>
											📲 Send Push to Segment
										</button>
										<button
											type="button"
											onClick={exportCampaignsCsv}
											disabled={campaigns.length === 0}
											className="text-[10px] font-bold bg-background-secondary border border-background-secondary hover:border-content-primary px-2.5 py-1 rounded transition disabled:opacity-50"
										>
											↓ CSV
										</button>
									</div>
								</div>

								<div className="divide-y divide-background-secondary">
									{campaigns.length === 0 ? (
										<div className="p-12 text-center text-xs text-content-tertiary font-semibold select-none">No campaigns built yet</div>
									) : (
										campaigns.map(c => {
											const isAnalyticsOpen = activeAnalyticsId === c.id;
											return (
												<div key={c.id} className="py-4 space-y-3">
													<div className="flex justify-between items-start">
														<div className="space-y-1">
															<div className="flex items-center gap-2">
																<h3 className="text-sm font-bold text-content-primary">{c.name}</h3>
																<AdminBadge
																	label={c.status}
																	variant={c.status === 'ACTIVE' ? 'positive' : c.status === 'PAUSED' ? 'warning' : 'neutral'}
																/>
															</div>
															<p className="text-[10px] text-content-tertiary font-mono">
																Channel: <span className="text-content-primary font-semibold">{c.channel}</span> | 
																Segment: <span className="text-content-primary font-semibold">{c.segment_name || 'All Users'}</span> | 
																Type: <span className="text-content-primary font-semibold">{c.schedule_type}</span>
															</p>
														</div>
														<div className="flex items-center gap-2 text-[10px] font-bold">
															<button
																onClick={() => viewCampaignAnalytics(c.id)}
																className="bg-background-secondary border border-background-secondary hover:border-content-primary px-2.5 py-1 rounded transition"
															>
																{isAnalyticsOpen ? 'Hide Metrics 📊' : 'View Metrics 📊'}
															</button>
															{c.status === 'ACTIVE' ? (
																<button
																	onClick={() => updateCampaignStatus(c.id, 'PAUSED')}
																	className="bg-surface-negative0/10 text-content-negative hover:bg-surface-negative0/20 border border-negative-400/20 px-2 py-1 rounded transition"
																>
																	Pause
																</button>
															) : (
																<button
																	onClick={() => updateCampaignStatus(c.id, 'ACTIVE')}
																	className="bg-positive-400/10 text-content-positive hover:bg-positive-400/20 border border-positive-400/20 px-2 py-1 rounded transition"
																>
																	Launch
																</button>
															)}
														</div>
													</div>

													{/* Variant Analytics dropdown */}
													{isAnalyticsOpen && (
														<div className="bg-background-tertiary rounded-lg border border-background-secondary p-4 space-y-4 animate-fade-in text-xs">
															<div className="flex justify-between items-center">
																<h4 className="font-bold text-content-primary uppercase tracking-wider text-[10px]">A/B Test Live Conversion Metrics</h4>
																<span className="text-[9px] text-content-tertiary uppercase font-mono">Click to inject test conversions</span>
															</div>
															
															<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
																{c.variants.map((v, idx) => {
																	const metric = analyticsMetrics.find(m => m.variant_id === v.id) || { delivered: 0, opened: 0, clicked: 0, booking: 0 };
																	const openRate = metric.delivered > 0 ? ((metric.opened / metric.delivered) * 100).toFixed(1) : '0';
																	const clickRate = metric.opened > 0 ? ((metric.clicked / metric.opened) * 100).toFixed(1) : '0';
																	const bookingRate = metric.clicked > 0 ? ((metric.booking / metric.clicked) * 100).toFixed(1) : '0';

																	return (
																		<div key={v.id || idx} className="bg-background-primary border border-background-secondary p-3 rounded-lg space-y-2">
																			<div className="flex justify-between items-center border-b border-background-secondary pb-1">
																				<span className="font-bold text-content-primary text-[11px]">{v.name} ({Math.round(v.weight * 100)}% weight)</span>
																				<div className="flex gap-1">
																					<button
																						onClick={() => simulateConversion(c.id, v.id || 0, 'DELIVERED')}
																						className="text-[8px] uppercase bg-background-secondary border px-1 rounded font-bold"
																					>
																						Deliv
																					</button>
																					<button
																						onClick={() => simulateConversion(c.id, v.id || 0, 'OPENED')}
																						className="text-[8px] uppercase bg-background-secondary border px-1 rounded font-bold"
																					>
																						Open
																					</button>
																					<button
																						onClick={() => simulateConversion(c.id, v.id || 0, 'CLICKED')}
																						className="text-[8px] uppercase bg-background-secondary border px-1 rounded font-bold"
																					>
																						Click
																					</button>
																					<button
																						onClick={() => simulateConversion(c.id, v.id || 0, 'BOOKING')}
																						className="text-[8px] uppercase bg-background-secondary border px-1 rounded font-bold text-content-positive"
																					>
																						Book
																					</button>
																				</div>
																			</div>

																			<div className="grid grid-cols-4 gap-1 text-center font-mono text-[10px]">
																				<div className="bg-background-tertiary p-1 rounded">
																					<span className="block font-bold text-content-primary">{metric.delivered}</span>
																					<span className="text-[8px] text-content-tertiary uppercase">Deliv</span>
																				</div>
																				<div className="bg-background-tertiary p-1 rounded">
																					<span className="block font-bold text-content-primary">{metric.opened}</span>
																					<span className="text-[8px] text-content-tertiary uppercase">Opens ({openRate}%)</span>
																				</div>
																				<div className="bg-background-tertiary p-1 rounded">
																					<span className="block font-bold text-content-primary">{metric.clicked}</span>
																					<span className="text-[8px] text-content-tertiary uppercase">Clicks ({clickRate}%)</span>
																				</div>
																				<div className="bg-background-tertiary p-1 rounded">
																					<span className="block font-bold text-content-primary text-content-positive">{metric.booking}</span>
																					<span className="text-[8px] text-content-tertiary uppercase">Book ({bookingRate}%)</span>
																				</div>
																			</div>
																		</div>
																	);
																})}
															</div>
														</div>
													)}
												</div>
											);
										})
									)}
								</div>
							</div>
						</div>
					</div>
				)}

				{/* 2. AUDIENCE SEGMENTS TAB */}
				{activeTab === 'SEGMENTS' && (
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
						{/* Audience Segmentation Engine */}
						<div className="lg:col-span-1 bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4 shadow-sm text-xs">
							<div className="border-b border-background-secondary pb-2">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary">Audience Query Filters</h2>
								<p className="text-[10px] text-content-tertiary">Set parameters to filter rider or driver targets</p>
							</div>

							<div className="space-y-3 text-content-secondary">
								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Target City</label>
										<input
											type="text"
											placeholder="Kolkata"
											value={estimatorFilters.city}
											onChange={e => setEstimatorFilters({ ...estimatorFilters, city: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-semibold"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Min Trips Completed</label>
										<input
											type="number"
											placeholder="10"
											value={estimatorFilters.min_trips}
											onChange={e => setEstimatorFilters({ ...estimatorFilters, min_trips: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-mono font-bold"
										/>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Last Active (Max Days)</label>
										<input
											type="number"
											placeholder="30"
											value={estimatorFilters.last_active_days}
											onChange={e => setEstimatorFilters({ ...estimatorFilters, last_active_days: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-mono"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Minimum LTV (₹)</label>
										<input
											type="number"
											placeholder="1000"
											value={estimatorFilters.min_ltv}
											onChange={e => setEstimatorFilters({ ...estimatorFilters, min_ltv: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-mono"
										/>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Car Type Owned</label>
										<select
											value={estimatorFilters.car_type}
											onChange={e => setEstimatorFilters({ ...estimatorFilters, car_type: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
										>
											<option value="">Any type...</option>
											<option value="Hatchback">Hatchback</option>
											<option value="Sedan">Sedan</option>
											<option value="SUV">SUV</option>
											<option value="Premium">Premium</option>
										</select>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Transmission Type</label>
										<select
											value={estimatorFilters.transmission}
											onChange={e => setEstimatorFilters({ ...estimatorFilters, transmission: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
										>
											<option value="">Any transmission...</option>
											<option value="MANUAL">MANUAL</option>
											<option value="AUTOMATIC">AUTOMATIC</option>
										</select>
									</div>
								</div>

								<div className="pt-2 flex gap-2">
									<button
										type="button"
										onClick={runEstimateSize}
										disabled={estimating}
										className="flex-1 bg-background-secondary hover:bg-background-tertiary border border-background-secondary text-content-primary font-bold py-2 rounded-md transition disabled:opacity-50"
									>
										{estimating ? 'Calculating...' : 'Estimate Size'}
									</button>
									<button
										type="button"
										onClick={() => setShowSaveSegmentModal(true)}
										className="flex-1 bg-content-primary text-gray-0 font-bold py-2 rounded-md hover:bg-gray-800 transition"
									>
										💾 Save Segment
									</button>
								</div>

								{estimatedSize !== null && (
									<div className="mt-3 p-3 bg-surface-positive0/10 border border-positive-400/20 rounded-lg text-center">
										<span className="text-[10px] uppercase font-bold text-content-positive block tracking-wider">Estimated Audience Size</span>
										<span className="text-xl font-extrabold text-content-positive font-mono">~{estimatedSize} users</span>
									</div>
								)}
							</div>
						</div>

						{/* Saved Audience segments list */}
						<div className="lg:col-span-2 bg-background-primary border border-background-secondary rounded-xl p-5 shadow-sm space-y-4 text-xs">
							<div className="flex justify-between items-center border-b border-background-secondary pb-2">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary">Saved Segments Registry</h2>
								<button
									type="button"
									onClick={exportSegmentsCsv}
									disabled={segments.length === 0}
									className="text-[10px] font-bold bg-background-secondary border border-background-secondary hover:border-content-primary px-2.5 py-1 rounded transition disabled:opacity-50"
								>
									↓ CSV
								</button>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								{segments.map(s => (
									<div key={s.id} className="p-4 bg-background-tertiary border border-background-secondary rounded-xl space-y-3 flex flex-col justify-between">
										<div className="space-y-1">
											<div className="flex justify-between items-start">
												<h3 className="font-bold text-content-primary text-sm">{s.name}</h3>
												<button
													onClick={() => deleteSegment(s.id)}
													className="text-status-negative text-[10px] hover:underline"
												>
													Delete
												</button>
											</div>
											<p className="text-content-secondary text-[11px]">{s.description || 'No description'}</p>
										</div>

										<div className="bg-background-primary border border-background-secondary p-2.5 rounded-lg font-mono text-[9px] text-content-tertiary space-y-1 leading-relaxed">
											<span className="font-bold uppercase text-[8px] text-content-secondary block mb-1">Filters Applied:</span>
											{Object.entries(s.filters).map(([k, v]) => (
												<div key={k}>{k}: <span className="text-content-primary font-semibold">{JSON.stringify(v)}</span></div>
											))}
										</div>

										<div className="flex justify-between items-center text-[10px] pt-1">
											<span className="font-mono font-extrabold text-content-primary bg-background-primary border border-background-secondary px-2 py-0.5 rounded-md">Size: ~{s.size} users</span>
											<span className="text-content-tertiary">{new Date(s.created_at).toLocaleDateString()}</span>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				)}

				{/* 3. BANNERS TAB */}
				{activeTab === 'BANNERS' && (
					<div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
						{/* In-app banner creator */}
						<div className="xl:col-span-1 bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4 shadow-sm text-xs">
							<div className="border-b border-background-secondary pb-2">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary">New In-App Placement</h2>
								<p className="text-[10px] text-content-tertiary">Broadcast banner promotions directly inside the user app</p>
							</div>

							<form onSubmit={submitBanner} className="space-y-4 text-content-secondary">
								<div className="space-y-1">
									<label className="block text-[10px] uppercase font-bold text-content-tertiary">Banner Title</label>
									<input
										type="text"
										required
										placeholder="e.g. Safe Ride Pledge"
										value={newBanner.title}
										onChange={e => setNewBanner({ ...newBanner, title: e.target.value })}
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-semibold"
									/>
								</div>

								<div className="space-y-1">
									<label className="block text-[10px] uppercase font-bold text-content-tertiary">Banner Body Text</label>
									<textarea
										required
										placeholder="Details about discount or info..."
										value={newBanner.body}
										onChange={e => setNewBanner({ ...newBanner, body: e.target.value })}
										className="w-full h-16 rounded bg-background-secondary border border-background-secondary p-2.5 focus:outline-none focus:border-content-primary font-semibold resize-none"
									/>
								</div>

								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">Image URL</label>
										<input
											type="text"
											placeholder="https://aws.s3/banner.png"
											value={newBanner.image_url}
											onChange={e => setNewBanner({ ...newBanner, image_url: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">Deep Link Redirect</label>
										<input
											type="text"
											placeholder="d4m://promos/SURE_RIDE"
											value={newBanner.deep_link}
											onChange={e => setNewBanner({ ...newBanner, deep_link: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3"
										/>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">Placement Location</label>
										<select
											value={newBanner.placement}
											onChange={e => setNewBanner({ ...newBanner, placement: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
										>
											<option value="HOME_SCREEN">Home Screen</option>
											<option value="BOOKING_CONFIRM">Booking Confirm Panel</option>
											<option value="POST_TRIP">Post-Trip Card</option>
										</select>
									</div>
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">Target Segment</label>
										<select
											value={newBanner.segment_id}
											onChange={e => setNewBanner({ ...newBanner, segment_id: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
										>
											<option value="">All Users</option>
											{segments.map(s => (
												<option key={s.id} value={s.id}>{s.name}</option>
											))}
										</select>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">Start Date</label>
										<input
											type="datetime-local"
											required
											value={newBanner.start_time}
											onChange={e => setNewBanner({ ...newBanner, start_time: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[10px] uppercase font-bold text-content-tertiary">End Date</label>
										<input
											type="datetime-local"
											required
											value={newBanner.end_time}
											onChange={e => setNewBanner({ ...newBanner, end_time: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-mono"
										/>
									</div>
								</div>

								<button
									type="submit"
									className="w-full bg-content-primary text-gray-0 text-xs font-bold py-2 rounded-md hover:bg-gray-800 transition shadow-sm active:scale-[0.97]"
								>
									🚀 Publish Banner Card
								</button>
							</form>
						</div>

						{/* In-app banner list */}
						<div className="xl:col-span-2 bg-background-primary border border-background-secondary rounded-xl p-5 shadow-sm space-y-4 text-xs">
							<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary border-b border-background-secondary pb-2">Active In-App Broadcasts</h2>
							
							<div className="space-y-4">
								{banners.map(b => (
									<div key={b.id} className="p-4 bg-background-tertiary border border-background-secondary rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												<h3 className="font-bold text-content-primary text-sm">{b.title}</h3>
												<span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-background-primary border border-background-secondary">{b.placement}</span>
												{b.segment_name && (
													<span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-surface-positive0/10 text-content-positive border border-positive-400/20">{b.segment_name}</span>
												)}
											</div>
											<p className="text-content-secondary font-mono text-[11px] leading-relaxed max-w-xl">"{b.body}"</p>
											{b.deep_link && <p className="text-[10px] text-content-tertiary font-mono">Link: {b.deep_link}</p>}
											<p className="text-[9px] text-content-tertiary font-mono">
												Active: {new Date(b.start_time).toLocaleString()} - {new Date(b.end_time).toLocaleString()}
											</p>
										</div>

										<div className="flex items-center gap-2">
											<AdminBadge label={b.status} variant={b.status === 'ACTIVE' ? 'positive' : 'neutral'} />
											<button
												onClick={() => toggleBannerStatus(b.id, b.status)}
												className="bg-background-primary border border-background-secondary hover:border-content-primary font-bold px-2.5 py-1 rounded transition"
											>
												Toggle Status
											</button>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				)}

				{/* 4. TEMPLATES TAB */}
				{activeTab === 'TEMPLATES' && (
					<div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
						{/* Template Creators columns */}
						<div className="space-y-6 xl:col-span-1">
							{/* Push template creator */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4 shadow-sm text-xs">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary border-b border-background-secondary pb-2">New Push Notification Template</h2>
								<form onSubmit={submitPushTemplate} className="space-y-3 text-content-secondary">
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Template Name</label>
										<input
											type="text"
											required
											placeholder="Promo Push"
											value={newPushTemplate.name}
											onChange={e => setNewPushTemplate({ ...newPushTemplate, name: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-semibold"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Title Template</label>
										<input
											type="text"
											required
											placeholder="Hey {first_name}!"
											value={newPushTemplate.title_template}
											onChange={e => setNewPushTemplate({ ...newPushTemplate, title_template: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-semibold"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Body Template</label>
										<textarea
											required
											placeholder="Enjoy {discount}% discount today."
											value={newPushTemplate.body_template}
											onChange={e => setNewPushTemplate({ ...newPushTemplate, body_template: e.target.value })}
											className="w-full h-12 rounded bg-background-secondary border border-background-secondary p-2 focus:outline-none focus:border-content-primary font-semibold resize-none"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Variables (comma separated)</label>
										<input
											type="text"
											placeholder="first_name, discount"
											value={newPushTemplate.variables}
											onChange={e => setNewPushTemplate({ ...newPushTemplate, variables: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 font-mono"
										/>
									</div>
									<button type="submit" className="w-full bg-content-primary text-gray-0 font-bold py-1.5 rounded-md hover:bg-gray-800 transition">
										Create Push Template
									</button>
								</form>
							</div>

							{/* DLT SMS Template creator */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4 shadow-sm text-xs">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary border-b border-background-secondary pb-2">DLT SMS Registry (TRAI India)</h2>
								<form onSubmit={submitSMSTemplate} className="space-y-3 text-content-secondary">
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">DLT Sender ID (6-char headers)</label>
										<input
											type="text"
											required
											maxLength={6}
											placeholder="DFUSMS"
											value={newSmsTemplate.sender_id}
											onChange={e => setNewSmsTemplate({ ...newSmsTemplate, sender_id: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-mono font-bold"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">DLT Template ID</label>
										<input
											type="text"
											required
											placeholder="1407161234567890123"
											value={newSmsTemplate.dlt_template_id}
											onChange={e => setNewSmsTemplate({ ...newSmsTemplate, dlt_template_id: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-mono font-bold"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">DLT Approved Template Content</label>
										<textarea
											required
											placeholder="Your OTP is {#var#}. Use it to verify."
											value={newSmsTemplate.approved_content}
											onChange={e => setNewSmsTemplate({ ...newSmsTemplate, approved_content: e.target.value })}
											className="w-full h-16 rounded bg-background-secondary border border-background-secondary p-2 focus:outline-none focus:border-content-primary font-semibold resize-none"
										/>
									</div>
									<button type="submit" className="w-full bg-content-primary text-gray-0 font-bold py-1.5 rounded-md hover:bg-gray-800 transition">
										Register DLT Template
									</button>
								</form>
							</div>

							{/* HTML Email template creator */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4 shadow-sm text-xs">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary border-b border-background-secondary pb-2">HTML Email Editor</h2>
								<form onSubmit={submitEmailTemplate} className="space-y-3 text-content-secondary">
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Template Name</label>
										<input
											type="text"
											required
											placeholder="Welcome Email"
											value={newEmailTemplate.name}
											onChange={e => setNewEmailTemplate({ ...newEmailTemplate, name: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 font-semibold"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Subject Line</label>
										<input
											type="text"
											required
											placeholder="Welcome to Vahnly!"
											value={newEmailTemplate.subject}
											onChange={e => setNewEmailTemplate({ ...newEmailTemplate, subject: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 font-semibold"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">HTML Source Content</label>
										<textarea
											required
											placeholder="<html>..."
											value={newEmailTemplate.html_content}
											onChange={e => setNewEmailTemplate({ ...newEmailTemplate, html_content: e.target.value })}
											className="w-full h-32 rounded bg-background-secondary border border-background-secondary p-2 focus:outline-none focus:border-content-primary font-mono resize-none"
										/>
									</div>
									<div className="space-y-1">
										<label className="block text-[9px] uppercase font-bold text-content-tertiary">Variables (comma separated)</label>
										<input
											type="text"
											placeholder="first_name"
											value={newEmailTemplate.variables}
											onChange={e => setNewEmailTemplate({ ...newEmailTemplate, variables: e.target.value })}
											className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 font-mono"
										/>
									</div>
									<button type="submit" className="w-full bg-content-primary text-gray-0 font-bold py-1.5 rounded-md hover:bg-gray-800 transition">
										Create Email Template
									</button>
								</form>
							</div>
						</div>

						{/* Right columns: Lists of templates */}
						<div className="space-y-6 xl:col-span-2 text-xs">
							{/* Push templates list */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 shadow-sm space-y-4">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary border-b border-background-secondary pb-2">Push Templates</h2>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{pushTemplates.map(t => (
										<div key={t.id} className="p-3 bg-background-tertiary border border-background-secondary rounded-lg space-y-2">
											<div className="flex justify-between items-center">
												<span className="font-bold text-content-primary font-mono">{t.name}</span>
												<span className="text-[9px] text-content-tertiary font-mono">{new Date(t.created_at).toLocaleDateString()}</span>
											</div>
											<div className="bg-background-primary border border-background-secondary p-2 rounded text-[11px] font-mono leading-relaxed">
												<span className="block font-bold text-content-primary">Title: {t.title_template}</span>
												<span className="block text-content-secondary mt-1">Body: {t.body_template}</span>
											</div>
											<div className="flex flex-wrap gap-1">
												{t.variables.map(v => (
													<span key={v} className="bg-background-primary border border-background-secondary text-content-tertiary px-1.5 py-0.5 rounded font-mono text-[9px]">
														{`{${v}}`}
													</span>
												))}
											</div>
										</div>
									))}
								</div>
							</div>

							{/* DLT SMS templates list */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 shadow-sm space-y-4">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary border-b border-background-secondary pb-2">DLT SMS Templates</h2>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{smsTemplates.map(t => (
										<div key={t.id} className="p-3 bg-background-tertiary border border-background-secondary rounded-lg space-y-2">
											<div className="flex justify-between items-center text-[10px] font-mono">
												<span className="font-bold text-content-primary">Sender: {t.sender_id}</span>
												<span className="text-content-tertiary">DLT: {t.dlt_template_id}</span>
											</div>
											<p className="p-2.5 bg-background-primary border border-background-secondary rounded text-[11px] font-mono leading-relaxed">
												"{t.approved_content}"
											</p>
											<div className="flex justify-between items-center text-[9px]">
												<span className="text-content-positive bg-surface-positive0/10 border border-positive-400/20 px-1 rounded font-bold uppercase">{t.status}</span>
												<span className="text-content-tertiary font-mono">{new Date(t.created_at).toLocaleDateString()}</span>
											</div>
										</div>
									))}
								</div>
							</div>

							{/* Email Templates list */}
							<div className="bg-background-primary border border-background-secondary rounded-xl p-5 shadow-sm space-y-4">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary border-b border-background-secondary pb-2">HTML Email Templates</h2>
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{emailTemplates.map(t => (
										<div key={t.id} className="p-3 bg-background-tertiary border border-background-secondary rounded-lg space-y-2">
											<div className="flex justify-between items-center">
												<span className="font-bold text-content-primary font-mono">{t.name}</span>
												<span className="text-[9px] text-content-tertiary font-mono">{new Date(t.created_at).toLocaleDateString()}</span>
											</div>
											<div className="bg-background-primary border border-background-secondary p-2 rounded text-[11px] font-mono">
												<span className="block font-bold text-content-primary">Subject: {t.subject}</span>
											</div>
											<div className="h-16 overflow-y-auto border border-background-secondary bg-background-primary rounded p-2 text-[9px] font-mono text-content-tertiary whitespace-pre-wrap">
												{t.html_content}
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
				)}

				{/* 5. DOMAINS TAB */}
				{activeTab === 'DOMAINS' && (
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start text-xs">
						{/* Domain Creator */}
						<div className="lg:col-span-1 bg-background-primary border border-background-secondary rounded-xl p-5 space-y-4 shadow-sm">
							<div className="border-b border-background-secondary pb-2">
								<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary">Add Sending Domain</h2>
								<p className="text-[10px] text-content-tertiary">Register your sender domains to setup SPF, DKIM and DMARC verification.</p>
							</div>

							<form onSubmit={submitDomain} className="space-y-4 text-content-secondary">
								<div className="space-y-1">
									<label className="block text-[10px] uppercase font-bold text-content-tertiary">Domain Name</label>
									<input
										type="text"
										required
										placeholder="e.g. notifications.vahnly.com"
										value={newDomain.domain}
										onChange={e => setNewDomain({ ...newDomain, domain: e.target.value })}
										className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 focus:outline-none focus:border-content-primary font-mono font-bold"
									/>
								</div>
								<button type="submit" className="w-full bg-content-primary text-gray-0 font-bold py-2 rounded-md hover:bg-gray-800 transition shadow-sm active:scale-[0.97]">
									Register Domain Header
								</button>
							</form>
						</div>

						{/* Domain list */}
						<div className="lg:col-span-2 bg-background-primary border border-background-secondary rounded-xl p-5 shadow-sm space-y-4">
							<h2 className="text-xs font-bold uppercase tracking-wider text-content-secondary border-b border-background-secondary pb-2">Verified Sender Domain Registry</h2>
							
							<div className="space-y-4">
								{domains.map(d => (
									<div key={d.id} className="p-4 bg-background-tertiary border border-background-secondary rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												<h3 className="font-bold text-content-primary text-sm font-mono">{d.domain}</h3>
												{d.verified ? (
													<span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-surface-positive0/10 text-content-positive border border-positive-400/20">Verified</span>
												) : (
													<span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-surface-warning0/10 text-content-warning border border-warning-400/20">DNS Pending</span>
												)}
											</div>
											
											<div className="grid grid-cols-2 gap-4 text-[10px] font-mono">
												<div className="bg-background-primary border border-background-secondary px-3 py-1.5 rounded flex justify-between items-center w-48">
													<span className="text-content-tertiary font-bold uppercase text-[8px]">DKIM:</span>
													<span className={d.dkim_status === 'VERIFIED' ? 'text-content-positive font-bold' : 'text-content-warning font-bold'}>{d.dkim_status}</span>
												</div>
												<div className="bg-background-primary border border-background-secondary px-3 py-1.5 rounded flex justify-between items-center w-48">
													<span className="text-content-tertiary font-bold uppercase text-[8px]">SPF:</span>
													<span className={d.spf_status === 'VERIFIED' ? 'text-content-positive font-bold' : 'text-content-warning font-bold'}>{d.spf_status}</span>
												</div>
											</div>
										</div>

										{!d.verified && (
											<button
												onClick={() => verifyDomain(d.id)}
												className="bg-content-primary text-gray-0 font-bold px-3 py-1.5 rounded-md hover:bg-gray-800 transition shadow-sm active:scale-[0.97]"
											>
												🔍 Verify DNS TXT Records
											</button>
										)}
									</div>
								))}
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Send Push to Segment Modal */}
			{showPushModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm animate-fade-in">
					<div className="bg-background-primary border border-background-secondary p-6 rounded-xl w-[420px] shadow-2xl space-y-4 text-xs">
						<h3 className="font-bold text-content-primary text-sm border-b border-background-secondary pb-2 uppercase tracking-wider">Send Push to Segment</h3>
						<form onSubmit={sendPushToSegment} className="space-y-4 text-content-secondary">
							<div className="space-y-1">
								<label className="block text-[9px] uppercase font-bold text-content-tertiary">Blast Name (optional)</label>
								<input
									type="text"
									value={pushForm.name}
									onChange={e => setPushForm({ ...pushForm, name: e.target.value })}
									placeholder="e.g. BLR Flash Push"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 font-semibold focus:outline-none"
								/>
							</div>
							<div className="space-y-1">
								<label className="block text-[9px] uppercase font-bold text-content-tertiary">Target Segment</label>
								<select
									value={pushForm.segment_id}
									onChange={e => setPushForm({ ...pushForm, segment_id: e.target.value })}
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-2 font-semibold"
								>
									<option value="">All Segment Users</option>
									{segments.map(s => (
										<option key={s.id} value={s.id}>{s.name} (~{s.size} users)</option>
									))}
								</select>
							</div>
							<div className="space-y-1">
								<label className="block text-[9px] uppercase font-bold text-content-tertiary">Push Title</label>
								<input
									type="text"
									required
									value={pushForm.title}
									onChange={e => setPushForm({ ...pushForm, title: e.target.value })}
									placeholder="Hey {first_name}!"
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 font-semibold focus:outline-none"
								/>
							</div>
							<div className="space-y-1">
								<label className="block text-[9px] uppercase font-bold text-content-tertiary">Push Body</label>
								<textarea
									required
									value={pushForm.body}
									onChange={e => setPushForm({ ...pushForm, body: e.target.value })}
									placeholder="Enjoy 20% off your next ride today."
									className="w-full h-16 rounded bg-background-secondary border border-background-secondary p-2 focus:outline-none resize-none font-semibold"
								/>
							</div>
							<div className="flex gap-2 justify-end">
								<button
									type="button"
									onClick={() => setShowPushModal(false)}
									className="bg-background-secondary hover:bg-background-tertiary text-content-primary font-bold px-3 py-1.5 rounded border border-background-secondary"
								>
									Cancel
								</button>
								<button type="submit" disabled={sendingPush} className="bg-content-primary text-gray-0 font-bold px-4 py-1.5 rounded hover:bg-gray-800 transition disabled:opacity-50">
									{sendingPush ? 'Sending…' : '📲 Send Push'}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Save segment Modal */}
			{showSaveSegmentModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm animate-fade-in">
					<div className="bg-background-primary border border-background-secondary p-6 rounded-xl w-[400px] shadow-2xl space-y-4 text-xs">
						<h3 className="font-bold text-content-primary text-sm border-b border-background-secondary pb-2 uppercase tracking-wider">Save Audience Segment</h3>
						<form onSubmit={saveAudienceSegment} className="space-y-4 text-content-secondary">
							<div className="space-y-1">
								<label className="block text-[9px] uppercase font-bold text-content-tertiary">Segment Name</label>
								<input
									type="text"
									required
									value={newSegmentForm.name}
									onChange={e => setNewSegmentForm({ ...newSegmentForm, name: e.target.value })}
									className="w-full h-8 rounded bg-background-secondary border border-background-secondary px-3 font-semibold focus:outline-none"
								/>
							</div>
							<div className="space-y-1">
								<label className="block text-[9px] uppercase font-bold text-content-tertiary">Segment Description</label>
								<textarea
									value={newSegmentForm.description}
									onChange={e => setNewSegmentForm({ ...newSegmentForm, description: e.target.value })}
									className="w-full h-16 rounded bg-background-secondary border border-background-secondary p-2 focus:outline-none resize-none"
								/>
							</div>
							<div className="flex gap-2 justify-end">
								<button
									type="button"
									onClick={() => setShowSaveSegmentModal(false)}
									className="bg-background-secondary hover:bg-background-tertiary text-content-primary font-bold px-3 py-1.5 rounded border border-background-secondary"
								>
									Cancel
								</button>
								<button type="submit" className="bg-content-primary text-gray-0 font-bold px-4 py-1.5 rounded hover:bg-gray-800 transition">
									Save
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
};
export default MarketingDashboard;
