import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// w8 M2. Claude Code 2.1.310's built-in cc-plugin-sec-default is seated outermost on a machine with managed settings or a
// managed MCP file, in Team and Enterprise organizations, and for the rest of a session once it was seated. There it
// sends these events on to the `append` tier (`o.to(r, "append")`), past every hook of the plugins a person installs:
// all of classic.*, the PASSED_OVER_EVENTS constant, and session.append at the doors below (tool-message and note only
// in part). A mod that hangs anything on them works on one machine and silently not on another, so none may.
const PASSED_OVER_EVENTS = [
  'prompt.section', 'prompt.context', 'prompt.attachment', 'prompt.compose', 'skill.prompt', 'attribution.text', 'session.compact', 'settings.read',
];
const PASSED_OVER_DOORS = ['attachment', 'hook-context', 'compaction', 'tool-message', 'note'];
// What a glob or a negation is checked against: a classic event of any name, the passed-over events and session.append.
const SKIPPED_SAMPLE = ['classic.SessionStart', 'classic.SubagentStop', 'classic.TaskCompleted', ...PASSED_OVER_EVENTS, 'session.append'];
const MOD_DIRS = ['src/lens', 'src/mod'];

export interface Registration { file: string; line: number; pattern: string | null; doors: string[] | null }

const IDENT = '[A-Za-z_$][\\w$]*';

/** The names a file registers through: a `Register` function's parameter and any parameter typed `On`. */
function registrars(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(new RegExp(`:\\s*Register\\s*=\\s*(?:async\\s*)?\\(?\\s*(${IDENT})`, 'g'))) names.add(m[1]);
  for (const m of source.matchAll(new RegExp(`(${IDENT})\\s*:\\s*On\\b`, 'g'))) names.add(m[1]);
  return names;
}

/** The text of the object literal starting at `from` (a `{`), braces balanced; null when it does not close. */
function objectAt(source: string, from: number): string | null {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(from, i + 1);
  }
  return null;
}

/** The source with its comments blanked (lines kept): «works on (E-02)» in a comment is no call. */
const blank = (s: string) => s.replace(/[^\n]/g, ' ');
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));

