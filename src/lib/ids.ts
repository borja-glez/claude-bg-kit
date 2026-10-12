const BAD = /[^A-Za-z0-9_\-.~:@+]+/g;

export function sessionIdFrom(name: string): string {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(BAD, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'main';
}

export function compactTs(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('.', '');
}

export function eventId(d: Date, sessionId: string, rand: () => number = Math.random): string {
  const r = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0');
  return `${compactTs(d)}-${sessionId}-${r}`;
}
