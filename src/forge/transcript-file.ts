// A6: the one safe way forge reads a Claude Code JSONL file (a transcript): measured first, then read in chunks.
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

export interface Measured { file: string; bytes: number }
export interface ScanStats { bytes: number; lines: number; long: number[]; longCount: number; truncated: boolean }
export interface ScanOpts { maxBytes?: number; maxLine?: number; chunk?: number }

export const SCAN_MAX_BYTES = 512 * 1024 * 1024;
export const LINE_MAX_BYTES = 2 * 1024 * 1024;
export const SCAN_CHUNK = 64 * 1024;
/** How many skipped line numbers ScanStats.long keeps. */
const LONG_KEPT = 50;

/** An absolute path ending in .jsonl that is a regular file (statSync().isFile(): never a pipe or a device), with its size; null otherwise or when it cannot be read. */
export function measureJsonl(file: unknown): Measured | null {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('.jsonl')) return null;
  try {
    const st = statSync(file);
    return st.isFile() ? { file, bytes: st.size } : null;
  } catch { return null; }
}

/** The last `max` bytes of the file, decoded as UTF-8 (its first line may be cut), or null when it cannot be read. */
export function readTail(file: string, max: number): string | null {
  try {
    const fd = openSync(file, 'r');
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, max);
      const buf = Buffer.alloc(len);
      let off = 0;
      while (off < len) {
        const n = readSync(fd, buf, off, len - off, size - len + off);
        if (n <= 0) break;
        off += n;
      }
      return buf.subarray(0, off).toString('utf8');
    } finally { closeSync(fd); }
  } catch { return null; }
}

/** Each line of a measured .jsonl in order, with its 1-based number; null when measureJsonl refuses the file. */
export function scanLines(file: string, onLine: (line: string, n: number) => void, opts: ScanOpts = {}): ScanStats | null {
  const m = measureJsonl(file);
  if (!m) return null;
  const maxBytes = opts.maxBytes ?? SCAN_MAX_BYTES;
  const maxLine = opts.maxLine ?? LINE_MAX_BYTES;
  const chunk = Math.max(1, opts.chunk ?? SCAN_CHUNK);
  const stats: ScanStats = { bytes: 0, lines: 0, long: [], longCount: 0, truncated: false };
  let parts: Buffer[] = [];
  let partLen = 0;
  let skipping = false;

  const close = (): void => {
    stats.lines++;
    if (skipping) {
      stats.longCount++;
      if (stats.long.length < LONG_KEPT) stats.long.push(stats.lines);
    } else {
      let text = Buffer.concat(parts, partLen).toString('utf8');
      if (text.endsWith('\r')) text = text.slice(0, -1);
      onLine(text, stats.lines);
    }
    parts = [];
    partLen = 0;
    skipping = false;
  };
  const add = (b: Buffer): void => {
    if (skipping) return;
    parts.push(b);
    partLen += b.length;
    if (partLen > maxLine) { skipping = true; parts = []; partLen = 0; }
  };

  try {
    const fd = openSync(m.file, 'r');
    try {
      const buf = Buffer.alloc(chunk);
      while (stats.bytes < maxBytes) {
        const n = readSync(fd, buf, 0, Math.min(chunk, maxBytes - stats.bytes), null);
        if (n <= 0) break;
        stats.bytes += n;
        let from = 0;
        for (let nl = buf.indexOf(10, from); nl >= 0 && nl < n; nl = buf.indexOf(10, from)) {
          add(Buffer.from(buf.subarray(from, nl)));
          close();
          from = nl + 1;
        }
        if (from < n) add(Buffer.from(buf.subarray(from, n)));
      }
      if (stats.bytes >= maxBytes) {
        // The cap: whatever is left of the file is not read, and the line it cut is not passed.
        stats.truncated = readSync(fd, Buffer.alloc(1), 0, 1, null) > 0;
        if (stats.truncated) return stats;
      }
      if (skipping || partLen > 0) close();
    } finally { closeSync(fd); }
  } catch { return null; }
  return stats;
}
