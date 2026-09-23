import { Check, X } from 'lucide-react';
import type { InvestmentDecision } from '../types/admin';
import { displayRequestId, formatInr } from '../utils/format';

type Props = {
  action: InvestmentDecision;
  requestId: string | null;
  amount: number;
  onClose: () => void;
  subject?: 'investment' | 'withdrawal' | 'renewal';
};

const COPY: Record<
  'investment' | 'withdrawal' | 'renewal',
  Record<InvestmentDecision, { title: string; tone: 'approve' | 'reject' | 'hold' }>
> = {
  investment: {
    approve: { title: 'Investment Approved!', tone: 'approve' },
    reject: { title: 'Investment Rejected!', tone: 'reject' },
    hold: { title: 'Investment On Hold', tone: 'hold' },
  },
  withdrawal: {
    approve: { title: 'Withdrawal Approved!', tone: 'approve' },
    reject: { title: 'Withdrawal Rejected!', tone: 'reject' },
    hold: { title: 'Withdrawal On Hold', tone: 'hold' },
  },
  renewal: {
    approve: { title: 'Renewal Approved!', tone: 'approve' },
    reject: { title: 'Renewal Rejected!', tone: 'reject' },
    hold: { title: 'Renewal On Hold', tone: 'hold' },
  },
};

export function DecisionResultModal({
  action,
  requestId,
  amount,
  onClose,
  subject = 'investment',
}: Props) {
  const copy = COPY[subject][action];
  const idLabel = displayRequestId(requestId);
  const money = formatInr(amount);
  const body =
    subject === 'withdrawal'
      ? action === 'approve'
        ? `The withdrawal request for ${idLabel} of ${money} has been successfully approved. The customer will be notified via email and SMS.`
        : action === 'reject'
          ? `The withdrawal request for ${idLabel} of ${money} has been rejected. The customer will be notified via email and SMS.`
          : `The withdrawal request for ${idLabel} of ${money} has been placed on hold for further review.`
      : subject === 'renewal'
        ? action === 'approve'
          ? `The agreement renewal ${idLabel} for ${money} has been approved. A new 365-day term starts today.`
          : action === 'reject'
            ? `The agreement renewal ${idLabel} for ${money} has been rejected. The customer will be notified.`
            : `The agreement renewal ${idLabel} for ${money} is on hold.`
        : action === 'approve'
          ? `The investment request ${idLabel} for ${money} has been successfully approved. The customer will be notified via email and SMS.`
          : action === 'reject'
            ? `The investment request ${idLabel} for ${money} has been rejected. The customer will be notified via email and SMS.`
            : `The investment request ${idLabel} for ${money} has been placed on hold for further review.`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="decision-modal" onClick={(event) => event.stopPropagation()}>
        <div className={`decision-icon ${copy.tone}`}>
          {action === 'reject' ? <X size={28} /> : <Check size={28} />}
        </div>
        <h2>{copy.title}</h2>
        <p>{body}</p>
        <button type="button" className="gold-btn" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}
