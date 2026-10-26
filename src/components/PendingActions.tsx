import { Link } from 'react-router-dom';

type Props = {
  pendingInvestments: number;
  pendingWithdrawals: number;
  pendingBorrowing?: number;
  allWorkspace?: boolean;
};

export function PendingActions({ pendingInvestments, pendingWithdrawals, pendingBorrowing = 0, allWorkspace = false }: Props) {
  const suffix = allWorkspace ? '?workspace=all' : '';
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
          <Link className="review-link" to={`/investment-requests${suffix}`}>
            Review
          </Link>
        </article>
        <article className="card pending-card">
          <div className="pending-badge gray">{pendingWithdrawals}</div>
          <div>
            <h3>Withdrawal Requests</h3>
            <p>Escalated for immediate payout review</p>
          </div>
          <Link className="review-link" to={`/withdrawals${suffix}`}>
            Review
          </Link>
        </article>
        {pendingBorrowing > 0 ? <article className="card pending-card">
          <div className="pending-badge gray">{pendingBorrowing}</div>
          <div><h3>Borrowing Requests</h3><p>Loan applications awaiting review</p></div>
          <Link className="review-link" to={`/borrowing/loans${suffix}`}>Review</Link>
        </article> : null}
      </div>
    </section>
  );
}
