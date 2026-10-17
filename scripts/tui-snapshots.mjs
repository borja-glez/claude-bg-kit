#!/usr/bin/env node
// F-17: snapshots of the real paint of the bands and the panel, taken in a pty at several sizes, in fullscreen
// (CLAUDE_CODE_NO_FLICKER=1) and on the main screen (=0), plus four checks of the engine's own behaviour that the test
// kit cannot see. Manual and outside the CI: it starts `claude` with this repository's plugins and the account of
// whoever runs it, and sends no prompt to the model (only /lens, /lens live and key presses, all local), so it costs no
// tokens, but it does open real sessions: it is slow (minutes), so run it on purpose.
//
// Its two dependencies are not in package.json or package-lock.json, and must not get in. Install them outside the
// repository: Node resolves imports by walking up from this file, so a node_modules in a parent folder of the checkout is
// found without touching the repository (node-pty builds a native module: it needs a C++ toolchain, or a prebuilt one):
//   cd <a parent folder of the checkout> && npm i node-pty@1.1.0 @xterm/headless@6.0.0
// Or, inside the checkout, without saving: npm i --no-save node-pty@1.1.0 @xterm/headless@6.0.0
// (then `git status` must show no change to package.json or package-lock.json).
// Build the plugins first (npm run build): the script loads plugins/waypoint and plugins/lens as built; restore the
// generated files afterwards (git checkout -- plugins/) unless you mean to commit them.
//
// Usage, from the repository root:
//   node scripts/tui-snapshots.mjs [--out <dir>] [--sizes 80x24,120x40] [--modes fullscreen,main] [--no-engine]
// It writes <out>/<mode>-<cols>x<rows>[-lens|-live|-resized].txt, engine-*.txt and index.md, and exits 1 if any check
// fails. The engine checks, named in the index (each is reported pass or fail):
//   (a) folded-letter-noop    a letter of a button folded into ⋯ does nothing (main screen, 60 columns)
//   (b) panel-button-photo    the lens Panel button's own $.command.run('/lens foto') reaches lens's command hook and
//                             the photo row draws in the transcript (main screen, 120 columns)
//   (c) photo-not-wrapped     the photo's rows neither wrap nor pass the width: CommandOutput rows are not indented in a
//                             way that makes the full-width photo wrap (same capture as b)
//   (d) pane-close-stops      closing the pane with the engine's ✕ stops lens's writes (fullscreen, 160 columns)
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bandFolds, changedFiles, checkCapture, checkPhoto, dotted, fillTemplate, findText, parseArgs, stopTriggered } from './tui/checks.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = path.join(repo, 'scripts', 'tui', 'fixture');
const INSTALL = 'npm i --no-save node-pty@1.1.0 @xterm/headless@6.0.0';
// The band is up once one of these shows: the fixture's run band, or a work band or a notice if the binding did not take.
const BAND = /EJECUCIÓN|EXECUTION|frente|track|otra sesión|another session/;
const TRUST = /trust the files|trust this folder|Do you trust/i;
const BAND_WAIT_MS = 60_000;
const SETTLE_MS = 3_000;
const QUIET_MS = 12_000;
const CHORD = '\x18'; // ctrl+x: outside fullscreen a band button is ctrl+x and its letter

async function load() {
  try {
    const pty = await import('node-pty');
    const xterm = await import('@xterm/headless');
    return { spawn: (pty.default ?? pty).spawn, Terminal: (xterm.default ?? xterm).Terminal };
  } catch {
    process.stderr.write(`tui-snapshots needs node-pty and @xterm/headless, which are not in package.json:\n  ${INSTALL}\n`);
    process.exit(2);
  }
}

// Copies the fixture into `dir`: its dot-<name> folders as .<name>, its session and times filled in.
function copyFixture(dir, vars, rel = '') {
  for (const name of readdirSync(path.join(FIXTURE, rel))) {
    const relName = rel ? `${rel}/${name}` : name;
    const src = path.join(FIXTURE, ...relName.split('/'));
    if (statSync(src).isDirectory()) { copyFixture(dir, vars, relName); continue; }
    const target = path.join(dir, ...dotted(relName).split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, fillTemplate(readFileSync(src, 'utf8'), vars));
  }
}

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

// The terminal's whole buffer (scrollback and screen) as text, trailing blank rows dropped.
function screen(term) {
  const buf = term.buffer.active;
  const rows = [];
  for (let i = 0; i < buf.length; i++) rows.push(buf.getLine(i)?.translateToString(true) ?? '');
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  return `${rows.join('\n')}\n`;
}

