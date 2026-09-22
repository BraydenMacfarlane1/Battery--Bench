import type { IntervalPoint } from "../sizing/types";

/** Worked example B — broad warehouse plateau. Illustrative shape, not a meter file. */
export const exampleBTargetKw = 280;
export const exampleBPeakKw = 350;

export const exampleBPoints: IntervalPoint[] = [
  { ts: "2026-07-15T13:00:00-06:00", kw: 320 },
  { ts: "2026-07-15T13:15:00-06:00", kw: 330 },
  { ts: "2026-07-15T13:30:00-06:00", kw: 340 },
  { ts: "2026-07-15T13:45:00-06:00", kw: 345 },
  { ts: "2026-07-15T14:00:00-06:00", kw: 350 },
  { ts: "2026-07-15T14:15:00-06:00", kw: 348 },
  { ts: "2026-07-15T14:30:00-06:00", kw: 342 },
  { ts: "2026-07-15T14:45:00-06:00", kw: 335 },
  { ts: "2026-07-15T15:00:00-06:00", kw: 320 },
  { ts: "2026-07-15T15:15:00-06:00", kw: 300 },
];
