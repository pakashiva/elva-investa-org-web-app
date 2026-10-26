import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Bell,
  Building2,
  FileBarChart,
  Gift,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const CLIENT_NAV = [
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/customers', label: 'Customers', end: false, icon: Users },
  { to: '/investment-requests', label: 'Investment Requests', end: false, icon: TrendingUp },
  { to: '/withdrawals', label: 'Withdrawals', end: false, icon: Wallet },
  { to: '/tds', label: 'TDS', end: false, icon: Receipt },
  { to: '/referrals', label: 'Referrals & Commission', end: false, icon: Gift },
  { to: '/reports', label: 'Reports', end: false, icon: FileBarChart },
  { to: '/notifications', label: 'Notifications', end: false, icon: Bell },
  { to: '/settings', label: 'Settings', end: false, icon: Settings },
  { to: '/manage-passwords', label: 'Manage Passwords', end: false, icon: KeyRound },
] as const;

const ALL_CLIENT_NAV = [
  { to: '/?workspace=all', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/customers?workspace=all', label: 'Customers', end: false, icon: Users },
  { to: '/investment-requests?workspace=all', label: 'Investment Requests', end: false, icon: TrendingUp },
  { to: '/withdrawals?workspace=all', label: 'Withdrawals', end: false, icon: Wallet },
  { to: '/borrowing/loans?workspace=all', label: 'Borrowing', end: false, icon: HandCoins },
  { to: '/tds?workspace=all', label: 'TDS', end: false, icon: Receipt },
  { to: '/referrals?workspace=all', label: 'Referrals & Commission', end: false, icon: Gift },
  { to: '/reports?workspace=all', label: 'Reports', end: false, icon: FileBarChart },
  { to: '/notifications?workspace=all', label: 'Notifications', end: false, icon: Bell },
  { to: '/settings?workspace=all', label: 'Settings', end: false, icon: Settings },
  { to: '/manage-passwords?workspace=all', label: 'Manage Passwords', end: false, icon: KeyRound },
] as const;

type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ open, onClose }: SidebarProps) {
  const { admin, signOut } = useAuth();
  const location = useLocation();
  const isSuperAdmin = admin?.role === 'super_admin';
  const borrowingActive = location.pathname.startsWith('/borrowing');
  const allWorkspace = location.pathname.startsWith('/all') || new URLSearchParams(location.search).get('workspace') === 'all';
  const clientLabel = admin?.clientName || 'Client Admin';

  return (
    <>
      {open ? <div className="sidebar-backdrop" onClick={onClose} /> : null}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/logo-mark.png" alt="" />
          <div className="sidebar-brand-text">
            <strong>ELVA CAPITA</strong>
            <span>{isSuperAdmin ? 'SUPER ADMIN' : clientLabel}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {isSuperAdmin ? (
            <>
              <NavLink
                to="/"
                end
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                onClick={onClose}
              >
                <LayoutDashboard />
                Dashboard
              </NavLink>
              <NavLink
                to="/clients"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                onClick={onClose}
              >
                <Building2 />
                Clients
              </NavLink>
              <NavLink
                to="/manage-passwords"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                onClick={onClose}
              >
                <KeyRound />
                Manage Passwords
              </NavLink>
            </>
          ) : (
            (allWorkspace
              ? ALL_CLIENT_NAV
              : borrowingActive
              ? [
                  { to: '/borrowing', label: 'Dashboard', end: true, icon: LayoutDashboard },
                  { to: '/borrowing/customers', label: 'Customers', end: false, icon: Users },
                  { to: '/borrowing/loans', label: 'Borrowing', end: false, icon: HandCoins },
                  { to: '/borrowing/reports', label: 'Reports', end: false, icon: FileBarChart },
                  { to: '/borrowing/notifications', label: 'Notifications', end: false, icon: Bell },
                  { to: '/borrowing/settings', label: 'Settings', end: false, icon: Settings },
                  { to: '/borrowing/manage-passwords', label: 'Manage Passwords', end: false, icon: KeyRound },
                ]
              : CLIENT_NAV.filter((item) => admin?.enabledModules?.includes('invest') !== false || !['/investment-requests', '/withdrawals', '/tds', '/referrals'].includes(item.to))
            ).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  onClick={onClose}
                >
                  <Icon />
                  {item.label}
                </NavLink>
              );
            })
          )}
        </nav>

        <div className="sidebar-footer">
          {isSuperAdmin ? (
            <div className="ops-card">
              <strong>Platform</strong>
              <p>Onboard traders and inspect each tenant book. Queue decisions stay with Client Admin.</p>
              <Link className="gold-btn" to="/clients/new" onClick={onClose}>
                Add Client
              </Link>
            </div>
          ) : (
            <div className="ops-card">
              <strong>{clientLabel}</strong>
              <p>{admin?.clientCode ? `Client code ${admin.clientCode}` : 'Your tenant workspace'}</p>
              <Link className="gold-btn" to="/contact-ops" onClick={onClose}>
                Contact Ops Dev
              </Link>
            </div>
          )}

          <button type="button" className="logout-btn" onClick={() => void signOut()}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}

export function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="menu-btn" onClick={onClick} aria-label="Open menu">
      <Menu size={20} />
    </button>
  );
}
