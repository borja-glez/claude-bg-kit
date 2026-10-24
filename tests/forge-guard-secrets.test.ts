import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { parseGuardInput, type GuardCtx, type GuardInput, type GuardVerdict } from '../src/forge/guard.js';
import { isDotenvName, isForgeAgent, isVerifyAgent, secretOf, secretsRule } from '../src/forge/guard-secrets.js';

const WIN = process.platform === 'win32';
const HOME = path.resolve(os.tmpdir(), 'guard-home');
const MAIN = path.join(HOME, 'work', 'shop');   // the repository under the home folder, as on the person's machine
const OTHER = path.join(HOME, 'work', 'other');
const CTX: GuardCtx = { main: MAIN, gitCommonDir: path.join(MAIN, '.git'), autonomous: null, home: HOME };
const IMPL = 'forge:forge-impl', VERIFY = 'forge:forge-verify', HEAVY = 'forge:forge-verify-heavy';
const sh = (p: string) => p.split(path.sep).join('/');
const ruleOf = (v: GuardVerdict | null) => (v?.decision === 'deny' ? v.rule : 'allow');
const reasonOf = (v: GuardVerdict | null) => (v?.decision === 'deny' ? v.reason : '');
const call = (tool_name: string, tool_input: Record<string, unknown>, agent?: string, cwd = MAIN): GuardInput =>
  ({ tool_name, tool_input, cwd, ...(agent ? { agent_type: agent } : {}) });
const fileInput = (tool: string, p: string) => (tool === 'NotebookEdit' ? { notebook_path: p, new_source: '' } : { file_path: p });
const on = (tool: string, p: string, agent?: string) => secretsRule.check(call(tool, fileInput(tool, p), agent), CTX);
const CREDS = [['.ssh', 'id_ed25519'], ['.aws', 'credentials'], ['.config', 'gh', 'hosts.yml'], ['.netrc'], ['.git-credentials'], ['.kube', 'config']]
  .map(p => path.join(HOME, ...p));

