import { api, setAdminToken } from '../lib/api';
import type { AdminMe } from '../types/platform';

type AuthPayload = {
  id: string;
  username: string;
  role: AdminMe['role'];
  fullName: string;
  clientId: string | null;
  clientName: string | null;
  clientCode: string | null;
};

function toAdmin(user: AuthPayload): AdminMe {
  return {
    id: user.id,
    user_id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.fullName,
    full_name: user.fullName,
    email: null,
    clientId: user.clientId ?? null,
    clientName: user.clientName ?? null,
    clientCode: user.clientCode ?? null,
  };
}

export async function fetchCurrentUser(): Promise<AdminMe | null> {
  try {
    const data = await api<{ user: AuthPayload }>('/api/auth/me');
    return toAdmin(data.user);
  } catch {
    return null;
  }
}

export async function portalLogin(username: string, password: string): Promise<AdminMe> {
  const data = await api<{ user: AuthPayload; token?: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.token) {
    setAdminToken(data.token);
  }
  const session = await fetchCurrentUser();
  return session ?? toAdmin(data.user);
}

export async function portalSignOut() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    setAdminToken(null);
  }
}

export async function portalChangePassword(
  _username: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  await api('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}
