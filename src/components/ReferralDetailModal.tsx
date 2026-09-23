import { useEffect, useState } from 'react';
import { Check, Pause, X } from 'lucide-react';
import { decideReferral } from '../services/referralService';
import type { ReferralListRow } from '../types/admin';
import {
  displayRequestId,
  formatDate,
  formatInr,
  formatTdsRate,
} from '../utils/format';

type Props = {
  row: ReferralListRow;
  onClose: () => void;
  onChanged: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ReferralDetailModal({ row, onClose, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'pay' | 'hold' | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const paidLifetime = row.lifetime_paid_net;
  const afterPay =
    row.status === 'Paid' ? paidLifetime : paidLifetime + row.net_bonus;

  async function onDecide(action: 'pay' | 'hold') {
    setSaving(true);
    setError(null);
    try {
      await decideReferral(row.id, action);
      setDone(action);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update commission');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="referral-modal"
        role="dialog"
        aria-labelledby="referral-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="customer-modal-head">
          <div>
            <h2 id="referral-detail-title">Commission Detail</h2>
            <p>
              {row.referrer_name} → {row.referred_name}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="referral-result">
            <div className={`decision-icon ${done === 'pay' ? 'approve' : 'hold'}`}>
              {done === 'pay' ? <Check size={28} /> : <Pause size={28} />}
            </div>
            <h3>{done === 'pay' ? 'Commission Paid!' : 'Commission On Hold'}</h3>
            <p>
              {done === 'pay'
                ? `The net bonus of ${formatInr(row.net_bonus)} has been credited to ${row.referrer_name}. Lifetime paid commission is now accumulated with this amount.`
                : `This commission is pending. It is not included in the referrer's mobile earnings until it is paid.`}
            </p>
            <button type="button" className="gold-btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            {error ? <p className="error-box">{error}</p> : null}

            <div className="detail-grid">
              <Field label="REFERRER" value={row.referrer_name} />
              <Field label="REFERRED CUSTOMER" value={row.referred_name} />
              <Field
                label="INVESTMENT ID"
                value={displayRequestId(row.investment_code)}
              />
              <Field label="REFERRAL CODE" value={row.referral_code || '—'} />
              <Field label="INVESTMENT AMT" value={formatInr(row.capital_amount)} />
              <Field label="COMM. RATE" value={formatTdsRate(row.referral_rate)} />
              <Field label="GROSS COMM." value={formatInr(row.gross_bonus)} />
              <Field
                label={`TDS (${formatTdsRate(row.tds_rate)})`}
                value={formatInr(row.tds_amount)}
              />
              <Field label="NET COMMISSION" value={formatInr(row.net_bonus)} />
              <Field label="DATE" value={formatDate(row.created_at)} />
            </div>

            <div className="referral-lifetime">
              <p>
                Mobile shows <strong>net after TDS</strong> only. Each new paid
                referral is <strong>added</strong> to this referrer’s previous paid
                total — it does not replace it.
              </p>
              <div className="detail-grid">
                <Field
                  label="LIFETIME PAID (NET)"
                  value={formatInr(paidLifetime)}
                />
                <Field
                  label={row.status === 'Paid' ? 'THIS CREDIT (INCLUDED)' : 'AFTER PAY (NET)'}
                  value={formatInr(afterPay)}
                />
              </div>
            </div>

            <div className="wd-audit-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="wd-approve"
                disabled={saving || row.status === 'Paid'}
                onClick={() => void onDecide('pay')}
              >
                Pay
              </button>
              <button
                type="button"
                className="wd-hold"
                disabled={saving || row.status === 'Pending'}
                onClick={() => void onDecide('hold')}
              >
                Hold
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
