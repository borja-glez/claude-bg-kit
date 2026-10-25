import { compareVersions } from './superpowers.js';

/**
 * A4, forge doctor: a read-only report. Each check runs isolated and gives ok, warn, fail or unverified; the exit is 0
 * when all is well, 2 when something needs a look (warn or fail), 1 when only some check could not verify; `say` is the
 * one-line count in the --locale.
 */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unverified';
export interface Fix { do: string; kind: 'manual' | 'confirm' }
export interface CheckResult { id: string; status: CheckStatus; detail: string; data?: Record<string, unknown>; fix?: Fix }
/** What every check reads: the main checkout (ctx.main), the install context and the clock. A check never throws; runChecks isolates one that does. */
export interface DoctorCtx { main: string; cwd: string; configDir: string; scriptPath: string; now: Date; locale: 'es' | 'en'; env: Record<string, string | undefined> }
/** A named check, so a throw can still be reported under its id. */
export interface DoctorCheck { id: string; run(ctx: DoctorCtx): CheckResult | CheckResult[] }

/** The range of superpowers that forge's route is written for. */
export const ROUTE_SUPERPOWERS = '^7.0.0';

export function runChecks(checks: readonly DoctorCheck[], ctx: DoctorCtx): CheckResult[] {
  const out: CheckResult[] = [];
  for (const check of checks) {
    try {
      out.push(...[check.run(ctx)].flat());
    } catch (e) {
      out.push({ id: check.id, status: 'unverified', detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export function doctorExit(checks: readonly CheckResult[]): 0 | 1 | 2 {
  if (checks.some(c => c.status === 'warn' || c.status === 'fail')) return 2;
  return checks.some(c => c.status === 'unverified') ? 1 : 0;
}

export function doctorSay(checks: readonly CheckResult[], locale: 'es' | 'en'): string {
  const ok = checks.filter(c => c.status === 'ok').length;
  const look = checks.filter(c => c.status === 'warn' || c.status === 'fail').length;
  const unverified = checks.filter(c => c.status === 'unverified').length;
  if (locale === 'es') return `forge doctor: ${ok} ${ok === 1 ? 'correcta' : 'correctas'}, ${look} que mirar, ${unverified} sin verificar`;
  return `forge doctor: ${ok} ok, ${look} to look at, ${unverified} unverified`;
}

/** x.y.z with what follows a `-` or `+` dropped; null when it is not three integers. */
function parseVersion(v: string): [number, number, number] | null {
  const parts = v.trim().split(/[-+]/)[0]!.split('.');
  if (parts.length !== 3 || !parts.every(p => /^\d+$/.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Whether version (x.y.z, pre-release dropped) satisfies a caret, tilde or exact range; false when either does not parse. */
export function satisfiesRange(version: string, range: string): boolean {
  const r = range.trim();
  const prefix = r[0] === '^' || r[0] === '~' ? r[0] : '';
  const v = parseVersion(version);
  const base = parseVersion(prefix ? r.slice(1) : r);
  if (!v || !base) return false;
  if (compareVersions(v.join('.'), base.join('.')) < 0) return false;
  if (prefix === '^') return v[0] === base[0] && (base[0] !== 0 || v[1] === base[1]);
  if (prefix === '~') return v[0] === base[0] && v[1] === base[1];
  return v.join('.') === base.join('.');
}
