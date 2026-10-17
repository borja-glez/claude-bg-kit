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

/** Whole minutes as the band's task clock says them: «45 m», «2 h», «9 h 58 m»; compact «45m», «2h», «9h58m». */
export function minutesText(minutes: number, compact = false): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  if (total < 60) return compact ? `${total}m` : `${total} m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (compact) return rest ? `${hours}h${rest}m` : `${hours}h`;
  return rest ? `${hours} h ${rest} m` : `${hours} h`;
}
