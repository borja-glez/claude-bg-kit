import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { guardRulesFor } from '../src/forge/autonomous.js';
import { AUTONOMY_RULES } from '../src/forge/autonomy-rules.js';
import { parseGuardInput, TRUST_RULES, type GuardCtx, type GuardInput, type GuardVerdict } from '../src/forge/guard.js';
import { CTX as AUTO_CTX } from './helpers/autonomy.js';
import { useTempDirs } from './helpers/tmp.js';
import { homeSpelled, isDotenvName, isForgeAgent, isVerifyAgent, secretOf, secretsRule } from '../src/forge/guard-secrets.js';

const tmp = useTempDirs();
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
    expect(ruleOf(on('Read', '~/.ssh/id_rsa', IMPL))).toBe('secrets');
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
    expect(ruleOf(grep(IMPL, { path: path.join(HOME, '.config') }))).toBe('secrets');
    expect(ruleOf(glob(IMPL, { pattern: `${sh(path.join(HOME, '.config'))}/**` }))).toBe('secrets');
    expect(ruleOf(glob(IMPL, { pattern: '**/hosts.yml', path: path.join(HOME, '.config') }))).toBe('secrets');
    expect(grep(IMPL, { path: path.join(HOME, '.config', 'other') })).toBeNull();
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
    // Claude Code's ~ and the Git Bash /x/ spelling: it rewrites only file_path before the hook, so a Grep/Glob path reaches it raw and the rule expands it itself.
    for (const p of ['~', '~/.ssh']) expect(ruleOf(grep(IMPL, { path: p })), p).toBe('secrets');
    expect(ruleOf(glob(IMPL, { path: '~/.ssh', pattern: '*' }))).toBe('secrets');
    expect(ruleOf(glob(IMPL, { pattern: '~/.ssh/*' }))).toBe('secrets');
    expect(grep(IMPL, { path: '~/work' })).toBeNull();
    if (WIN) {
      const gb = `/${HOME[0].toLowerCase()}${sh(HOME.slice(2))}/.ssh`;
      expect(ruleOf(grep(IMPL, { path: gb })), gb).toBe('secrets');
      expect(ruleOf(glob(IMPL, { path: gb, pattern: '*' })), gb).toBe('secrets');
    }
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

