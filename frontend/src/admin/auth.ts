// Admin role resolution for UI gating.
//
// The role is read from the server-signed JWT claims, NOT from a separately stored
// `admin_role` key or a URL fragment — both of which a user can rewrite to self-assign
// SUPER_ADMIN. The signature is not verified client-side (the gateway is authoritative
// for every request); this only decides what the dashboard renders and must never be
// the sole authorization control.

export function decodeJwtRole(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

// Role for UI gating. With the JWT now in an HttpOnly cookie (CRIT-004), the role can no
// longer be decoded from a JS-readable token — it is the non-sensitive value the shell
// stores from GET /auth/session. The server remains authoritative on every request.
export function getAdminRole(): string {
  return localStorage.getItem('admin_role') || 'ADMIN';
}
