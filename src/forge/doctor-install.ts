import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTE_SUPERPOWERS, satisfiesRange, type CheckResult, type DoctorCheck, type DoctorCtx } from './doctor.js';
import { installedPlugins, locateSuperpowers, type InstalledPlugin } from './superpowers.js';
import { findWaypointCli } from './cli/commands/waypoint-cli.js';
import { samePath } from '../lib/worktree.js';

/** A4: the checks of the install forge runs from: waypoint and superpowers against their ranges, which copy runs, the permissions and waypoint doctor. */
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const readJson = (file: string): unknown => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const forgeRootOf = (ctx: DoctorCtx) => path.resolve(path.dirname(ctx.scriptPath), '..');
const parses = (v: string) => /^\d+\.\d+\.\d+([-+].*)?$/.test(v.trim());

/** The unverified result when installed_plugins.json exists and is not JSON (the lookups would read it as "nothing installed"). */
function unreadableInstall(id: string, ctx: DoctorCtx): CheckResult | null {
  const file = path.join(ctx.configDir, 'plugins', 'installed_plugins.json');
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return existsSync(file) ? { id, status: 'unverified', detail: 'plugins/installed_plugins.json does not read' } : null; }
  try { JSON.parse(text); return null; } catch { return { id, status: 'unverified', detail: 'plugins/installed_plugins.json does not read' }; }
}

/** The version of an install: the entry's when it parses, else the plugin.json under its installPath; null when neither does (R12). */
function versionOf(version: string, installPath: string): string | null {
  if (parses(version)) return version;
  const v = readJson(path.join(installPath, '.claude-plugin', 'plugin.json'));
  return isObj(v) && typeof v.version === 'string' && parses(v.version) ? v.version : null;
}

const forgeManifest = (ctx: DoctorCtx): Record<string, unknown> | null => {
  const v = readJson(path.join(forgeRootOf(ctx), '.claude-plugin', 'plugin.json'));
  return isObj(v) ? v : null;
};

function waypointRange(ctx: DoctorCtx): string | null {
  const deps = forgeManifest(ctx)?.dependencies;
  const dep = Array.isArray(deps) ? deps.find(d => isObj(d) && d.name === 'waypoint') : undefined;
  return isObj(dep) && typeof dep.version === 'string' ? dep.version : null;
}

const waypointVersionCheck: DoctorCheck = {
  id: 'waypoint-version',
  run(ctx) {
    const id = 'waypoint-version';
    const bad = unreadableInstall(id, ctx);
    if (bad) return bad;
    const range = waypointRange(ctx);
    if (!range) return { id, status: 'unverified', detail: "forge's plugin.json does not give a range for waypoint" };
    const found = installedPlugins({ configDir: ctx.configDir, projectDir: ctx.main }, n => n === 'waypoint');
    if (!found.length) {
      return { id, status: 'fail', detail: 'waypoint is not installed for this project; forge needs it', fix: { do: 'install the waypoint plugin and restart Claude Code', kind: 'manual' } };
    }
    const versions = found.map(p => ({ p, version: versionOf(p.version, p.installPath) }));
    const outside = versions.find(v => v.version !== null && !satisfiesRange(v.version, range));
    if (outside) {
      return {
        id, status: 'fail', detail: `waypoint ${outside.version} is outside forge's range ${range}`, data: { range, versions: versions.map(v => v.version) },
        fix: { do: 'update waypoint, then restart Claude Code', kind: 'manual' },
      };
    }
    if (versions.some(v => v.version === null)) return { id, status: 'unverified', detail: 'the version of an installed waypoint does not read' };
    return { id, status: 'ok', detail: `waypoint ${versions.map(v => v.version).join(', ')} satisfies ${range}`, data: { range, versions: versions.map(v => v.version) } };
  },
};

type Kind = 'installPath' | 'cache' | 'dev' | 'other';

