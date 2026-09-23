import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { NotificationToastHost } from '../components/NotificationToastHost';
import { Sidebar } from '../components/Sidebar';
import { useAuth } from '../contexts/AuthContext';

export function AdminLayout() {
  const { admin } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isClientAdmin = admin?.role === 'client_admin';

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="main">
        <Outlet context={{ onOpenMenu: () => setMenuOpen(true) }} />
      </main>
      {isClientAdmin ? <NotificationToastHost /> : null}
    </div>
  );
}

export type AdminOutletContext = {
  onOpenMenu: () => void;
};
