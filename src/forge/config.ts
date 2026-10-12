import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

export type Profile = 'balanced' | 'economy' | 'quality';
export const ROLES = ['impl-heavy', 'impl', 'impl-light', 'mech', 'review-correctness', 'review-security', 'review-perf'] as const;
export type Role = (typeof ROLES)[number];
export interface ValidatorSpec { name: string; cmd: string; kind?: 'test' | 'lint' | 'typecheck' | 'build' | 'other'; affects?: string[] }
export interface ForgeConfig { profile: Profile; validators?: ValidatorSpec[]; validatorTimeoutSec: number; swarm: { parallel: number } }
export class ConfigError extends Error {}

const Schema = z.object({
  profile: z.enum(['balanced', 'economy', 'quality']).default('balanced'),
  validators: z.array(z.object({
    name: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/),
    cmd: z.string().min(1),
    kind: z.enum(['test', 'lint', 'typecheck', 'build', 'other']).optional(),
    affects: z.array(z.string().min(1)).optional(),
  }).strict()).optional(),
  validatorTimeoutSec: z.number().int().positive().max(7200).default(600),
  swarm: z.object({ parallel: z.number().int().min(1).max(10).default(5) }).strict().default({ parallel: 5 }),
}).strict();

export function parseConfig(text: string | null): ForgeConfig {
  if (text === null || !text.trim()) return { profile: 'balanced', validatorTimeoutSec: 600, swarm: { parallel: 5 } };
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

// economy steps implementers down one tier, quality steps them up; reviewers never change.
const SHIFT: Record<Profile, Partial<Record<Role, string>>> = {
  balanced: {},
  economy: { 'impl-heavy': 'forge-impl', impl: 'forge-impl-light' },
  quality: { impl: 'forge-impl-heavy', 'impl-light': 'forge-impl', mech: 'forge-impl-light' },
};

export function agentFor(role: Role, profile: Profile): string {
  return SHIFT[profile][role] ?? `forge-${role}`;
}
