export type MonthlyCsvRow = {
  startDate: string;
  peakKw: number;
  totalKwh: number | null;
};

export type IntervalCsvPoint = {
  ts: string;
  kw: number;
};

export type CsvLoad =
  | { kind: "monthly"; rows: MonthlyCsvRow[] }
  | { kind: "interval"; points: IntervalCsvPoint[]; intervalMinutes: number | null };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], names: string[]): number {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  for (const name of names) {
    const index = normalized.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function asNumber(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} is not a number (${value || "blank"}).`);
  return number;
}

export function parseMonthlyCsv(text: string): MonthlyCsvRow[] {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("Monthly CSV needs a header and at least one row.");
  const headers = table[0];
  const peakIndex = headerIndex(headers, ["peak_demand_kw", "peak_kw", "peak", "kw", "demand_kw"]);
  if (peakIndex < 0) throw new Error("Monthly CSV needs a peak_demand_kw column.");
  const dateIndex = headerIndex(headers, ["start_date", "date", "month"]);
  const kwhIndex = headerIndex(headers, ["total_kwh", "kwh"]);
  return table.slice(1).map((cells, index) => {
    const peakKw = asNumber(cells[peakIndex] ?? "", `Row ${index + 2} peak`);
    if (peakKw < 0) throw new Error(`Row ${index + 2} peak must be zero or positive.`);
    const totalRaw = kwhIndex >= 0 ? cells[kwhIndex] : "";
    return {
      startDate: dateIndex >= 0 ? (cells[dateIndex] ?? "") : "",
      peakKw,
      totalKwh: totalRaw ? asNumber(totalRaw, `Row ${index + 2} kWh`) : null,
    };
  });
}

export function parseIntervalCsv(text: string): { points: IntervalCsvPoint[]; intervalMinutes: number | null } {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("Interval CSV needs a header and at least one row.");
  const headers = table[0];
  const kwIndex = headerIndex(headers, ["kw", "demand_kw", "peak_kw", "kW".toLowerCase()]);
  const tsIndex = headerIndex(headers, ["ts", "timestamp", "time", "datetime", "date"]);
  if (kwIndex < 0) throw new Error("Interval CSV needs a kw column.");
  const points = table.slice(1).map((cells, index) => {
    const kw = asNumber(cells[kwIndex] ?? "", `Row ${index + 2} kW`);
    if (kw < 0) throw new Error(`Row ${index + 2} kW must be zero or positive.`);
    return {
      ts: tsIndex >= 0 ? (cells[tsIndex] ?? "") : "",
      kw,
    };
  });
  return { points, intervalMinutes: inferIntervalMinutes(points) };
}

export function inferIntervalMinutes(points: { ts: string }[]): number | null {
  const deltas: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const previous = Date.parse(points[i - 1].ts);
    const current = Date.parse(points[i].ts);
    if (Number.isFinite(previous) && Number.isFinite(current) && current > previous) {
      deltas.push((current - previous) / 60000);
    }
  }
  if (deltas.length === 0) return null;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  const known = [1, 5, 15, 30, 60];
  return known.find((step) => Math.abs(step - median) < 0.2) ?? Math.round(median);
}

export function loadCsv(text: string): CsvLoad {
  const table = parseCsv(text);
  if (table.length === 0) throw new Error("CSV is empty.");
  const headers = table[0].map((header) => header.trim().toLowerCase());
  const hasTime = headers.some((header) => ["ts", "timestamp", "time", "datetime"].includes(header));
  const hasMonthly = headers.some((header) =>
    ["peak_demand_kw", "peak_kw", "peak", "total_kwh"].includes(header),
  );
  if (hasTime && !headers.includes("peak_demand_kw")) {
    const interval = parseIntervalCsv(text);
    return { kind: "interval", ...interval };
  }
  if (hasMonthly || headers.includes("peak")) {
    return { kind: "monthly", rows: parseMonthlyCsv(text) };
  }
  throw new Error("Unrecognized CSV. Use peak_demand_kw for monthly bills, or ts,kw for 15-minute intervals.");
}
