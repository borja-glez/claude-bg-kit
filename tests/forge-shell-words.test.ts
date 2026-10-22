import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { shellSegments, shellPath, commandName, type Dialect } from '../src/forge/shell-words.js';

const W = path.resolve('/w');
const segs = (c: string, d: Dialect = 'bash') => shellSegments(c, W, d);
const argv = (c: string, d: Dialect = 'bash') => segs(c, d).map(s => s.argv.map(w => w.text));

describe('shellSegments', () => {
  it('splits on && || ; | & and newlines, never inside quotes', () => {
    expect(argv('a 1 && b "x && y"; c | d\ne & f || g \'h;i\'')).toEqual([['a', '1'], ['b', 'x && y'], ['c'], ['d'], ['e'], ['f'], ['g', 'h;i']]);
    expect(segs('a 1 && b "x && y"; c | d\ne & f || g').map(s => s.after)).toEqual([null, '&&', ';', '|', '\n', '&', '||']);
  });
  it('joins a line continued with a backslash', () => {
    expect(argv('rm \\\n  -rf x')).toEqual([['rm', '-rf', 'x']]);
  });
  it('bash: an unquoted backslash escapes the next character; inside double quotes it escapes only $ ` " \\ and a newline (B2)', () => {
    expect(argv('rm -rf .\\./.\\./x')).toEqual([['rm', '-rf', '../../x']]);
    expect(argv('echo C:\\Users\\x "C:\\Users\\x" \'C:\\x\' "a\\$b"')).toEqual([['echo', 'C:Usersx', 'C:\\Users\\x', 'C:\\x', 'a$b']]);
  });
  it('bash: marks variables, substitutions, globs and ranges; single quotes keep $ literal; a brace list expands as bash expands it', () => {
    const [s] = segs(`rm -rf "$DIR" '$HOME' \${Y} *.log {1..3}.log`);
    expect(s.argv.map(w => [w.text, w.dynamic, w.glob])).toEqual([
      ['rm', false, false], ['-rf', false, false], ['$DIR', true, false], ['$HOME', false, false], ['${Y}', true, false], ['*.log', false, true], ['{1..3}.log', false, true],
    ]);
    expect(argv('rm -rf {..,x}/y "{a,b}"')).toEqual([['rm', '-rf', '../y', 'x/y', '{a,b}']]);
  });
  it('powershell: the backslash is literal, the backtick escapes, \'\' is a quote, $env:X is dynamic (B2)', () => {
    expect(segs("Remove-Item C:\\Users\\x $env:X 'it''s' a`$b", 'powershell')[0].argv.map(w => [w.text, w.dynamic]))
      .toEqual([['Remove-Item', false], ['C:\\Users\\x', false], ['$env:X', true], ["it's", false], ['a$b', false]]);
  });
  it('cmd: the backslash is literal, ^ escapes, %X% is dynamic (B2)', () => {
    expect(segs('rd /s /q %TEMP%\\x C:\\a^&b', 'cmd')[0].argv.map(w => [w.text, w.dynamic]))
      .toEqual([['rd', false], ['/s', false], ['/q', false], ['%TEMP%\\x', true], ['C:\\a&b', false]]);
  });
  it('an unterminated quote makes the rest one dynamic word', () => {
    expect(segs('rm "unterminated x')[0].argv[1]).toEqual({ text: 'unterminated x', dynamic: true, glob: false });
  });
  it('parses the commands inside -c, /c, -Command, -EncodedCommand, eval, iex, $(…), <(…), backticks, a script block and rebase -x, each in its own dialect', () => {
    const first = (c: string, d: Dialect = 'bash') => segs(c, d).map(s => s.argv[0]?.text);
    expect(first('bash -c "rm -rf /x && echo ok"')).toEqual(['bash', 'rm', 'echo']);
    expect(first('echo $(git push) `dropdb x`')).toEqual(['echo', 'git', 'dropdb']);
    expect(first('diff <(git push) x')).toEqual(['diff', 'git']);
    expect(first('pwsh -Command "Remove-Item -Recurse C:\\x"')).toEqual(['pwsh', 'Remove-Item']);
    expect(first('powershell -ExecutionPolicy Bypass -c "Remove-Item x"')).toEqual(['powershell', 'Remove-Item']);
    expect(first('cmd /c del /q C:\\x')).toEqual(['cmd', 'del']);
    expect(segs('cmd /c "del C:\\x"').at(-1)).toMatchObject({ dialect: 'cmd', argv: [{ text: 'del' }, { text: 'C:\\x' }] });
    expect(first("eval 'git push'")).toEqual(['eval', 'git']);
    expect(first('iex "Remove-Item x"', 'powershell')).toEqual(['iex', 'Remove-Item']);
    expect(first('& { Remove-Item -Recurse x }', 'powershell')).toContain('Remove-Item');
    const enc = Buffer.from('Remove-Item -Recurse x', 'utf16le').toString('base64');
    expect(first(`powershell -EncodedCommand ${enc}`, 'powershell')).toEqual(['powershell', 'Remove-Item']);
    expect(segs('powershell -enc @@@', 'powershell')[0].argv.at(-1)!.dynamic).toBe(true);
    expect(first('git rebase -x "git push" HEAD~2')).toEqual(['git', 'git']);
  });
  it('takes VAR=value before a command and the assignments of env as the segment env, and drops env, nohup, time, exec, command, builtin', () => {
    const [s] = segs('PLAYWRIGHT_BROWSERS_PATH=./pw nohup env A=1 time npx playwright install');
    expect(s.argv.map(w => w.text)).toEqual(['npx', 'playwright', 'install']);
    expect(Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, v.text]))).toEqual({ PLAYWRIGHT_BROWSERS_PATH: './pw', A: '1' });
  });
  it('drops the wrappers and keeps the command they run (H6)', () => {
    expect(argv('timeout 5 nice -n 5 stdbuf -oL doas chronic rm -rf x')).toEqual([['rm', '-rf', 'x']]);
    expect(argv('watch -n 1 rm x')).toEqual([['rm', 'x']]);
    expect(argv('pnpm exec playwright install')).toEqual([['playwright', 'install']]);
    expect(argv('Start-Process rm -ArgumentList "-rf x"', 'powershell')).toEqual([['rm', '-rf', 'x']]);
  });
  it('xargs and find -exec run a command whose arguments the hook cannot see (H6)', () => {
    const x = segs('find ../.. -name "*.log" | xargs -0 rm -f');
    expect(x.map(s => [s.argv.map(w => w.text), s.dynamicArgs])).toEqual([[['find', '../..', '-name', '*.log'], false], [['rm', '-f'], true]]);
    const f = segs('find . -name x -exec rm -rf {} \\;');
    expect(f.map(s => [s.argv.map(w => w.text), s.dynamicArgs])).toEqual([[['find', '.', '-name', 'x'], false], [['rm', '-rf'], true]]);
  });
  it('keeps file redirections with their target in every form, and leaves out the null sinks and fd duplications (B2)', () => {
    const [s] = segs('cmd > out.txt 2>&1 >> "C:\\a b.log" 2> /dev/null >| f1 &> f2 &>> f3 3> f4 >&f5 <> f6');
    expect(s.redirects.map(r => [r.op, r.target.text])).toEqual([['>', 'out.txt'], ['>>', 'C:\\a b.log'], ['>', 'f1'], ['>', 'f2'], ['>>', 'f3'], ['>', 'f4'], ['>', 'f5'], ['>', 'f6']]);
    expect(s.argv.map(w => w.text)).toEqual(['cmd']);
    expect(segs('Get-Item x *> o.txt 2>$null > NUL', 'powershell')[0].redirects.map(r => [r.op, r.target.text])).toEqual([['>', 'o.txt']]);
    expect(segs('psql -d x < drop.sql')[0].redirects.map(r => [r.op, r.target.text])).toEqual([['<', 'drop.sql']]);
  });
  it('carries cd, pushd and Set-Location to the segments after them; a subshell keeps its cd; popd or a dynamic one leaves the cwd unknown', () => {
    expect(segs('cd sub && rm a; pushd ../abs; Set-Location "$X"; rm b').map(s => s.cwd))
      .toEqual([W, path.join(W, 'sub'), path.join(W, 'sub'), path.join(W, 'abs'), null]);
    expect(segs('(cd sub && rm a); rm b').map(s => s.cwd)).toEqual([W, path.join(W, 'sub'), W]);
    expect(segs('pushd sub; popd; rm c').map(s => s.cwd)).toEqual([W, path.join(W, 'sub'), null]);
  });
});

