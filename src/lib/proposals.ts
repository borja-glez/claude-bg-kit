export const PROPOSAL_CATEGORIES = ['feature', 'security', 'perf', 'quality', 'tests', 'deps'] as const;
export const PROPOSAL_RISKS = ['low', 'medium', 'high'] as const;
export const PROPOSAL_STATUSES = ['proposed', 'approved', 'rejected', 'discussing', 'auto_approved', 'done'] as const;
export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number];
export type ProposalRisk = (typeof PROPOSAL_RISKS)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type Decision = 'approve' | 'reject' | 'discuss';
export const MAX_PROPOSAL_TEXT = 4000;
export const MAX_PROPOSAL_TITLE = 200;

export interface ProposalDoc {
  ts: string; category: ProposalCategory; risk: ProposalRisk; title: string; rationale: string; evidence: string; pillar: string;
  estimate?: string; path?: string; taskId?: string; status: ProposalStatus; decidedBy?: string; decidedAt?: string; reason?: string;
  source: 'scout' | 'user'; author: string;
}

const str = (x: unknown): x is string => typeof x === 'string';
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => str(x) && (list as readonly string[]).includes(x);

/**
 * Clips to at most `max` code points at a word boundary, ending in «…». Hard cut only when the
 * last ~30% holds no whitespace (one long token such as a URL). No Node imports: the page bundles this.
 */
export function clipWords(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  let space = -1;
  for (let i = Math.min(max - 1, chars.length - 1); i >= 0; i--) if (/\s/.test(chars[i])) { space = i; break; }
  const hard = chars.slice(0, max - 1).join('');
  if (space < Math.floor((max - 1) * 0.7)) return hard + '…';
  const soft = chars.slice(0, space).join('').replace(/[\s.,;:!?¡¿…\-–—]+$/u, '');
  return (soft || hard) + '…';
}

/** Strict normalizer for shared (untrusted) proposal docs. */
export function normalizeProposal(x: unknown): ProposalDoc | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!oneOf(PROPOSAL_CATEGORIES, o.category) || !oneOf(PROPOSAL_RISKS, o.risk) || !oneOf(PROPOSAL_STATUSES, o.status)) return null;
  if (o.source !== 'scout' && o.source !== 'user') return null;
  if (!str(o.title) || !o.title.trim() || !str(o.author)) return null;
  const text = (v: unknown, max = MAX_PROPOSAL_TEXT) => (str(v) ? clipWords(v, max) : '');
  const out: ProposalDoc = {
    ts: str(o.ts) ? o.ts : '', category: o.category, risk: o.risk, title: clipWords(o.title, MAX_PROPOSAL_TITLE),
    rationale: text(o.rationale), evidence: text(o.evidence), pillar: text(o.pillar, MAX_PROPOSAL_TITLE),
    status: o.status, source: o.source, author: o.author,
  };
  for (const k of ['estimate', 'path', 'decidedBy', 'decidedAt'] as const) if (str(o[k])) out[k] = (o[k] as string).slice(0, MAX_PROPOSAL_TITLE);
  if (str(o.taskId) && /^[A-Za-z0-9_.-]{1,64}$/.test(o.taskId)) out.taskId = o.taskId;
  if (str(o.reason)) out.reason = clipWords(o.reason, MAX_PROPOSAL_TEXT);
  return out;
}

export const canDecide = (status: ProposalStatus): boolean => status === 'proposed' || status === 'discussing';
export const applyDecision = (d: Decision): ProposalStatus => (d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'discussing');
export const isActionable = (p: ProposalDoc): boolean => p.status === 'approved' || p.status === 'auto_approved';