/** Every registration call in `source`: its pattern (null when it is not a plain string literal) and its doors. */
export function registrationsIn(file: string, text: string): Registration[] {
  const source = withoutComments(text);
  const out: Registration[] = [];
  for (const name of registrars(source)) {
    for (const m of source.matchAll(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g'))) {
      const at = m.index! + m[0].length;
      const line = source.slice(0, m.index).split('\n').length;
      const literal = /^\s*(['"`])((?:(?!\1)[^\\$]|\\.)*)\1\s*([,)])/.exec(source.slice(at));
      if (!literal) { out.push({ file, line, pattern: null, doors: null }); continue; }
      let doors: string[] | null = null;
      if (literal[3] === ',') {
        const rest = source.slice(at + literal[0].length);
        const brace = /^\s*\{/.exec(rest);
        const matcher = brace ? objectAt(rest, brace[0].length - 1) : null;
        const door = matcher ? /\bdoor\s*:\s*(\[[^\]]*\]|(['"])[^'"]*\2)/.exec(matcher) : null;
        if (door) doors = [...door[1].matchAll(/(['"])([^'"]*)\1/g)].map(d => d[2]);
      }
      out.push({ file, line, pattern: literal[2], doors });
    }
  }
  return out;
}

const globRe = (glob: string) => new RegExp(`^${glob.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

/** Why a registration would be passed over (or could not be checked), or null when it always runs. */
export function passedOver(r: Registration): string | null {
  const p = r.pattern;
  if (p === null) return 'its event is not a string literal, so this test cannot check it';
  if (p.startsWith('!')) return `the negation ${p} selects passed-over events`;
  if (p.includes('*')) {
    const hit = SKIPPED_SAMPLE.find(e => globRe(p).test(e));
    return hit ? `the glob ${p} selects ${hit}` : null;
  }
  if (p.startsWith('classic.')) return `${p} is a classic event`;
  if (PASSED_OVER_EVENTS.includes(p)) return `${p} is one of PASSED_OVER_EVENTS`;
  if (p === 'session.append') {
    if (!r.doors?.length) return 'session.append without a door matcher reaches the passed-over doors';
    const door = r.doors.find(d => PASSED_OVER_DOORS.includes(d));
    if (door) return `session.append at the door ${door} is passed over`;
  }
  return null;
}

function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return sourcesOf(path);
    return /\.tsx?$/.test(d.name) && !d.name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('mods never hang on what cc-plugin-sec-default passes over (w8 M2)', () => {
  const all = MOD_DIRS.flatMap(dir => sourcesOf(dir).flatMap(file => registrationsIn(file.replace(/\\/g, '/'), readFileSync(file, 'utf8'))));

  it('the scan finds the registrations of both mods', () => {
    expect(all.filter(r => r.file.startsWith('src/lens/')).length).toBeGreaterThan(10);
    expect(all.filter(r => r.file.startsWith('src/mod/')).length).toBeGreaterThan(5);
    expect(all.some(r => r.pattern === 'ui.render')).toBe(true);
  });

  it('no registration in src/lens or src/mod is passed over', () => {
    const bad = all.flatMap(r => { const why = passedOver(r); return why ? [`${r.file}:${r.line} ${why}`] : []; });
    expect(bad).toEqual([]);
  });
});

describe('the scan itself (w8 M2)', () => {
  const scan = (source: string) => registrationsIn('x.tsx', source).map(r => [r.pattern, r.doors, passedOver(r)]);
  it('reads the Register parameter whatever its name, and helpers that take On', () => {
    expect(scan("export const register: Register = hook => { hook('turn.start', f); hook(\"classic.Stop\", g); };"))
      .toEqual([['turn.start', null, null], ['classic.Stop', null, 'classic.Stop is a classic event']]);
    expect(scan("function wire(on: On) { on('session.compact', f).catch(c); }"))
      .toEqual([['session.compact', null, 'session.compact is one of PASSED_OVER_EVENTS']]);
  });
  it('flags globs and negations that select a passed-over event, and passes the others', () => {
    const verdict = (p: string) => passedOver({ file: 'x', line: 1, pattern: p, doors: null });
    expect(verdict('*')).toMatch(/selects/);
    expect(verdict('classic.*')).toMatch(/selects classic\./);
    expect(verdict('prompt.*')).toMatch(/selects prompt\.section/);
    expect(verdict('session.*')).toMatch(/selects session\.compact/);
    expect(verdict('!tool.describe')).toMatch(/negation/);
    expect(verdict('tool.*')).toBeNull();
    expect(verdict('ui.*')).toBeNull();
  });
  it('lets session.append through only at doors that always run', () => {
    expect(scan("const register: Register = on => { on('session.append', { door: 'response' }, f); };")[0][2]).toBeNull();
    expect(scan("const register: Register = on => { on('session.append', { door: ['prompt', 'note'] }, f); };")[0][2]).toMatch(/door note/);
    expect(scan("const register: Register = on => { on('session.append', f); };")[0][2]).toMatch(/without a door/);
    expect(scan("const register: Register = on => { on('session.append', { door: 'compaction' }, f); };")[0][2]).toMatch(/door compaction/);
  });
  it('reads no call in a comment, and keeps the line numbers', () => {
    const source = "const register: Register = on => {\n  // lens keeps which task it works on (E-02)\n  /* on('classic.Stop') */\n  on('turn.start', f);\n};";
    expect(registrationsIn('x.tsx', source)).toEqual([{ file: 'x.tsx', line: 4, pattern: 'turn.start', doors: null }]);
  });
  it('cannot be fooled by a computed event name', () => {
    expect(scan('const register: Register = on => { on(EVENT, f); on(`classic.${x}`, g); };').map(r => r[2]))
      .toEqual(['its event is not a string literal, so this test cannot check it', 'its event is not a string literal, so this test cannot check it']);
  });
});