describe('shellSegments · what a shell does that the brief leaves to the parser', () => {
  it('skips heredoc and here-string bodies and comments, but splits the $(…) of an unquoted heredoc', () => {
    expect(argv("git commit -m \"$(cat <<'EOF'\nfix: don't (break); rm -rf /\nEOF\n)\" && git push").map(a => a[0])).toEqual(['git', 'cat', 'git']);
    expect(argv('cat <<EOF\n$(rm -rf /x)\nEOF\nls # it\'s ; rm y')).toEqual([['cat'], ['rm', '-rf', '/x'], ['ls']]);
    expect(argv("git commit -m @'\nit's (x); rm -rf y\n'@; git push", 'powershell')).toEqual([['git', 'commit', '-m', "it's (x); rm -rf y"], ['git', 'push']]);
  });
  it('reads the command after a reserved word, a case pattern or an extglob', () => {
    expect(argv('if true; then rm -rf x; fi; for f in *; do rm "$f"; done').map(a => a[0])).toEqual(['true', 'rm', 'for', 'rm']);
    expect(argv('echo "$(case $x in a) rm -rf y;; esac)"').map(a => a[0])).toEqual(['echo', 'case', 'rm']);
    expect(segs('rm !(keep)')[0].argv[1]).toEqual({ text: '!(keep)', dynamic: false, glob: true });
  });
  it('a cd in a pipeline or in the background leaves the cwd unknown; cmd\'s & runs in sequence', () => {
    expect(segs('cd sub | cat; rm a').map(s => s.cwd)).toEqual([W, null, null]);
    expect(segs('cd sub & rm a').map(s => s.cwd)).toEqual([W, null]);
    expect(segs('cd sub & del a', 'cmd').map(s => s.cwd)).toEqual([W, path.join(W, 'sub')]);
  });
  it('what the outer shell expands stays dynamic in the command it hands to another shell', () => {
    expect(segs('cmd /c rd /s /q $DIR').at(-1)!.argv.at(-1)).toEqual({ text: '$DIR', dynamic: true, glob: false });
    expect(segs('bash -c "cmd /c rd /s /q $D"').at(-1)).toMatchObject({ dialect: 'cmd', argv: [{ text: 'rd' }, {}, {}, { text: '$D', dynamic: true }] });
  });
  it('powershell splits every script block and reads a comma as an array; cmd reads glued switches, if and start', () => {
    expect(argv('Get-ChildItem | ForEach-Object { Remove-Item $_ }', 'powershell').map(a => a[0])).toEqual(['Get-ChildItem', 'ForEach-Object', 'Remove-Item']);
    expect(argv('Remove-Item a,b', 'powershell')).toEqual([['Remove-Item', 'a', 'b']]);
    expect(argv('rd/s/q x & if exist y (del y) & start "" /b rd z', 'cmd')).toEqual([['rd', '/s', '/q', 'x'], ['del', 'y'], ['rd', 'z']]);
  });
  it('powershell: a parameter glued to its value with a colon is read like the spaced one', () => {
    expect(argv('Start-Process rm -ArgumentList:"-rf x"', 'powershell')).toEqual([['rm', '-rf', 'x']]);
    expect(argv("Start-Process -FilePath:rm -ArgumentList:'-rf','x' -Wait", 'powershell')).toEqual([['rm', '-rf', 'x']]);
    expect(segs('pwsh -Command:"Remove-Item x"', 'powershell').map(s => s.argv[0]?.text)).toEqual(['pwsh', 'Remove-Item']);
    expect(segs('powershell -NoProfile -c:"Remove-Item x"').map(s => s.argv[0]?.text)).toEqual(['powershell', 'Remove-Item']);
    const enc = Buffer.from('Remove-Item -Recurse x', 'utf16le').toString('base64');
    expect(segs(`powershell -EncodedCommand:${enc}`, 'powershell').map(s => s.argv[0]?.text)).toEqual(['powershell', 'Remove-Item']);
    expect(segs('powershell -enc:@@@', 'powershell')[0].argv.at(-1)!.dynamic).toBe(true);
    expect(segs('Invoke-Expression -Command:"Remove-Item x"', 'powershell').map(s => s.argv[0]?.text)).toEqual(['Invoke-Expression', 'Remove-Item']);
  });
  it("cmd: the ('…') of a for /f is a command, split in cmd", () => {
    expect(segs("for /f %i in ('rd /s /q x') do echo %i", 'cmd').map(s => s.argv.map(w => w.text))).toContainEqual(['rd', '/s', '/q', 'x']);
    expect(segs('for /f "usebackq" %i in (`del /q y`) do echo %i', 'cmd').map(s => s.argv.map(w => w.text))).toContainEqual(['del', '/q', 'y']);
  });
  it('never throws on deep nesting or a brace bomb: what it cannot read is dynamic', () => {
    expect(segs(`${'$('.repeat(2000)}x${')'.repeat(2000)}`)[0].argv[0].dynamic).toBe(true);
    expect(segs(`echo ${'{a,b}'.repeat(30)}`)[0].argv[1].dynamic).toBe(true);
  });
});

