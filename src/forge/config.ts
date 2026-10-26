import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import * as z from 'zod';
import { EFFORTS, MODELS, type Effort, type Model } from '../lib/launcher.js';

export type Profile = 'balanced' | 'economy' | 'quality';
export const ROLES = ['impl-heavy', 'impl-high', 'impl', 'impl-light', 'mech', 'review-correctness', 'review-security', 'review-perf', 'review-final', 'verify'] as const;
export type Role = (typeof ROLES)[number];
export const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Who does a coding request: ask, forge, superpowers, superpowers designing or planning and forge building,
 *  or `off` (no forge: the routing hooks stay silent; the route option `none`, saved). */
export const WORKFLOWS = ['ask', 'forge', 'superpowers', 'superpowers-design', 'superpowers-plan', 'off'] as const;
export type Workflow = (typeof WORKFLOWS)[number];
/** Whether forge asks at its gates (`ask`) or decides and records it (`auto`). */
export const AUTONOMIES = ['ask', 'auto'] as const;
export type Autonomy = (typeof AUTONOMIES)[number];
/** The TDD modes: `off`, `superpowers` (briefs point at its skill) and `verified` (forge itself runs the new tests on BASE). */
export const TDD_MODES = ['off', 'superpowers', 'verified'] as const;
export type TddMode = (typeof TDD_MODES)[number];
export type When = 'always' | 'medium' | 'final';
/** When a failed validator runs again (C-12): after a flaky result in the last 30 days, always, or never. */
export type RetryPolicy = 'flaky' | 'always' | 'never';
export interface ValidatorSpec { name: string; cmd: string; kind?: string; affects?: string[]; when?: When; cache?: boolean; affected_cmd?: string }
export interface VerifyLimits { checks: number; shots: number; minutes: number }
/** K2-13: when the run's integrated result is verified at depth flow: before Large's final review (`final`), also once
 *  the last task of each phase is integrated (`phase`), or never (`off`). */
export const FLOW_MODES = ['final', 'phase', 'off'] as const;
export type FlowMode = (typeof FLOW_MODES)[number];
/** K2-07: the ports FORGE verify-env hands out when `verify.ports` says nothing. */
export const DEFAULT_VERIFY_PORTS = '41000-41999';
/** What security judges against (K4-02, §4.8): the person writes it; each entry at most 200 characters. */
export interface ThreatModel { protects: string[]; trusted: string[]; untrusted: string[]; outOfScope: string[]; notes?: string }
/** How the review loop converges: the express review (measure 7) and the docs written for people (K4-09). */
export interface ReviewConfig { express: boolean; personDocs: string[] }
/** The docs written for people by default: an important finding only there does not open a round (K4-09). */
export const PERSON_DOCS: readonly string[] = ['README.md', 'README.*.md', '**/README.md', '**/README.*.md', 'CHANGELOG.md', '**/CHANGELOG.md'];
export interface ForgeConfig {
  profile: Profile; validators?: ValidatorSpec[]; detect: boolean; exclude: string[];
  verify: { limits: VerifyLimits; ports?: string; flow?: FlowMode }; evidence: 'upload' | 'local'; validatorTimeoutSec: number; swarm: {
    parallel: number; mode?: 'subagents' | 'sessions'; launcher: 'bg' | 'herdr';
    /** How a sessions-mode member is launched: its own effort, and a model only when set (else the person's default). */
    member: { effort: Effort; model?: Model };
    setup?: string;
    /** C-03: how many background jobs (prep, review-prep, integrate, step) run their validators at once. */
    validateJobs: number;
    /** A10: a plan run in subagents mode hands each task to a forge-runner subagent; absent or false: off. */
    nested?: boolean;
  };
  /** How validators run: through the tree cache (C6), at most `parallel` at once, and which failures run again (C-12). */
  validate: { cache: boolean; parallel: number; retry: RetryPolicy };
  /** Without one, security takes the person at the keyboard and the local machine as trusted (decision of the user). */
  threatModel?: ThreatModel;
  review: ReviewConfig;
  /** `superpowers`: briefs follow its TDD skill; `verified`: forge runs the new tests on BASE (src/forge/tdd.ts). */
  tdd: TddMode;
  workflow?: Workflow; autonomy?: Autonomy;
  /** K1-03: route-prompt's one-line hint; without it, on. */
  route?: { hint: 'on' | 'off' };
  /** Globs of tracked build output: forge puts those files back after its validator runs in any checkout. */
  generated: string[];
  /** FX2: the spending cap `infinite start` takes when it gets no --max-usd. */
  budget?: { usd?: number };
}
export class ConfigError extends Error {}