describe('secretsRule: the credentials of the machine and the .env files (w7 A4, guard B)', () => {
  it('denies every forge agent each credential path, and lets the person\'s session and other agents through', () => {
    for (const p of CREDS) for (const tool of ['Read', 'Edit', 'Write', 'NotebookEdit']) {
      for (const a of [IMPL, VERIFY, HEAVY, 'forge-verify', 'forge:forge-review-security']) expect(ruleOf(on(tool, p, a)), `${tool} ${a} ${p}`).toBe('secrets');
      for (const a of [undefined, 'general-purpose', 'Explore', 'x:forge-verify']) expect(on(tool, p, a), `${tool} ${a} ${p}`).toBeNull();
    }
    expect(reasonOf(on('Read', CREDS[0], IMPL))).toMatch(/^forge guard · secrets: ~\/\.ssh /);
  });
  it('a .env is denied to every forge agent but verify, which reads only the repository\'s own and never writes it (decision 2)', () => {
    const inRepo = [path.join(MAIN, '.env'), path.join(MAIN, 'apps', 'web', '.env.local'), path.join(MAIN, '.claude', 'worktrees', 'task-T1', '.env.production')];
    const outside = [path.join(OTHER, '.env'), path.join(HOME, '.env')];
    for (const p of inRepo) {
      expect(ruleOf(on('Read', p, IMPL)), p).toBe('secrets');
      for (const a of [VERIFY, HEAVY, 'forge-verify-heavy']) {
        expect(on('Read', p, a), `${a} reads ${p}`).toBeNull();
        for (const tool of ['Edit', 'Write', 'NotebookEdit']) expect(ruleOf(on(tool, p, a)), `${a} ${tool} ${p}`).toBe('secrets');
      }
    }
    for (const p of outside) for (const a of [IMPL, VERIFY, HEAVY]) expect(ruleOf(on('Read', p, a)), `${a} ${p}`).toBe('secrets');
    for (const p of [...inRepo, ...outside]) expect(on('Read', p, 'general-purpose'), p).toBeNull();
    expect(reasonOf(on('Read', inRepo[0], IMPL))).toContain('forge-verify');
  });
  it('lets through what only looks like a .env or a credential (Review Focus 1)', () => {
    for (const p of ['.env.example', '.env.sample', '.env.template', '.env.dist', '.envrc', 'env.ts', '.environment', path.join('src', 'dotenv.ts')].map(f => path.join(MAIN, f))) {
      for (const tool of ['Read', 'Edit', 'Write']) expect(on(tool, p, IMPL), `${tool} ${p}`).toBeNull();
    }
    for (const p of [path.join(HOME, '.gitconfig'), path.join(HOME, '.config', 'git', 'config'), path.join(HOME, '.sshx', 'a'), path.join(MAIN, '.ssh', 'known_hosts.txt'), path.join(MAIN, 'src', 'aws.ts')])
      expect(on('Read', p, IMPL), p).toBeNull();
    expect([isDotenvName('.ENV'), isDotenvName('.env.Local'), isDotenvName('.env.Example'), isDotenvName('.envrc')]).toEqual([true, true, false, false]);
  });
  it('reads a path as Claude Code or Windows spells it (Review Focus 3)', () => {
    expect(ruleOf(secretsRule.check(call('Read', { file_path: path.join('..', '..', '.ssh', 'id_rsa') }, IMPL), CTX))).toBe('secrets');
    expect(ruleOf(on('Read', sh(path.join(HOME, '.kube', 'config')), IMPL))).toBe('secrets');
    if (WIN) {
      expect(ruleOf(on('Read', path.join(HOME.toUpperCase(), '.SSH', 'ID_RSA'), IMPL))).toBe('secrets');
      expect(ruleOf(on('Read', '\\\\?\\' + path.join(HOME, '.aws', 'credentials'), IMPL))).toBe('secrets');
      expect(ruleOf(on('Read', path.join(HOME, '.ssh.', 'id_rsa'), IMPL))).toBe('secrets');
      expect(ruleOf(on('Read', path.join(MAIN, '.ENV'), IMPL))).toBe('secrets');
      expect(ruleOf(on('Read', path.join(OTHER, '.env::$DATA'), VERIFY))).toBe('secrets');
    }
  });
  it('Grep and Glob: judged by their root and by the name their file pattern points at, never by the text Grep searches (Review Focus 1)', () => {
    const grep = (agent: string | undefined, input: Record<string, unknown>) => secretsRule.check(call('Grep', { pattern: 'KEY', ...input }, agent), CTX);
    const glob = (agent: string | undefined, input: Record<string, unknown>) => secretsRule.check(call('Glob', input, agent), CTX);
    for (const p of [path.join(HOME, '.aws'), HOME, path.dirname(HOME)]) expect(ruleOf(grep(IMPL, { path: p })), p).toBe('secrets');
    expect(grep(IMPL, { path: MAIN })).toBeNull();
    expect(grep(IMPL, {})).toBeNull();
    expect(grep(IMPL, { path: MAIN, pattern: '.env' })).toBeNull();
    expect(grep(IMPL, { path: MAIN, glob: '*.ts' })).toBeNull();
    expect(ruleOf(grep(IMPL, { path: MAIN, glob: '.env*' }))).toBe('secrets');
    expect(grep(VERIFY, { path: MAIN, glob: '.env*' })).toBeNull();
    expect(ruleOf(grep(VERIFY, { path: OTHER, glob: '.env' }))).toBe('secrets');
    expect(ruleOf(grep(VERIFY, { path: path.join(OTHER, '.env') }))).toBe('secrets');
    expect(glob(IMPL, { pattern: '**/*.ts' })).toBeNull();
    expect(glob(IMPL, { pattern: '**/.env.example' })).toBeNull();
    expect(ruleOf(glob(IMPL, { pattern: `${sh(path.join(HOME, '.ssh'))}/*` }))).toBe('secrets');
    expect(ruleOf(glob(IMPL, { pattern: '*', path: path.join(HOME, '.kube') }))).toBe('secrets');
    expect(ruleOf(glob(IMPL, { pattern: '**/.env*', path: MAIN }))).toBe('secrets');
    expect(glob(VERIFY, { pattern: '**/.env*', path: MAIN })).toBeNull();
    expect(ruleOf(glob(VERIFY, { pattern: '.env', path: OTHER }))).toBe('secrets');
    for (const a of [undefined, 'general-purpose']) expect(grep(a, { path: HOME }), String(a)).toBeNull();
  });
  it('reads nothing of ctx for a session that is not a forge agent, nor main for a credential; parseGuardInput keeps agent_type', () => {
    const lazy: GuardCtx = { get main(): string { throw new Error('main read'); }, get gitCommonDir(): string | null { throw new Error('gitCommonDir read'); }, autonomous: null, home: HOME };
    for (const tool of ['Read', 'Write', 'Grep', 'Glob', 'Bash']) {
      expect(secretsRule.check(call(tool, { file_path: path.join(MAIN, '.env'), pattern: '.env', command: 'cat .env' }), lazy), tool).toBeNull();
    }
    expect(ruleOf(secretsRule.check(call('Read', { file_path: CREDS[0] }, IMPL), lazy))).toBe('secrets');
    expect(ruleOf(secretsRule.check(call('Read', { file_path: path.join(MAIN, '.env') }, IMPL), lazy))).toBe('secrets');
    expect(parseGuardInput({ tool_name: 'Read', tool_input: { file_path: 'a' }, agent_type: IMPL, agent_id: 'a1' })).toEqual({ tool_name: 'Read', tool_input: { file_path: 'a' }, agent_type: IMPL });
    expect(parseGuardInput({ tool_name: 'Read', tool_input: {}, agent_type: 5 })).toEqual({ tool_name: 'Read', tool_input: {} });
    expect([isForgeAgent(IMPL), isForgeAgent('forge-mech'), isForgeAgent('general-purpose'), isForgeAgent(undefined)]).toEqual([true, true, false, false]);
    expect([isVerifyAgent(VERIFY), isVerifyAgent('forge-verify-heavy'), isVerifyAgent(IMPL), isVerifyAgent('x:forge-verify')]).toEqual([true, true, false, false]);
    expect(secretOf(path.join(HOME, '.config', 'gh', 'hosts.yml'), HOME)).toBe('~/.config/gh');
  });
});
