import React, { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router-dom';

// Eagerly loaded — these are the two primary views
import { ControlRoomDashboard } from './ControlRoomDashboard';

// Lazy-loaded pages (code-split at the route boundary)
const DashboardHome = lazy(() =>
  import('./pages/DashboardHome').then((m) => ({ default: m.DashboardHome }))
);

const TripsList = lazy(() =>
  import('./pages/TripsList').then((m) => ({ default: m.TripsList }))
);
const TripDetail = lazy(() =>
  import('./pages/TripDetail').then((m) => ({ default: m.TripDetail }))
);
const ManualBooking = lazy(() =>
  import('./pages/ManualBooking').then((m) => ({ default: m.ManualBooking }))
);
const RidersList = lazy(() =>
  import('./pages/RidersList').then((m) => ({ default: m.RidersList }))
);
const RiderDetail = lazy(() =>
  import('./pages/RiderDetail').then((m) => ({ default: m.RiderDetail }))
);
const DriversList = lazy(() =>
  import('./pages/DriversList').then((m) => ({ default: m.DriversList }))
);
const DriverDetail = lazy(() =>
  import('./pages/DriverDetail').then((m) => ({ default: m.DriverDetail }))
);
const DriverOnboardingQueue = lazy(() =>
  import('./pages/DriverOnboardingQueue').then((m) => ({ default: m.DriverOnboardingQueue }))
);
const VehiclesList = lazy(() =>
  import('./pages/VehiclesList').then((m) => ({ default: m.VehiclesList }))
);
const DispatchDashboard = lazy(() =>
  import('./pages/DispatchDashboard').then((m) => ({ default: m.DispatchDashboard }))
);
const PricingDashboard = lazy(() =>
  import('./pages/PricingDashboard').then((m) => ({ default: m.PricingDashboard }))
);
const PromotionsDashboard = lazy(() =>
  import('./pages/PromotionsDashboard').then((m) => ({ default: m.PromotionsDashboard }))
);
const FinanceDashboard = lazy(() =>
  import('./pages/FinanceDashboard').then((m) => ({ default: m.FinanceDashboard }))
);
const PayoutsDashboard = lazy(() =>
  import('./pages/PayoutsDashboard').then((m) => ({ default: m.PayoutsDashboard }))
);
const SupportDashboard = lazy(() =>
  import('./pages/SupportDashboard').then((m) => ({ default: m.SupportDashboard }))
);
const SafetyDashboard = lazy(() =>
  import('./pages/SafetyDashboard').then((m) => ({ default: m.SafetyDashboard }))
);
const MarketingDashboard = lazy(() =>
  import('./pages/MarketingDashboard').then((m) => ({ default: m.MarketingDashboard }))
);
const AdminTeamManagement = lazy(() =>
  import('./components/AdminTeamManagement').then((m) => ({ default: m.AdminTeamManagement }))
);
const AnalyticsDashboard = lazy(() =>
  import('./pages/AnalyticsExtendedDashboard').then((m) => ({ default: m.AnalyticsExtendedDashboard }))
);
const ComplianceDashboard = lazy(() =>
  import('./pages/ComplianceExtendedDashboard').then((m) => ({ default: m.ComplianceExtendedDashboard }))
);
const AuditLogsDashboard = lazy(() =>
  import('./pages/AuditLogsDashboard').then((m) => ({ default: m.AuditLogsDashboard }))
);
const CMSDashboard = lazy(() =>
  import('./pages/CMSDashboard').then((m) => ({ default: m.CMSDashboard }))
);
const DocumentsVaultDashboard = lazy(() =>
  import('./pages/DocumentsVaultDashboard').then((m) => ({ default: m.DocumentsVaultDashboard }))
);
const ConfigDashboard = lazy(() =>
  import('./pages/ConfigDashboard').then((m) => ({ default: m.ConfigDashboard }))
);
const DeveloperDashboard = lazy(() =>
  import('./pages/DeveloperDashboard').then((m) => ({ default: m.DeveloperDashboard }))
);
const CorporateDashboard = lazy(() =>
  import('./pages/CorporateDashboard').then((m) => ({ default: m.CorporateDashboard }))
);


// Suspense wrapper for lazy routes
const LazyWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense
    fallback={
      <div className="h-full flex items-center justify-center">
        <div className="text-sm text-mute animate-pulse">Loading module…</div>
      </div>
    }
  >
    {children}
  </Suspense>
);

