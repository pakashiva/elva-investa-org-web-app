import { useAuth } from '../contexts/AuthContext';

export function UnauthorizedPage() {
  const { error, signOut } = useAuth();

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Access denied</h1>
        <p>
          {error ??
            'This Supabase account is not in admin_users. Ask a super admin to grant access, then sign in again.'}
        </p>
        <button type="button" className="primary-btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
