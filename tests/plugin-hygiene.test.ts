import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const cp = (n: number) => String.fromCodePoint(n);
// A7: what a reader cannot see. Built from code points, so this file never holds one.
const INVISIBLE = new RegExp(`[${[[0x00ad], [0x061c], [0x115f, 0x1160], [0x180e], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069],
  [0x3164], [0xfeff], [0xffa0], [0xfff9, 0xfffb], [0xe0000, 0xe007f]].map(([a, b]) => (b ? `${cp(a)}-${cp(b)}` : cp(a))).join('')}]`, 'gu');
// A7: a person's folder. A placeholder (or a name that starts with <, $, % or {) is not one. A drive letter starts a
// word, so the end of a name before a colon (the D of "$PWD:/work") is not one.
const NAME = String.raw`(?!(?:user|username|you|me|name|example|runner|public|default)(?![\w.-]))[A-Za-z0-9._-]+`;
const PERSONAL = new RegExp([
  String.raw`(?<!\w)[A-Za-z]:[\\/]+Users[\\/]+${NAME}`,
  String.raw`(?<![\w.])/(?:[a-z]/)?Users/${NAME}`,
  String.raw`(?<![\w.])/home/${NAME}`,
  String.raw`(?<!\w)[A-Za-z]:[\\/]+work(?![\w-])`,
  String.raw`(?<![\w.])/[a-z]/work(?![\w-])`,
].join('|'), 'gi');
const AGENT_KEYS = ['name', 'description', 'model', 'effort', 'maxTurns', 'tools', 'disallowedTools', 'skills', 'memory', 'background', 'isolation', 'color', 'initialPrompt'];
const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Claude Code 2.1.310's hook events, as its binary lists them (2026-10-24). */
const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Notification', 'UserPromptSubmit', 'UserPromptExpansion', 'SessionStart',
  'SessionEnd', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'PermissionRequest',
  'PermissionDenied', 'Setup', 'TeammateIdle', 'TaskCreated', 'TaskCompleted', 'Elicitation', 'ElicitationResult', 'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
  'InstructionsLoaded', 'CwdChanged', 'FileChanged', 'DirectoryAdded', 'MessageDisplay'];
const ROOT_KEYS = ['description', 'hooks', 'modules'];
const GROUP_KEYS = ['matcher', 'hooks'];
const HANDLER_KEYS = ['type', 'command', 'args', 'if', 'shell', 'timeout', 'statusMessage', 'once', 'async', 'asyncRewake'];

const publishedFiles = (): string[] => execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'plugins'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(f => f && existsSync(path.join(ROOT, f)));
const text = (f: string): string | null => { const b = readFileSync(path.join(ROOT, f)); return b.includes(0) ? null : b.toString('utf8'); };
const agents = () => readdirSync(path.join(ROOT, 'plugins')).flatMap(p => {
  const d = path.join(ROOT, 'plugins', p, 'agents');
  return existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.md')).map(f => `plugins/${p}/agents/${f}`) : [];
});

/** Problems with an agent file's frontmatter; an empty list is none. */
function agentIssues(file: string, md: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
  if (!m) return ['no frontmatter'];
  const issues: string[] = [];
  const values = new Map<string, string>();
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!k) continue;
    if (values.has(k[1])) issues.push(`repeated key ${k[1]}`);
    else if (!AGENT_KEYS.includes(k[1])) issues.push(`unknown key ${k[1]}`);
    values.set(k[1], k[2].trim());
  }
  if (values.get('name') !== path.basename(file, '.md')) issues.push(`name is not ${path.basename(file, '.md')}`);
  if (!values.get('description')) issues.push('description is empty');
  const model = values.get('model');
  if (model === undefined || !MODELS.includes(model)) issues.push(`model is ${model ?? 'missing'}, not one of ${MODELS.join(', ')}`);
  const effort = values.get('effort');
  if (effort === undefined || !EFFORTS.includes(effort)) issues.push(`effort is ${effort ?? 'missing'}, not one of ${EFFORTS.join(', ')}`);
  const turns = values.get('maxTurns');
  if (turns !== undefined && !/^[1-9]\d*$/.test(turns)) issues.push(`maxTurns is ${turns}, not a positive integer`);
  return issues;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Problems with a plugin's hooks.json; an empty list is none. */
