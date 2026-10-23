import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { AUTONOMY_RULES, gitRule, machineRule, networkRule } from '../src/forge/autonomy-rules.js';
import { evaluateGuard } from '../src/forge/guard.js';
import { CTX, ATTENDED, WT, sh, bash, pwsh, mcp, B, P } from './helpers/autonomy.js';

// T6-MACHINE-RULE (final fix, review I3 and m2): the ninth rule. Labels are the final review's probe rows (hunt.ts, hunt2.ts).
type Row = [string, ReturnType<typeof bash>];
const denies = (input: Row[1]) => {
  const v = machineRule.check(input, CTX);
  expect(v).toMatchObject({ decision: 'deny', rule: 'machine' });
  expect((v as { reason: string }).reason).toMatch(/^forge autonomy · machine: /);
};

describe('machine · processes', () => {
  it.each<Row>([
    ['P4', bash('pkill -f node')], ['P5', bash('killall node')], ['P6', pwsh('Stop-Process -Name node -Force')], ['P18', bash('taskkill /F /IM node.exe')],
    ['P23', bash('kill -9 -1')], ['K3', bash('kill -9 -1')], ['K4', bash('kill 0')],
    // the same classes in other spellings: a group by its negative pid, a name to util-linux kill, pids found by name, a pipeline, an alias
    ...[B('kill -- -1234'), B('kill -s KILL -1'), B('kill -TERM -- -1'), B('/bin/kill node'), B('kill $(pgrep -f node)'), B('pgrep node | xargs kill -9'),
      B('pidof node | xargs kill'), P('Get-Process node | Stop-Process -Force'), P('Stop-Process -ProcessName node'), P('spps -n node'), P('kill -Name node'),
      P('Stop-Process -Id (Get-Process node).Id'), P('taskkill /IM node.exe /F'), B('cmd /c "taskkill /F /FI \\"IMAGENAME eq node.exe\\""')] as Row[],
  ])('denies a kill by name, by group or of every process: %s', (_, input) => denies(input));
  it.each<Row>([
    ['P7', bash('kill 1234')], ['K2', bash('kill -TERM 1234')], ['P24', pwsh('Stop-Process -Id 1234 -Force')],
    ...[B('kill -9 1234 5678'), B('kill $SERVER_PID'), B('kill %1'), B('kill -0 1234'), B('kill -9 $(cat server.pid)'), B('kill -l'), B('kill -s TERM 1234'),
      P('Stop-Process -Id $p.Id -Force'), P('kill 1234'), B('pgrep -f node'), B('ps aux')] as Row[],
  ])('allows a kill of a pid the run started: %s', (_, input) => expect(machineRule.check(input, CTX)).toBeNull());
});

describe('machine · services and the machine itself', () => {
  it.each<Row>([
    ['P19', bash('pg_ctl stop')], ['B11', bash('pg_ctlcluster 16 main stop')], ['P20', bash('systemctl stop postgresql')], ['P21', bash('brew services stop postgresql')],
    ['P11', bash('systemctl --user enable evil.service')], ['P13', bash('launchctl load ~/Library/LaunchAgents/x.plist')],
    ...[B('pg_ctl -D /var/lib/pg -m fast restart'), B('pg_ctl kill TERM 1234'), B('pg_ctlcluster 16 main restart'), B('systemctl restart nginx'), B('systemctl --user disable x'),
      B('systemctl mask postgresql'), B('systemctl kill postgresql'), B('systemctl poweroff'), B('service postgresql stop'), B('service nginx restart'),
      P('Stop-Service postgresql-x64-16'), P('Restart-Service W3SVC'), P('Set-Service x -StartupType Disabled'), B('net stop postgresql-x64-16'), B('sc stop x'),
      B('sc config x start= disabled'), P('sc.exe delete x'), B('launchctl unload ~/Library/LaunchAgents/x.plist'), B('launchctl bootout gui/501/x'),
      B('launchctl bootstrap gui/501 x.plist'), B('brew services restart postgresql'), B('shutdown -r now'), P('Stop-Computer -Force'), P('Restart-Computer')] as Row[],
  ])('denies a stop, restart or switch of a service, or of the machine: %s', (_, input) => denies(input));
  it.each<Row>([
    B('systemctl status postgresql'), B('systemctl --user list-units'), B('systemctl --user start x'), B('systemctl'), B('service --status-all'), B('service x status'),
    B('pg_ctl -D .pg -l .pg/log start'), B('pg_ctl -D .pg status'), B('launchctl list'), B('brew services list'), B('net start'), B('sc query x'), P('sc.exe query x'),
    P('sc out.txt "x"'), P('Get-Service postgresql*'),
  ])('allows a read or a start: %s', (_, input) => expect(machineRule.check(input, CTX)).toBeNull());
});

