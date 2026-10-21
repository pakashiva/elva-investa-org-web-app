import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ErrorBanner } from '../components/States';
import type { AdminOutletContext } from '../layouts/AdminLayout';
import { downloadCollectionsReport, downloadLoanReport } from '../services/borrowingService';

export function BorrowingReportsPage() {
  const { onOpenMenu } = useOutletContext<AdminOutletContext>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'loans' | 'collections' | null>(null);

  async function download(kind: 'loans' | 'collections') {
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'loans' ? downloadLoanReport() : downloadCollectionsReport());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export the borrowing report.');
    } finally {
      setBusy(null);
    }
  }

  return <>
    <AppHeader title="Borrowing Reports" subtitle="Export loan book and collections data." onOpenMenu={onOpenMenu} />
    {error ? <ErrorBanner message={error} /> : null}
    <section className="report-grid">
      <article className="card report-card">
        <div className="report-card-icon"><FileDown size={18} /></div>
        <h3>Loan book</h3>
        <p>Download borrower, loan, balance, status, and repayment term details as a CSV file.</p>
        <button className="ghost-btn report-generate" disabled={busy !== null} onClick={() => void download('loans')}>
          {busy === 'loans' ? 'Preparing…' : 'Download CSV'}
        </button>
      </article>
      <article className="card report-card">
        <div className="report-card-icon"><FileDown size={18} /></div>
        <h3>Collections</h3>
        <p>Download scheduled dues and collection status for your borrowing portfolio.</p>
        <button className="ghost-btn report-generate" disabled={busy !== null} onClick={() => void download('collections')}>
          {busy === 'collections' ? 'Preparing…' : 'Download CSV'}
        </button>
      </article>
    </section>
  </>;
}
