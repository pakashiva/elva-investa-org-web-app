import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { TdsQuarterSlice } from '../types/admin';
import { formatCompactInr } from '../utils/format';

const COLORS = ['#0E1B36', '#5B8FB9', '#7DCAA5', '#E4C35A'];

type Props = {
  slices: TdsQuarterSlice[];
  fyTotal: number;
  fyShort: string;
};

export function TdsQuarterChart({ slices, fyTotal, fyShort }: Props) {
  const hasValues = slices.some((slice) => slice.amount > 0);

  return (
    <section className="card tds-chart-card">
      <h2>TDS Distribution by Quarter</h2>
      {hasValues ? (
        <>
          <div className="tds-donut-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="amount"
                  nameKey="label"
                  innerRadius={68}
                  outerRadius={96}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {slices.map((slice) => (
                    <Cell
                      key={slice.quarter}
                      fill={COLORS[(slice.quarter - 1) % COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="tds-donut-center">
              <strong>{formatCompactInr(fyTotal)}</strong>
              <span>{fyShort}</span>
            </div>
          </div>
          <ul className="tds-legend">
            {slices.map((slice) => {
              const share = fyTotal > 0 ? (slice.amount / fyTotal) * 100 : 0;
              const label = slice.isCurrent ? `${slice.label} (YTD)` : slice.label;
              return (
                <li key={slice.quarter}>
                  <i style={{ background: COLORS[(slice.quarter - 1) % COLORS.length] }} />
                  <span>{label}</span>
                  <strong>
                    {share.toFixed(1)}% ({formatCompactInr(slice.amount)})
                  </strong>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="state-box">No TDS recorded in {fyShort || 'this financial year'}.</p>
      )}
    </section>
  );
}
