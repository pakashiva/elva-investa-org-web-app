import { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { AddWithdrawalModal } from '../components/AddWithdrawalModal';
import { AppHeader } from '../components/AppHeader';
import { DecisionResultModal } from '../components/DecisionResultModal';
import { EmptyState, ErrorBanner } from '../components/States';
import { TablePager } from '../components/TablePager';
import { useWithdrawals } from '../hooks/useWithdrawals';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { decideWithdrawal } from '../services/withdrawalService';
import type { WithdrawalDecision, WithdrawalFilter, WithdrawalListRow } from '../types/admin';
import {
  formatDate,
  formatInr,
  formatPercent,
  formatTimeIst,
  maskBankAccount,
  withdrawalStatusLabel,
} from '../utils/format';

const FILTERS: { id: WithdrawalFilter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

function statusClass(label: ReturnType<typeof withdrawalStatusLabel>): string {
  if (label === 'Approved') return 'approved';
  if (label === 'Rejected') return 'rejected';
  if (label === 'On Hold') return 'hold';
  return 'pending';
}

function auditCopy(row: WithdrawalListRow): string {
  const amount = formatInr(row.withdrawal_amount);
  const code = row.investment_code || 'this plan';
  if (row.strategy === 'partial') {
    return `This customer is requesting a partial withdrawal of ${amount} from their active plan ${code}. Remaining principal stays invested. ${
      row.tds_amount > 0
        ? `A mandatory ${formatPercent(row.tds_percent)} TDS (${formatInr(row.tds_amount)}) has been computed on the earned interest portion of this request.`
        : 'No additional TDS applies because this request is from principal.'
    }`;
  }
  return `This customer is requesting withdrawal of ${amount} from their active plan ${code}. A mandatory ${formatPercent(row.tds_percent)} TDS (${formatInr(row.tds_amount)}) has been computed on the earned interest portion of this request.`;
}

function isActionable(status: WithdrawalListRow['status']): boolean {
  return status === 'Processing' || status === 'On Hold';
}

export function WithdrawalsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const withdrawals = useWithdrawals();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<{
    action: WithdrawalDecision;
    row: WithdrawalListRow;
  } | null>(null);

  const rows = withdrawals.result?.rows ?? [];
  const total = withdrawals.result?.total ?? 0;
  const from = total === 0 ? 0 : (withdrawals.page - 1) * withdrawals.pageSize + 1;
  const to = Math.min(withdrawals.page * withdrawals.pageSize, total);

  async function onDecide(row: WithdrawalListRow, action: WithdrawalDecision) {
    setSavingId(row.id);
    setActionError(null);
    try {
      await decideWithdrawal(row.id, action);
      setDecision({ action, row });
      setExpandedId(null);
      await withdrawals.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update withdrawal');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <AppHeader
        title="Withdrawal Requests"
        subtitle="Authorise and process customer withdrawal requests."
        showSearch
        onOpenMenu={onOpenMenu}
        actions={
          <button type="button" className="primary-btn" onClick={() => setCreateOpen(true)}>
            + Create Withdrawal
          </button>
        }
      />

      {notice ? <div className="notice-box">{notice}</div> : null}

      {withdrawals.error ? (
        <ErrorBanner message={withdrawals.error} onRetry={() => void withdrawals.reload()} />
      ) : null}
      {actionError ? (
        <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />
      ) : null}

      <section className="table-shell">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`filter-tab${withdrawals.filter === item.id ? ' active' : ''}`}
                onClick={() => {
                  withdrawals.changeFilter(item.id);
                  setExpandedId(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {withdrawals.isLoading ? (
          <div className="state-box">Loading withdrawals…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No withdrawal requests"
            message="No matching payout requests for this filter."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table withdrawals-table">
              <thead>
                <tr>
                  <th>CUSTOMER NAME</th>
                  <th>INVESTMENT ID</th>
                  <th>AVAILABLE PRINCIPAL</th>
                  <th>REQUESTED AMT</th>
                  <th>TDS/CHARGES</th>
                  <th>NET PAYOUT</th>
                  <th>TARGET BANK</th>
                  <th>REQUEST DATE</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const label = withdrawalStatusLabel(row.status);
                  const open = expandedId === row.id;
                  return (
                    <RowGroup
                      key={row.id}
                      row={row}
                      label={label}
                      open={open}
                      saving={savingId === row.id}
                      onToggle={() => setExpandedId(open ? null : row.id)}
                      onDecide={onDecide}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-footer">
          <span>{total === 0 ? '0 requests' : `Showing ${from}–${to} of ${total}`}</span>
          <TablePager
            page={withdrawals.page}
            pageCount={withdrawals.pageCount}
            total={total}
            onPageChange={withdrawals.setPage}
          />
        </div>
      </section>

      {decision ? (
        <DecisionResultModal
          subject="withdrawal"
          action={decision.action}
          requestId={decision.row.investment_code}
          amount={decision.row.withdrawal_amount}
          onClose={() => setDecision(null)}
        />
      ) : null}

      <AddWithdrawalModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={({ amount, strategy }) => {
          setNotice(
            `${strategy === 'partial' ? 'Partial' : 'Full'} withdrawal of ${formatInr(amount)} created. Status: Processing.`
          );
          void withdrawals.reload();
        }}
      />
    </>
  );
}

function RowGroup({
  row,
  label,
  open,
  saving,
  onToggle,
  onDecide,
}: {
  row: WithdrawalListRow;
  label: ReturnType<typeof withdrawalStatusLabel>;
  open: boolean;
  saving: boolean;
  onToggle: () => void;
  onDecide: (row: WithdrawalListRow, action: WithdrawalDecision) => void;
}) {
  const actionable = isActionable(row.status);

  return (
    <>
      <tr className={open ? 'wd-row-open' : undefined} onClick={onToggle}>
        <td>
          <span className="wd-name">
            <ChevronRight size={16} className={open ? 'open' : undefined} />
            {row.customer_name}
          </span>
        </td>
        <td>{row.investment_code}</td>
        <td>{formatInr(row.available_principal)}</td>
        <td>{formatInr(row.withdrawal_amount)}</td>
        <td className="amount-debit">
          {formatInr(row.tds_amount)} (TDS)
        </td>
        <td className="amount-credit">{formatInr(row.net_payout)}</td>
        <td>{maskBankAccount(row.bank_name, row.account_number)}</td>
        <td>{formatDate(row.requested_on)}</td>
        <td>
          <span className={`status-pill ${statusClass(label)}`}>{label}</span>
        </td>
      </tr>
      {open ? (
        <tr className="wd-audit-row" onClick={(event) => event.stopPropagation()}>
          <td colSpan={9}>
            <div className="wd-audit">
              <div className="wd-audit-copy">
                <h4>Withdrawal Summary Audit</h4>
                <p>{auditCopy(row)}</p>
                {row.agreement_ok ? (
                  <p className="wd-check">
                    <Check size={16} />
                    Signature on Agreement matches portal records
                  </p>
                ) : (
                  <p className="wd-check pending">Agreement acceptance is not on file.</p>
                )}
              </div>
              {actionable ? (
                <div className="wd-audit-actions">
                  <button
                    type="button"
                    className="wd-approve"
                    disabled={saving}
                    onClick={() => onDecide(row, 'approve')}
                  >
                    Approve Request
                  </button>
                  <button
                    type="button"
                    className="wd-reject"
                    disabled={saving}
                    onClick={() => onDecide(row, 'reject')}
                  >
                    Reject Request
                  </button>
                  <button
                    type="button"
                    className="wd-hold"
                    disabled={saving || row.status === 'On Hold'}
                    onClick={() => onDecide(row, 'hold')}
                  >
                    Put on Hold
                  </button>
                </div>
              ) : (
                <p className="muted">This request is already {label.toLowerCase()}.</p>
              )}
              <p className="wd-audit-meta">
                Last updated {formatDate(row.updated_at)} at {formatTimeIst(row.updated_at)}
              </p>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