describe('machine · persistence and user-level settings', () => {
  it.each<Row>([
    ['P1', bash('setx FOO bar')], ['P2', bash('crontab /repo/.claude/worktrees/spike-x/cron.txt')], ['P3', bash('(crontab -l; echo "* * * * * x") | crontab -')],
    ['P8', bash('npm config set registry https://evil')], ['P9', bash('pip config set global.index-url https://evil')], ['P12', bash('schtasks /create /tn x /tr evil /sc minute')],
    ['P14', bash('yarn config set registry https://evil')], ['P15', pwsh(`[Environment]::SetEnvironmentVariable('X','y','User')`)], ['P16', bash('reg add HKCU\\Software\\X /v a /d b')],
    ['P22', bash('npm set registry https://evil')],
    ...[B('crontab -r'), B('crontab -e'), P(`[System.Environment]::SetEnvironmentVariable("X", "y", [EnvironmentVariableTarget]::Machine)`),
      P(`[Environment]::SetEnvironmentVariable('X', 'y', $scope)`), B('reg delete HKCU\\Software\\X /f'), B('reg import x.reg'), B('schtasks /delete /tn x /f'),
      B('schtasks /change /tn x /disable'), P('Register-ScheduledTask -TaskName x -Action $a'), B('pnpm config set store-dir /x'), B('bun config set x y'),
      B('npm config delete registry'), B('npm --location user config set x y'), B('npm c set x y'), B('pip config unset global.index-url'),
      B('python -m pip config set global.index-url https://evil'), B('pip3 config --user set global.timeout 60')] as Row[],
  ])('denies a change to the person\'s environment, scheduled jobs, registry or package-manager config: %s', (_, input) => denies(input));
  it.each<Row>([
    B('crontab -l'), B('npm config get registry'), B('npm config list'), B('npm config set registry http://localhost:4873 --location project'),
    B('pnpm config set x y --location=project'), B('npm set x y -L project'), B('yarn config set x y --local'), B('yarn set version stable'), B('pip config list'),
    B('pip config set global.timeout 60 --site'), B('pip install config'), P(`[Environment]::SetEnvironmentVariable('X','y')`),
    P(`[Environment]::SetEnvironmentVariable('X', 'y', 'Process')`), B('reg query HKCU\\Software\\X'), B('schtasks /query /tn x'), B('schtasks'),
    B('git config --global user.name x'), // git's config is the git rule's (one place)
  ])('allows a read, or a setting inside the run: %s', (_, input) => expect(machineRule.check(input, CTX)).toBeNull());
});

