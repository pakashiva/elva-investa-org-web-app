import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FlowPoint } from '../types/admin';
import { toLakhs } from '../utils/format';

export function FlowChart({ points }: { points: FlowPoint[] }) {
  const data = points.map((point) => ({
    ...point,
    inflowL: toLakhs(point.inflow),
    outflowL: toLakhs(point.outflow),
  }));
  const hasValues = data.some((point) => point.inflow > 0 || point.outflow > 0);

  return (
    <section className="card chart-card">
      <div className="chart-head">
        <div>
          <h2>Inflow vs Outflow</h2>
          <p>Monthly transaction comparison (in Lakhs)</p>
        </div>
        <div className="legend">
          <span>
            <i style={{ background: '#0E1B36' }} /> Inflow
          </span>
          <span>
            <i style={{ background: '#E24B4B' }} /> Outflow
          </span>
        </div>
      </div>
      {hasValues ? (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} barGap={4}>
            <CartesianGrid stroke="#EEF1F5" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <Tooltip
              formatter={(value, name) => [
                `₹${Number(value ?? 0).toFixed(2)} L`,
                name === 'inflowL' ? 'Inflow' : 'Outflow',
              ]}
            />
            <Legend formatter={(value) => (value === 'inflowL' ? 'Inflow' : 'Outflow')} />
            <Bar dataKey="inflowL" fill="#0E1B36" radius={[4, 4, 0, 0]} />
            <Bar dataKey="outflowL" fill="#E24B4B" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="state-box">No inflow or outflow recorded in this range.</p>
      )}
    </section>
  );
}
