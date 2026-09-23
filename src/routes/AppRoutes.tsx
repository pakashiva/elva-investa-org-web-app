import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AdminLayout } from '../layouts/AdminLayout';
import { ClientCustomersPage } from '../pages/ClientCustomersPage';
import { ClientDashboardPage } from '../pages/ClientDashboardPage';
import { ClientsPage } from '../pages/ClientsPage';
import { ContactOpsPage } from '../pages/ContactOpsPage';
import { CreateClientPage } from '../pages/CreateClientPage';
import { DashboardPage } from '../pages/DashboardPage';
import { InvestmentRequestsPage } from '../pages/InvestmentRequestsPage';
import { AgreementRenewalReviewPage } from '../pages/AgreementRenewalReviewPage';
import { InvestmentReviewPage } from '../pages/InvestmentReviewPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterClientPage } from '../pages/RegisterClientPage';
import { ManagePasswordsPage } from '../pages/ManagePasswordsPage';
import { NotificationsPage } from '../pages/NotificationsPage';
import { ReferralsPage } from '../pages/ReferralsPage';
import { ReportsPage } from '../pages/ReportsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SuperAdminClientPage } from '../pages/SuperAdminClientPage';
import { TdsPage } from '../pages/TdsPage';
import { WithdrawalsPage } from '../pages/WithdrawalsPage';

function FullPageLoading() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <p>Loading admin session…</p>
      </div>
    </div>
  );
}

function SuperAdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<CreateClientPage />} />
        <Route path="/clients/:clientId" element={<SuperAdminClientPage />} />
        <Route path="/manage-passwords" element={<ManagePasswordsPage />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ClientAdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="/" element={<ClientDashboardPage />} />
        <Route path="/customers" element={<ClientCustomersPage />} />
        <Route path="/customers/:userId" element={<ClientCustomersPage />} />
        <Route path="/investment-requests" element={<InvestmentRequestsPage />} />
        <Route path="/investment-requests/renewal/:renewalId" element={<AgreementRenewalReviewPage />} />
        <Route path="/investment-requests/:requestId" element={<InvestmentReviewPage />} />
        <Route path="/withdrawals" element={<WithdrawalsPage />} />
        <Route path="/tds" element={<TdsPage />} />
        <Route path="/referrals" element={<ReferralsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/manage-passwords" element={<ManagePasswordsPage />} />
        <Route path="/contact-ops" element={<ContactOpsPage />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function AppRoutes() {
  const { status, admin } = useAuth();

  if (status === 'loading') {
    return <FullPageLoading />;
  }

  if (status === 'anonymous') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register-client" element={<RegisterClientPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (admin?.role === 'client_admin') {
    return <ClientAdminRoutes />;
  }

  return <SuperAdminRoutes />;
}
