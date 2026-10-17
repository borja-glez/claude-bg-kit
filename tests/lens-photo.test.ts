import { describe, it, expect } from 'vitest';
import { clockText, keepPhoto, lensMode, photoId, photoText, PHOTOS_MAX } from '../src/lens/photo.js';

describe('the /lens photo (step 3 of §4.6)', () => {
  it('a line with the time and the photo number, which the row hook reads back', () => {
    const line = photoText(3, Date.parse('2026-10-16T12:00:00.000Z'), '3 tareas');
    expect(line).toMatch(/^lens · \d{2}:\d{2}:\d{2} #3 · 3 tareas$/);
    expect(clockText(Date.parse('2026-10-16T12:00:00.000Z'))).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(photoId(line)).toBe(3);
    for (const other of ['lens · 12:00 #3 · x', 'Progress panel opened.', '', undefined, 42]) expect(photoId(other), String(other)).toBeNull();
  });
  it('keeps the newest 20 photos (Review Focus 4)', () => {
    const photos = new Map<number, string>();
    for (let n = 1; n <= 25; n++) keepPhoto(photos, n, `shot ${n}`);
    expect(photos.size).toBe(PHOTOS_MAX);
    expect(photos.has(5)).toBe(false);
    expect(photos.get(25)).toBe('shot 25');
  });
  it('live or pane open the pane, foto or photo take the photo; bare, the photo outside fullscreen or under 110 columns', () => {
    expect(lensMode('live', { isFullscreen: false, columns: 80 })).toBe('pane');
    expect(lensMode(' Pane ', { isFullscreen: false, columns: 80 })).toBe('pane');
    expect(lensMode('foto', { isFullscreen: true, columns: 200 })).toBe('photo');
    expect(lensMode('photo', { isFullscreen: true, columns: 200 })).toBe('photo');
    expect(lensMode('', { isFullscreen: true, columns: 160 })).toBe('pane');
    expect(lensMode('', { isFullscreen: true, columns: 100 })).toBe('photo');
    expect(lensMode('', { isFullscreen: false, columns: 200 })).toBe('photo');
    expect(lensMode('what', undefined)).toBe('pane');
  });
});
