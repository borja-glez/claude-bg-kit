// K2-11: what a run's verifications learned, by surface: the learned notes (as surfaces learn filters them) and the
// proposals to change a surface, from every verify.json its tasks and its flow passes wrote since the run started. The
// coordinator shows it once at the end of the run, or leaves it in one question note. The text comes from agents that
// read untrusted pages: it goes through the same filters as a learned note, is bounded, and what is dropped is only counted.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { filterNotes } from './surfaces.js';
import { parseVerifyFile } from './verdict.js';

export interface DigestSurface {
  name: string; learned: { note: string; tasks: string[] }[]; proposals: { change: string; tasks: string[] }[];
  /** Only when items went past ITEMS_MAX: how many were left out. */
  more?: { learned: number; proposals: number };
}

/** At most this many notes and this many proposals per surface, and this many verify files read per digest. */
export const ITEMS_MAX = 20;
export const ENTRIES_MAX = 200;

/** The verify.json files of a work folder (its own, and those of its reviews-<n>-<k>/ folders) written at `since` or later. */
export function verifyFilesOf(dir: string, since: number): string[] {
  let rounds: string[] = [];
  try { rounds = readdirSync(dir).filter(n => /^reviews-\d+-\d+$/.test(n)).sort().map(n => path.join(dir, n, 'verify.json')); } catch { rounds = []; }
  return [path.join(dir, 'verify.json'), ...rounds].filter(f => { try { return statSync(f).mtimeMs >= since; } catch { return false; } });
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * By surface name, each note and proposal once with the tasks (or passes) that wrote it. A note or proposal surfaces
 * learn would refuse (too long, a secret, an instruction, naming the task or a work path) is left out and counted in
 * `dropped`, never echoed; so is one a surface already holds (`existing(name)`: its learned notes), without counting.
 * `entries`: the text of a verify.json and the task or pass it is of; past ENTRIES_MAX the rest is counted in `unread`.
 */
export function digest(entries: { task: string; text: string }[], existing: (surface: string) => string[] = () => []):
  { surfaces: DigestSurface[]; dropped: number; unread: number } {
  const by = new Map<string, DigestSurface>();
  const have = new Map<string, Set<string>>();
  const over = new Map<string, { learned: number; proposals: number }>();
  let dropped = 0;
  const of = (name: string): DigestSurface => {
    let s = by.get(name);
    if (!s) { s = { name, learned: [], proposals: [] }; by.set(name, s); have.set(name, new Set(existing(name).map(norm))); }
    return s;
  };
  const add = <T extends { tasks: string[] }>(surface: string, kind: 'learned' | 'proposals', list: T[], key: (x: T) => string, item: T, task: string) => {
    const same = list.find(x => norm(key(x)) === norm(key(item)));
    if (same) { if (!same.tasks.includes(task)) same.tasks.push(task); return; }
    if (list.length >= ITEMS_MAX) { const o = over.get(surface) ?? { learned: 0, proposals: 0 }; o[kind]++; over.set(surface, o); return; }
    list.push(item);
  };
  const clean = (text: string, task: string): string | null => {
    const { keep, skipped } = filterNotes([text], [], task);
    if (skipped.length) dropped++;
    return keep[0] ?? null;
  };
  for (const { task, text } of entries.slice(0, ENTRIES_MAX)) {
    const v = parseVerifyFile(text);
    if (!v) continue;
    for (const l of v.learned) {
      const note = clean(l.note, task);
      const surface = of(l.surface || 'app');
      if (note && !have.get(surface.name)?.has(norm(note))) add(surface.name, 'learned', surface.learned, x => x.note, { note, tasks: [task] }, task);
    }
    for (const p of v.proposals) {
      const change = clean(p.change, task);
      if (change) { const surface = of(p.surface || 'app'); add(surface.name, 'proposals', surface.proposals, x => x.change, { change, tasks: [task] }, task); }
    }
  }
  for (const [name, o] of over) by.get(name)!.more = o;
  const surfaces = [...by.values()].filter(s => s.learned.length || s.proposals.length).sort((a, b) => a.name.localeCompare(b.name));
  return { surfaces, dropped, unread: Math.max(0, entries.length - ENTRIES_MAX) };
}

/** The line the coordinator prints: what each surface gathered, or that there is nothing. */
export function digestSay(surfaces: DigestSurface[], runId: string, es: boolean): string {
  if (!surfaces.length) return es ? `La ejecución ${runId} no dejó notas ni propuestas de verificación.` : `The run ${runId} left no verification notes or proposals.`;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = surfaces.map(s => {
    const notes = s.learned.length + (s.more?.learned ?? 0), props = s.proposals.length + (s.more?.proposals ?? 0);
    return `${s.name}: ${[
      ...(notes ? [es ? n(notes, 'nota', 'notas') : n(notes, 'note', 'notes')] : []),
      ...(props ? [es ? n(props, 'propuesta', 'propuestas') : n(props, 'proposal', 'proposals')] : []),
    ].join(', ')}`;
  });
  return es ? `Lo que aprendió la verificación en ${runId}: ${parts.join('; ')}.` : `What verification learned in ${runId}: ${parts.join('; ')}.`;
}
