import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { AddInvestmentModal } from '../components/AddInvestmentModal';
import { AgreementDetailsModal } from '../components/AgreementDetailsModal';
import { AppHeader } from '../components/AppHeader';
import { EditApprovedInvestmentModal } from '../components/EditApprovedInvestmentModal';
import { EmptyState, ErrorBanner } from '../components/States';
import { TablePager } from '../components/TablePager';
import { useInvestmentRequests } from '../hooks/useInvestmentRequests';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import {
  downloadAgreementDocx,
  getInvestmentAgreement,
  saveInvestmentAgreement,
} from '../services/agreementService';
import { cancelApprovedInvestment } from '../services/investmentRequestService';
import type {
  AgreementInputs,
  InvestmentRequestFilter,
  InvestmentRequestListRow,
} from '../types/admin';
import {
  displayCustomerId,
  displayRequestId,
  formatDate,
  formatInr,
  requestStatusLabel,
} from '../utils/format';

const FILTERS: { id: InvestmentRequestFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'under_review', label: 'Under Review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

function isApprovedStatus(status: InvestmentRequestListRow['status']) {
  return status === 'Active' || status === 'Closed' || status === 'Approved';
}

export function InvestmentRequestsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [regenerateId, setRegenerateId] = useState<string | null>(null);
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [agreementError, setAgreementError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const requests = useInvestmentRequests();

  const rows = requests.result?.rows ?? [];
  const total = requests.result?.total ?? 0;
  const from = total === 0 ? 0 : (requests.page - 1) * requests.pageSize + 1;
  const to = Math.min(requests.page * requests.pageSize, total);

  useEffect(() => {
    if (!menuId) return;
    function onDocClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuId(null);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuId(null);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  async function onCancelInvestment(row: InvestmentRequestListRow) {
    setMenuId(null);
    const ok = window.confirm(
      `Withdraw / cancel ${row.code || 'this investment'} for ${row.customer_name}? This moves it to Rejected.`
    );
    if (!ok) return;
    setActionBusy(true);
    setNotice(null);
    try {
      await cancelApprovedInvestment(row.id);
      setNotice(`Investment ${row.code || row.id} cancelled.`);
      void requests.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not cancel investment');
    } finally {
      setActionBusy(false);
    }
  }

  async function onRegenerate(row: InvestmentRequestListRow) {
    setMenuId(null);
    setAgreementError(null);
    setActionBusy(true);
    try {
      const existing = await getInvestmentAgreement(row.id);
      if (existing) {
        await downloadAgreementDocx(existing);
        setNotice(`Agreement regenerated for ${row.code || row.customer_name}.`);
        return;
      }
      setRegenerateId(row.id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not regenerate agreement');
    } finally {
      setActionBusy(false);
    }
  }

  async function onAgreementConfirm(inputs: AgreementInputs) {
    if (!regenerateId) return;
    setAgreementBusy(true);
    setAgreementError(null);
    try {
      const payload = await saveInvestmentAgreement({
        investmentId: regenerateId,
        officeId: inputs.officeId,
        chequeNo: inputs.chequeNo,
        chequeBankName: inputs.chequeBankName,
        chequeBankAddress: inputs.chequeBankAddress,
      });
      await downloadAgreementDocx(payload);
      setRegenerateId(null);
      setNotice('Agreement generated and downloaded.');
    } catch (err) {
      setAgreementError(err instanceof Error ? err.message : 'Could not generate agreement');
    } finally {
      setAgreementBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Investment Requests"
        subtitle="Process and sign off client capital deployments."
        showSearch
        onOpenMenu={onOpenMenu}
        actions={
          <button type="button" className="primary-btn" onClick={() => setCreateOpen(true)}>
            + Create Investment Request
          </button>
        }
      />

      {notice ? <div className="notice-box">{notice}</div> : null}
      {requests.error ? (
        <ErrorBanner message={requests.error} onRetry={() => void requests.reload()} />
      ) : null}

      <section className="table-shell">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`filter-tab${requests.filter === item.id ? ' active' : ''}`}
                onClick={() => requests.changeFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {requests.isLoading ? (
          <div className="state-box">Loading requests…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No investment requests"
            message="No matching fund requests for this filter."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>PLAN NO.</th>
                  <th>REQUEST ID</th>
                  <th>CUSTOMER NAME</th>
                  <th>CUSTOMER ID</th>
                  <th>REQUESTED PLAN</th>
                  <th>AMOUNT</th>
                  <th>REQUEST DATE</th>
                  <th>STATUS</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const label = requestStatusLabel(row.status);
                  const isRenewal = row.kind === 'renewal';
                  const showApprovedMenu =
                    !isRenewal && isApprovedStatus(row.status) && row.status !== 'Closed';
                  const showClosedMenu = !isRenewal && row.status === 'Closed';
                  return (
                    <tr
                      key={`${row.kind ?? 'investment'}-${row.id}`}
                      className={isRenewal ? 'renewal-row' : undefined}
                    >
                      <td>
                        <strong>{row.code || '—'}</strong>
                        {isRenewal ? (
                          <span className="request-kind-badge renewal">Renewal</span>
                        ) : null}
                      </td>
                      <td>{displayRequestId(row.request_id)}</td>
                      <td>
                        <strong>{row.customer_name}</strong>
                      </td>
                      <td>{displayCustomerId(row.customer_id)}</td>
                      <td>{row.plan_name}</td>
                      <td>{formatInr(row.fund_amount)}</td>
                      <td>{formatDate(row.created_at)}</td>
                      <td>
                        <span
                          className={`status-pill ${
                            label === 'Approved'
                              ? 'approved'
                              : label === 'Rejected'
                                ? 'rejected'
                                : label === 'Under Review'
                                  ? 'review'
                                  : 'pending'
                          }`}
                        >
                          {label}
                        </span>
                      </td>
                      <td>
                        {showApprovedMenu || showClosedMenu ? (
                          <div
                            className="row-menu"
                            ref={menuId === row.id ? menuRef : undefined}
                          >
                            <button
                              type="button"
                              className="icon-btn row-menu-trigger"
                              aria-label="More actions"
                              aria-expanded={menuId === row.id}
                              disabled={actionBusy}
                              onClick={() =>
                                setMenuId((prev) => (prev === row.id ? null : row.id))
                              }
                            >
                              <MoreVertical size={18} />
                            </button>
                            {menuId === row.id ? (
                              <div className="row-menu-dropdown" role="menu">
                                {showApprovedMenu ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setMenuId(null);
                                      setEditId(row.id);
                                    }}
                                  >
                                    Edit
                                  </button>
                                ) : null}
                                {showApprovedMenu ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="danger"
                                    onClick={() => void onCancelInvestment(row)}
                                  >
                                    Withdraw / Cancel
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => void onRegenerate(row)}
                                >
                                  Regenerate
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setMenuId(null);
                                    navigate(`/investment-requests/${row.id}`);
                                  }}
                                >
                                  View
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() =>
                              navigate(
                                isRenewal
                                  ? `/investment-requests/renewal/${row.id}`
                                  : `/investment-requests/${row.id}`
                              )
                            }
                          >
                            Review
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-footer">
          <span>{total === 0 ? '0 requests' : `Showing ${from}–${to} of ${total}`}</span>
          <TablePager
            page={requests.page}
            pageCount={requests.pageCount}
            total={total}
            onPageChange={requests.setPage}
          />
        </div>
      </section>

      <AddInvestmentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={({ customerId, amount }) => {
          setNotice(
            `Investment request created for ${customerId ?? 'customer'} · ${formatInr(amount)}. Status: Pending.`
          );
          void requests.reload();
        }}
      />

      <EditApprovedInvestmentModal
        open={editId !== null}
        investmentId={editId}
        onClose={() => setEditId(null)}
        onSaved={() => {
          setNotice('Investment details updated.');
          void requests.reload();
        }}
      />

      <AgreementDetailsModal
        open={regenerateId !== null}
        title="Generate Loan Agreement"
        confirmLabel="Download Agreement"
        busy={agreementBusy}
        error={agreementError}
        onClose={() => {
          if (!agreementBusy) {
            setRegenerateId(null);
            setAgreementError(null);
          }
        }}
        onConfirm={(inputs) => void onAgreementConfirm(inputs)}
      />
    </>
  );
}
