type IntervalPoint = { kw: number; ts?: string };

type ExcessPoint = { x: number; y: number };

function excessPaths(
  points: IntervalPoint[],
  targetKw: number,
  xAt: (index: number) => number,
  yAt: (kw: number) => number,
): string[] {
  const paths: string[] = [];
  let current: ExcessPoint[] = [];

  const flush = () => {
    if (current.length >= 2) {
      const top = current
        .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(" ");
      const back = [...current]
        .reverse()
        .map((point) => `L${point.x.toFixed(1)} ${yAt(targetKw).toFixed(1)}`)
        .join(" ");
      paths.push(`${top} ${back} Z`);
    }
    current = [];
  };

  for (let index = 0; index < points.length; index++) {
    const kw = points[index].kw;
    const previous = index > 0 ? points[index - 1].kw : null;
    if (kw >= targetKw) {
      if (previous != null && previous < targetKw && kw !== previous) {
        const t = (targetKw - previous) / (kw - previous);
        current.push({
          x: xAt(index - 1) + t * (xAt(index) - xAt(index - 1)),
          y: yAt(targetKw),
        });
      }
      current.push({ x: xAt(index), y: yAt(kw) });
    } else if (previous != null && previous >= targetKw) {
      if (kw !== previous) {
        const t = (targetKw - previous) / (kw - previous);
        current.push({
          x: xAt(index - 1) + t * (xAt(index) - xAt(index - 1)),
          y: yAt(targetKw),
        });
      }
      flush();
    }
  }
  flush();
  return paths;
}

export function IntervalChart({ points, targetKw }: { points: IntervalPoint[]; targetKw: number }) {
  if (points.length === 0) return null;
  const width = 640;
  const height = 210;
  const padL = 46;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const minKw = Math.min(targetKw, ...points.map((point) => point.kw));
  const maxKw = Math.max(targetKw, ...points.map((point) => point.kw));
  const span = Math.max(8, maxKw - minKw);
  const y0 = Math.max(0, minKw - span * 0.35);
  const y1 = maxKw + span * 0.28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (index: number) =>
    padL + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const yAt = (kw: number) => padT + (1 - (kw - y0) / (y1 - y0)) * plotH;
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)} ${yAt(point.kw).toFixed(1)}`)
    .join(" ");
  const areas = excessPaths(points, targetKw, xAt, yAt);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Load above the peak-shave target">
      <title>Load versus target. Shaded area is excess kilowatts.</title>
      <line className="chart-axis" x1={padL} y1={yAt(y0)} x2={padL} y2={yAt(y1)} />
      <line className="chart-target" x1={padL} y1={yAt(targetKw)} x2={width - padR} y2={yAt(targetKw)} />
      <text className="chart-label" x={padL + 6} y={yAt(targetKw) - 6}>
        Target {targetKw} kW
      </text>
      {areas.map((path) => (
        <path key={path} className="chart-excess" d={path} />
      ))}
      <path className="chart-load" d={line} />
      <text className="chart-label" x={4} y={yAt(y1) + 4}>
        {Math.round(y1)}
      </text>
      <text className="chart-label" x={4} y={yAt(y0)}>
        {Math.round(y0)}
      </text>
    </svg>
  );
}

export function MonthlyChart({
  months,
  targetKw,
}: {
  months: { label: string; peakKw: number }[];
  targetKw: number;
}) {
  if (months.length === 0) return null;
  const width = 640;
  const height = 200;
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 32;
  const maxKw = Math.max(targetKw, ...months.map((month) => month.peakKw), 1) * 1.12;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const gap = 14;
  const barW = Math.min(72, (plotW - gap * (months.length - 1)) / months.length);
  const yAt = (kw: number) => padT + (1 - kw / maxKw) * plotH;

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly peaks versus target">
      <title>Monthly billing peaks versus the shave target.</title>
      <line className="chart-target" x1={padL} y1={yAt(targetKw)} x2={width - padR} y2={yAt(targetKw)} />
      <text className="chart-label" x={padL + 6} y={Math.max(14, yAt(targetKw) - 6)}>
        Target {targetKw} kW
      </text>
      {months.map((month, index) => {
        const x = padL + index * (barW + gap);
        const y = yAt(month.peakKw);
        const h = yAt(0) - y;
        return (
          <g key={`${month.label}-${index}`}>
            <rect className="chart-bar" x={x} y={y} width={barW} height={Math.max(0, h)} rx={3} />
            <text className="chart-label" x={x + barW / 2} y={height - 10} textAnchor="middle">
              {month.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