function classify(dir: string, entries: readonly InstalledPlugin[], ctx: DoctorCtx, dev: string | null): Kind {
  if (entries.some(e => samePath(e.installPath, dir))) return 'installPath';
  const rel = path.relative(path.join(ctx.configDir, 'plugins', 'cache'), path.resolve(dir));
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return 'cache';
  if (dev !== null && samePath(dev, dir)) return 'dev';
  return 'other';
}

const runningCopyCheck: DoctorCheck = {
  id: 'running-copy',
  run(ctx) {
    const id = 'running-copy';
    const bad = unreadableInstall(id, ctx);
    if (bad) return bad;
    const opts = { configDir: ctx.configDir, projectDir: ctx.main };
    const plugins = installedPlugins(opts, n => n === 'forge' || n === 'waypoint');
    const forgeRoot = forgeRootOf(ctx);
    const devFile = path.join(forgeRoot, '..', 'waypoint', 'dist', 'waypoint.cjs');
    const wpCli = findWaypointCli(ctx.scriptPath, opts);
    const forgeEntries = plugins.filter(p => p.name === 'forge');
    const wpEntries = plugins.filter(p => p.name === 'waypoint');
    const forgeKind = classify(forgeRoot, forgeEntries, ctx, existsSync(devFile) ? forgeRoot : null);
    const wpRoot = wpCli ? path.resolve(path.dirname(wpCli), '..') : null;
    const wpIsDev = wpCli !== null && samePath(wpCli, devFile);
    const wpKind = wpRoot ? classify(wpRoot, wpEntries, ctx, wpIsDev ? wpRoot : null) : null;
    const m = forgeManifest(ctx);
    const data = {
      forge: { kind: forgeKind, path: forgeRoot, version: typeof m?.version === 'string' ? m.version : null },
      waypoint: wpRoot && wpKind ? { kind: wpKind, path: wpRoot } : null,
    };
    const off = (forgeEntries.length > 0 && forgeKind !== 'installPath') || (wpEntries.length > 0 && wpKind !== null && wpKind !== 'installPath');
    if (off) {
      return {
        id, status: 'warn', detail: 'the forge or waypoint running is not the copy installed for this project', data,
        fix: { do: 'the forge running is not the one installed for this project: restart Claude Code, or check plugins/installed_plugins.json', kind: 'manual' },
      };
    }
    return { id, status: 'ok', detail: `forge runs from ${forgeKind}${wpKind ? `, waypoint from ${wpKind}` : ''}`, data };
  },
};

const superpowersVersionCheck: DoctorCheck = {
  id: 'superpowers-version',
  run(ctx) {
    const id = 'superpowers-version';
    const bad = unreadableInstall(id, ctx);
    if (bad) return bad;
    const sp = locateSuperpowers({ configDir: ctx.configDir, projectDir: ctx.main });
    if (!sp.installed) return { id, status: 'ok', detail: 'superpowers is not installed (forge:route adapts to it when it is)' };
    const version = versionOf(sp.version ?? 'unknown', sp.installPath ?? '');
    if (version === null) return { id, status: 'unverified', detail: 'the version of the installed superpowers does not read' };
    if (!satisfiesRange(version, ROUTE_SUPERPOWERS)) {
      return {
        id, status: 'warn', detail: `superpowers ${version} is outside the range forge:route is adapted for (${ROUTE_SUPERPOWERS})`,
        fix: { do: 'update forge, whose route skill follows superpowers', kind: 'manual' },
      };
    }
    return { id, status: 'ok', detail: `superpowers ${version} is inside ${ROUTE_SUPERPOWERS}` };
  },
};

const RECOMMEND = {
  allow: ['Bash(node *forge.cjs*)'],
  deny: ['Bash(*forge.cjs* hook *)'],
  ask: ['Bash(*forge.cjs* swarm merge*)', 'Bash(*forge.cjs* local set*)'],
};

