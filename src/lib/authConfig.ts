/**
 * Portal login uses username/password stored in admin_portal_users (see migration 027).
 * Default credentials: admin / 1234 — change via Manage Passwords.
 */
export const ADMIN_SESSION_KEY = 'elva_admin_portal_session';

export type PortalSession = {
  username: string;
  loggedInAt: string;
};
