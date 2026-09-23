import { ArrowLeft, FileDown } from 'lucide-react';
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
  decideInvestment,
  getInvestmentRequest,
  updateInvestmentTerms,
} from '../services/investmentRequestService';
import type {
  AgreementInputs,
  InvestmentDecision,
  InvestmentRequestDetail,
} from '../types/admin';
import {
  displayCustomerId,
  displayRequestId,
  formatInr,
  formatPercent,
  formatTdsRate,
  last4Account,
} from '../utils/format';

const RATE_OPTIONS = [0.04, 0.05, 0.06, 0.07, 0.08];
const PAYOUT_DAYS = [1, 5, 10, 15, 20, 25];
const REFERRAL_RATE_OPTIONS = [0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.05];

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function InvestmentReviewPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<InvestmentRequestDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState<InvestmentDecision | null>(null);
  const [agreementMode, setAgreementMode] = useState<'approve' | 'download' | null>(null);
  const [agreementError, setAgreementError] = useState<string | null>(null);

  const load = async () => {
    if (!requestId) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setDetail(await getInvestmentRequest(requestId));
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : 'Failed to load request');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [requestId]);

  const editable = detail?.status === 'Pending' || detail?.status === 'Under Review';
  const payoutDay = detail?.payout_day ?? 10;
  const referralRate = detail?.referral_rate ?? 0.01;
  const hasReferrer = Boolean(detail?.referrer_user_id || detail?.referrer_name);

  const preview = useMemo(() => {
    const principal = detail?.fund_amount ?? 0;
    const rate = detail?.interest_rate ?? 0.05;
    const tds = detail?.tds_percent ?? 0.1;
    const gross = roundMoney(principal * rate);
    const tax = roundMoney(gross * tds);
    const net = roundMoney(gross - tax);
    return { principal, gross, tax, net, maturity: roundMoney(principal + net) };
  }, [detail]);

  const referralPreview = useMemo(() => {
    const principal = detail?.fund_amount ?? 0;
    const rate = detail?.referral_rate ?? 0.01;
    const tdsRate = detail?.referral_tds_rate ?? 0.02;
    const gross = roundMoney(principal * rate);
    const tax = roundMoney(gross * tdsRate);
    const net = roundMoney(gross - tax);
    return { gross, tax, net, tdsRate };
  }, [detail]);

  async function persistTerms(
    rate: number,
    tds: number,
    day: number,
    nextReferralRate: number = referralRate
  ) {
    if (!detail || !editable) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateInvestmentTerms(detail.id, rate, tds, day, nextReferralRate);
      setDetail({
        ...detail,
        interest_rate: rate,
        tds_percent: tds,
        payout_day: day,
        referral_rate: nextReferralRate,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save terms');
    } finally {
      setSaving(false);
    }
  }

  async function onDecide(action: InvestmentDecision) {
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
      const result = await decideInvestment(detail.id, action);
      setDetail({ ...detail, status: result.status });
      setDecision(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update request');
    } finally {
      setSaving(false);
    }
  }

  async function onAgreementConfirm(inputs: AgreementInputs) {
    if (!detail) {
      return;
    }
    const approving = agreementMode === 'approve';
    const alreadyActive = detail.status === 'Active' || detail.status === 'Closed';
    setSaving(true);
    setError(null);
    setAgreementError(null);
    try {
      if (approving && !alreadyActive) {
        try {
          const result = await decideInvestment(detail.id, 'approve');
          setDetail((prev) => (prev ? { ...prev, status: result.status } : prev));
        } catch (err) {
          const message = err instanceof Error ? err.message : '';
          if (!/already been decided/i.test(message)) {
            throw err;
          }
          setDetail((prev) => (prev ? { ...prev, status: 'Active' } : prev));
        }
      }

      const payload = await saveInvestmentAgreement({
        investmentId: detail.id,
        officeId: inputs.officeId,
        chequeNo: inputs.chequeNo,
        chequeBankName: inputs.chequeBankName,
        chequeBankAddress: inputs.chequeBankAddress,
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
      const payload = await getInvestmentAgreement(detail.id);
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

  return (
    <>
      <AppHeader
        title="Investment Approval Console"
        subtitle={`Awaiting decision for ${displayRequestId(detail?.request_id)}.`}
        showSearch
        onOpenMenu={onOpenMenu}
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {isLoading || !detail ? (
        <div className="card state-box">{isLoading ? 'Loading request…' : 'Request not found'}</div>
      ) : (
        <div className="review-grid">
          <div className="review-col">
            <article className="card review-card">
              <div className="review-card-top">
                <button
                  type="button"
                  className="review-back-btn"
                  onClick={() => navigate(-1)}
                  aria-label="Go back"
                >
                  <ArrowLeft size={18} />
                </button>
                <h3>Customer Information</h3>
              </div>
              <div className="review-customer">
                <img className="avatar" src="/avatar.png" alt="" />
                <div>
                  <strong>{detail.customer_name}</strong>
                  <p>Customer ID: {displayCustomerId(detail.customer_id)}</p>
                </div>
              </div>
              <div className="detail-grid">
                <div className="detail-field">
                  <span>TOTAL ACTIVE PORTFOLIO</span>
                  <strong>{formatInr(detail.active_portfolio)}</strong>
                </div>
                <div className="detail-field">
                  <span>ACTIVE SCHEMES</span>
                  <strong>{detail.active_plans} active plans</strong>
                </div>
                <div className="detail-field">
                  <span>REFERRER NAME</span>
                  <strong>{detail.referrer_name || '—'}</strong>
                  {detail.referral_code ? <p>Code: {detail.referral_code}</p> : null}
                </div>
                {hasReferrer ? (
                  <div className="detail-field">
                    <span>REFERRAL % (FOR REFERRER)</span>
                    <strong>{formatTdsRate(referralRate)}</strong>
                    <p>
                      Est. net commission: {formatInr(referralPreview.net)} after{' '}
                      {formatTdsRate(referralPreview.tdsRate)} TDS
                    </p>
                  </div>
                ) : null}
              </div>
            </article>

            <article className="card review-card">
              <h3>Request Parameters</h3>
              <div className="detail-grid">
                <div className="detail-field">
                  <span>PLAN NO.</span>
                  <strong>{detail.code || '—'}</strong>
                </div>
                <div className="detail-field">
                  <span>PROPOSED PLAN</span>
                  <strong>
                    {detail.plan_name} ({formatPercent(detail.interest_rate)} p.m.)
                  </strong>
                </div>
                <div className="detail-field">
                  <span>FUNDING AMOUNT</span>
                  <strong>{formatInr(detail.fund_amount)}</strong>
                </div>
              </div>
              <div className="linked-bank">
                <span>LINKED BANK ACCOUNT</span>
                {detail.bank ? (
                  <>
                    <strong>
                      {detail.bank.bank_name} (Acct ending **{last4Account(detail.bank.account_number)})
                    </strong>
                    <p>IFSC: {detail.bank.ifsc_code}</p>
                  </>
                ) : (
                  <p>No bank account linked.</p>
                )}
              </div>
            </article>
          </div>

          <article className="card review-card">
            <h3>Plan Validation Configuration</h3>

            <label className="toggle-row">
              <span>
                <strong>TDS Deduction Policy</strong>
                <p>Automate statutory 10% lock-in</p>
              </span>
              <input
                type="checkbox"
                checked={detail.tds_percent > 0}
                disabled={!editable || saving}
                onChange={(event) =>
                  void persistTerms(detail.interest_rate, event.target.checked ? 0.1 : 0, payoutDay)
                }
              />
            </label>

            {hasReferrer ? (
              <label className="config-field">
                Referral percentage (for {detail.referrer_name || 'referrer'})
                <select
                  className="select"
                  value={referralRate}
                  disabled={!editable || saving}
                  onChange={(event) =>
                    void persistTerms(
                      detail.interest_rate,
                      detail.tds_percent,
                      payoutDay,
                      Number(event.target.value)
                    )
                  }
                >
                  {!REFERRAL_RATE_OPTIONS.includes(referralRate) ? (
                    <option value={referralRate}>{formatTdsRate(referralRate)}</option>
                  ) : null}
                  {REFERRAL_RATE_OPTIONS.map((rate) => (
                    <option key={rate} value={rate}>
                      {formatTdsRate(rate)}
                      {rate === 0.01 ? ' (Default)' : ''}
                    </option>
                  ))}
                </select>
                <p className="muted" style={{ marginTop: 8 }}>
                  Gross {formatInr(referralPreview.gross)} − TDS {formatInr(referralPreview.tax)} ={' '}
                  <strong>{formatInr(referralPreview.net)}</strong> net to referrer on approval.
                </p>
              </label>
            ) : (
              <p className="muted">No referrer on this request — referral percentage not applicable.</p>
            )}

            <label className="config-field">
              Assign Interest Yield (p.m.)
              <select
                className="select"
                value={detail.interest_rate}
                disabled={!editable || saving}
                onChange={(event) =>
                  void persistTerms(Number(event.target.value), detail.tds_percent, payoutDay)
                }
              >
                {RATE_OPTIONS.map((rate) => (
                  <option key={rate} value={rate}>
                    {formatPercent(rate)} p.m.
                    {rate === 0.05 ? ' (Standard Rate)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="config-field">
              Monthly Payout Cycle
              <div className="payout-days">
                {PAYOUT_DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={payoutDay === day ? 'active' : ''}
                    disabled={!editable || saving}
                    onClick={() => void persistTerms(detail.interest_rate, detail.tds_percent, day)}
                  >
                    {day === 1 ? '1st' : `${day}th`}
                  </button>
                ))}
              </div>
            </div>

            <div className="accrual-preview">
              <h4>Interest Accrual Summary Preview</h4>
              <p>Uses the live monthly interest formula (not annual).</p>
              <ul>
                <li>
                  <span>Principal</span>
                  <strong>{formatInr(preview.principal)}</strong>
                </li>
                <li>
                  <span>Gross yield (monthly)</span>
                  <strong>{formatInr(preview.gross)}</strong>
                </li>
                <li>
                  <span>TDS {formatPercent(detail.tds_percent)} deduction</span>
                  <strong className="debit">-{formatInr(preview.tax)}</strong>
                </li>
                <li>
                  <span>Net monthly yield</span>
                  <strong className="credit">{formatInr(preview.net)}</strong>
                </li>
                <li>
                  <span>Estimated value after 1 period</span>
                  <strong>{formatInr(preview.maturity)}</strong>
                </li>
              </ul>
            </div>

            {editable ? (
              <div className="decision-actions">
                <button
                  type="button"
                  className="approve-btn"
                  disabled={saving}
                  onClick={() => void onDecide('approve')}
                >
                  Approve Investment
                </button>
                <button
                  type="button"
                  className="hold-btn"
                  disabled={saving}
                  onClick={() => void onDecide('hold')}
                >
                  Hold Request
                </button>
                <button
                  type="button"
                  className="reject-btn"
                  disabled={saving}
                  onClick={() => void onDecide('reject')}
                >
                  Reject Request
                </button>
              </div>
            ) : (
              <>
                <p className="muted">
                  This request is already {requestStatusLabelSafe(detail.status)}.
                </p>
                {detail.status === 'Active' || detail.status === 'Closed' ? (
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
              </>
            )}
          </article>
        </div>
      )}

      <AgreementDetailsModal
        open={agreementMode !== null}
        title={
          agreementMode === 'approve' ? 'Approve & Generate Agreement' : 'Generate Loan Agreement'
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

      {decision && detail ? (
        <DecisionResultModal
          action={decision}
          requestId={detail.request_id}
          amount={detail.fund_amount}
          onClose={() => navigate('/investment-requests')}
        />
      ) : null}
    </>
  );
}

function requestStatusLabelSafe(status: string): string {
  if (status === 'Active' || status === 'Closed') return 'approved';
  return status.toLowerCase();
}
