// Anthropic API prices in USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing.md
// (fetched 2026-10-12). Cache writes use the 1-hour rate: Claude Code caches for an hour, and the usage the API
// reports does not split 5-minute from 1-hour writes. Pure, so lens and its tests share it.

export const PRICES_AS_OF = '2026-10-12';
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number }

const P = (input: number, output: number, cacheRead: number, cacheWrite: number): Price => ({ input, output, cacheRead, cacheWrite });
const HAIKU_55_HIGH = P(0.5, 2.5, 0.05, 1);
const HAIKU_55_TIER_TOKENS = 100_000;

// Most specific prefix first: claude-opus-5-5 before claude-opus-5.
const TABLE: [prefix: string, price: Price][] = [
  ['claude-fable-5-1', P(10, 50, 0.25, 20)],
  ['claude-mythos-5-1', P(10, 50, 0.25, 20)],
  ['claude-fable-5', P(10, 50, 1, 20)],
  ['claude-mythos-5', P(10, 50, 1, 20)],
  ['claude-opus-5-5', P(4, 20, 0.2, 8)],
  ['claude-opus-5', P(5, 25, 0.5, 10)],
  ['claude-opus-4-8', P(5, 25, 0.5, 10)],
  ['claude-opus-4-7', P(5, 25, 0.5, 10)],
  ['claude-opus-4-6', P(5, 25, 0.5, 10)],
  ['claude-opus-4-5', P(5, 25, 0.5, 10)],
  ['claude-opus-4-1', P(15, 75, 1.5, 30)],
  ['claude-opus-4', P(15, 75, 1.5, 30)],
  ['claude-sonnet-5-5', P(2, 10, 0.1, 4)],
  ['claude-sonnet-5', P(2, 10, 0.2, 4)],
  ['claude-sonnet-4', P(3, 15, 0.3, 6)],
  ['claude-haiku-5-5', P(0.1, 0.5, 0.01, 0.2)],
  ['claude-haiku-4-5', P(1, 5, 0.1, 2)],
  ['claude-haiku-3-5', P(0.8, 4, 0.08, 1.6)],
];

/** The id without a bracketed suffix such as `[1m]`. */
const baseId = (model: string) => model.replace(/\[[^\]]*\]$/, '').trim();

/** null for an unpriced model. `promptTokens` (input + cache read + cache write of one request) picks Haiku 5.5's tier. */
export function priceFor(model: string, promptTokens = 0): Price | null {
  const id = baseId(model);
  const hit = TABLE.find(([prefix]) => id === prefix || id.startsWith(`${prefix}-`) || id.startsWith(`${prefix}[`));
  if (!hit) return null;
  if (hit[0] === 'claude-haiku-5-5' && promptTokens > HAIKU_55_TIER_TOKENS) return HAIKU_55_HIGH;
  return hit[1];
}

const cost = (p: Price, t: Tokens) => (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6;

/** One request's cost, with the tier its own prompt size gives. */
export function stepCost(model: string, t: Tokens): number | null {
  const p = priceFor(model, t.input + t.cacheRead + t.cacheWrite);
  return p ? cost(p, t) : null;
}

/** Summed tokens at the base tier: for repricing aggregates. */
export function tokensCost(model: string, t: Tokens): number | null {
  const p = priceFor(model);
  return p ? cost(p, t) : null;
}

const FAMILY = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;
const MAX_NAME = 22;

/** «Opus 5.5»; an unknown id clipped. */
export function shortModelName(model: string): string {
  const id = baseId(model);
  const m = FAMILY.exec(id);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] !== undefined ? `.${m[3]}` : ''}`;
  return id.length > MAX_NAME ? `${id.slice(0, MAX_NAME)}…` : id;
}