describe('secretsRule in Bash and PowerShell (w7 A4, guard B)', () => {
  const H = sh(HOME);
  const bash = (command: string, agent?: string) => secretsRule.check(call('Bash', { command }, agent), CTX);
  const pwsh = (command: string, agent?: string) => secretsRule.check(call('PowerShell', { command }, agent), CTX);
  const gitBash = `/${HOME[0].toLowerCase()}${sh(HOME.slice(2))}`;
  it.each([
    'cat ~/.ssh/id_ed25519', 'cat $HOME/.aws/credentials', 'cat "${HOME}/.config/gh/hosts.yml"', 'cp ~/.netrc /tmp/n', 'echo token >> ~/.git-credentials',
    'KUBECONFIG=~/.kube/config kubectl get pods', 'kubectl --kubeconfig=~/.kube/config get pods', 'cd ~/.ssh && ls', 'cat ../../.ssh/id_rsa', `cat ${H}/.aws/config`,
    'ls -la ~/.ssh/', 'tar -czf /tmp/k.tgz ~/.kube', 'x=$(cat ~/.ssh/id_rsa)', 'bash -c "cat ~/.ssh/id_rsa"', 'grep -r BEGIN ~', 'rg password $HOME', 'find ~ -name id_rsa',
    'cat .env', 'source .env', 'node --env-file=.env app.js', 'cat apps/web/.env.local', `cat ${sh(OTHER)}/.env`, 'cat "$CFG/.env"',
    'cat .env*', 'cat "apps/*/.env"', 'rg --regexp=x ~/.ssh', 'grep -e x -r ~',
    'grep -f ~/.ssh/id_rsa -r src',
    ...(WIN ? ['cmd /c "type %USERPROFILE%\\.ssh\\id_rsa"', `cat ${gitBash}/.ssh/id_rsa`, `cat "${HOME.toUpperCase()}\\.SSH\\ID_RSA"`,
      'cmd /c "findstr /r /c:. %USERPROFILE%\\.ssh\\id_rsa"'] : []),
  ])('denies a forge agent the Bash call %s (Review Focus 3)', command => expect(ruleOf(bash(command, IMPL))).toBe('secrets'));
  it.each([
    'Get-Content $env:USERPROFILE\\.ssh\\id_rsa', 'Get-Content ~\\.aws\\credentials', 'type $HOME\\.kube\\config', 'Copy-Item ${env:USERPROFILE}\\.netrc x', 'Get-Content .env',
    'findstr /r /c:. $env:USERPROFILE\\.ssh\\id_rsa', 'findstr /c:BEGIN ~\\.ssh\\id_rsa',
  ])('denies a forge agent the PowerShell call %s', command => expect(ruleOf(pwsh(command, IMPL))).toBe('secrets'));
  it.each([
    'grep -rn ".env" src', 'rg -e .env src', 'rg --regexp=.env src', 'rg -e.env src', 'rg -n "process\\.env" src', 'echo .env >> .gitignore', "printf '%s\\n' .env >> .gitignore",
    'git add .env.example', 'cat .env.example', 'curl -s https://example.com/.env', 'git commit -m "document ~/.ssh setup"', 'cat ~/.gitconfig', 'ls ~/work', 'npm test',
    'grep -r x src', "find . -name '*.ts'",
    'grep -m 1 .env src', 'rg -g "*.ts" .env src', 'rg -n -t ts .env src',
  ])('lets a forge agent run %s (Review Focus 1)', command => expect(bash(command, IMPL)).toBeNull());
  it('lets a forge agent search for the text .env with Select-String', () => {
    expect(pwsh('Select-String -Pattern .env -Path src\\a.ts', IMPL)).toBeNull();
    expect(pwsh('Select-String -Pattern:.env -Path src\\a.ts', IMPL)).toBeNull();
  });
  it.each([
    'Select-String -Path ~\\.ssh\\id_rsa foo', 'sls -LiteralPath $HOME\\.aws\\credentials foo', 'Get-Content -Path:~\\.ssh\\id_rsa', 'Get-Content -LiteralPath:$env:USERPROFILE\\.netrc',
    'Select-String -Path:.env foo',
  ])('denies the PowerShell call %s whose path is the value of an option', command => expect(ruleOf(pwsh(command, IMPL))).toBe('secrets'));
  it('verify reads the repository .env through Bash, and writes none and reads no other', () => {
    for (const command of ['cat .env', 'dotenv -e .env -- node app.js', 'npm run dev']) expect(bash(command, VERIFY), command).toBeNull();
    for (const command of [`cat ${sh(OTHER)}/.env`, 'echo X=1 >> .env', "sed -i 's/a/b/' .env", 'cat "$CFG/.env"', 'cat ~/.ssh/id_rsa']) expect(ruleOf(bash(command, HEAVY)), command).toBe('secrets');
  });
  it('the person\'s session and other agents run any of them', () => {
    for (const a of [undefined, 'general-purpose']) for (const command of ['cat ~/.ssh/id_rsa', 'cat .env', 'grep -r BEGIN ~']) expect(bash(command, a), `${a} ${command}`).toBeNull();
  });
  it('homeSpelled replaces only a leading spelling of the home folder', () => {
    for (const t of ['~', '~/.ssh', '$HOME/.aws', '${HOME}/x', '$env:USERPROFILE\\.ssh', '${env:USERPROFILE}\\x', '%USERPROFILE%\\.ssh', '%HOMEDRIVE%%HOMEPATH%\\x'])
      expect(homeSpelled(t, HOME).startsWith(HOME), t).toBe(true);
    for (const t of ['~user/x', '$HOMEDIR/x', 'a/~/x', 'x$HOME']) expect(homeSpelled(t, HOME), t).toBe(t);
  });
});

