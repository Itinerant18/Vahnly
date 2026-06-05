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
const AdminTeamManagement = lazy(() =>
  import('./components/AdminTeamManagement').then((m) => ({ default: m.AdminTeamManagement }))
);

// Placeholder component for routes that are not yet implemented
const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div className="h-full flex items-center justify-center">
    <div className="bg-canvas rounded-xl border border-canvas-soft p-10 text-center max-w-md animate-fade-in">
      <div className="text-xl font-bold text-ink mb-2">{title}</div>
      <div className="text-sm text-body">This module is under development and will be available soon.</div>
      <div className="mt-4 text-xs text-mute font-mono">coming soon</div>
    </div>
  </div>
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
  { path: 'payouts', element: <PlaceholderPage title="Payouts" /> },
  { path: 'support', element: <PlaceholderPage title="Support / Tickets" /> },
  { path: 'safety', element: <PlaceholderPage title="Safety & Incidents" /> },
  { path: 'marketing', element: <PlaceholderPage title="Marketing & Campaigns" /> },
  { path: 'communications', element: <PlaceholderPage title="Communications" /> },
  { path: 'content', element: <PlaceholderPage title="Content (CMS)" /> },
  { path: 'analytics', element: <PlaceholderPage title="Analytics & Reports" /> },
  { path: 'compliance', element: <PlaceholderPage title="Compliance & KYC" /> },
  { path: 'documents', element: <PlaceholderPage title="Documents Vault" /> },
  { path: 'settings', element: <PlaceholderPage title="Configuration" /> },
  { path: 'audit', element: <PlaceholderPage title="Audit Logs" /> },
  { path: 'api', element: <PlaceholderPage title="Developer / API" /> },
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
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: 'Dashboard', group: 'core' },
  { key: 'operations', label: 'Live Operations', path: '/admin/operations', icon: 'Map', group: 'core' },

  // Fleet
  { key: 'trips', label: 'Trips', path: '/admin/trips', icon: 'Trips', group: 'fleet' },
  { key: 'riders', label: 'Riders', path: '/admin/riders', icon: 'Riders', group: 'fleet' },
  { key: 'drivers', label: 'Drivers', path: '/admin/drivers', icon: 'Drivers', group: 'fleet' },
  { key: 'vehicles', label: 'Vehicles', path: '/admin/vehicles', icon: 'Vehicles', group: 'fleet' },
  { key: 'dispatch', label: 'Dispatch & Zones', path: '/admin/dispatch', icon: 'Dispatch', group: 'fleet' },
  { key: 'pricing', label: 'Pricing & Surge', path: '/admin/pricing', icon: 'Pricing', group: 'fleet' },

  // Finance
  { key: 'promotions', label: 'Promotions', path: '/admin/promotions', icon: 'Promotions', group: 'finance' },
  { key: 'payments', label: 'Payments & Finance', path: '/admin/finance', icon: 'Payments', group: 'finance' },
  { key: 'payouts', label: 'Payouts', path: '/admin/payouts', icon: 'Payouts', group: 'finance' },

  // Engagement
  { key: 'support', label: 'Support / Tickets', path: '/admin/support', icon: 'Support', group: 'engagement' },
  { key: 'safety', label: 'Safety & Incidents', path: '/admin/safety', icon: 'Safety', group: 'engagement' },
  { key: 'marketing', label: 'Marketing & Campaigns', path: '/admin/marketing', icon: 'Marketing', group: 'engagement' },
  { key: 'communications', label: 'Communications', path: '/admin/communications', icon: 'Comms', group: 'engagement' },
  { key: 'content', label: 'Content (CMS)', path: '/admin/content', icon: 'Content', group: 'engagement' },

  // System
  { key: 'analytics', label: 'Analytics & Reports', path: '/admin/analytics', icon: 'Analytics', group: 'system' },
  { key: 'compliance', label: 'Compliance & KYC', path: '/admin/compliance', icon: 'Compliance', group: 'system' },
  { key: 'documents', label: 'Documents Vault', path: '/admin/documents', icon: 'Documents', group: 'system' },
  { key: 'settings', label: 'Configuration', path: '/admin/settings', icon: 'Settings', group: 'system' },
  { key: 'audit', label: 'Audit Logs', path: '/admin/audit', icon: 'Audit', group: 'system' },
  { key: 'api', label: 'Developer / API', path: '/admin/api', icon: 'API', group: 'system' },
  { key: 'team', label: 'Team & Roles', path: '/admin/team', icon: 'Team', group: 'system', allowedRoles: ['SUPER_ADMIN'] },
];

export const navGroups: { key: string; label: string }[] = [
  { key: 'core', label: '' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'finance', label: 'Finance' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'system', label: 'System' },
];
