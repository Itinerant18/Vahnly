import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { adminRoutes, navItems, navGroups } from './adminRoutes';
import { API_GATEWAY_BASE_URL } from '../config';
import { AdminAuthGateway } from './components/AdminAuthGateway';
import { SsoCallback } from './components/SsoCallback';
import {
  IconDashboard, IconMap, IconTrips, IconRiders, IconDrivers,
  IconVehicles, IconDispatch, IconPricing, IconPromotions,
  IconPayments, IconPayouts, IconSupport, IconSafety,
  IconMarketing, IconComms, IconContent, IconAnalytics,
  IconCompliance, IconDocuments, IconSettings, IconAudit,
  IconAPI, IconTeam, IconSearch, IconBell, IconPlus,
  IconChevron, IconLogout,
} from './components/SidebarIcons';

// Icon lookup map
const iconMap: Record<string, React.FC<{ size?: number; className?: string }>> = {
  Dashboard: IconDashboard, Map: IconMap, Trips: IconTrips, Riders: IconRiders,
  Drivers: IconDrivers, Vehicles: IconVehicles, Dispatch: IconDispatch,
  Pricing: IconPricing, Promotions: IconPromotions, Payments: IconPayments,
  Payouts: IconPayouts, Support: IconSupport, Safety: IconSafety,
  Marketing: IconMarketing, Comms: IconComms, Content: IconContent,
  Analytics: IconAnalytics, Compliance: IconCompliance, Documents: IconDocuments,
  Settings: IconSettings, Audit: IconAudit, API: IconAPI, Team: IconTeam,
  Bell: IconBell, Corporate: IconTeam,
};

// ─── Notification items (mock) ──────────────────────────────────────────
const mockNotifications = [
  { id: '1', text: 'SOS triggered — Trip TRP-KOL-9281', time: '2 min ago', critical: true },
  { id: '2', text: 'Surge multiplier hit 2.4x in Sector V', time: '8 min ago', critical: false },
  { id: '3', text: 'Driver KYC rejected — DRV-0482', time: '15 min ago', critical: false },
  { id: '4', text: 'Payout batch #421 failed reconciliation', time: '23 min ago', critical: true },
  { id: '5', text: 'New driver signup spike — 12 in last hour', time: '31 min ago', critical: false },
];

// ─── Quick actions ──────────────────────────────────────────────────────
const quickActions = [
  { label: 'New promo', path: '/promotions' },
  { label: 'New broadcast', path: '/communications' },
  { label: 'Manual booking', path: '/dispatch' },
];

// ─── City options ───────────────────────────────────────────────────────
const cityOptions = ['KOL', 'DEL', 'MUM', 'BLR', 'CHN', 'HYD'];