/** What a settings file says: whether its permissions.allow names forge.cjs, or that it exists and does not read. */
function allowsForge(file: string): 'yes' | 'no' | 'unreadable' {
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return existsSync(file) ? 'unreadable' : 'no'; }
  try {
    const s: unknown = JSON.parse(text);
    const allow = isObj(s) && isObj(s.permissions) ? s.permissions.allow : null;
    return Array.isArray(allow) && allow.some(a => typeof a === 'string' && a.includes('forge.cjs')) ? 'yes' : 'no';
  } catch { return 'unreadable'; }
}

const permissionsCheck: DoctorCheck = {
  id: 'permissions',
  run(ctx) {
    const id = 'permissions';
    const project = [path.join(ctx.main, '.claude', 'settings.local.json'), path.join(ctx.main, '.claude', 'settings.json')];
    const files = [...project, path.join(ctx.configDir, 'settings.json')];
    const states = files.map(f => ({ f, s: allowsForge(f) }));
    const data = { recommend: RECOMMEND };
    if (states.slice(0, 2).some(x => x.s === 'yes')) return { id, status: 'ok', detail: "the project's settings allow forge.cjs", data };
    const unreadable = states.find(x => x.s === 'unreadable');
    if (unreadable) return { id, status: 'unverified', detail: `${unreadable.f} does not read`, data };
    return {
      id, status: 'warn',
      detail: states[2]!.s === 'yes'
        ? "only the user's settings allow forge.cjs, which every project reads; the project's do not"
        : "no settings file of this project allows forge.cjs, so each forge command asks",
      data,
      fix: { do: 'add "Bash(node *forge.cjs*)" to permissions.allow in .claude/settings.local.json of this project', kind: 'manual' },
    };
  },
};

const MAX_PLANS = 5;

const waypointDoctorCheck: DoctorCheck = {
  id: 'waypoint-doctor',
  run(ctx) {
    const id = 'waypoint-doctor';
    const wp = findWaypointCli(ctx.scriptPath, { configDir: ctx.configDir, projectDir: ctx.main });
    if (!wp) return { id, status: 'unverified', detail: 'waypoint not found: skipped' };
    const base = path.join(ctx.main, 'docs', 'waypoint');
    let names: string[] = [];
    try { names = readdirSync(base).sort(); } catch { /* no docs/waypoint */ }
    const plans = names.map(n => `docs/waypoint/${n}/plan.yaml`).filter(rel => existsSync(path.join(ctx.main, rel))).slice(0, MAX_PLANS);
    if (!plans.length) return { id, status: 'ok', detail: 'no waypoint project here' };
    const leftovers: { plan: string; path: string }[] = [];
    for (const plan of plans) {
      try {
        // Never --fix: the check only reports. stderr is piped, so a failing waypoint does not write into doctor's.
        const out = execFileSync(process.execPath, [wp, 'doctor', plan], {
          cwd: ctx.main, input: '', timeout: 10000, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });
        const parsed: unknown = JSON.parse(out);
        const list = isObj(parsed) ? parsed.leftovers : null;
        if (!Array.isArray(list)) return { id, status: 'unverified', detail: `waypoint doctor ${plan} gave no leftovers list` };
        for (const l of list) leftovers.push({ plan, path: isObj(l) && typeof l.path === 'string' ? l.path : String(l) });
      } catch (e) {
        return { id, status: 'unverified', detail: `waypoint doctor ${plan} did not run: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}` };
      }
    }
    if (!leftovers.length) return { id, status: 'ok', detail: 'waypoint left nothing under .waypoint/' };
    // --fix removes only the leftovers of the plan it is given: one command for each plan that left some.
    const fixes = plans.filter(p => leftovers.some(l => l.plan === p)).map(p => `waypoint doctor ${p} --fix`);
    return {
      id, status: 'warn', detail: `waypoint left ${leftovers.length} leftover(s) under .waypoint/`, data: { leftovers },
      fix: { do: fixes.length === 1 ? `${fixes[0]} removes them` : `${fixes.join(' and ')} remove them`, kind: 'confirm' },
    };
  },
};

export const INSTALL_CHECKS: readonly DoctorCheck[] = [waypointVersionCheck, runningCopyCheck, superpowersVersionCheck, permissionsCheck, waypointDoctorCheck];
