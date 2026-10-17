// F-11: durations as lens and the band say them. duration() «45s», «12m 05s», «2h 05m»; span() the same, null for a
// missing, endless or negative one and «>24h» past a day; minutesText() whole minutes as the band's task clock reads
// them, «45 m», «2 h», «9 h 58 m», and compact «45m», «2h», «9h58m». Shared by lens and waypoint's band.

export const duration = (seconds: number | null | undefined): string | null =>
  seconds === null || seconds === undefined ? null
    : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
      : `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`;

export const DAY_S = 86_400;
/** duration() for a span: null when missing, not finite or negative; «>24h» past a day. */
export function span(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  return seconds > DAY_S ? '>24h' : duration(Math.floor(seconds));
}

const MAX_MINUTES = 99_999 * 1440;

/**
 * Whole minutes as the band's task clock says them: «45 m», «2 h», «9 h 58 m»; compact «45m», «2h», «9h58m». From 99 999
 * days up it prints that cap with a «+» (never an exponent); a negative or non-finite value is «0 m».
 */
export function minutesText(minutes: number, compact = false): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  const capped = total >= MAX_MINUTES;
  const n = capped ? MAX_MINUTES : total;
  const plus = capped ? '+' : '';
  if (n < 60) return compact ? `${n}m` : `${n} m`;
  const hours = Math.floor(n / 60);
  const rest = n % 60;
  if (compact) return `${rest ? `${hours}h${rest}m` : `${hours}h`}${plus}`;
  return `${rest ? `${hours} h ${rest} m` : `${hours} h`}${plus}`;
}
