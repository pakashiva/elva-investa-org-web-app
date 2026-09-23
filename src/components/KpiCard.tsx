import { Link } from 'react-router-dom';

type KpiCardProps = {
  label: string;
  value: string;
  subtext: string;
  highlight?: boolean;
  to?: string;
};

export function KpiCard({ label, value, subtext, highlight, to }: KpiCardProps) {
  const className = `card kpi-card${highlight ? ' highlight' : ''}${to ? ' clickable' : ''}`;

  const body = (
    <>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      <p className="kpi-sub">{subtext}</p>
    </>
  );

  if (to) {
    return (
      <Link className={className} to={to}>
        {body}
      </Link>
    );
  }

  return <article className={className}>{body}</article>;
}

export function KpiSkeleton() {
  return (
    <article className="card kpi-card">
      <p className="kpi-label">Loading</p>
      <p className="kpi-value">—</p>
      <p className="kpi-sub">Fetching live data</p>
    </article>
  );
}
