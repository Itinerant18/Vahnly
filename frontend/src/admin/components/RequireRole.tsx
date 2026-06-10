import React from 'react';
import { getAdminRole } from '../auth';

/**
 * Route-level RBAC guard. Renders its children only when the JWT-derived role is
 * permitted; otherwise shows an access-restricted panel. SUPER_ADMIN is always
 * allowed, mirroring the gateway's RequireAnyRole behaviour.
 *
 * This is defense-in-depth for direct URL navigation — the backend independently
 * enforces RBAC on every endpoint, so a forged role still cannot read protected data.
 */
export const RequireRole: React.FC<{ allowed: string[]; children: React.ReactNode }> = ({
  allowed,
  children,
}) => {
  const role = getAdminRole();
  if (role === 'SUPER_ADMIN' || allowed.includes(role)) {
    return <>{children}</>;
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center max-w-sm">
        <div className="text-sm font-bold text-status-alert mb-1">Access restricted</div>
        <div className="text-xs text-mute">
          Your role ({role.replace(/_/g, ' ')}) is not permitted to view this module.
        </div>
      </div>
    </div>
  );
};