describe('forge hook guard: the secrets of the machine (w7 A4, guard B)', () => {
  const SILENT = { code: 0, stdout: '', stderr: '' };
  const NOW = () => new Date('2026-10-24T10:00:00.000Z');
  const SSH = path.join(os.homedir(), '.ssh', 'id_rsa');
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
  let root: string;
  beforeEach(() => { root = tmp('guard-b-'); git(root, 'init', '-q', '-b', 'main'); });
  const guard = (input: Record<string, unknown>, cwd = root) => run(['hook', 'guard'], {
    cwd: root, now: NOW, env: {},
    stdin: JSON.stringify({ session_id: 's1', transcript_path: 't.jsonl', cwd, permission_mode: 'default', hook_event_name: 'PreToolUse', tool_use_id: 'toolu_1', ...input }),
  });
  const reason = (r: { code: number; stdout: string; stderr: string }) => {
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason as string;
  };
  const sub = (agent_type: string) => ({ agent_id: 'a1', agent_type });
  it('denies a forge subagent a Read, Grep, Glob, Edit or Bash of the credentials, and says why', () => {
    const calls: [string, Record<string, unknown>][] = [['Read', { file_path: SSH }], ['Grep', { pattern: 'x', path: path.dirname(SSH) }], ['Glob', { pattern: '*', path: path.dirname(SSH) }],
      ['Edit', { file_path: SSH, old_string: 'a', new_string: 'b' }], ['Bash', { command: 'cat ~/.aws/credentials' }]];
    for (const [tool_name, tool_input] of calls) expect(reason(guard({ tool_name, tool_input, ...sub('forge:forge-impl') })), tool_name).toMatch(/^forge guard · secrets:/);
  });
  it('verify reads the repository\x27s .env and no other; an implementer reads none', () => {
    const env = path.join(root, '.env');
    expect(guard({ tool_name: 'Read', tool_input: { file_path: env }, ...sub('forge:forge-verify') })).toEqual(SILENT);
    expect(reason(guard({ tool_name: 'Read', tool_input: { file_path: env }, ...sub('forge:forge-impl') }))).toContain('forge-verify');
    expect(reason(guard({ tool_name: 'Write', tool_input: { file_path: env, content: '' }, ...sub('forge:forge-verify') }))).toMatch(/^forge guard · secrets:/);
    expect(reason(guard({ tool_name: 'Read', tool_input: { file_path: path.join(tmp('guard-b-other-'), '.env') }, ...sub('forge:forge-verify-heavy') }))).toMatch(/^forge guard · secrets:/);
  });
  it('prints nothing for the person\x27s session and for other agents (Review Focus 2)', () => {
    expect(guard({ tool_name: 'Read', tool_input: { file_path: SSH } })).toEqual(SILENT);
    expect(guard({ tool_name: 'Read', tool_input: { file_path: SSH }, ...sub('general-purpose') })).toEqual(SILENT);
    expect(guard({ tool_name: 'Bash', tool_input: { command: 'cat ~/.ssh/id_rsa' }, ...sub('Explore') })).toEqual(SILENT);
    expect(guard({ tool_name: 'Grep', tool_input: { pattern: 'x', path: os.homedir() } })).toEqual(SILENT);
  });
  it('a Read never fails closed: where an unreadable run.json denies a Bash, a Read passes (Review Focus 2)', () => {
    mkdirSync(path.join(root, '.forge'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'run.json'), '{"autonomous": ');
    const wt = path.join(root, '.claude', 'worktrees', 'x');
    mkdirSync(wt, { recursive: true });
    const file = path.join(root, 'a.ts');
    expect(guard({ tool_name: 'Read', tool_input: { file_path: file } }, wt)).toEqual(SILENT);
    expect(guard({ tool_name: 'Read', tool_input: { file_path: file }, ...sub('forge:forge-impl') }, wt)).toEqual(SILENT);
    expect(reason(guard({ tool_name: 'Bash', tool_input: { command: 'ls' } }, wt))).toContain('guard-error');
  });
  it('guardRulesFor runs the secrets rule after the trust rules for every session, and before the autonomy rules', () => {
    const ids = (ctx: GuardCtx) => guardRulesFor(ctx).map(r => r.id);
    expect(ids({ ...AUTO_CTX, autonomous: null })).toEqual([...TRUST_RULES.map(r => r.id), 'secrets']);
    expect(ids(AUTO_CTX)).toEqual([...TRUST_RULES.map(r => r.id), 'secrets', ...AUTONOMY_RULES.map(r => r.id)]);
  });
});