// I-03: a command runs as the person trusted it (src/forge/trust.ts hashes it with CRLF as LF), so CRLF is LF here too.
const lf = (s: string) => s.replace(/\r\n/g, '\n');

// K2-07: `<from>-<to>`, two ports of 1024 to 65535, the first not above the second.
const validPorts = (s: string): boolean => {
  const [from, to] = s.split('-').map(Number);
  return from >= 1024 && to <= 65535 && from <= to;
};

const Schema = z.object({
  profile: z.enum(['balanced', 'economy', 'quality']).default('balanced'),
  detect: z.boolean().default(true),
  exclude: z.array(z.string().regex(NAME)).default([]),
  validators: z.array(z.object({
    name: z.string().regex(NAME),
    cmd: z.string().min(1).transform(lf),
    kind: z.string().regex(NAME).optional(),
    affects: z.array(z.string().min(1)).optional(),
    when: z.enum(['always', 'medium', 'final']).optional(),
    cache: z.boolean().optional(),
    affected_cmd: z.string().min(1).max(500).refine(s => /\{(files|tests|packages)\}/.test(s), { message: 'must contain {files}, {tests} or {packages}' }).transform(lf).optional(),
  }).strict()).superRefine((list, ctx) => {
    // I-03: one name, one validator. A second one of a name would replace the first (or a detected one) when it runs,
    // and hide behind it in the trust question: the whole config is refused, so none of its commands runs.
    const seen = new Set<string>();
    for (const [i, v] of list.entries()) {
      if (seen.has(v.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'name'], message: `duplicate name ${v.name}: each validator needs its own name` });
      seen.add(v.name);
    }
  }).optional(),
  verify: z.object({
    limits: z.object({
      checks: z.number().int().min(1).max(20).default(8),
      shots: z.number().int().min(1).max(30).default(10),
      minutes: z.number().int().min(1).max(60).default(10),
    }).strict().prefault({}),
    ports: z.string().regex(/^\d{4,5}-\d{4,5}$/, 'must be <from>-<to>').refine(validPorts, 'must be two ports from 1024 to 65535, the first not above the second').optional(),
    flow: z.enum(FLOW_MODES).optional(),
  }).strict().prefault({}),
  evidence: z.enum(['upload', 'local']).default('upload'),
  validatorTimeoutSec: z.number().int().positive().max(7200).default(600),
  validate: z.object({
    cache: z.boolean().default(true),
    parallel: z.number().int().min(1).max(8).default(3),
    retry: z.enum(['flaky', 'always', 'never']).default('flaky'),
  }).strict().default({ cache: true, parallel: 3, retry: 'flaky' }),
  tdd: z.enum(TDD_MODES).default('off'),
  workflow: z.enum(WORKFLOWS).optional(),
  autonomy: z.enum(AUTONOMIES).optional(),
  route: z.object({
    // `on` and `off` are strings in YAML 1.2; `true` and `false` mean the same.
    hint: z.union([z.enum(['on', 'off']), z.boolean()]).transform(v => (v === true ? 'on' : v === false ? 'off' : v)).default('on'),
  }).strict().optional(),
  generated: z.array(z.string().min(1).max(200)).max(50).default([]),
  budget: z.object({ usd: z.number().positive().max(1_000_000).optional() }).strict().optional(),
  threatModel: z.object({
    protects: z.array(z.string().min(1).max(200)).min(1).max(10),
    trusted: z.array(z.string().min(1).max(200)).max(10).default([]),
    untrusted: z.array(z.string().min(1).max(200)).max(10).default([]),
    outOfScope: z.array(z.string().min(1).max(200)).max(20).default([]),
    notes: z.string().min(1).max(1000).optional(),
  }).strict().optional(),
  review: z.object({
    express: z.boolean().default(true),
    personDocs: z.array(z.string().min(1).max(200)).max(50).default([...PERSON_DOCS]),
  }).strict().default({ express: true, personDocs: [...PERSON_DOCS] }),
  swarm: z.object({
    parallel: z.number().int().min(1).max(10).default(3),
    mode: z.enum(['subagents', 'sessions']).optional(),
    // I-18: only bg; herdr was removed, and an old config that names it still loads and reads as bg.
    launcher: z.enum(['bg', 'herdr']).default('bg'),
    member: z.object({
      effort: z.enum(EFFORTS).default('medium'),
      model: z.enum(MODELS).optional(),
    }).strict().default({ effort: 'medium' }),
    setup: z.string().min(1).max(500).transform(lf).optional(),
    validateJobs: z.number().int().min(1).max(8).default(2),
    nested: z.boolean().optional(),
  }).strict().default({ parallel: 3, launcher: 'bg', member: { effort: 'medium' }, validateJobs: 2 }),
}).strict();

