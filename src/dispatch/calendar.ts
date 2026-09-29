export const HOURS_PER_YEAR = 8760;
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export type HourStamp = {
  index: number;
  /** 1–12 */
  month: number;
  /** 0–11 */
  monthIndex: number;
  /** 1–31 */
  dayOfMonth: number;
  /** 0–23, hour beginning */
  hour: number;
  /** 0–364 */
  dayIndex: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  isWeekend: boolean;
};

export type MonthSpan = { start: number; end: number };

export function hourMask(on: (hour: number) => boolean): boolean[] {
  return Array.from({ length: 24 }, (_, hour) => on(hour));
}

export const ALL_HOURS: readonly boolean[] = hourMask(() => true);
export const NO_HOURS: readonly boolean[] = hourMask(() => false);

/** Hours in [startHour, endHour). 16 and 21 is 16:00–21:00. */
export function hoursBetween(startHour: number, endHour: number): boolean[] {
  return hourMask((hour) => hour >= startHour && hour < endHour);
}

export function monthSpans(): MonthSpan[] {
  const spans: MonthSpan[] = [];
  let cursor = 0;
  for (const days of DAYS_IN_MONTH) {
    const hours = days * 24;
    spans.push({ start: cursor, end: cursor + hours });
    cursor += hours;
  }
  return spans;
}

/** Non-leap year. Hour 0 is `startWeekday` at 00:00. Default start is Monday. */
export function buildCalendar(startWeekday = 1): HourStamp[] {
  if (!Number.isInteger(startWeekday) || startWeekday < 0 || startWeekday > 6) {
    throw new Error("start_weekday must be an integer from 0 (Sunday) through 6 (Saturday).");
  }
  const stamps: HourStamp[] = new Array(HOURS_PER_YEAR);
  let index = 0;
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const days = DAYS_IN_MONTH[monthIndex];
    for (let day = 0; day < days; day += 1) {
      const dayIndex = Math.floor(index / 24);
      const weekday = (startWeekday + dayIndex) % 7;
      for (let hour = 0; hour < 24; hour += 1) {
        stamps[index] = {
          index,
          month: monthIndex + 1,
          monthIndex,
          dayOfMonth: day + 1,
          hour,
          dayIndex,
          weekday,
          isWeekend: weekday === 0 || weekday === 6,
        };
        index += 1;
      }
    }
  }
  return stamps;
}

export function monthInSeason(month: number, startMonth: number, endMonth: number): boolean {
  if (startMonth <= endMonth) return month >= startMonth && month <= endMonth;
  return month >= startMonth || month <= endMonth;
}
