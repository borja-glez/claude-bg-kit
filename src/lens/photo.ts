// Steps 2 and 3 of §4.6: `/lens` as a photo in the transcript. The command answers one line with a stamp, «lens ·
// 14:02:11 #3 · 3 tareas»: the number names the photo in lens's memory, the time is for the person. The CommandOutput
// hook finds the photo by its number and draws its cards, still. Pure: register.tsx keeps the map.
import { DOCK_MIN_COLUMNS } from './layout.js';

/** At most this many photos are kept; an older one's row goes back to the engine's line. */
export const PHOTOS_MAX = 20;
const STAMP = /^lens · \d{2}:\d{2}:\d{2} #(\d{1,6}) · /;

/** HH:MM:SS of `nowMs`, in local time. */
export function clockText(nowMs: number): string {
  const d = new Date(nowMs);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

/** The one line `/lens` answers for photo `n`. */
export function photoText(n: number, nowMs: number, summary: string): string {
  return `lens · ${clockText(nowMs)} #${n} · ${summary}`;
}

/** The number of the photo a CommandOutput line names, or null for a line this module did not write. */
export function photoId(text: unknown): number | null {
  const m = typeof text === 'string' ? STAMP.exec(text) : null;
  return m ? Number(m[1]) : null;
}

/** Keeps photo `n`; past PHOTOS_MAX the oldest goes. */
export function keepPhoto<T>(photos: Map<number, T>, n: number, shot: T): void {
  photos.set(n, shot);
  while (photos.size > PHOTOS_MAX) {
    const oldest = photos.keys().next();
    if (oldest.done) break;
    photos.delete(oldest.value);
  }
}

/**
 * What `/lens` does: live or pane open the pane, foto or photo take the photo; bare (or anything else), the photo where
 * the pane would not dock (outside fullscreen, or under 110 columns: inline it would take the band's room, F-01).
 */
export function lensMode(args: unknown, presentation?: { isFullscreen?: boolean; columns?: number } | null): 'pane' | 'photo' {
  const a = String(args ?? '').trim().toLowerCase();
  if (a === 'live' || a === 'pane') return 'pane';
  if (a === 'foto' || a === 'photo') return 'photo';
  const columns = Number(presentation?.columns);
  const docks = presentation?.isFullscreen !== false && (Number.isFinite(columns) && columns > 0 ? columns : DOCK_MIN_COLUMNS) >= DOCK_MIN_COLUMNS;
  return docks ? 'pane' : 'photo';
}
