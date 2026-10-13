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
import { BorrowingPage } from '../pages/BorrowingPage';

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

function ClientAdminRoutes({ borrowingEnabled, investingEnabled }: { borrowingEnabled: boolean; investingEnabled: boolean }) {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route path="/" element={<ClientDashboardPage />} />
        <Route path="/customers" element={<ClientCustomersPage />} />
        <Route path="/customers/:userId" element={<ClientCustomersPage />} />
        {investingEnabled ? <Route path="/investment-requests" element={<InvestmentRequestsPage />} /> : null}
        {investingEnabled ? <Route path="/investment-requests/renewal/:renewalId" element={<AgreementRenewalReviewPage />} /> : null}
        {investingEnabled ? <Route path="/investment-requests/:requestId" element={<InvestmentReviewPage />} /> : null}
        {investingEnabled ? <Route path="/withdrawals" element={<WithdrawalsPage />} /> : null}
        {investingEnabled ? <Route path="/tds" element={<TdsPage />} /> : null}
        {investingEnabled ? <Route path="/referrals" element={<ReferralsPage />} /> : null}
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/manage-passwords" element={<ManagePasswordsPage />} />
        {borrowingEnabled ? <Route path="/borrowing" element={<BorrowingPage />} /> : null}
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
    return <ClientAdminRoutes borrowingEnabled={admin.enabledModules?.includes('borrow') ?? false} investingEnabled={admin.enabledModules?.includes('invest') ?? true} />;
  }

  return <SuperAdminRoutes />;
}