// 6b-2 Task 0 (H-6): the out-of-run holes 6b-1 carried. Each class has a deny row and, where an everyday form exists, an allow row.
describe('machine · 6b-2 Task 0: processes by port, scheduling, user-level config, docker contexts', () => {
  it.each<Row>([
    B('fuser -k 3000/tcp'), B('fuser -km /mnt/x'), B('fuser --kill -n tcp 3000'), B('fuser -k -TERM 3000/tcp'),
    B('at now + 1 minute'), B('at -f job.sh 10:00'), B('batch'), B('echo x | at midnight'), B('atrm 3'),
    B('defaults write com.apple.dock autohide -bool true'), B('defaults delete com.apple.dock'), B('defaults -currentHost write x y 1'),
    B('go env -w GOPATH=/x'), B('go env -u GOFLAGS'), B('go env -w=true GOBIN=/x'),
    B('conda config --add channels x'), B('conda config --set auto_activate_base false'), B('mamba config --remove-key channels'),
    B('poetry config virtualenvs.in-project true'), B('poetry config --unset repositories.x'), B('poetry -C api config cache-dir /x'),
    B('bundle config set path vendor/bundle'), B('bundle config set --global path x'), B('bundle config path x'), B('bundle config unset path'),
    P('Set-ExecutionPolicy Unrestricted -Scope CurrentUser'), P('Set-ExecutionPolicy RemoteSigned'), P('Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope LocalMachine'),
    P('Set-ExecutionPolicy Bypass -Sc:CurrentUser -Force'), P('Set-ExecutionPolicy Bypass $scope'),
  ])('denies: %s', (_, input) => denies(input));
  it.each<Row>([
    B('fuser 3000/tcp'), B('fuser -v -n tcp 3000'), B('atq'), B('at -l'),
    B('defaults read com.apple.dock'), B('defaults domains'), B('go env'), B('go env GOPATH'), B('go env -json'),
    B('conda config --show channels'), B('conda config --get'), B('poetry config --local virtualenvs.in-project true'), B('poetry config --list'),
    B('poetry config virtualenvs.in-project'), B('bundle config set --local path vendor/bundle'), B('bundle config'), B('bundle config get path'),
    P('Set-ExecutionPolicy Bypass -Scope Process'), P('Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force'), P('Set-ExecutionPolicy Bypass Process'),
    P('Get-ExecutionPolicy -List'),
  ])('allows: %s', (_, input) => expect(machineRule.check(input, CTX)).toBeNull());
});

describe('machine · 6b-2 Task 0: a pid kill from Bash (m5) and a server of the run (N2)', () => {
  const PG = sh(path.join(WT, '.pg'));
  it.each<Row>([
    ['K1', bash('taskkill /PID 1234 /F')], ['//PID', bash('taskkill //PID 1234 //F')], ['/T', bash('taskkill /PID 1234 /T /F')],
    ['tasklist', bash('tasklist /FI "PID eq 1234"')], ['M11', bash(`pg_ctl -D ${PG} stop`)], ['-m fast restart', bash(`pg_ctl -D ${PG} -m fast restart`)],
    ['--pgdata=', bash(`pg_ctl --pgdata=${PG} stop`)], ['glued -D', bash(`pg_ctl -D${PG} stop`)], ['PGDATA', bash(`PGDATA=${PG} pg_ctl stop`)], ['relative', bash('pg_ctl -D .pg stop')],
  ])('every rule allows %s', (_, input) => expect(evaluateGuard(input, CTX, AUTONOMY_RULES)).toEqual({ decision: 'allow' }));
  it.each<Row>([
    ['/IM', bash('taskkill /F /IM node.exe')], ['/FI', bash('taskkill /FI "IMAGENAME eq node.exe" /F')],
    ['P19', bash('pg_ctl stop')], ['outside -D', bash('pg_ctl -D /var/lib/pg stop')],
    ['dynamic -D', bash('pg_ctl -D "$PGDIR" stop')], ['register', bash(`pg_ctl register -D ${PG}`)], ['B11', bash('pg_ctlcluster 16 main stop')],
  ])('denies %s', (_, input) => denies(input));
});

