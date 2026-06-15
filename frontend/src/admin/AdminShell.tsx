import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { adminRoutes, navItems, navGroups } from './adminRoutes';
import { API_GATEWAY_BASE_URL } from '../config';
import { AdminAuthGateway } from './components/AdminAuthGateway';
import { AdminChangePassword } from './components/AdminChangePassword';
import { SsoCallback } from './components/SsoCallback';
import { themeStore } from './lib/useThemeStore';
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
  { label: 'New promo',       path: '/promotions' },
  { label: 'New broadcast',   path: '/communications' },
  { label: 'Manual booking',  path: '/dispatch' },
];

// ─── City options ───────────────────────────────────────────────────────
const cityOptions = ['KOL', 'DEL', 'MUM', 'BLR', 'CHN', 'HYD'];

// ─── DS5 Theme Toggle ────────────────────────────────────────────────────
function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark');
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('dfu-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('dfu-theme', 'light');
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="touch-target focus-ring w-8 h-8 flex items-center justify-center rounded-pill text-content-secondary hover:text-content-primary hover:bg-background-secondary transition-base cursor-pointer"
    >
      {dark ? (
        /* Sun icon */
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2"/>
          <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ) : (
        /* Moon icon */
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

export const AdminShell: React.FC = () => {
  const [sessionState, setSessionState] = useState<'LOADING' | 'AUTHED' | 'ANON'>('LOADING');
  const [mustChangePassword, setMustChangePassword] = useState<boolean>(false);
  const [adminRole, setAdminRole] = useState<string>(localStorage.getItem('admin_role') ?? 'ADMIN');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedCities, setSelectedCities] = useState<string[]>(['KOL']);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const navigate  = useNavigate();
  const location  = useLocation();

  const cityRef    = useRef<HTMLDivElement>(null);
  const notifRef   = useRef<HTMLDivElement>(null);
  const quickRef   = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Apply persisted theme preference on mount
  useEffect(() => { themeStore.initTheme(); }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityRef.current    && !cityRef.current.contains(e.target as Node))    setShowCityPicker(false);
      if (notifRef.current   && !notifRef.current.contains(e.target as Node))   setShowNotifications(false);
      if (quickRef.current   && !quickRef.current.contains(e.target as Node))   setShowQuickActions(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfileMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
          localStorage.setItem('admin_role', role);
          setMustChangePassword(Boolean(data.must_change_password));
          setSessionState('AUTHED');
        } else {
          setSessionState('ANON');
        }
      } else {
        setSessionState('ANON');
      }
    } catch {
      setSessionState('ANON');
    }
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  const handleLoginSuccess = useCallback(() => {
    setSessionState('LOADING');
    checkSession();
  }, [checkSession]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch { /* ignore */ }
    localStorage.removeItem('admin_role');
    localStorage.removeItem('admin_jwt_token');
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
    console.log('[AdminShell] global search:', searchQuery);
  };

  if (location.pathname === '/sso-callback') return <SsoCallback />;

  // ── Loading skeleton ──────────────────────────────────────────────────
  if (sessionState === 'LOADING') {
    return (
      <div className="h-screen bg-background-primary flex items-center justify-center">
        <div className="text-paragraph-small text-content-tertiary animate-pulse">
          Verifying session…
        </div>
      </div>
    );
  }

  if (sessionState === 'ANON') {
    return <AdminAuthGateway onAuthSuccess={handleLoginSuccess} />;
  }

  // Authenticated but still on a temporary (invited) password — force rotation first.
  if (mustChangePassword) {
    return (
      <AdminChangePassword
        onChanged={() => { setMustChangePassword(false); checkSession(); }}
        onCancel={handleLogout}
      />
    );
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

  const isLiveEnv = true;

  return (
    <div className="h-screen bg-background-primary text-content-primary flex flex-col font-sans selection:bg-content-primary selection:text-background-primary overflow-hidden">

      {/* ═══════════════════════ TOP BAR ═══════════════════════ */}
      <header className="h-[72px] bg-background-primary border-b border-border-opaque px-4 flex items-center justify-between flex-shrink-0 z-30 shadow-elevation-1">

        {/* Left: Brand + Search */}
        <div className="flex items-center gap-4 flex-1 max-w-xl">
          <h1
            className="text-heading-small text-content-primary whitespace-nowrap cursor-pointer select-none"
            onClick={() => navigate('/')}
          >
            drivers-for-u
          </h1>

          {/* Global Search */}
          <form onSubmit={handleSearch} className="flex-1 relative">
            <div className={`flex items-center gap-2 bg-background-secondary rounded-pill px-4 py-2 transition-base ${searchFocused ? 'ring-1 ring-border-selected' : ''}`}>
              <IconSearch size={16} className="text-content-tertiary flex-shrink-0" />
              <input
                type="text"
                placeholder="Search trip, driver, rider, plate…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                className="bg-transparent text-paragraph-medium text-content-primary placeholder:text-content-tertiary outline-none w-full"
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
              className="flex items-center gap-1 text-label-medium text-content-secondary bg-background-secondary px-3 py-1.5 rounded-pill hover:bg-background-tertiary transition-base cursor-pointer"
            >
              {selectedCities.join(', ') || 'All cities'}
              <IconChevron size={12} direction={showCityPicker ? 'right' : 'left'} className="rotate-[-90deg]" />
            </button>
            {showCityPicker && (
              <div className="absolute right-0 top-full mt-2 bg-background-primary rounded-md border border-border-opaque shadow-elevation-2 p-3 min-w-[160px] z-50 animate-dropdown">
                <div className="text-label-small text-content-tertiary uppercase tracking-wider mb-2">City scope</div>
                {cityOptions.map((city) => (
                  <label key={city} className="flex items-center gap-2 py-1.5 px-2 rounded-sm hover:bg-background-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCities.includes(city)}
                      onChange={() => toggleCity(city)}
                      className="accent-content-primary w-3.5 h-3.5"
                    />
                    <span className="font-mono text-mono-small text-content-primary">{city}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Environment Badge */}
          <span className={`text-label-small px-2.5 py-1 rounded-pill ${
            isLiveEnv
              ? 'bg-interactive-primary text-interactive-primary-text'
              : 'bg-background-secondary text-content-secondary'
          }`}>
            {isLiveEnv ? 'Live' : 'Staging'}
          </span>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label="Notifications"
              className="relative p-2 rounded-pill hover:bg-background-secondary transition-base cursor-pointer"
            >
              <IconBell size={18} className="text-content-primary" />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-interactive-primary text-interactive-primary-text text-[9px] font-bold rounded-pill flex items-center justify-center badge-pulse">
                {mockNotifications.length}
              </span>
            </button>
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 bg-background-primary rounded-md border border-border-opaque shadow-elevation-2 w-[340px] z-50 animate-dropdown">
                <div className="px-4 py-3 border-b border-border-opaque flex items-center justify-between">
                  <span className="text-label-large text-content-primary">Notifications</span>
                  <span className="text-label-small text-content-tertiary font-mono">{mockNotifications.length} new</span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {mockNotifications.map((n) => (
                    <div key={n.id} className="px-4 py-3 hover:bg-background-secondary border-b border-border-opaque last:border-none flex items-start gap-2.5 cursor-pointer transition-base">
                      {n.critical && (
                        <span className="w-2 h-2 rounded-pill bg-negative-400 mt-1.5 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-paragraph-medium text-content-primary leading-snug">{n.text}</div>
                        <div className="text-mono-small text-content-tertiary mt-0.5">{n.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Quick Actions */}
          <div className="relative" ref={quickRef}>
            <button
              onClick={() => setShowQuickActions(!showQuickActions)}
              aria-label="Quick actions"
              className="p-2 rounded-pill bg-interactive-primary hover:opacity-90 text-interactive-primary-text transition-base active:scale-[0.96] cursor-pointer"
            >
              <IconPlus size={16} />
            </button>
            {showQuickActions && (
              <div className="absolute right-0 top-full mt-2 bg-background-primary rounded-md border border-border-opaque shadow-elevation-2 min-w-[180px] z-50 animate-dropdown">
                <div className="px-4 py-2.5 border-b border-border-opaque">
                  <span className="text-label-small text-content-tertiary uppercase tracking-wider">Quick actions</span>
                </div>
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => { navigate(action.path); setShowQuickActions(false); }}
                    className="w-full text-left px-4 py-2.5 text-paragraph-medium text-content-primary hover:bg-background-secondary transition-base cursor-pointer"
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
              className="w-8 h-8 rounded-pill bg-interactive-primary text-interactive-primary-text flex items-center justify-center text-label-medium hover:opacity-90 transition-base cursor-pointer"
            >
              {(adminRole || 'A').charAt(0)}
            </button>
            {showProfileMenu && (
              <div className="absolute right-0 top-full mt-2 bg-background-primary rounded-md border border-border-opaque shadow-elevation-2 min-w-[200px] z-50 animate-dropdown">
                <div className="px-4 py-3 border-b border-border-opaque">
                  <div className="text-label-large text-content-primary">Admin</div>
                  <div className="text-mono-small text-content-tertiary mt-0.5">{adminRole.replace(/_/g, ' ')}</div>
                </div>
                <button
                  onClick={() => { navigate('/settings'); setShowProfileMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-paragraph-medium text-content-primary hover:bg-background-secondary transition-base cursor-pointer"
                >
                  Settings
                </button>
                <button
                  onClick={() => { handleLogout(); setShowProfileMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-paragraph-medium text-content-primary hover:bg-background-secondary transition-base flex items-center gap-2 border-t border-border-opaque cursor-pointer"
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
          className={`sidebar-transition bg-background-secondary border-r border-border-opaque flex flex-col flex-shrink-0 overflow-hidden ${
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
                    <div className="px-5 pt-4 pb-1 text-label-small text-content-tertiary uppercase tracking-wider">
                      {group.label}
                    </div>
                  )}
                  {group.label && sidebarCollapsed && (
                    <div className="mx-3 my-2 border-b border-border-opaque" />
                  )}
                  {items.map((item) => {
                    const active = isActive(item.path);
                    const Icon = iconMap[item.icon];
                    return (
                      <button
                        key={item.key}
                        onClick={() => navigate(item.path)}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={`w-full flex items-center gap-3 text-label-large transition-base relative cursor-pointer
                          ${sidebarCollapsed ? 'justify-center px-0 py-3' : 'px-5 py-2.5'}
                          ${active
                            ? 'text-content-primary bg-background-primary'
                            : 'text-content-secondary hover:text-content-primary hover:bg-background-primary'
                          }`}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-interactive-primary rounded-r-pill" />
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
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center gap-2 py-4 border-t border-border-opaque text-content-secondary hover:text-content-primary transition-base text-label-medium cursor-pointer"
          >
            <IconChevron size={16} direction={sidebarCollapsed ? 'right' : 'left'} />
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>
        </aside>

        {/* ─── MAIN CONTENT ─── */}
        <main className="flex-1 overflow-hidden bg-background-primary">
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
