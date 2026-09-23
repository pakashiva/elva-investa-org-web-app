import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../contexts/AuthContext';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { portalChangePassword } from '../services/authService';

export function ManagePasswordsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const { admin } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!admin?.user_id) {
      setError('You must be signed in to change the password.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (newPassword.length < 4) {
      setError('New password must be at least 4 characters.');
      return;
    }

    setIsSaving(true);
    try {
      await portalChangePassword(admin.user_id, oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Password updated successfully. Use the new password next time you sign in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Manage Passwords"
        subtitle="Verify your current credentials, then set a new admin password."
        onOpenMenu={onOpenMenu}
      />

      {error ? <div className="error-box">{error}</div> : null}
      {notice ? <div className="notice-box">{notice}</div> : null}

      <form className="card settings-card" onSubmit={(event) => void onSubmit(event)}>
        <h2>Change Password</h2>

        <label className="settings-field">
          <span>Username</span>
          <input className="settings-input" value={admin?.username ?? ''} readOnly />
        </label>

        <label className="settings-field">
          <span>Current Password</span>
          <input
            className="settings-input"
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(event) => setOldPassword(event.target.value)}
            required
          />
        </label>

        <label className="settings-field">
          <span>New Password</span>
          <input
            className="settings-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </label>

        <label className="settings-field">
          <span>Confirm New Password</span>
          <input
            className="settings-input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>

        <div className="settings-actions">
          <button type="submit" className="primary-btn settings-save" disabled={isSaving}>
            {isSaving ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </form>
    </>
  );
}
