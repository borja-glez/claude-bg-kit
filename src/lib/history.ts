import { z } from 'zod';

const EntrySchema = z.object({
  version: z.number(),
  date: z.string(),
  note: z.string(),
  words: z.number(),
  round: z.number(),
});
export type ChangelogEntry = z.infer<typeof EntrySchema> & {
  /** A-04: round → the proposal numbers this entry applied, sorted and without duplicates (the shape of dismissed.json). */
  applied?: Record<number, number[]>;
  /** A-04: the rewrite of this entry folded in the proposals of its round. */
  rewrite?: true;
};

/**
 * `applied` of a changelog entry, read tolerantly: a round (a decimal key without leading zeros) → its positive
 * numbers, sorted and without duplicates; anything else is dropped, and nothing valid is null. A bad value never makes
 * the changelog invalid: an invalid changelog leaves the band blank.
 */
export function normalizeApplied(x: unknown): Record<number, number[]> | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out: Record<number, number[]> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!/^[1-9]\d*$/.test(k) || !Array.isArray(v)) continue;
    const ns = v.filter((n): n is number => Number.isInteger(n) && n > 0);
    if (ns.length) out[Number(k)] = [...new Set(ns)].sort((a, b) => a - b);
  }
  return Object.keys(out).length ? out : null;
}

/** A malformed `--applied` of `design-snapshot`. */
export class AppliedError extends Error {}

/**
 * The items of `design-snapshot --applied` as round → numbers, sorted and without duplicates. An item is `r<R>:<list>`,
 * or a bare `<list>` of `round` (the snapshot's --round; null when it has none); a list is positive integers separated by
 * commas. No item, a malformed one, a bare list without --round, or a round after --round throws AppliedError.
 */
export function parseAppliedItems(items: string[], round: number | null): Record<number, number[]> {
  if (!items.length) throw new AppliedError('--applied needs at least one item (r<R>:<numbers> or <numbers>)');
  const out: Record<number, number[]> = {};
  for (const item of items) {
    const m = /^(?:r([1-9]\d*):)?([1-9]\d*(?:,[1-9]\d*)*)$/.exec(item);
    if (!m) throw new AppliedError(`--applied item ${item.slice(0, 40)} is not r<R>:<numbers> nor <numbers>`);
    if (!m[1] && round === null) throw new AppliedError(`--applied item ${item} has no round: add --round <R> or write it r<R>:${item}`);
    const r = m[1] ? Number(m[1]) : round!;
    if (round !== null && r > round) throw new AppliedError(`--applied round ${r} is after --round ${round}`);
    out[r] = [...new Set([...(out[r] ?? []), ...m[2].split(',').map(Number)])].sort((a, b) => a - b);
  }
  return out;
}

export function listVersions(files: string[]): number[] {
  const set = new Set<number>();
  for (const f of files) { const m = /^v(\d+)\.md$/.exec(f); if (m) set.add(Number(m[1])); }
  return [...set].sort((a, b) => a - b);
}

export function nextVersion(files: string[]): number {
  const v = listVersions(files);
  return v.length ? v[v.length - 1] + 1 : 1;
}

export function parseChangelog(text: string | null): ChangelogEntry[] {
  if (!text || !text.trim()) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('changelog.json is not valid JSON'); }
  if (!Array.isArray(raw)) throw new Error('changelog.json must be a JSON array');
  return raw.map((e, i) => {
    const r = EntrySchema.safeParse(e);
    if (!r.success) {
      const why = r.error.issues.map(x => `${x.path.join('.') || '(root)'}: ${x.message}`).join('; ');
      throw new Error(`changelog.json entry ${i} is invalid: ${why}`);
    }
    // EntrySchema keeps the five fields of every entry; applied and rewrite are optional and read tolerantly.
    const entry = e as Record<string, unknown>;
    const applied = normalizeApplied(entry.applied);
    return { ...r.data, ...(applied ? { applied } : {}), ...(entry.rewrite === true ? { rewrite: true as const } : {}) };
  });
}

export function appendChangelog(list: ChangelogEntry[], e: ChangelogEntry): ChangelogEntry[] {
  const last = list[list.length - 1];
  if (last && e.version <= last.version) throw new Error(`changelog already has version ${last.version}; cannot append version ${e.version}`);
  return [...list, e];
}
