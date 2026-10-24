import { loadProposals, PROPOSAL_ID } from './proposals.js';
import { proposalDigest, type ProposalDoc } from '../lib/proposals.js';
import { clean as cleanLine } from '../lib/decisions.js';
import { isPlanId } from '../lib/ids.js';
import { estimateMinutes } from './to-task.js';

export const CRITIC_VERDICTS = ['keep', 'adapt', 'drop', 'clash'] as const;
export const CRITIC_TEXT_MAX = 1000;

/** 6b-3: where the critic puts the task of a proposal it keeps in a `product` run: a phase of the plan, a done_when a check can
 *  see, the plan's tasks it waits for (none is []) and an estimate (`45m`, `2h`). */
export interface CriticPlacement { phase: string; doneWhen: string; dependsOn: string[]; estimate: string }

export interface CriticVerdict {
  id: string; digest: string; verdict: (typeof CRITIC_VERDICTS)[number]; why: string; changes?: string; loses?: string; placement?: CriticPlacement;
}

/**
 * Free text from the critic, cleaned as the decision record cleans it (6b-2 Task 4 fix 1, I-1: one function, lib/decisions'
 * clean): C0, DEL and C1 controls and bidi overrides out, one line, trimmed, cut by code points to CRITIC_TEXT_MAX. '' when it
 * is not text, so a `why` the decision would refuse is no verdict.
 */
function clean(x: unknown): string {
  return typeof x === 'string' ? cleanLine(x, CRITIC_TEXT_MAX) : '';
}

/**
 * 6b-3: a placement from untrusted JSON (the critic's file, or the `judge` event that keeps it), or null unless its four fields
 * read: a phase and dependencies that are plan ids, a done_when that cleans to some text (clean) and an estimate that reads as
 * minutes (estimateMinutes). The dependencies are kept once each, in their order.
 */
export function readPlacement(x: unknown): CriticPlacement | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const doneWhen = clean(o.doneWhen);
  const estimate = typeof o.estimate === 'string' ? o.estimate.trim() : '';
  if (typeof o.phase !== 'string' || !isPlanId(o.phase) || !doneWhen || estimateMinutes(estimate) === null) return null;
  if (!Array.isArray(o.dependsOn) || !o.dependsOn.every((d): d is string => typeof d === 'string' && isPlanId(d))) return null;
  return { phase: o.phase, doneWhen, dependsOn: [...new Set(o.dependsOn)], estimate };
}

/**
 * The verdicts the critic wrote (`{"verdicts": [...]}`): each entry needs an id of PROPOSAL_ID, a digest of 64 hex, a known
 * verdict and a reason; adapt needs its changes and clash what would be lost. A repeated id counts the first time; the rest is
 * dropped. Text that is not read gives []. 6b-3, L-4: a keep keeps its placement when it reads whole (readPlacement); no other
 * verdict carries one (an adapt approves nothing: its v2's own keep places it).
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
    const placement = verdict === 'keep' ? readPlacement(o.placement) : null;
    out.push({ id: o.id, digest: o.digest, verdict, why, ...(verdict === 'adapt' ? { changes } : {}), ...(verdict === 'clash' ? { loses } : {}), ...(placement ? { placement } : {}) });
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