function hooksIssues(file: string, json: unknown): string[] {
  if (!isObject(json)) return ['not an object'];
  const issues: string[] = [];
  const pluginDir = path.join(ROOT, path.dirname(path.dirname(file)));
  for (const k of Object.keys(json)) if (!ROOT_KEYS.includes(k)) issues.push(`unknown key ${k}`);
  if (json.hooks !== undefined) {
    if (!isObject(json.hooks)) issues.push('hooks is not an object');
    else for (const [event, groups] of Object.entries(json.hooks)) {
      if (!HOOK_EVENTS.includes(event)) issues.push(`unknown event ${event}`);
      if (!Array.isArray(groups) || groups.length === 0) { issues.push(`${event} has no groups`); continue; }
      for (const g of groups) {
        if (!isObject(g)) { issues.push(`${event}: a group is not an object`); continue; }
        for (const k of Object.keys(g)) if (!GROUP_KEYS.includes(k)) issues.push(`${event}: unknown group key ${k}`);
        if (g.matcher !== undefined && typeof g.matcher !== 'string') issues.push(`${event}: matcher is not a string`);
        if (!Array.isArray(g.hooks) || g.hooks.length === 0) { issues.push(`${event}: a group has no hooks`); continue; }
        for (const h of g.hooks) {
          if (!isObject(h)) { issues.push(`${event}: a hook is not an object`); continue; }
          for (const k of Object.keys(h)) if (!HANDLER_KEYS.includes(k)) issues.push(`${event}: unknown hook key ${k}`);
          if (h.type !== 'command') issues.push(`${event}: hook type is ${String(h.type)}, not command`);
          if (typeof h.command !== 'string' || h.command.trim() === '') issues.push(`${event}: command is empty`);
          else for (const r of h.command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g)) {
            if (!existsSync(path.join(pluginDir, r[1]))) issues.push(`${event}: ${r[1]} does not exist`);
          }
          if (h.timeout !== undefined && !(typeof h.timeout === 'number' && h.timeout > 0)) issues.push(`${event}: timeout is not a positive number`);
        }
      }
    }
  }
  if (json.modules !== undefined) {
    const mods = Array.isArray(json.modules) ? json.modules : [json.modules];
    for (const mod of mods) {
      const x = typeof mod === 'string' ? /^\.\/([^/\\]+)\.js$/.exec(mod) : null;
      if (!x) issues.push(`module ${JSON.stringify(mod)} is not ./<x>.js`);
      else if (!existsSync(path.join(ROOT, path.dirname(file), `${x[1]}.js`))) issues.push(`module ./${x[1]}.js does not exist`);
    }
  }
  return issues;
}

describe('what the plugins publish (A7)', () => {
  it('no published file names a personal path (C:\\Users\\<name>, /Users/<name>, /home/<name>, E:\\work, /e/work), dist included', () => {
    const files = publishedFiles();
    expect(files).toContain('plugins/forge/dist/forge.cjs');
    expect(files.flatMap(f => (text(f)?.match(PERSONAL) ?? []).map(m => `${f}: ${m}`))).toEqual([]);
  });
  it('no published file holds an invisible or bidi character', () => {
    expect(publishedFiles().flatMap(f => [...new Set(text(f)?.match(INVISIBLE) ?? [])]
      .map(c => `${f}: U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`))).toEqual([]);
  });
  it('the path check finds a person\'s folder however it is written, and leaves placeholders alone', () => {
    const hits = (s: string) => s.match(PERSONAL) ?? [];
    expect(hits('C:\\Users\\alice\\x')).toEqual(['C:\\Users\\alice']);
    expect(hits('"C:\\\\Users\\\\alice\\\\x"')).toEqual(['C:\\\\Users\\\\alice']);
    expect(hits('/c/Users/alice/x and /Users/bob/y')).toEqual(['/c/Users/alice', '/Users/bob']);
    expect(hits('/home/carol/.claude')).toEqual(['/home/carol']);
    expect(hits('E:\\work\\x, e:/work/y, /e/work/z')).toEqual(['E:\\work', 'e:/work', '/e/work']);
    for (const ok of ['C:\\Users\\<name>\\.claude', 'C:\\Users\\you', '/home/user/x', '/Users/me', '~/.claude/projects',
      '${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs', 'E:\\workspace', 'src/work/x', 'docs/home/x', 'docker run -v "$PWD:/work" -w /work']) expect(hits(ok), ok).toEqual([]);
    expect(`a${cp(0x200b)}b${cp(0x202e)}c`.match(INVISIBLE)).toHaveLength(2);
    expect(`a${cp(0xe0041)}b`.match(INVISIBLE)).toHaveLength(1);
    expect(`a${cp(0xfff9)}b${cp(0xfffb)}c`.match(INVISIBLE)).toHaveLength(2);
    expect('emoji 👩 ❤ é ñ —'.match(INVISIBLE)).toBeNull();
  });
});

