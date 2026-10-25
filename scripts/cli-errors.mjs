// A7: the ratchet on the forge CLI's errors. Every exit-2 error under src/forge (each `new UsageError(...)` and
// `new ConfigError(...)`, the `stderr` of each `{ code: 2, ... }` result and each `fail(2, ...)`) should say what to do:
// name a flag, the usage, a command or an order, or say what is required. Reads the sources with the TypeScript compiler
// API and takes the text of each message (a literal, a template with `${}` for each hole, both sides of a condition, a
// const of the same file). tests/cli-error-ratchet.test.ts holds the errors that do not say it yet in
// tests/fixtures/cli-error-baseline.json: that list only shrinks.
// Usage: node scripts/cli-errors.mjs   (prints baselineEntries(process.cwd()) as JSON, indented by 2 spaces)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// The names in COMMANDS of src/forge/cli/commands/index.ts (plus the `cycle`-style ones listed there), and the waypoint ones.
const FORGE_COMMANDS = ['triage', 'doctor', 'brief', 'validate', 'stats', 'verdict', 'round', 'review-prep', 'review-close', 'prep', 'shadow',
  'log', 'decision', 'agents', 'last', 'diagnose', 'proposals', 'surfaces', 'tools', 'local', 'prefs', 'begin', 'route',
  'verify-env', 'verify-plan', 'verify-preflight', 'verify-result', 'verify-cleanup', 'verify-close', 'verify-spawn',
  'waypoint-cli', 'sp-path', 'sp-specs', 'sp-plans', 'sp-plan', 'tdd', 'tree', 'config', 'infinite', 'cycle', 'authorize', 'swarm',
  'setup', 'stop', 'hook', 'resource', 'blocked', 'market', 'roadmap-doc', 'roadmap-run'];
const WAYPOINT_COMMANDS = ['session', 'plugin', 'doctor', 'replan', 'track', 'block', 'commit-info'];

export const ACTIONABLE = [
  // the flag to pass or to correct
  /--[a-z][\w-]*/i,
  // the usage line
  /\busage:/i,
  // a command, a file or a value between backticks
  /`[^`]+`/,
  // a command to run
  // (only real orders: a forge or waypoint command, a git verb, an npm script, a node script; `git status failed` is not one)
  new RegExp(`\\b(?:forge|FORGE)\\s+(?:${FORGE_COMMANDS.join('|')})\\b`),
  new RegExp(`\\bwaypoint\\s+(?:${WAYPOINT_COMMANDS.join('|')})\\b`),
  /\bgit\s+(?:add|commit|checkout|switch|worktree|rebase|merge|pull|fetch|restore|rm|init)\b/,
  /\bnpm\s+(?:run|install|ci|test)\b/,
  /\bnode\s+\S+\.[cm]?js\b/,
  // a command after a colon, a semicolon, a parenthesis or a comma (a verb followed by a colon is a label, not an order)
  /(?:^|[:;(,]\s*|\b(?:then|first|or)\s+)(?:run|use|pass|give|add|set|remove|rename|integrate|answer|retry|wait|ask|fix|delete|untrack|commit|list|name|write|start|stop|open|check|install|update|resume|choose|close|drop|keep|create|move|switch|read|regenerate|rebase|merge)\b(?!\s*:)/i,
  // what is required
  /\b(?:must|needs?|is required|are required|is needed|expected|one of|at most|at least|goes with|instead|again|first)\b/i,
];

export function isActionable(message) {
  return !message.startsWith('<dynamic') && ACTIONABLE.some(re => re.test(message));
}

const isText = n => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
const isBlank = s => s.trim() === '';

/** The texts a message expression can have; `deep` is false inside the initializer of a const (one level of identifiers). */
function texts(node, sf, deep = true) {
  if (isText(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    const { head, templateSpans: spans } = node;
    if (isBlank(head.text) && spans.length === 1 && isBlank(spans[0].literal.text)) return texts(spans[0].expression, sf, deep);
    return [head.text + spans.map(s => '${}' + s.literal.text).join('')];
  }
  if (ts.isConditionalExpression(node)) return [...texts(node.whenTrue, sf, deep), ...texts(node.whenFalse, sf, deep)];
  if (ts.isParenthesizedExpression(node)) return texts(node.expression, sf, deep);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [texts(node.left, sf, deep)[0] + texts(node.right, sf, deep)[0]];
  }
  if (deep && ts.isIdentifier(node)) {
    const init = constInitializer(sf, node.text);
    if (init) return texts(init, sf, false);
  }
  return [`<dynamic: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 60)}>`];
}

/** The initializer of a top-to-bottom `const name = 'text' | `template`` of the file, if there is one. */
function constInitializer(sf, name) {
  let found;
  const visit = n => {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer
      && (n.parent.flags & ts.NodeFlags.Const) && (isText(n.initializer) || ts.isTemplateExpression(n.initializer))) { found = n.initializer; return; }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

const clean = s => s.replace(/\n+$/, '').replace(/\s+/g, ' ').trim().slice(0, 160);

/** The exit-2 messages of one source file, in source order. */
export function errorMessages(text) {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const add = node => { for (const t of texts(node, sf)) out.push(clean(t)); };
  const visit = n => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'UsageError' || n.expression.text === 'ConfigError') && n.arguments?.length) {
      add(n.arguments[0]);
    } else if (ts.isObjectLiteralExpression(n)) {
      const named = name => n.properties.find(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === name);
      const code = named('code');
      const stderr = named('stderr');
      if (code && ts.isPropertyAssignment(code) && ts.isNumericLiteral(code.initializer) && code.initializer.text === '2' && stderr) {
        add(ts.isShorthandPropertyAssignment(stderr) ? stderr.name : stderr.initializer);
      }
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fail'
      && n.arguments.length >= 2 && ts.isNumericLiteral(n.arguments[0]) && n.arguments[0].text === '2') {
      add(n.arguments[1]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function tsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Every exit-2 message under src/forge, `file` repo-relative with `/`, files in path order. */
export function scanCliErrors(root) {
  const files = tsFiles(path.join(root, 'src', 'forge'))
    .map(f => path.relative(root, f).split(path.sep).join('/'))
    .sort();
  return files.flatMap(file => errorMessages(readFileSync(path.join(root, file), 'utf8')).map(message => ({ file, message })));
}

/** `<file> :: <message>` of each message that is not actionable, sorted (duplicates kept): the baseline's format. */
export function baselineEntries(root) {
  return scanCliErrors(root).filter(e => !isActionable(e.message)).map(e => `${e.file} :: ${e.message}`).sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(baselineEntries(process.cwd()), null, 2) + '\n');
}
