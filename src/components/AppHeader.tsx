import type { ReactNode } from 'react';
import { Bell } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useUnreadCount } from '../hooks/useUnreadCount';
import { adminRoleLabel, firstName } from '../utils/format';
import { MenuButton } from './Sidebar';

type AppHeaderProps = {
  title: string;
  subtitle?: string;
  showSearch?: boolean;
  actions?: ReactNode;
  onOpenMenu: () => void;
};

export function AppHeader({
  title,
  subtitle,
  showSearch = false,
  actions,
  onOpenMenu,
}: AppHeaderProps) {
  const { admin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isClientAdmin = admin?.role === 'client_admin';
  const borrowingEnabled = admin?.enabledModules?.includes('borrow') ?? false;
  const investingEnabled = admin?.enabledModules?.includes('invest') ?? true;
  const borrowingActive = location.pathname.startsWith('/borrowing');
  const allActive = location.pathname.startsWith('/all') || new URLSearchParams(location.search).get('workspace') === 'all';
  const unreadCount = useUnreadCount();
  const displayName = admin?.fullName || admin?.full_name || 'Admin';

  return (
    <header className="page-header">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <MenuButton onClick={onOpenMenu} />
        <div className="page-title">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>

      {isClientAdmin && borrowingEnabled && investingEnabled ? (
        <div className="module-switch" role="group" aria-label="Choose workspace module">
          <button type="button" className={!borrowingActive && !allActive ? 'active' : ''} aria-pressed={!borrowingActive && !allActive} onClick={() => navigate('/')}>
              Investment
          </button>
          <button type="button" className={borrowingActive ? 'active' : ''} aria-pressed={borrowingActive} onClick={() => navigate('/borrowing')}>
              Borrowing
          </button>
          <button type="button" className={allActive ? 'active' : ''} aria-pressed={allActive} onClick={() => navigate('/all')}>
            All
          </button>
        </div>
      ) : null}
      <div className="header-tools">
        {isClientAdmin && showSearch ? (
          <form className="search-pill" onSubmit={(event) => event.preventDefault()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20L17 17" stroke="currentColor" strokeWidth="2" />
            </svg>
            <input name="q" placeholder="Search operations..." />
          </form>
        ) : null}
        {actions}
        {isClientAdmin ? (
          <Link
            to={allActive ? '/notifications?workspace=all' : borrowingActive ? '/borrowing/notifications' : '/notifications'}
            className="icon-btn notify-btn"
            aria-label={
              unreadCount > 0
                ? `${unreadCount > 9 ? '9+' : unreadCount} unread notifications`
                : 'Notifications'
            }
          >
            <Bell size={23} />
            {unreadCount > 0 ? (
              <span className="notify-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            ) : null}
          </Link>
        ) : null}
        <div className="profile-chip">
          <img className="avatar" src="/avatar.png" alt="" />
          <div>
            <strong>{firstName(displayName)}</strong>
            <span>{admin ? adminRoleLabel(admin.role) : ''}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