const DEFAULTS: ForgeConfig = {
  profile: 'balanced', detect: true, exclude: [], verify: { limits: { checks: 8, shots: 10, minutes: 10 } },
  evidence: 'upload', validatorTimeoutSec: 600, validate: { cache: true, parallel: 3, retry: 'flaky' }, review: { express: true, personDocs: [...PERSON_DOCS] }, swarm: { parallel: 3, launcher: 'bg', member: { effort: 'medium' }, validateJobs: 2 }, tdd: 'off', generated: [],
};

export function parseConfig(text: string | null): ForgeConfig {
  if (text === null || !text.trim()) return structuredClone(DEFAULTS);
  let raw: unknown;
  try { raw = parse(text); } catch (e) { throw new ConfigError(`.forge/config.yaml: ${(e as Error).message}`); }
  const r = Schema.safeParse(raw ?? {});
  if (!r.success) throw new ConfigError(`.forge/config.yaml: ${r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  const { validators, ...rest } = r.data;
  return validators ? { ...rest, validators } : rest;
}

/** The value of a key or dotted path (`evidence`, `swarm.parallel`) of a parsed config; undefined when it has none. */
export function configValue(config: ForgeConfig, key: string): unknown {
  let at: unknown = config;
  for (const part of key.split('.')) {
    if (!at || typeof at !== 'object' || Array.isArray(at) || !Object.prototype.hasOwnProperty.call(at, part)) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

export function loadConfig(root: string): ForgeConfig {
  const file = path.join(root, '.forge', 'config.yaml');
  return parseConfig(existsSync(file) ? readFileSync(file, 'utf8') : null);
}

// economy steps implementers down one rung of the ladder, quality steps them up (impl and impl-high to impl-heavy); reviewers never change; verify gets Opus on quality.
const SHIFT: Record<Profile, Partial<Record<Role, string>>> = {
  balanced: {},
  economy: { 'impl-heavy': 'forge-impl-high', 'impl-high': 'forge-impl', impl: 'forge-impl-light' },
  quality: { impl: 'forge-impl-heavy', 'impl-high': 'forge-impl-heavy', 'impl-light': 'forge-impl', mech: 'forge-impl-light', verify: 'forge-verify-heavy' },
};

export function agentFor(role: Role, profile: Profile): string {
  return SHIFT[profile][role] ?? `forge-${role}`;
}

/** K2-07: the port range of FORGE verify-env: `verify.ports`, else 41000-41999. */
export function verifyPorts(config: ForgeConfig): { from: number; to: number } {
  const [from, to] = (config.verify.ports ?? DEFAULT_VERIFY_PORTS).split('-').map(Number);
  return { from, to };
}

/** K2-13: `verify.flow`, `final` when the config says nothing. */
export const verifyFlow = (config: ForgeConfig): FlowMode => config.verify.flow ?? 'final';
