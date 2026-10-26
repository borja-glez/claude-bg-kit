import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

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

// The calls are read with TypeScript's own parser (review Minor 6): a `/*` in a string such as '.forge/status/*.json', a
// regex or a template is no comment, and a comment holds no call.
const typeName = (t: ts.TypeNode | undefined): string | null =>
  t && ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) ? t.typeName.text : null;

/** The names a file registers through: a `Register` function's first parameter and any parameter typed `On`. */
function registrars(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && typeName(n.type) === 'Register' && n.initializer
      && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      const first = n.initializer.parameters[0];
      if (first && ts.isIdentifier(first.name)) names.add(first.name.text);
    }
    if (ts.isParameter(n) && typeName(n.type) === 'On' && ts.isIdentifier(n.name)) names.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return names;
}

const literalText = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

/** The doors a matcher names (`{ door: 'x' }` or `{ door: ['x', 'y'] }`), or null when it names none as literals. */
function doorsOf(matcher: ts.Expression | undefined): string[] | null {
  if (!matcher || !ts.isObjectLiteralExpression(matcher)) return null;
  for (const p of matcher.properties) {
    if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) || p.name.text !== 'door') continue;
    const one = literalText(p.initializer);
    if (one !== null) return [one];
    if (!ts.isArrayLiteralExpression(p.initializer)) return null;
    const all = p.initializer.elements.map(literalText);
    return all.every((d): d is string => d !== null) ? all : null;
  }
  return null;
}

/** Every registration call in `text`: its pattern (null when it is not a plain string literal) and its doors. */
export function registrationsIn(file: string, text: string): Registration[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names = registrars(sf);
  const out: Registration[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) {
      const pattern = literalText(n.arguments[0]);
      out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, pattern, doors: pattern === null ? null : doorsOf(n.arguments[1]) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
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
  it('is not blinded by comment marks inside strings, regexes or templates (polish, review Minor 6)', () => {
    const source = [
      'const register: Register = on => {',
      "  const glob = '.forge/status/*.json';",
      "  on('classic.SubagentStop', f);",
      "  const tail = '*/';",
      '  const t = `// not a comment ${glob}`; on("prompt.context", h2);',
      '  const re = /\\/\\*/g;',
      "  on('session.compact', g);",
      '  // a comment */ that closes nothing',
      '};',
    ].join('\n');
    expect(registrationsIn('x.tsx', source).map(r => [r.line, r.pattern]))
      .toEqual([[3, 'classic.SubagentStop'], [5, 'prompt.context'], [7, 'session.compact']]);
  });
  it('cannot be fooled by a computed event name', () => {
    expect(scan('const register: Register = on => { on(EVENT, f); on(`classic.${x}`, g); };').map(r => r[2]))
      .toEqual(['its event is not a string literal, so this test cannot check it', 'its event is not a string literal, so this test cannot check it']);
  });
});
