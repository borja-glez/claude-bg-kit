// K2-11: what a run's verifications learned, by surface: the learned notes (as surfaces learn filters them) and the
// proposals to change a surface, from every verify.json its tasks and its flow passes wrote since the run started. The
// coordinator shows it once at the end of the run, or leaves it in one question note.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { filterNotes } from './surfaces.js';
import { parseVerifyFile } from './verdict.js';

export interface DigestSurface { name: string; learned: { note: string; tasks: string[] }[]; proposals: { change: string; tasks: string[] }[] }

/** The verify.json files of a work folder (its own, and those of its reviews-<n>-<k>/ folders) written at `since` or later. */
export function verifyFilesOf(dir: string, since: number): string[] {
  let rounds: string[] = [];
  try { rounds = readdirSync(dir).filter(n => /^reviews-\d+-\d+$/.test(n)).sort().map(n => path.join(dir, n, 'verify.json')); } catch { rounds = []; }
  return [path.join(dir, 'verify.json'), ...rounds].filter(f => { try { return statSync(f).mtimeMs >= since; } catch { return false; } });
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** By surface name, each note and proposal once with the tasks (or passes) that wrote it; a note surfaces learn would
 *  refuse is left out. `entries`: the text of a verify.json and the task or pass it is of. */
export function digest(entries: { task: string; text: string }[]): DigestSurface[] {
  const by = new Map<string, DigestSurface>();
  const of = (name: string): DigestSurface => {
    let s = by.get(name);
    if (!s) { s = { name, learned: [], proposals: [] }; by.set(name, s); }
    return s;
  };
  const add = <T extends { tasks: string[] }>(list: T[], key: (x: T) => string, item: T, task: string) => {
    const same = list.find(x => norm(key(x)) === norm(key(item)));
    if (!same) list.push(item);
    else if (!same.tasks.includes(task)) same.tasks.push(task);
  };
  for (const { task, text } of entries) {
    const v = parseVerifyFile(text);
    if (!v) continue;
    for (const l of v.learned) {
      const [note] = filterNotes([l.note], [], task).keep;
      if (note) add(of(l.surface || 'app').learned, x => x.note, { note, tasks: [task] }, task);
    }
    for (const p of v.proposals) add(of(p.surface || 'app').proposals, x => x.change, { change: p.change.trim(), tasks: [task] }, task);
  }
  return [...by.values()].filter(s => s.learned.length || s.proposals.length).sort((a, b) => a.name.localeCompare(b.name));
}

/** The line the coordinator prints: what each surface gathered, or that there is nothing. */
export function digestSay(surfaces: DigestSurface[], runId: string, es: boolean): string {
  if (!surfaces.length) return es ? `La ejecución ${runId} no dejó notas ni propuestas de verificación.` : `The run ${runId} left no verification notes or proposals.`;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = surfaces.map(s => `${s.name}: ${[
    ...(s.learned.length ? [es ? n(s.learned.length, 'nota', 'notas') : n(s.learned.length, 'note', 'notes')] : []),
    ...(s.proposals.length ? [es ? n(s.proposals.length, 'propuesta', 'propuestas') : n(s.proposals.length, 'proposal', 'proposals')] : []),
  ].join(', ')}`);
  return es ? `Lo que aprendió la verificación en ${runId}: ${parts.join('; ')}.` : `What verification learned in ${runId}: ${parts.join('; ')}.`;
}
