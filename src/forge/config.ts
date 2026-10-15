import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { EFFORTS, MODELS, type Effort, type Model } from '../lib/launcher.js';

export type Profile = 'balanced' | 'economy' | 'quality';
export const ROLES = ['impl-heavy', 'impl-high', 'impl', 'impl-light', 'mech', 'review-correctness', 'review-security', 'review-perf', 'review-final', 'verify'] as const;
export type Role = (typeof ROLES)[number];
export const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Who does a coding request (spec §5.4): ask, forge, superpowers, superpowers designing or planning and forge building,
 *  or `off` (no forge: the routing hooks stay silent; the route option `none`, saved). */
export const WORKFLOWS = ['ask', 'forge', 'superpowers', 'superpowers-design', 'superpowers-plan', 'off'] as const;
export type Workflow = (typeof WORKFLOWS)[number];
/** Whether forge asks at its gates (`ask`) or decides and records it (`auto`). */
export const AUTONOMIES = ['ask', 'auto'] as const;
export type Autonomy = (typeof AUTONOMIES)[number];
export type When = 'always' | 'medium' | 'final';
/** When a failed validator runs again (C-12): after a flaky result in the last 30 days, always, or never. */
export type RetryPolicy = 'flaky' | 'always' | 'never';
export interface ValidatorSpec { name: string; cmd: string; kind?: string; affects?: string[]; when?: When; cache?: boolean }
export interface VerifyLimits { checks: number; shots: number; minutes: number }
export interface ForgeConfig {
  profile: Profile; validators?: ValidatorSpec[]; detect: boolean; exclude: string[];
  verify: { limits: VerifyLimits }; evidence: 'upload' | 'local'; validatorTimeoutSec: number; swarm: {
    parallel: number; mode?: 'subagents' | 'sessions'; launcher: 'bg' | 'herdr';
    /** How a sessions-mode member is launched: its own effort, and a model only when set (else the person's default). */
    member: { effort: Effort; model?: Model };
    setup?: string;
  };
  /** How validators run: through the tree cache (C6), at most `parallel` at once, and which failures run again (C-12). */
  validate: { cache: boolean; parallel: number; retry: RetryPolicy };
  tdd: 'off' | 'superpowers';
  workflow?: Workflow; autonomy?: Autonomy;
  /** Globs of tracked build output: forge puts those files back after its validator runs in any checkout. */
  generated: string[];
}
export class ConfigError extends Error {}

const Schema = z.object({
  profile: z.enum(['balanced', 'economy', 'quality']).default('balanced'),
  detect: z.boolean().default(true),
  exclude: z.array(z.string().regex(NAME)).default([]),
  validators: z.array(z.object({
    name: z.string().regex(NAME),
    cmd: z.string().min(1),
    kind: z.string().regex(NAME).optional(),
    affects: z.array(z.string().min(1)).optional(),
    when: z.enum(['always', 'medium', 'final']).optional(),
    cache: z.boolean().optional(),
  }).strict()).optional(),
  verify: z.object({
    limits: z.object({
      checks: z.number().int().min(1).max(20).default(8),
      shots: z.number().int().min(1).max(30).default(10),
      minutes: z.number().int().min(1).max(60).default(10),
    }).strict().default({}),
  }).strict().default({}),
  evidence: z.enum(['upload', 'local']).default('upload'),
  validatorTimeoutSec: z.number().int().positive().max(7200).default(600),
  validate: z.object({
    cache: z.boolean().default(true),
    parallel: z.number().int().min(1).max(8).default(3),
    retry: z.enum(['flaky', 'always', 'never']).default('flaky'),
  }).strict().default({ cache: true, parallel: 3, retry: 'flaky' }),
  tdd: z.enum(['off', 'superpowers']).default('off'),
  workflow: z.enum(WORKFLOWS).optional(),
  autonomy: z.enum(AUTONOMIES).optional(),
  generated: z.array(z.string().min(1).max(200)).max(50).default([]),
  swarm: z.object({
    parallel: z.number().int().min(1).max(10).default(3),
    mode: z.enum(['subagents', 'sessions']).optional(),
    launcher: z.enum(['bg', 'herdr']).default('bg'),
    member: z.object({
      effort: z.enum(EFFORTS).default('medium'),
      model: z.enum(MODELS).optional(),
    }).strict().default({ effort: 'medium' }),
    setup: z.string().min(1).max(500).optional(),
  }).strict().default({ parallel: 3, launcher: 'bg', member: { effort: 'medium' } }),
}).strict();

const DEFAULTS: ForgeConfig = {
  profile: 'balanced', detect: true, exclude: [], verify: { limits: { checks: 8, shots: 10, minutes: 10 } },
  evidence: 'upload', validatorTimeoutSec: 600, validate: { cache: true, parallel: 3, retry: 'flaky' }, swarm: { parallel: 3, launcher: 'bg', member: { effort: 'medium' } }, tdd: 'off', generated: [],
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
