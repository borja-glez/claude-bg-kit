import { loadProposals, PROPOSAL_ID } from './proposals.js';
import { proposalDigest, type ProposalDoc } from '../lib/proposals.js';

export const CRITIC_VERDICTS = ['keep', 'adapt', 'drop', 'clash'] as const;
export const CRITIC_TEXT_MAX = 1000;

export interface CriticVerdict {
  id: string; digest: string; verdict: (typeof CRITIC_VERDICTS)[number]; why: string; changes?: string; loses?: string;
}

/** Free text from the critic: control characters out, trimmed, cut to CRITIC_TEXT_MAX; '' when it is not text. */
function clean(x: unknown): string {
  // eslint-disable-next-line no-control-regex
  // Cut by code points, so a surrogate pair is never split.
  return typeof x === 'string' ? Array.from(x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim()).slice(0, CRITIC_TEXT_MAX).join('') : '';
}

/**
 * The verdicts the critic wrote (`{"verdicts": [...]}`): each entry needs an id of PROPOSAL_ID, a digest of 64 hex, a known
 * verdict and a reason; adapt needs its changes and clash what would be lost. A repeated id counts the first time; the rest is
 * dropped. Text that is not read gives [].
 */
export function readVerdicts(text: string): CriticVerdict[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const list = raw && typeof raw === 'object' ? (raw as { verdicts?: unknown }).verdicts : undefined;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CriticVerdict[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    const verdict = (CRITIC_VERDICTS as readonly unknown[]).includes(o.verdict) ? o.verdict as CriticVerdict['verdict'] : null;
    if (typeof o.id !== 'string' || !PROPOSAL_ID.test(o.id) || seen.has(o.id)) continue;
    // The first entry for an id is the one that counts, valid or not: a critic that contradicts itself never passes.
    seen.add(o.id);
    if (typeof o.digest !== 'string' || !/^[0-9a-f]{64}$/.test(o.digest) || !verdict) continue;
    const why = clean(o.why);
    if (!why) continue;
    const changes = clean(o.changes);
    const loses = clean(o.loses);
    if (verdict === 'adapt' && !changes) continue;
    if (verdict === 'clash' && !loses) continue;
    out.push({ id: o.id, digest: o.digest, verdict, why, ...(verdict === 'adapt' ? { changes } : {}), ...(verdict === 'clash' ? { loses } : {}) });
  }
  return out;
}

/** The proposals the critic judges, each with the digest of its text; `missing` are the ids with no proposal in `root`. */
export function proposalBatch(root: string, ids: string[]): { proposals: { id: string; digest: string; doc: ProposalDoc }[]; missing: string[] } {
  const byId = new Map(loadProposals(root).map(({ id, ...doc }) => [id, doc as ProposalDoc]));
  const proposals: { id: string; digest: string; doc: ProposalDoc }[] = [];
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const doc = byId.get(id);
    if (doc) proposals.push({ id, digest: proposalDigest(id, doc), doc }); else missing.push(id);
  }
  return { proposals, missing };
}
