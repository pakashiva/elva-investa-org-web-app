import { FileDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { AgreementDetailsModal } from '../components/AgreementDetailsModal';
import { AppHeader } from '../components/AppHeader';
import { DecisionResultModal } from '../components/DecisionResultModal';
import { ErrorBanner } from '../components/States';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import {
  downloadAgreementDocx,
  getInvestmentAgreement,
  saveInvestmentAgreement,
} from '../services/agreementService';
import {
  decideAgreementRenewal,
  getAgreementRenewal,
} from '../services/investmentRequestService';
import type {
  AgreementInputs,
  AgreementRenewalDetail,
  RenewalDecision,
} from '../types/admin';
import {
  displayCustomerId,
  formatDate,
  formatInr,
  formatPercent,
  last4Account,
  requestStatusLabel,
} from '../utils/format';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function AgreementRenewalReviewPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const { renewalId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AgreementRenewalDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState<RenewalDecision | null>(null);
  const [agreementMode, setAgreementMode] = useState<'approve' | 'download' | null>(null);
  const [agreementError, setAgreementError] = useState<string | null>(null);

  const load = async () => {
    if (!renewalId) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setDetail(await getAgreementRenewal(renewalId));
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : 'Failed to load renewal request');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [renewalId]);

  const editable = detail?.status === 'Pending';

  const preview = useMemo(() => {
    const principal = detail?.new_principal ?? 0;
    const rate = detail?.interest_rate ?? 0.05;
    const tds = detail?.tds_percent ?? 0.1;
    const gross = roundMoney(principal * rate);
    const tax = roundMoney(gross * tds);
    const net = roundMoney(gross - tax);
    return { principal, gross, tax, net };
  }, [detail]);

  async function decide(action: RenewalDecision) {
    if (!detail || !editable) {
      return;
    }
    if (action === 'approve') {
      setAgreementMode('approve');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await decideAgreementRenewal(detail.id, action);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              status:
                result.status === 'Approved' || result.status === 'Rejected'
                  ? result.status
                  : prev.status,
              fund_amount: result.fund_amount || prev.fund_amount,
              new_principal: result.fund_amount || prev.new_principal,
            }
          : prev
      );
      setDecision(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update renewal');
    } finally {
      setSaving(false);
    }
  }

  async function onAgreementConfirm(inputs: AgreementInputs) {
    if (!detail) {
      return;
    }
    const approving = agreementMode === 'approve';
    const alreadyApproved = detail.status === 'Approved';
    setSaving(true);
    setError(null);
    setAgreementError(null);
    try {
      if (approving && !alreadyApproved) {
        try {
          const result = await decideAgreementRenewal(detail.id, 'approve');
          setDetail((prev) =>
            prev
              ? {
                  ...prev,
                  status:
                    result.status === 'Approved' || result.status === 'Rejected'
                      ? result.status
                      : prev.status,
                  fund_amount: result.fund_amount || prev.fund_amount,
                  new_principal: result.fund_amount || prev.new_principal,
                }
              : prev
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : '';
          if (!/already been decided|already (approved|rejected)|Only Pending/i.test(message)) {
            throw err;
          }
          setDetail((prev) => (prev ? { ...prev, status: 'Approved' } : prev));
        }
      }

      const payload = await saveInvestmentAgreement({
        investmentId: detail.investment_id,
        officeId: inputs.officeId,
        chequeNo: inputs.chequeNo,
        chequeBankName: inputs.chequeBankName,
        chequeBankAddress: inputs.chequeBankAddress,
        renewalId: detail.id,
      });
      await downloadAgreementDocx(payload);
      setAgreementMode(null);
      setAgreementError(null);
      if (approving) {
        setDecision('approve');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not generate the agreement';
      setAgreementError(message);
      setError(message);
      if (approving) {
        setAgreementMode('download');
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDownloadAgreement() {
    if (!detail) {
      return;
    }
    setSaving(true);
    setError(null);
    setAgreementError(null);
    try {
      const payload = await getInvestmentAgreement(detail.investment_id, detail.id);
      if (!payload) {
        setAgreementMode('download');
        return;
      }
      await downloadAgreementDocx(payload);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not download the agreement';
      setAgreementError(message);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <>
        <AppHeader title="Agreement Renewal" onOpenMenu={onOpenMenu} />
        <div className="state-box">Loading renewal request…</div>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <AppHeader title="Agreement Renewal" onOpenMenu={onOpenMenu} />
        <ErrorBanner
          message={error ?? 'Renewal request not found'}
          onRetry={() => void load()}
        />
      </>
    );
  }

  const statusLabel = requestStatusLabel(detail.status);

  return (
    <>
      <AppHeader
        title="Agreement Renewal Review"
        subtitle="Approve to reset the 365-day agreement term from today."
        onOpenMenu={onOpenMenu}
        actions={
          <button
            type="button"
            className="ghost-btn"
            onClick={() => navigate('/investment-requests')}
          >
            Back to list
          </button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="renewal-banner">
        <strong>Agreement Renewal</strong>
        <span>
          This is not a new investment request. It renews an existing Active plan
          {detail.mode === 'increase' ? ' and increases principal.' : ' at the same principal.'}
        </span>
      </div>

      <section className="review-grid">
        <article className="card review-card">
          <h3>Customer</h3>
          <dl className="review-dl">
            <div>
              <dt>Name</dt>
              <dd>{detail.customer_name}</dd>
            </div>
            <div>
              <dt>Customer ID</dt>
              <dd>{displayCustomerId(detail.customer_id)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span
                  className={`status-pill ${
                    statusLabel === 'Approved'
                      ? 'approved'
                      : statusLabel === 'Rejected'
                        ? 'rejected'
                        : 'pending'
                  }`}
                >
                  {statusLabel}
                </span>
              </dd>
            </div>
          </dl>
        </article>

        <article className="card review-card">
          <h3>Renewal request</h3>
          <dl className="review-dl">
            <div>
              <dt>Agreement ID</dt>
              <dd>{detail.agreement_id || '—'}</dd>
            </div>
            <div>
              <dt>Plan No.</dt>
              <dd>{detail.plan_no || '—'}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>
                {detail.mode === 'increase' ? 'Increase investment amount' : 'Renew with same amount'}
              </dd>
            </div>
            <div>
              <dt>Current principal</dt>
              <dd>{formatInr(detail.current_amount)}</dd>
            </div>
            {detail.mode === 'increase' ? (
              <>
                <div>
                  <dt>Increment</dt>
                  <dd>{formatInr(detail.increment_amount ?? 0)}</dd>
                </div>
                <div>
                  <dt>New principal</dt>
                  <dd>
                    <strong>{formatInr(detail.new_principal)}</strong>
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Requested on</dt>
              <dd>{formatDate(detail.created_at)}</dd>
            </div>
            <div>
              <dt>Current invested date</dt>
              <dd>{detail.invested_date ? formatDate(detail.invested_date) : '—'}</dd>
            </div>
          </dl>
        </article>

        <article className="card review-card">
          <h3>Linked investment</h3>
          <dl className="review-dl">
            <div>
              <dt>Plan</dt>
              <dd>{detail.plan_name}</dd>
            </div>
            <div>
              <dt>Live principal</dt>
              <dd>{formatInr(detail.fund_amount)}</dd>
            </div>
            <div>
              <dt>Interest rate</dt>
              <dd>{formatPercent(detail.interest_rate)}</dd>
            </div>
            <div>
              <dt>Investment status</dt>
              <dd>{detail.investment_status}</dd>
            </div>
            {detail.bank ? (
              <div>
                <dt>Payout bank</dt>
                <dd>
                  {detail.bank.bank_name} · ****{last4Account(detail.bank.account_number)}
                </dd>
              </div>
            ) : null}
          </dl>
        </article>

        <article className="card review-card">
          <h3>After approval</h3>
          <p className="muted-cell" style={{ marginTop: 0 }}>
            Invested date resets to today (new 365-day term). Interest periods restart; monthly
            interest uses the new principal from the current cycle.
          </p>
          <dl className="review-dl">
            <div>
              <dt>Principal after approval</dt>
              <dd>
                <strong>{formatInr(preview.principal)}</strong>
              </dd>
            </div>
            <div>
              <dt>Est. monthly gross</dt>
              <dd>{formatInr(preview.gross)}</dd>
            </div>
            <div>
              <dt>Est. monthly TDS</dt>
              <dd>{formatInr(preview.tax)}</dd>
            </div>
            <div>
              <dt>Est. monthly net</dt>
              <dd>{formatInr(preview.net)}</dd>
            </div>
          </dl>

          {editable ? (
            <div className="decision-actions">
              <button
                type="button"
                className="approve-btn"
                disabled={saving}
                onClick={() => void decide('approve')}
              >
                {saving ? 'Saving…' : 'Approve renewal'}
              </button>
              <button
                type="button"
                className="reject-btn"
                disabled={saving}
                onClick={() => void decide('reject')}
              >
                Reject
              </button>
            </div>
          ) : detail.status === 'Approved' ? (
            <div className="decision-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={saving}
                onClick={() => void onDownloadAgreement()}
              >
                <FileDown size={16} /> Download Agreement (Word)
              </button>
            </div>
          ) : null}
        </article>
      </section>

      <AgreementDetailsModal
        open={agreementMode !== null}
        title={
          agreementMode === 'approve'
            ? 'Approve Renewal & Generate Agreement'
            : 'Generate Renewal Agreement'
        }
        confirmLabel={agreementMode === 'approve' ? 'Approve & Download' : 'Download Agreement'}
        busy={saving}
        error={agreementError}
        onClose={() => {
          setAgreementMode(null);
          setAgreementError(null);
        }}
        onConfirm={(inputs) => void onAgreementConfirm(inputs)}
      />

      {decision ? (
        <DecisionResultModal
          action={decision}
          requestId={detail.agreement_id}
          amount={detail.new_principal}
          subject="renewal"
          onClose={() => navigate('/investment-requests')}
        />
      ) : null}
    </>
  );
}