export const AdminShell: React.FC = () => {
  // Auth is gated on the server session (HttpOnly cookie), not a JS-readable token.
  const [sessionState, setSessionState] = useState<'LOADING' | 'AUTHED' | 'ANON'>('LOADING');
  const [adminRole, setAdminRole] = useState<string>(localStorage.getItem('admin_role') ?? 'ADMIN');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedCities, setSelectedCities] = useState<string[]>(['KOL']);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const cityRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityRef.current && !cityRef.current.contains(e.target as Node)) setShowCityPicker(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) setShowQuickActions(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfileMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Verify the session against the server (cookie-authenticated) and read the role.
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/session`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          const role = data.role || 'ADMIN';
          setAdminRole(role);
          localStorage.setItem('admin_role', role); // non-sensitive; drives nav/RBAC gating
          setSessionState('AUTHED');
        } else {
          // 2FA enrolment pending — not permitted into the dashboard.
          setSessionState('ANON');
        }
      } else {
        setSessionState('ANON');
      }
    } catch {
      setSessionState('ANON');
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const handleLoginSuccess = useCallback(() => {
    // The server set the HttpOnly session cookie; re-verify to enter the dashboard.
    setSessionState('LOADING');
    checkSession();
  }, [checkSession]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore network errors; clearing local state below still logs the operator out
    }
    localStorage.removeItem('admin_role');
    localStorage.removeItem('admin_jwt_token'); // purge any legacy token
    setSessionState('ANON');
  }, []);

  const toggleCity = (city: string) => {
    setSelectedCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    // In production: dispatch search to backend
    console.log('[AdminShell] global search:', searchQuery);
  };

  // SSO callback must be handled before the auth gate — it is what establishes auth.
  if (location.pathname === '/sso-callback') {
    return <SsoCallback />;
  }

  if (sessionState === 'LOADING') {
    return (
      <div className="h-screen bg-canvas flex items-center justify-center">
        <div className="text-sm text-mute animate-pulse">Verifying session…</div>
      </div>
    );
  }

  // Auth gate — no valid server session.
  if (sessionState === 'ANON') {
    return <AdminAuthGateway onAuthSuccess={handleLoginSuccess} />;
  }

  // Filter nav items by role
  const visibleNav = navItems.filter((item) => {
    if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
    return item.allowedRoles.includes(adminRole);
  });

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/' || location.pathname === '';
    return location.pathname.startsWith(path);
  };

  const isLiveEnv = true; // Toggle for Live/Staging badge

  return (
    <div className="h-screen bg-canvas text-ink flex flex-col font-sans selection:bg-black selection:text-white overflow-hidden">
      {/* ═══════════════════════ TOP BAR ═══════════════════════ */}
      <header className="h-[72px] bg-canvas border-b border-canvas-soft px-4 flex items-center justify-between flex-shrink-0 z-30">
        {/* Left: Brand + Search */}
        <div className="flex items-center gap-4 flex-1 max-w-xl">
          <h1
            className="text-lg font-bold tracking-tight text-ink whitespace-nowrap cursor-pointer"
            onClick={() => navigate('/')}
          >
            drivers-for-u
          </h1>

          {/* Global Search */}
          <form onSubmit={handleSearch} className="flex-1 relative">
            <div className={`flex items-center gap-2 bg-canvas-soft rounded-pill px-4 py-2 transition-all ${searchFocused ? 'ring-1 ring-ink' : ''}`}>
              <IconSearch size={16} className="text-mute flex-shrink-0" />
              <input
                type="text"
                placeholder="Search trip, driver, rider, plate…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                className="bg-transparent text-sm text-ink placeholder-mute outline-none w-full"
              />
            </div>
          </form>
        </div>

        {/* Right: City, Env, Notifs, Quick Actions, Profile */}
        <div className="flex items-center gap-2">
          {/* City Selector */}
          <div className="relative" ref={cityRef}>
            <button
              onClick={() => setShowCityPicker(!showCityPicker)}
              className="flex items-center gap-1 text-xs font-medium text-body bg-canvas-soft px-3 py-1.5 rounded-pill hover:bg-surface-pressed transition"
            >
              {selectedCities.join(', ') || 'All cities'}
              <IconChevron size={12} direction={showCityPicker ? 'right' : 'left'} className="rotate-[-90deg]" />
            </button>
            {showCityPicker && (
              <div className="absolute right-0 top-full mt-2 bg-canvas rounded-xl border border-canvas-soft shadow-[0px_4px_16px_rgba(0,0,0,0.12)] p-3 min-w-[160px] z-50 animate-dropdown">
                <div className="text-[10px] text-mute uppercase tracking-wider mb-2">City scope</div>
                {cityOptions.map((city) => (
                  <label key={city} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-canvas-softer cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedCities.includes(city)}
                      onChange={() => toggleCity(city)}
                      className="accent-black w-3.5 h-3.5"
                    />
                    <span className="font-mono text-xs">{city}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Environment Badge */}
          <span className={`text-[10px] font-medium px-2.5 py-1 rounded-pill ${
            isLiveEnv ? 'bg-ink text-on-dark' : 'bg-canvas-soft text-body'
          }`}>
            {isLiveEnv ? 'Live' : 'Staging'}
          </span>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-pill hover:bg-canvas-soft transition"
            >
              <IconBell size={18} className="text-ink" />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-ink text-on-dark text-[9px] font-bold rounded-full flex items-center justify-center badge-pulse">
                {mockNotifications.length}
              </span>
            </button>
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 bg-canvas rounded-xl border border-canvas-soft shadow-[0px_4px_16px_rgba(0,0,0,0.12)] w-[340px] z-50 animate-dropdown">
                <div className="px-4 py-3 border-b border-canvas-soft flex items-center justify-between">
                  <span className="text-sm font-bold">Notifications</span>
                  <span className="text-[10px] text-mute font-mono">{mockNotifications.length} new</span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {mockNotifications.map((n) => (
                    <div key={n.id} className="px-4 py-3 hover:bg-canvas-softer border-b border-canvas-soft last:border-none flex items-start gap-2.5">
                      {n.critical && <span className="w-2 h-2 rounded-full bg-status-alert mt-1.5 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink leading-snug">{n.text}</div>
                        <div className="text-[10px] text-mute font-mono mt-0.5">{n.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="relative" ref={quickRef}>
            <button
              onClick={() => setShowQuickActions(!showQuickActions)}
              className="p-2 rounded-pill bg-ink hover:bg-black-elevated text-on-dark transition active:scale-[0.96]"
            >
              <IconPlus size={16} />
            </button>
            {showQuickActions && (
              <div className="absolute right-0 top-full mt-2 bg-canvas rounded-xl border border-canvas-soft shadow-[0px_4px_16px_rgba(0,0,0,0.12)] min-w-[180px] z-50 animate-dropdown">
                <div className="px-4 py-2.5 border-b border-canvas-soft">
                  <span className="text-[10px] text-mute uppercase tracking-wider">Quick actions</span>
                </div>
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => {
                      navigate(action.path);
                      setShowQuickActions(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-canvas-softer transition"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Profile Menu */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="w-8 h-8 rounded-full bg-ink text-on-dark flex items-center justify-center text-xs font-bold hover:bg-black-elevated transition"
            >
              {(adminRole || 'A').charAt(0)}
            </button>
            {showProfileMenu && (
              <div className="absolute right-0 top-full mt-2 bg-canvas rounded-xl border border-canvas-soft shadow-[0px_4px_16px_rgba(0,0,0,0.12)] min-w-[200px] z-50 animate-dropdown">
                <div className="px-4 py-3 border-b border-canvas-soft">
                  <div className="text-sm font-bold text-ink">Admin</div>
                  <div className="text-[10px] text-mute font-mono mt-0.5">{adminRole.replace(/_/g, ' ')}</div>
                </div>
                <button
                  onClick={() => {
                    navigate('/settings');
                    setShowProfileMenu(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-canvas-softer transition"
                >
                  Settings
                </button>
                <button
                  onClick={() => {
                    handleLogout();
                    setShowProfileMenu(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-ink hover:bg-canvas-softer transition flex items-center gap-2 border-t border-canvas-soft"
                >
                  <IconLogout size={14} />
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════════════════ BODY ═══════════════════════ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── LEFT SIDEBAR ─── */}
        <aside
          className={`sidebar-transition bg-canvas-softer border-r border-canvas-soft flex flex-col flex-shrink-0 overflow-hidden ${
            sidebarCollapsed ? 'w-sidebar-collapsed' : 'w-sidebar-expanded'
          }`}
        >
          <nav className="flex-1 overflow-y-auto py-3">
            {navGroups.map((group) => {
              const items = visibleNav.filter((n) => n.group === group.key);
              if (items.length === 0) return null;
              return (
                <div key={group.key} className="mb-1">
                  {group.label && !sidebarCollapsed && (
                    <div className="px-5 pt-4 pb-1 text-[10px] text-mute uppercase tracking-wider">
                      {group.label}
                    </div>
                  )}
                  {group.label && sidebarCollapsed && (
                    <div className="mx-3 my-2 border-b border-canvas-soft" />
                  )}
                  {items.map((item) => {
                    const active = isActive(item.path);
                    const Icon = iconMap[item.icon];
                    return (
                      <button
                        key={item.key}
                        onClick={() => navigate(item.path)}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={`w-full flex items-center gap-3 text-sm font-medium transition-all relative
                          ${sidebarCollapsed ? 'justify-center px-0 py-3' : 'px-5 py-2.5'}
                          ${active
                            ? 'text-ink bg-canvas'
                            : 'text-body hover:text-ink hover:bg-canvas'
                          }`}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-ink rounded-r-full" />
                        )}
                        {Icon && <Icon size={18} />}
                        {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="flex items-center justify-center gap-2 py-4 border-t border-canvas-soft text-body hover:text-ink transition text-xs font-medium"
          >
            <IconChevron size={16} direction={sidebarCollapsed ? 'right' : 'left'} />
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>
        </aside>

        {/* ─── MAIN CONTENT ─── */}
        <main className="flex-1 overflow-hidden bg-canvas">
          <Routes>
            {adminRoutes.map((route, i) =>
              route.index ? (
                <Route key={i} index element={route.element} />
              ) : (
                <Route key={i} path={route.path} element={route.element} />
              )
            )}
          </Routes>
        </main>
      </div>
    </div>
  );
};
