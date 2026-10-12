import { z } from 'zod';

const EntrySchema = z.object({
  version: z.number(),
  date: z.string(),
  note: z.string(),
  words: z.number(),
  round: z.number(),
});
export type ChangelogEntry = z.infer<typeof EntrySchema>;

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
    return r.data;
  });
}

export function appendChangelog(list: ChangelogEntry[], e: ChangelogEntry): ChangelogEntry[] {
  const last = list[list.length - 1];
  if (last && e.version <= last.version) throw new Error(`changelog already has version ${last.version}; cannot append version ${e.version}`);
  return [...list, e];
}