// Master route configuration — consumed by AdminShell's <Routes>
export const adminRoutes: RouteObject[] = [
  { index: true, element: <LazyWrap><DashboardHome /></LazyWrap> },
  { path: 'operations', element: <ControlRoomDashboard /> },
  { path: 'trips', element: <LazyWrap><TripsList /></LazyWrap> },
  { path: 'trips/new', element: <LazyWrap><ManualBooking /></LazyWrap> },
  { path: 'trips/:id', element: <LazyWrap><TripDetail /></LazyWrap> },
  { path: 'riders', element: <LazyWrap><RidersList /></LazyWrap> },
  { path: 'riders/:id', element: <LazyWrap><RiderDetail /></LazyWrap> },
  { path: 'drivers', element: <LazyWrap><DriversList /></LazyWrap> },
  { path: 'drivers/onboarding', element: <LazyWrap><DriverOnboardingQueue /></LazyWrap> },
  { path: 'drivers/:id', element: <LazyWrap><DriverDetail /></LazyWrap> },
  { path: 'vehicles', element: <LazyWrap><VehiclesList /></LazyWrap> },
  { path: 'dispatch', element: <LazyWrap><DispatchDashboard /></LazyWrap> },
  { path: 'pricing', element: <LazyWrap><PricingDashboard /></LazyWrap> },
  { path: 'promotions', element: <LazyWrap><PromotionsDashboard /></LazyWrap> },
  { path: 'finance', element: <LazyWrap><FinanceDashboard /></LazyWrap> },
  { path: 'payments', element: <LazyWrap><FinanceDashboard /></LazyWrap> },
  { path: 'payouts', element: <LazyWrap><PayoutsDashboard /></LazyWrap> },
  { path: 'support', element: <LazyWrap><SupportDashboard /></LazyWrap> },
  { path: 'safety', element: <LazyWrap><SafetyDashboard /></LazyWrap> },
  { path: 'marketing', element: <LazyWrap><MarketingDashboard /></LazyWrap> },
  { path: 'communications/push', element: <LazyWrap><MarketingDashboard /></LazyWrap> },
  { path: 'communications', element: <LazyWrap><MarketingDashboard /></LazyWrap> },
  { path: 'content', element: <LazyWrap><CMSDashboard /></LazyWrap> },
  { path: 'analytics', element: <LazyWrap><AnalyticsDashboard /></LazyWrap> },
  { path: 'compliance', element: <LazyWrap><ComplianceDashboard /></LazyWrap> },
  { path: 'documents', element: <LazyWrap><DocumentsVaultDashboard /></LazyWrap> },
  { path: 'settings', element: <LazyWrap><ConfigDashboard /></LazyWrap> },
  { path: 'config',   element: <LazyWrap><ConfigDashboard /></LazyWrap> },
  { path: 'audit', element: <LazyWrap><AuditLogsDashboard /></LazyWrap> },
  { path: 'api', element: <LazyWrap><DeveloperDashboard /></LazyWrap> },
  { path: 'corporate', element: <LazyWrap><CorporateDashboard /></LazyWrap> },
  { path: 'team', element: <AdminTeamManagement /> },
];

// Navigation item metadata — drives the sidebar rendering
export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: string; // Maps to SidebarIcons component name
  group: 'core' | 'fleet' | 'finance' | 'engagement' | 'system';
  // Roles that can see this item. Empty = visible to all authenticated admins.
  allowedRoles?: string[];
}

export const navItems: NavItem[] = [
  // Core
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: 'Dashboard', group: 'core' },
  { key: 'operations', label: 'Live Operations', path: '/operations', icon: 'Map', group: 'core' },

  // Fleet
  { key: 'trips', label: 'Trips', path: '/trips', icon: 'Trips', group: 'fleet' },
  { key: 'riders', label: 'Riders', path: '/riders', icon: 'Riders', group: 'fleet' },
  { key: 'drivers', label: 'Drivers', path: '/drivers', icon: 'Drivers', group: 'fleet' },
  { key: 'vehicles', label: 'Vehicles', path: '/vehicles', icon: 'Vehicles', group: 'fleet' },
  { key: 'dispatch', label: 'Dispatch & Zones', path: '/dispatch', icon: 'Dispatch', group: 'fleet' },
  { key: 'pricing', label: 'Pricing & Surge', path: '/pricing', icon: 'Pricing', group: 'fleet' },

  // Finance
  { key: 'promotions', label: 'Promotions', path: '/promotions', icon: 'Promotions', group: 'finance' },
  { key: 'payments', label: 'Payments & Finance', path: '/finance', icon: 'Payments', group: 'finance' },
  { key: 'payouts', label: 'Payouts', path: '/payouts', icon: 'Payouts', group: 'finance' },

  // Engagement
  { key: 'support', label: 'Support / Tickets', path: '/support', icon: 'Support', group: 'engagement' },
  { key: 'safety', label: 'Safety & Incidents', path: '/safety', icon: 'Safety', group: 'engagement' },
  { key: 'marketing', label: 'Marketing & Campaigns', path: '/marketing', icon: 'Marketing', group: 'engagement' },
  { key: 'communications', label: 'Communications', path: '/communications', icon: 'Comms', group: 'engagement' },
  { key: 'content', label: 'Content (CMS)', path: '/content', icon: 'Content', group: 'engagement' },

  // System
  { key: 'analytics', label: 'Analytics & Reports', path: '/analytics', icon: 'Analytics', group: 'system' },
  { key: 'compliance', label: 'Compliance & KYC', path: '/compliance', icon: 'Compliance', group: 'system' },
  { key: 'documents', label: 'Documents Vault', path: '/documents', icon: 'Documents', group: 'system' },
  { key: 'settings', label: 'Configuration', path: '/settings', icon: 'Settings', group: 'system' },
  { key: 'audit', label: 'Audit Logs', path: '/audit', icon: 'Audit', group: 'system' },
  { key: 'api', label: 'Developer / API', path: '/api', icon: 'API', group: 'system' },
  { key: 'corporate', label: 'Corporate / B2B', path: '/corporate', icon: 'Corporate', group: 'system', allowedRoles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'FINANCE'] },
  { key: 'team', label: 'Team & Roles', path: '/team', icon: 'Team', group: 'system', allowedRoles: ['SUPER_ADMIN'] },
];

export const navGroups: { key: string; label: string }[] = [
  { key: 'core', label: '' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'finance', label: 'Finance' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'system', label: 'System' },
];
