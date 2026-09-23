import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WealthPoint } from '../types/admin';
import { toCrores } from '../utils/format';

type Props = {
  points: WealthPoint[];
  months: 3 | 6 | 12;
  onMonthsChange: (months: 3 | 6 | 12) => void;
};

export function WealthChart({ points, months, onMonthsChange }: Props) {
  const data = points.map((point) => ({
    ...point,
    wealthCr: toCrores(point.wealth),
  }));
  const hasValues = data.some((point) => point.wealth > 0);

  return (
    <section className="card chart-card">
      <div className="chart-head">
        <div>
          <h2>Wealth Managed Over Time</h2>
          <p>Active asset under custody growth (in Cr.)</p>
        </div>
        <select
          className="select"
          value={months}
          onChange={(event) => onMonthsChange(Number(event.target.value) as 3 | 6 | 12)}
        >
          <option value={3}>3 Months</option>
          <option value={6}>6 Months</option>
          <option value={12}>12 Months</option>
        </select>
      </div>
      {hasValues ? (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data}>
            <CartesianGrid stroke="#EEF1F5" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <Tooltip
              formatter={(value) => [
                `₹${Number(value ?? 0).toFixed(2)} Cr`,
                'Wealth',
              ]}
            />
            <Line
              type="monotone"
              dataKey="wealthCr"
              stroke="#1463C6"
              strokeWidth={3}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="state-box">No historical wealth data yet.</p>
      )}
    </section>
  );
}
