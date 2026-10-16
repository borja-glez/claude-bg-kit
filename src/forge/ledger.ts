import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveStatus, normalizeStatus, type ForgeStatus } from '../lib/forge-status.js';

export const LEDGER_KINDS = ['triage', 'phase', 'agent', 'validate', 'verdict', 'round', 'ruling', 'cycle', 'proposal', 'verify', 'verify-skip', 'decision'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export interface LedgerEvent { ts: string; kind: LedgerKind; task?: string; [key: string]: unknown }

const GITIGNORE = '*\n!.gitignore\n!config.yaml\n!verify/\n!verify/*.md\n';
// What forge 0.5.x wrote; upgraded in place so surfaces reach git. Any other content is the user's and stays.
const GITIGNORE_05 = '*\n!.gitignore\n!config.yaml\n';

const forgePath = (root: string) => path.join(root, '.forge');
const ledgerFile = (root: string) => path.join(forgePath(root), 'ledger.jsonl');
export const statusFile = (root: string) => path.join(forgePath(root), 'status.json');

export function forgeDir(root: string): string {
  const dir = forgePath(root);
  mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, GITIGNORE);
  else {
    try { if (readFileSync(ignore, 'utf8').replace(/\r\n/g, '\n') === GITIGNORE_05) writeFileSync(ignore, GITIGNORE); } catch { /* leave it */ }
  }
  return dir;
}

// True when the file is non-empty and its last byte is not a newline. Reads only that byte.
export function endsMidLine(file: string): boolean {
  if (!existsSync(file)) return false;
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (!size) return false;
    const buf = Buffer.alloc(1);
    return readSync(fd, buf, 0, 1, size - 1) === 1 && buf[0] !== 0x0a;
  } finally { closeSync(fd); }
}

export function appendEvent(root: string, event: LedgerEvent): void {
  forgeDir(root);
  const file = ledgerFile(root);
  // A line left half-written by a crash must not swallow the next event.
  appendFileSync(file, (endsMidLine(file) ? '\n' : '') + JSON.stringify(event) + '\n');
  updateStatus(root, event);
}

/** Appends a phase event unless the task's last phase event already names that phase for the same brief (C4: a stage
 *  is logged once, whether review-prep or `swarm task`, which names no brief, logs it first). Returns whether it appended. */
export function appendPhase(root: string, event: LedgerEvent & { task: string; phase: string }): boolean {
  const last = readEvents(root).filter(e => e.kind === 'phase' && e.task === event.task).at(-1);
  if (last && last.phase === event.phase && (last.brief === undefined || event.brief === undefined || last.brief === event.brief)) return false;
  appendEvent(root, event);
  return true;
}

// .forge/status.json follows the ledger one event at a time, so readers (lens) never read the whole ledger.
// A missing or corrupt status starts over from this event; any failure here leaves the append done.
function updateStatus(root: string, event: LedgerEvent): void {
  try {
    const file = statusFile(root);
    let prev: ForgeStatus | null = null;
    try { prev = normalizeStatus(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* none yet, or corrupt */ }
    const next = deriveStatus(prev, event);
    if (!next || next === prev) return;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next) + '\n');
    renameSync(tmp, file);
  } catch { /* the ledger is the record; the status is a convenience */ }
}

export function readStatus(root: string): ForgeStatus | null {
  try { return normalizeStatus(JSON.parse(readFileSync(statusFile(root), 'utf8'))); } catch { return null; }
}

export function readEvents(root: string): LedgerEvent[] {
  const file = ledgerFile(root);
  if (!existsSync(file)) return [];
  const out: LedgerEvent[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && typeof e.ts === 'string' && (LEDGER_KINDS as readonly string[]).includes(e.kind)
        && (e.task === undefined || typeof e.task === 'string')) out.push(e);
    } catch { /* a half-written line */ }
  }
  return out;
}
