import type { AdminRole } from '@rallia/shared-hooks';

// =============================================================================
// ROUTE ACCESS CONFIG
// =============================================================================

/** Which sidebar routes each role can see/access. '*' means all routes. */
export const ROLE_ALLOWED_ROUTES: Record<AdminRole, string[]> = {
  super_admin: ['*'],
  moderator: [
    '/admin/dashboard',
    '/admin/organizations',
    '/admin/users',
    '/admin/networks',
    '/admin/map',
    '/admin/moderation',
    '/admin/alerts',
    '/admin/activity-log',
    '/admin/communications',
  ],
  support: [
    '/admin/dashboard',
    '/admin/organizations',
    '/admin/users',
    '/admin/alerts',
    '/admin/map',
  ],
  analyst: ['/admin/dashboard', '/admin/analytics'],
};

/** Check if a role can access a given pathname (exact or prefix match). */
export function canAccessRoute(role: AdminRole, pathname: string): boolean {
  const allowed = ROLE_ALLOWED_ROUTES[role];
  if (allowed.includes('*')) return true;
  return allowed.some(route => pathname === route || pathname.startsWith(route + '/'));
}

// =============================================================================
// WRITE ACTION PERMISSIONS
// =============================================================================

/** Which roles can perform specific write/destructive actions. */
const ROLE_WRITE_PERMISSIONS: Record<string, AdminRole[]> = {
  'organizations:create': ['super_admin'],
  'organizations:edit': ['super_admin'],
  'organizations:delete': ['super_admin'],
  'players:suspend': ['super_admin', 'moderator'],
  'players:delete': ['super_admin', 'moderator'],
  'players:ban': ['super_admin', 'moderator'],
  'invitations:create': ['super_admin'],
  'communications:send': ['super_admin', 'moderator'],
};

/** Check if a role can perform a specific write action. */
export function canPerformAction(role: AdminRole, action: string): boolean {
  if (role === 'super_admin') return true;
  return ROLE_WRITE_PERMISSIONS[action]?.includes(role) ?? false;
}
