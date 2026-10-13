import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

export type Profile = 'balanced' | 'economy' | 'quality';
export const ROLES = ['impl-heavy', 'impl', 'impl-light', 'mech', 'review-correctness', 'review-security', 'review-perf', 'verify'] as const;
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
export interface ValidatorSpec { name: string; cmd: string; kind?: string; affects?: string[]; when?: When }
export interface VerifyLimits { checks: number; shots: number; minutes: number }
export interface ForgeConfig {
  profile: Profile; validators?: ValidatorSpec[]; detect: boolean; exclude: string[];
  verify: { limits: VerifyLimits }; evidence: 'upload' | 'local'; validatorTimeoutSec: number; swarm: { parallel: number; mode?: 'subagents' | 'sessions'; launcher: 'bg' | 'herdr'; setup?: string };
  tdd: 'off' | 'superpowers';
  workflow?: Workflow; autonomy?: Autonomy;
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
  tdd: z.enum(['off', 'superpowers']).default('off'),
  workflow: z.enum(WORKFLOWS).optional(),
  autonomy: z.enum(AUTONOMIES).optional(),
  swarm: z.object({
    parallel: z.number().int().min(1).max(10).default(3),
    mode: z.enum(['subagents', 'sessions']).optional(),
    launcher: z.enum(['bg', 'herdr']).default('bg'),
    setup: z.string().min(1).max(500).optional(),
  }).strict().default({ parallel: 3, launcher: 'bg' }),
}).strict();

const DEFAULTS: ForgeConfig = {
  profile: 'balanced', detect: true, exclude: [], verify: { limits: { checks: 8, shots: 10, minutes: 10 } },
  evidence: 'upload', validatorTimeoutSec: 600, swarm: { parallel: 3, launcher: 'bg' }, tdd: 'off',
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

export function loadConfig(root: string): ForgeConfig {
  const file = path.join(root, '.forge', 'config.yaml');
  return parseConfig(existsSync(file) ? readFileSync(file, 'utf8') : null);
}

// economy steps implementers down one tier, quality steps them up; reviewers never change; verify gets Opus on quality.
const SHIFT: Record<Profile, Partial<Record<Role, string>>> = {
  balanced: {},
  economy: { 'impl-heavy': 'forge-impl', impl: 'forge-impl-light' },
  quality: { impl: 'forge-impl-heavy', 'impl-light': 'forge-impl', mech: 'forge-impl-light', verify: 'forge-verify-heavy' },
};

export function agentFor(role: Role, profile: Profile): string {
  return SHIFT[profile][role] ?? `forge-${role}`;
}
