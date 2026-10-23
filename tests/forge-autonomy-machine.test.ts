import { describe, it, expect } from 'vitest';
import { AUTONOMY_RULES, machineRule } from '../src/forge/autonomy-rules.js';
import { evaluateGuard } from '../src/forge/guard.js';
import { CTX, ATTENDED, bash, pwsh, mcp, B, P } from './helpers/autonomy.js';

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
