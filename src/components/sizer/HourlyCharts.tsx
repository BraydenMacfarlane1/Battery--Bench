import { formatUsd } from "../../sizing/tariff";

const SAVINGS_COLORS = ["#0f766e", "#0e2a43", "#b45309", "#1d4e89"];

export function DispatchChart({
  label,
  series,
}: {
  label: string;
  series: { name: string; color: string; values: number[] }[];
}) {
  const width = 640;
  const height = 220;
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const flat = series.flatMap((entry) => entry.values);
  const maxKw = Math.max(1, ...flat);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (hour: number) => padL + (hour / 23) * plotW;
  const yAt = (kw: number) => padT + (1 - Math.max(0, kw) / maxKw) * plotH;
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <title>{label}</title>
        <line className="chart-axis" x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} />
        <line className="chart-axis" x1={padL} y1={padT} x2={padL} y2={padT + plotH} />
        {series.map((entry) => (
          <polyline
            key={entry.name}
            fill="none"
            stroke={entry.color}
            strokeWidth="2.2"
            points={entry.values.map((value, hour) => `${xAt(hour).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ")}
          />
        ))}
        <text className="chart-label" x={padL} y={height - 8}>
          0:00
        </text>
        <text className="chart-label" x={width - padR - 36} y={height - 8}>
          23:00
        </text>
        <text className="chart-label" x={4} y={padT + 8}>
          {Math.round(maxKw)} kW
        </text>
      </svg>
      <ul className="legend">
        {series.map((entry) => (
          <li key={entry.name}>
            <i style={{ background: entry.color }} />
            {entry.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SavingsChart({ series }: { series: { name: string; points: { kwh: number; savings: number }[] }[] }) {
  const width = 640;
  const height = 220;
  const padL = 56;
  const padR = 12;
  const padT = 16;
  const padB = 32;
  const points = series.flatMap((entry) => entry.points);
  if (points.length === 0) return null;
  const maxKwh = Math.max(...points.map((point) => point.kwh), 1);
  const maxSavings = Math.max(1, ...points.map((point) => point.savings));
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (kwh: number) => padL + (kwh / maxKwh) * plotW;
  const yAt = (savings: number) => padT + (1 - Math.max(0, savings) / maxSavings) * plotH;
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Annual savings versus battery size"
      data-testid="savings-chart"
    >
      <title>Annual savings versus usable kWh. A flattening line is diminishing returns.</title>
      <line className="chart-axis" x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} />
      <line className="chart-axis" x1={padL} y1={padT} x2={padL} y2={padT + plotH} />
      {series.map((entry, index) => (
        <polyline
          key={entry.name}
          fill="none"
          stroke={SAVINGS_COLORS[index % SAVINGS_COLORS.length]}
          strokeWidth="2.4"
          points={entry.points.map((point) => `${xAt(point.kwh).toFixed(1)},${yAt(point.savings).toFixed(1)}`).join(" ")}
        />
      ))}
      <text className="chart-label" x={padL} y={height - 8}>
        0
      </text>
      <text className="chart-label" x={width - padR - 48} y={height - 8}>
        {Math.round(maxKwh)} kWh
      </text>
      <text className="chart-label" x={4} y={padT + 8}>
        {formatUsd(maxSavings)}
      </text>
    </svg>
  );
}
