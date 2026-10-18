import type { Command } from '../context.js';
import { loadConfig, NAME, WORKFLOWS, AUTONOMIES } from '../../config.js';
import { isWorkflow, isAutonomy } from '../../prefs.js';
import { UsageError } from '../errors.js';
import { readLocal, updateLocal, readLearned, trackedState, surfacePermissions, OBJECT_ID, type SurfacePermission } from '../../local.js';
import { commandsHash, configCommands, readTrust, recordTrust, updateTrust } from '../../trust.js';
import { readSurfaces } from '../../surfaces.js';
import { defaultGit } from '../exec.js';
import { surfaceBlob } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, ok, json, ts } = ctx;
  const [sub, key, value] = args;
  // I-03: the answer about the commands of .forge/config.yaml, kept in the git directory of the repository of the code
  // checked (--cwd), where every check reads it (src/forge/trust.ts), never in local.yaml.
  if (sub === 'get' && key === 'commands') return json(readTrust(repoDir).commands ?? null);
  if (sub === 'set' && key === 'commands') {
    // allowed needs --expect, the hash the question showed, so commands changed since then are never allowed.
    if (value !== 'allowed' && value !== 'denied' && value !== 'none') throw new UsageError('local set commands: the value must be allowed|denied|none');
    const kept = (fn: Parameters<typeof updateTrust>[1]) => {
      const r = updateTrust(repoDir, fn);
      if (!r.ok) {
        throw new UsageError(r.why === 'no-repo'
          ? `local set commands: ${repoDir} is not in a git repository, so forge keeps no answer for it and asks each time`
          : `local set commands: git could not tell where the repository of ${repoDir} is, so forge keeps no answer for it and asks each time`);
      }
      return ok('ok');
    };
    if (value === 'none') return kept(({ commands: _gone, ...r }) => r);
    const list = configCommands(loadConfig(repoDir));
    if (!list.length) throw new UsageError('local set commands: .forge/config.yaml defines no commands');
    const hash = commandsHash(list);
    const expected = flag('expect');
    if (value === 'allowed' && expected === undefined) throw new UsageError('local set commands allowed: --expect <hash> is required (the hash FORGE triage printed)');
    if (expected !== undefined && expected !== hash) throw new UsageError('local set commands: the commands of .forge/config.yaml changed since forge showed them: run FORGE triage again');
    return kept(r => ({ ...r, commands: recordTrust(r.commands, value, list, hash, ts()) }));
  }
  if (sub === 'get') {
    const s = readLocal(io.cwd);
    if (key === undefined) return json(s);
    const m = /^surfaces\.(.+)$/.exec(key);
    if (!m) throw new UsageError('local get: the path must be surfaces.<name>');
    return json(surfacePermissions(io.cwd, s)[m[1]] ?? null);
  }
  if (sub === 'set' && (key === 'workflow' || key === 'autonomy')) {
    if (value === 'none') {
      updateLocal(io.cwd, s => { const next = { ...s }; delete next[key]; return next; });
      return ok('ok');
    }
    if (key === 'workflow' ? !isWorkflow(value) : !isAutonomy(value)) throw new UsageError(`local set: ${key} must be one of ${(key === 'workflow' ? WORKFLOWS : AUTONOMIES).join('|')}|none`);
    updateLocal(io.cwd, s => ({ ...s, [key]: value }));
    return ok('ok');
  }
  if (sub === 'set') {
    const m = /^surfaces\.(.+)$/.exec(key ?? '');
    if (!m || !NAME.test(m[1])) throw new UsageError('local set: the path must be surfaces.<name>');
    if (value !== 'allowed' && value !== 'denied' && value !== 'none') throw new UsageError('local set: the value must be allowed|denied|none');
    // An allowance is tied to what the surface says now (in the code checked, --cwd): a later edit of the file asks
    // again (verify-plan: changed). --expect: the hash verify-plan showed, so a file changed since the question is
    // never allowed. It keeps the file's blob and the commit, so a later change can be shown as a diff.
    const expected = flag('expect');
    if (has('expect') && !expected) throw new UsageError('local set: --expect needs the hash verify-plan gave');
    const surface = readSurfaces(repoDir, readLearned(io.cwd)).find(x => x.name === m[1]);
    if (value === 'allowed' && !surface) throw new UsageError(`local set: .forge/verify/${m[1]}.md does not exist`);
    // final-carries 7: a local.yaml git tracks, or cannot say about, grants no surface, so an allowance written there
    // would ask forever.
    const tracked = value === 'allowed' ? trackedState(io.cwd, 'local.yaml') : 'untracked';
    if (tracked === 'tracked') {
      throw new UsageError('local set: git tracks .forge/local.yaml, so a permission in it grants nothing: untrack it with git rm --cached .forge/local.yaml (the file stays) and answer again');
    }
    if (tracked === 'unknown') {
      throw new UsageError('local set: git could not tell whether .forge/local.yaml is tracked (it refused to run here, or failed), so a permission in it grants nothing and forge asks each time');
    }
    if (value === 'allowed' && expected !== undefined && expected !== surface!.hash) {
      throw new UsageError(`local set: .forge/verify/${m[1]}.md changed since verify-plan showed it: run verify-plan again`);
    }
    let perm: SurfacePermission = { state: 'denied', hash: null };
    if (value === 'allowed') {
      const blob = surfaceBlob(repoDir, surface!.file);
      const commit = (io.git ?? defaultGit(repoDir))(['rev-parse', 'HEAD'])?.trim();
      perm = { state: 'allowed', hash: surface!.hash, ...(blob ? { blob } : {}), ...(commit && OBJECT_ID.test(commit) ? { commit } : {}) };
    }
    updateLocal(io.cwd, s => {
      const surfaces = { ...s.surfaces };
      if (value === 'none') delete surfaces[m[1]];
      else surfaces[m[1]] = perm;
      return { ...s, surfaces };
    });
    return ok('ok');
  }
  throw new UsageError('usage: forge local get [surfaces.<name>] | set surfaces.<name> allowed [--expect <hash>]|denied|none | get commands | set commands allowed --expect <hash>|denied|none | set workflow <w>|none | set autonomy ask|auto|none');
};