describe('shellPath and commandName', () => {
  it('reads a path the way each shell does, on each platform (B2, M9)', () => {
    expect(shellPath('/e/repo/src', 'C:\\w', 'bash', 'win32')).toBe('E:\\repo\\src');
    expect(shellPath('/cygdrive/d/x', 'C:\\w', 'bash', 'win32')).toBe('D:\\x');
    expect(shellPath('/tmp/a', 'C:\\w', 'bash', 'win32')).toBe(path.win32.join(os.tmpdir(), 'a'));
    expect(shellPath('/usr/x', 'C:\\w', 'bash', 'win32')).toBeNull();
    expect(shellPath('/usr/x', '/w', 'bash', 'linux')).toBe('/usr/x');
    expect(shellPath('..\\x', '/w/a', 'powershell', 'linux')).toBe('/w/x');
    expect(shellPath('C:\\x', 'E:\\w', 'cmd', 'win32')).toBe('C:\\x');
    expect(shellPath('C:\\x', '/w', 'cmd', 'linux')).toBeNull();
    expect(shellPath('~/x', '/w', 'bash', 'linux')).toBeNull();
  });
  it('names a command by its basename, without a leading backslash, an extension or case (H6)', () => {
    expect(['/bin/rm', '\\rm', 'RM.exe', 'C:\\x\\Remove-Item.PS1'].map(t => commandName({ text: t, dynamic: false, glob: false }))).toEqual(['rm', 'rm', 'rm', 'remove-item']);
  });
});
