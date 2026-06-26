import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { adminRoutes, navItems, navGroups } from './adminRoutes';
import { API_GATEWAY_BASE_URL } from '../config';
import { getCityFilter, setCityFilter } from './auth';
import { AdminAuthGateway } from './components/AdminAuthGateway';
import { AdminChangePassword } from './components/AdminChangePassword';
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

// ─── Notification + search types ──────────────────────────────────────────
interface AdminNotification {
  id: string;
  title: string;
  severity: string;
  status: string;
  created_at: string;
}

interface SearchTrip { id: string; status: string; fare_paise: number; city_prefix: string }
interface SearchDriver { id: string; name: string; phone: string; status: string }
interface SearchRider { id: string; name: string; phone: string }
interface SearchResults { trips: SearchTrip[]; drivers: SearchDriver[]; riders: SearchRider[] }

// ─── Quick actions ──────────────────────────────────────────────────────
const quickActions = [
  { label: 'New promo',       path: '/promotions' },
  { label: 'New broadcast',   path: '/communications' },
  { label: 'Manual booking',  path: '/dispatch' },
];

// ─── City options ───────────────────────────────────────────────────────
const cityOptions = ['KOL', 'DEL', 'MUM', 'BLR', 'CHN', 'HYD'];



export const AdminShell: React.FC = () => {
  const [sessionState, setSessionState] = useState<'LOADING' | 'AUTHED' | 'ANON'>('LOADING');
  const [mustChangePassword, setMustChangePassword] = useState<boolean>(false);
  const [adminRole, setAdminRole] = useState<string>(localStorage.getItem('admin_role') ?? 'ADMIN');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedCities, setSelectedCities] = useState<string[]>(() => {
    const persisted = getCityFilter();
    return persisted.length > 0 ? persisted : ['KOL'];
  });
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const navigate  = useNavigate();
  const location  = useLocation();

  const cityRef    = useRef<HTMLDivElement>(null);
  const notifRef   = useRef<HTMLDivElement>(null);
  const quickRef   = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);



  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityRef.current    && !cityRef.current.contains(e.target as Node))    setShowCityPicker(false);
      if (notifRef.current   && !notifRef.current.contains(e.target as Node))   setShowNotifications(false);
      if (quickRef.current   && !quickRef.current.contains(e.target as Node))   setShowQuickActions(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfileMenu(false);
      if (searchRef.current  && !searchRef.current.contains(e.target as Node))  setShowSearchResults(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ⌘K / Ctrl+K focuses the global search input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
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

  // ── Notifications: real unread count + recent items ──────────────────────
  const fetchNotifications = useCallback(async () => {
    if (sessionState !== 'AUTHED') return;
    try {
      const [listRes, statsRes] = await Promise.all([
        fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/notifications`, { credentials: 'include' }),
        fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/notifications/stats`, { credentials: 'include' }),
      ]);
      if (listRes.ok) {
        const data = await listRes.json();
        setNotifications((data.notifications ?? []) as AdminNotification[]);
      }
      if (statsRes.ok) {
        const stats = await statsRes.json();
        setUnreadCount(Number(stats.total_unread ?? 0));
      }
    } catch { /* ignore — bell just shows last-known state */ }
  }, [sessionState]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  // ── Global search (debounced) ────────────────────────────────────────────
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_GATEWAY_BASE_URL}/api/v1/admin/search?q=${encodeURIComponent(q)}`,
          { credentials: 'include', signal: ctrl.signal },
        );
        if (res.ok) {
          const body = await res.json();
          const data = (body.data ?? {}) as Partial<SearchResults>;
          setSearchResults({
            trips: data.trips ?? [],
            drivers: data.drivers ?? [],
            riders: data.riders ?? [],
          });
          setShowSearchResults(true);
        }
      } catch { /* aborted or network — ignore */ }
      finally { setSearchLoading(false); }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [searchQuery]);

  const goToResult = useCallback((path: string) => {
    navigate(path);
    setShowSearchResults(false);
    setSearchQuery('');
  }, [navigate]);

  const acknowledgeNotification = useCallback(async (id: string) => {
    try {
      await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/notifications/${encodeURIComponent(id)}/acknowledge`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch { /* ignore */ }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setUnreadCount((c) => Math.max(0, c - 1));
    setShowNotifications(false);
    navigate('/notifications');
  }, [navigate]);

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
    setSelectedCities((prev) => {
      const next = prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city];
      setCityFilter(next);
      return next;
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !searchResults) return;
    // Enter jumps to the first available result, preferring trips → drivers → riders.
    const first =
      searchResults.trips[0]   ? `/trips/${searchResults.trips[0].id}` :
      searchResults.drivers[0] ? `/drivers/${searchResults.drivers[0].id}` :
      searchResults.riders[0]  ? `/riders/${searchResults.riders[0].id}` : null;
    if (first) goToResult(first);
  };

  const hasSearchResults = !!searchResults &&
    (searchResults.trips.length + searchResults.drivers.length + searchResults.riders.length) > 0;

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

  const isLiveEnv = import.meta.env.MODE === 'production';

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
            vahnly
          </h1>

          {/* Global Search */}
          <div className="flex-1 relative" ref={searchRef}>
            <form onSubmit={handleSearch}>
              <div className={`flex items-center gap-2 bg-background-secondary rounded-pill px-4 py-2 transition-base ${searchFocused ? 'ring-1 ring-border-selected' : ''}`}>
                <IconSearch size={16} className="text-content-tertiary flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search trip, driver, rider, plate…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => { setSearchFocused(true); if (hasSearchResults) setShowSearchResults(true); }}
                  onBlur={() => setSearchFocused(false)}
                  className="bg-transparent text-paragraph-medium text-content-primary placeholder:text-content-tertiary outline-none w-full"
                />
                <kbd className="hidden sm:flex items-center gap-0.5 text-label-small text-content-tertiary font-mono border border-border-opaque rounded-sm px-1.5 py-0.5">⌘K</kbd>
              </div>
            </form>

            {showSearchResults && searchQuery.trim().length >= 2 && (
              <div className="absolute left-0 top-full mt-2 bg-background-primary rounded-md border border-border-opaque shadow-elevation-2 w-full z-50 animate-dropdown max-h-[420px] overflow-y-auto">
                {searchLoading && !hasSearchResults && (
                  <div className="px-4 py-3 text-paragraph-small text-content-tertiary animate-pulse">Searching…</div>
                )}
                {!searchLoading && !hasSearchResults && (
                  <div className="px-4 py-3 text-paragraph-small text-content-tertiary">No matches for “{searchQuery.trim()}”.</div>
                )}

                {searchResults && searchResults.trips.length > 0 && (
                  <div>
                    <div className="px-4 pt-3 pb-1 text-label-small text-content-tertiary uppercase tracking-wider">Trips</div>
                    {searchResults.trips.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => goToResult(`/trips/${t.id}`)}
                        className="w-full text-left px-4 py-2.5 hover:bg-background-secondary transition-base cursor-pointer flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-paragraph-medium text-content-primary font-mono truncate">{t.id}</span>
                          <span className="block text-mono-small text-content-tertiary">{t.city_prefix} · {t.status}</span>
                        </span>
                        <span className="text-mono-small text-content-secondary flex-shrink-0">₹{(t.fare_paise / 100).toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                )}

                {searchResults && searchResults.drivers.length > 0 && (
                  <div className="border-t border-border-opaque">
                    <div className="px-4 pt-3 pb-1 text-label-small text-content-tertiary uppercase tracking-wider">Drivers</div>
                    {searchResults.drivers.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => goToResult(`/drivers/${d.id}`)}
                        className="w-full text-left px-4 py-2.5 hover:bg-background-secondary transition-base cursor-pointer flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-paragraph-medium text-content-primary truncate">{d.name}</span>
                          <span className="block text-mono-small text-content-tertiary font-mono">{d.phone}</span>
                        </span>
                        <span className="text-mono-small text-content-secondary flex-shrink-0">{d.status}</span>
                      </button>
                    ))}
                  </div>
                )}

                {searchResults && searchResults.riders.length > 0 && (
                  <div className="border-t border-border-opaque">
                    <div className="px-4 pt-3 pb-1 text-label-small text-content-tertiary uppercase tracking-wider">Riders</div>
                    {searchResults.riders.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => goToResult(`/riders/${r.id}`)}
                        className="w-full text-left px-4 py-2.5 hover:bg-background-secondary transition-base cursor-pointer flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-paragraph-medium text-content-primary truncate">{r.name}</span>
                          <span className="block text-mono-small text-content-tertiary font-mono">{r.phone}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
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
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-interactive-primary text-interactive-primary-text text-[9px] font-bold rounded-pill flex items-center justify-center badge-pulse">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 bg-background-primary rounded-md border border-border-opaque shadow-elevation-2 w-[340px] z-50 animate-dropdown">
                <div className="px-4 py-3 border-b border-border-opaque flex items-center justify-between">
                  <span className="text-label-large text-content-primary">Notifications</span>
                  <span className="text-label-small text-content-tertiary font-mono">{unreadCount} unread</span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-paragraph-small text-content-tertiary">No notifications.</div>
                  ) : (
                    notifications.map((n) => {
                      const critical = n.severity === 'CRITICAL' || n.severity === 'HIGH';
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => acknowledgeNotification(n.id)}
                          className="w-full text-left px-4 py-3 hover:bg-background-secondary border-b border-border-opaque last:border-none flex items-start gap-2.5 cursor-pointer transition-base"
                        >
                          {critical && (
                            <span className="w-2 h-2 rounded-pill bg-negative-400 mt-1.5 flex-shrink-0" />
                          )}
                          <span className="flex-1 min-w-0">
                            <span className="block text-paragraph-medium text-content-primary leading-snug">{n.title}</span>
                            <span className="block text-mono-small text-content-tertiary mt-0.5">{new Date(n.created_at).toLocaleString()}</span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>



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
