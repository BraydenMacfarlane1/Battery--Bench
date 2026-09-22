/** Decimal round that stays stable for the Schedule 6 fixture values. */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor + Number.EPSILON) / factor;
}