describe('agents (A7)', () => {
  it('every agent of every plugin has known keys, its own name, a description, and declares its model and effort', () => {
    const list = agents();
    expect(list.length).toBeGreaterThanOrEqual(18);
    expect(list.flatMap(f => agentIssues(f, readFileSync(path.join(ROOT, f), 'utf8')).map(i => `${f}: ${i}`))).toEqual([]);
  });
  it("design-critic reviews on opus at high effort, never on the session's model", () => {
    const head = readFileSync(path.join(ROOT, 'plugins/waypoint/agents/design-critic.md'), 'utf8').split(/\r?\n---\r?\n/)[0];
    expect(head).toMatch(/\nmodel: opus\r?\n/);
    expect(head).toMatch(/\neffort: high\r?(\n|$)/);
    expect(head).not.toContain('inherit');
  });
  it('the agent check flags what claude plugin validate lets pass', () => {
    const fm = (lines: string) => `---\nname: x\ndescription: d\n${lines}\n---\n\nbody\n`;
    expect(agentIssues('plugins/p/agents/x.md', fm('model: opus\neffort: high\ntools: Read, Grep'))).toEqual([]);
    for (const bad of ['model: opux\neffort: high', 'model: opus\neffort: ultra', 'model: inherit\neffort: high', 'model: opus',
      'effort: high', 'model: opus\neffort: high\nbogus: 1', 'model: opus\neffort: high\nhooks: x', 'model: opus\neffort: high\nmaxTurns: 0',
      'model: opus\neffort: high\nmodel: sonnet']) expect(agentIssues('plugins/p/agents/x.md', fm(bad)), bad).not.toEqual([]);
    expect(agentIssues('plugins/p/agents/y.md', fm('model: opus\neffort: high'))).not.toEqual([]);
    expect(agentIssues('plugins/p/agents/x.md', 'no frontmatter')).not.toEqual([]);
  });
});

describe('hooks.json (A7)', () => {
  it('every hooks.json has only known keys, events and fields, and names files that exist', () => {
    const files = readdirSync(path.join(ROOT, 'plugins')).map(p => `plugins/${p}/hooks/hooks.json`).filter(f => existsSync(path.join(ROOT, f)));
    expect(files).toEqual(expect.arrayContaining(['plugins/forge/hooks/hooks.json', 'plugins/lens/hooks/hooks.json', 'plugins/waypoint/hooks/hooks.json']));
    expect(files.flatMap(f => hooksIssues(f, JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'))).map(i => `${f}: ${i}`))).toEqual([]);
  });
  it('the hooks check flags $schema, an unknown key, an unknown event, a misspelled field and a missing file', () => {
    const stop = [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs" hook stop' }] }];
    expect(hooksIssues('plugins/forge/hooks/hooks.json', { hooks: { Stop: stop } })).toEqual([]);
    for (const bad of [
      { $schema: 'x', hooks: { Stop: stop } }, { bogusKey: 1, hooks: { Stop: stop } }, { hooks: { PostToolUze: stop } },
      { hooks: { Stop: [{ id: 'a', hooks: stop[0].hooks }] } }, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x', timeOut: 5 }] }] } },
      { hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: 'x' }] }] } }, { hooks: { Stop: [] } },
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/dist/missing.cjs"' }] }] } },
      { modules: ['./missing.js'] }, { modules: ['register.js'] },
    ]) expect(hooksIssues('plugins/forge/hooks/hooks.json', bad), JSON.stringify(bad)).not.toEqual([]);
  });
});