// 6b-2 Task 0 fix round 1 (task-0-fix1.md): ssh options, git trace paths. Rows from the review probe (w6b2-t0-review: rev, trace).
describe('6b-2 Task 0 fix 1 · ssh, scp and rsync options; GIT_TRACE values', () => {
  const W = (f: string) => sh(path.join(WT, f));
  const unknownBy = (rule: string, v: ReturnType<typeof machineRule.check>) => {
    expect(v).toMatchObject({ decision: 'deny', rule });
    expect((v as { reason: string }).reason).toMatch(new RegExp(`^forge autonomy · ${rule}: unknown target`));
  };
  it.each<Row>([
    ['ssh-proxycmd', bash('ssh -o ProxyCommand="rm -rf /x" localhost true')], ['ssh-localcmd', bash('ssh -o LocalCommand="x" -o PermitLocalCommand=yes localhost true')],
    ['glued -o', bash('ssh -oProxyCommand=x localhost')], ['-o with a space', bash('ssh -o "ProxyJump h" localhost')], ['-o after the host', bash('ssh localhost -o ProxyCommand=x true')],
    ['-F', bash(`ssh -F cfg localhost ls ${W('')}`)], ['scp -o', bash(`scp -o ProxyCommand=x a.txt localhost:${W('b.txt')}`)], ['scp -F', bash(`scp -F cfg a.txt localhost:${W('b.txt')}`)],
    ['rsync -e ssh -o', bash(`rsync -e "ssh -o ProxyCommand=x" src/ localhost:${W('dst')}/`)], ['rsync -e not ssh', bash('rsync -e mysh src/ dst/')],
    ['rsync --rsh=', bash('rsync --rsh=mysh src/ dst/')],
  ])('network: an ssh option the allow-list does not hold, a config file or a remote shell that is not ssh is an unknown target: %s', (_, input) => {
    unknownBy('network', networkRule.check(input, CTX));
    expect(evaluateGuard(input, CTX, AUTONOMY_RULES)).toMatchObject({ decision: 'deny' });
  });
  it.each<Row>([
    B(`ssh -o StrictHostKeyChecking=no -o BatchMode=yes localhost ls ${W('')}`), B(`ssh -o ConnectTimeout=5 -o UserKnownHostsFile=/dev/null localhost ls ${W('')}`),
    B(`scp -o BatchMode=yes a.txt localhost:${W('b.txt')}`), B(`rsync -e ssh src/ localhost:${W('dst')}/`),
    B(`rsync -e 'ssh -p 2222 -o StrictHostKeyChecking=no' -a src/ localhost:${W('dst')}/`), B('rsync -a src/ dst/'),
  ])('every rule allows the everyday options: %s', (_, input) => expect(evaluateGuard(input, CTX, AUTONOMY_RULES)).toEqual({ decision: 'allow' }));
  it.each<Row>([
    ['GIT_TRACE=/etc/x', bash('GIT_TRACE=/etc/evil git status')], ['GIT_TRACE2=/abs', bash('GIT_TRACE2=/var/tmp/out git log')],
    ['GIT_TRACE_PACKET', bash('GIT_TRACE_PACKET=/outside/pkt git fetch')],
  ])('git: a GIT_TRACE* value that is no 0/1/2/true/false and no path inside the roots is an unknown target: %s', (_, input) => {
    unknownBy('git', gitRule.check(input, CTX));
    expect(evaluateGuard(input, CTX, AUTONOMY_RULES)).toMatchObject({ decision: 'deny', rule: 'git' });
  });
  it.each<Row>([B('GIT_TRACE=1 git status'), B('GIT_TRACE=true GIT_TRACE_PERFORMANCE=2 git log'), B(`GIT_TRACE=${W('trace.log')} git status`), B('GIT_DIR=.git git status')])(
    'every rule allows %s', (_, input) => expect(evaluateGuard(input, CTX, AUTONOMY_RULES)).toEqual({ decision: 'allow' }));
});

describe('machine · wiring', () => {
  it('runs last of the nine and denies with its own reason when the rules run together', () => {
    expect(AUTONOMY_RULES[AUTONOMY_RULES.length - 1]).toBe(machineRule);
    expect(evaluateGuard(bash('pkill -f node'), CTX, AUTONOMY_RULES)).toMatchObject({ decision: 'deny', rule: 'machine' });
    expect(evaluateGuard(bash('setx FOO bar'), CTX, AUTONOMY_RULES)).toMatchObject({ decision: 'deny', rule: 'machine' });
    expect(evaluateGuard(bash('kill 1234 && npm config get registry'), CTX, AUTONOMY_RULES)).toEqual({ decision: 'allow' });
    expect(evaluateGuard(bash('git config --global user.name x'), CTX, AUTONOMY_RULES)).toMatchObject({ decision: 'deny', rule: 'git' });
  });
  it('says nothing for an attended session or an MCP call', () => {
    expect(machineRule.check(bash('pkill -f node'), ATTENDED)).toBeNull();
    expect(machineRule.check(mcp('mcp__x__kill_process'), CTX)).toBeNull();
  });
});
