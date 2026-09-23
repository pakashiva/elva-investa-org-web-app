import { Link } from 'react-router-dom';

type Props = {
  pendingInvestments: number;
  pendingWithdrawals: number;
};

export function PendingActions({ pendingInvestments, pendingWithdrawals }: Props) {
  return (
    <section className="pending-section" id="pending-operations">
      <h2>Pending Operations Actions</h2>
      <div className="pending-grid">
        <article className="card pending-card">
          <div className="pending-badge gold">{pendingInvestments}</div>
          <div>
            <h3>Investment Requests</h3>
            <p>Awaiting calculation and plan signoff</p>
          </div>
          <Link className="review-link" to="/investment-requests">
            Review
          </Link>
        </article>
        <article className="card pending-card">
          <div className="pending-badge gray">{pendingWithdrawals}</div>
          <div>
            <h3>Withdrawal Requests</h3>
            <p>Escalated for immediate payout review</p>
          </div>
          <Link className="review-link" to="/withdrawals">
            Review
          </Link>
        </article>
      </div>
    </section>
  );
}