// The indexes (as in screen()) of the rows the terminal wrapped from the row above.
function wrappedRows(term) {
  const buf = term.buffer.active;
  const out = [];
  for (let i = 0; i < buf.length; i++) if (buf.getLine(i)?.isWrapped) out.push(i);
  return out;
}

// The rows on the visible screen only, to turn a found mark into mouse coordinates.
function viewport(term) {
  const buf = term.buffer.active;
  const rows = [];
  for (let i = 0; i < term.rows; i++) rows.push(buf.getLine(buf.viewportY + i)?.translateToString(true) ?? '');
  return rows.join('\n');
}

// Polls the screen until `test` holds or `ms` pass; says whether it held.
async function until(term, test, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test(screen(term))) return true;
    await sleep(250);
  }
  return false;
}

// Runs `body` on a claude started in a fresh fixture copy, with its band up; always kills claude and removes the copy.
async function withClaude(engine, o, body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bgkit-tui-'));
  const session = randomUUID();
  const term = new engine.Terminal({ cols: o.cols, rows: o.rows, allowProposedApi: true, scrollback: 2000 });
  let p = null;
  try {
    copyFixture(dir, { session, now: Date.now() });
    const args = ['--session-id', session, '--plugin-dir', path.join(repo, 'plugins', 'waypoint'), '--plugin-dir', path.join(repo, 'plugins', 'lens')];
    // claude is a .cmd on Windows, which only cmd.exe runs.
    const [file, argv] = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/c', 'claude', ...args]] : ['claude', args];
    p = engine.spawn(file, argv, {
      name: 'xterm-256color', cols: o.cols, rows: o.rows, cwd: dir,
      env: { ...process.env, CLAUDE_CODE_NO_FLICKER: o.mode === 'fullscreen' ? '1' : '0' },
    });
    p.onData(data => { term.write(data); });
    if (await until(term, text => TRUST.test(text), 15_000)) p.write('\r');
    if (!(await until(term, text => BAND.test(text), BAND_WAIT_MS))) throw new Error('no band within 60 s');
    await sleep(SETTLE_MS);
    return await body({ p, term, dir, session });
  } finally {
    try { p?.kill(); } catch { /* already gone */ }
    term.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}

// One size in one mode: the band, /lens, /lens live and the screen after a resize (F-15).
function shoot(engine, o) {
  return withClaude(engine, o, async ({ p, term }) => {
    const shots = [['band', screen(term)]];
    p.write('/lens\r');
    await sleep(SETTLE_MS);
    shots.push(['lens', screen(term)]);
    p.write('/lens live\r');
    await sleep(SETTLE_MS);
    shots.push(['live', screen(term)]);
    const narrower = Math.max(40, o.cols - 20);
    p.resize(narrower, o.rows);
    term.resize(narrower, o.rows);
    await sleep(SETTLE_MS);
    shots.push(['resized', screen(term)]);
    return shots;
  });
}

// A button of the band outside fullscreen: ctrl+x, then its letter.
async function pressLetter(p, letter) {
  p.write(CHORD);
  await sleep(300);
  p.write(letter);
}

// Every file under dir/.forge/usage with its time: what lens writes for the run.
function usageListing(dir) {
  const root = path.join(dir, '.forge', 'usage');
  const out = {};
  let names = [];
  try { names = readdirSync(root); } catch { return out; }
  for (const name of names) out[`.forge/usage/${name}`] = statSync(path.join(root, name)).mtimeMs;
  return out;
}

// (a) A letter of a button folded into ⋯ does nothing. The premise is a band that folded Stop (t) at 60 columns.
async function foldedLetterNoop(engine) {
  return withClaude(engine, { cols: 60, rows: 24, mode: 'main' }, async ({ p, term }) => {
    const before = screen(term);
    if (!bandFolds(before)) return { text: before, fails: ['the band did not fold its buttons into ⋯ at 60 columns, so there was nothing to press'] };
    await pressLetter(p, 't');
    await sleep(SETTLE_MS);
    const after = screen(term);
    return { text: after, fails: stopTriggered(after) ? ['a letter of a folded button did something (Stop was armed or filled)'] : [] };
  });
}

// (b) and (c) The lens Panel button's letter runs its own $.command.run('/lens foto'); the photo draws and does not wrap.
async function panelButtonPhoto(engine) {
  const cols = 120;
  return withClaude(engine, { cols, rows: 30, mode: 'main' }, async ({ p, term }) => {
    const letter = /(?:^|\s)([a-z]): Panel/m.exec(screen(term))?.[1];
    if (!letter) {
      const text = screen(term);
      return { text, photo: ['no Panel letter on the band, so the button was not pressed'], wrap: ['no photo to measure'] };
    }
    await pressLetter(p, letter);
    await sleep(SETTLE_MS);
    const text = screen(term);
    const fails = checkPhoto(text, { cols, wrapped: wrappedRows(term) });
    const missing = fails.filter(f => f.startsWith('no photo row') || f.startsWith('the photo row has no cards'));
    return { text, photo: missing, wrap: missing.length ? ['no photo to measure'] : fails };
  });
}

// (d) Closing the pane with the engine's ✕ stops lens's writes: after it, a change in the run leaves .forge/usage as it was.
async function paneCloseStops(engine) {
  return withClaude(engine, { cols: 160, rows: 40, mode: 'fullscreen' }, async ({ p, term, dir, session }) => {
    p.write('/lens live\r');
    await sleep(SETTLE_MS);
    const mark = findText(viewport(term), '✕');
    if (!mark) return { text: screen(term), fails: ['no ✕ on the screen, so the pane did not open or has no close mark'] };
    // SGR mouse: press and release at the mark (1-based).
    p.write(`\x1b[<0;${mark.col + 1};${mark.row + 1}M\x1b[<0;${mark.col + 1};${mark.row + 1}m`);
    await sleep(SETTLE_MS);
    const closed = screen(term);
    if (findText(viewport(term), '✕')) return { text: closed, fails: ['the pane is still open after clicking ✕'] };
    const before = usageListing(dir);
    // The run moves on: the fixture's status file is written again, as forge would.
    const file = path.join(dir, '.forge', 'status', 'demo__T001.json');
    writeFileSync(file, fillTemplate(readFileSync(path.join(FIXTURE, 'dot-forge', 'status', 'demo__T001.json'), 'utf8'), { session, now: Date.now() }));
    await sleep(QUIET_MS);
    const wrote = changedFiles(before, usageListing(dir));
    return { text: closed, fails: wrote.map(name => `lens wrote ${name} after the pane was closed`) };
  });
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2).filter(a => a !== '--no-engine')); } catch (err) { process.stderr.write(`${err.message}\n`); process.exit(2); }
  const engineChecks = !process.argv.includes('--no-engine');
  const engine = await load();
  const out = path.resolve(repo, opts.out);
  mkdirSync(out, { recursive: true });
  const index = ['# TUI snapshots', '', `${new Date().toISOString()} · claude with plugins/waypoint and plugins/lens of ${repo}`, ''];
  const failures = [];
  for (const mode of opts.modes) {
    for (const { cols, rows } of opts.sizes) {
      try {
        for (const [kind, text] of await shoot(engine, { cols, rows, mode })) {
          const name = `${mode}-${cols}x${rows}${kind === 'band' ? '' : `-${kind}`}.txt`;
          writeFileSync(path.join(out, name), text);
          const fails = kind === 'resized' ? [] : checkCapture(text, { cols, rows, mode, kind });
          index.push(`- [${name}](${name})${fails.length ? ` — ${fails.join('; ')}` : ''}`);
          for (const f of fails) failures.push(`${name}: ${f}`);
        }
      } catch (err) {
        failures.push(`${mode}-${cols}x${rows}: ${err.message}`);
        index.push(`- ${mode}-${cols}x${rows}: ${err.message}`);
      }
    }
  }
  if (engineChecks) {
    index.push('', '## Engine checks', '');
    const report = (id, fails, file) => {
      index.push(`- ${id}: ${fails.length ? `FAIL — ${fails.join('; ')}` : 'pass'}${file ? ` ([${file}](${file}))` : ''}`);
      for (const f of fails) failures.push(`${id}: ${f}`);
    };
    const run = async (ids, fn, file) => {
      try {
        const r = await fn(engine);
        writeFileSync(path.join(out, file), r.text);
        for (const id of ids) report(id, r.fails, file);
      } catch (err) {
        for (const id of ids) report(id, [err.message]);
      }
    };
    await run(['(a) folded-letter-noop'], foldedLetterNoop, 'engine-folded-letter.txt');
    try {
      const r = await panelButtonPhoto(engine);
      writeFileSync(path.join(out, 'engine-panel-photo.txt'), r.text);
      report('(b) panel-button-photo', r.photo, 'engine-panel-photo.txt');
      report('(c) photo-not-wrapped', r.wrap, 'engine-panel-photo.txt');
    } catch (err) {
      report('(b) panel-button-photo', [err.message]);
      report('(c) photo-not-wrapped', [err.message]);
    }
    await run(['(d) pane-close-stops'], paneCloseStops, 'engine-pane-close.txt');
  }
  writeFileSync(path.join(out, 'index.md'), `${index.join('\n')}\n`);
  process.stdout.write(`${failures.length ? failures.join('\n') : 'every capture passes its checks'}\n${path.relative(repo, out)}/index.md\n`);
  process.exit(failures.length ? 1 : 0);
}

await main();
