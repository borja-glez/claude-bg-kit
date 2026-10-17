#!/usr/bin/env node
// F-17: snapshots of the real paint of the bands and the panel, taken in a pty at several sizes, in fullscreen
// (CLAUDE_CODE_NO_FLICKER=1) and on the main screen (=0), plus checks of the engine's own behaviour that the test kit
// cannot see. Manual and outside the CI. It sends no prompt to the model (only /lens, /lens live and key presses, all
// local), so it costs no tokens, but it opens many real sessions and is slow.
//
// READ THIS BEFORE RUNNING IT. Every session is a real `claude` started with this repository's plugins and, unless you
// pass --config-dir, the REAL ~/.claude of whoever runs it: accepting the trust dialog for each new temporary folder
// writes a project entry into ~/.claude.json, every session lands in the real history, and the global hooks and the
// installed plugins (an installed forge or waypoint included, which will see the fixture's execution.json as active) run
// in each one. A full run launches 34 sessions: 15 sizes x 2 modes, plus 4 for the engine checks (a, b, b2, d), each with
// a start-up and several seconds of settling. --sizes, --modes, --no-engine and --engine-only narrow it. To keep the
// real config out of it, prepare an isolated config dir yourself (signed in as you see fit; this script never copies
// credentials) and pass it: --config-dir <dir> sets CLAUDE_CONFIG_DIR for the launched sessions.
//
// Its two dependencies are not in package.json or package-lock.json, and must not get in. Install them outside the
// repository: Node resolves imports by walking up from this file, so a node_modules in a parent folder of the checkout is
// found without touching the repository (node-pty builds a native module: it needs a C++ toolchain, or a prebuilt one):
//   cd <a parent folder of the checkout> && npm i node-pty@1.1.0 @xterm/headless@6.0.0
// Or, inside the checkout, without saving: npm i --no-save node-pty@1.1.0 @xterm/headless@6.0.0
// (then `git status` must show no change to package.json or package-lock.json; the next npm install prunes them).
// Build the plugins first (npm run build): the script loads plugins/waypoint and plugins/lens as built; restore the
// generated files afterwards (git checkout -- plugins/) unless you mean to commit them.
//
// Usage, from the repository root:
//   node scripts/tui-snapshots.mjs [--out <dir>] [--sizes 80x24,120x40] [--modes fullscreen,main]
//                                  [--config-dir <dir>] [--no-engine | --engine-only]
// It writes <out>/<mode>-<cols>x<rows>[-lens|-live|-resized].txt, engine-*.txt and index.md, and exits 1 if any check
// fails. The engine checks are named in the index and reported PASS, FAIL or INCONCLUSIVE (a premise did not hold, so
// nothing was proven either way; it does not fail the run). A FAIL always means the keys reached the band and the
// expected effect was missing.
// Every band letter is pressed as the engine documents it: ctrl+x tab gives the band the focus, then the letter, then Esc
// hands the keys back to the prompt. A letter that does not reach the band lands in the composer and draws no button, so
// each letter check first proves that its keys reach the band (its positive control), and is inconclusive when they do not:
//   (a) folded-letter-noop        a letter of a button folded into ⋯ does nothing (main screen, 60 columns). Control first:
//                                 m (the ⋯ button) must open the folded row, its buttons' letters showing; Stop's letter
//                                 is read there, the row is closed again, and that letter is pressed.
//   (b) waypoint-panel-to-lens    waypoint's Panel button runs $.command.run('/lens'), which reaches lens's command hook
//                                 and the photo row draws in the transcript (main screen, 100 columns, both plugins: the
//                                 band folds its buttons there). Control first: m opens the folded row, where Panel shows
//                                 with its letter; that letter is then pressed.
//   (b2) lens-panel-button-photo  the same with only lens loaded, so lens draws its own band and its own Panel button runs
//                                 /lens foto. Inconclusive if lens does not draw a band with a Panel letter there. lens's
//                                 band has no ⋯, so its control comes after a press that drew no photo: × must close the
//                                 band (the photo, when it draws, already proves the keys reached it).
//   (c) photo-not-wrapped         the photo's rows neither wrap nor pass the width: CommandOutput rows are not indented in
//                                 a way that makes the full-width photo wrap (same capture as b).
//   (d) pane-close-stops          closing the pane with the engine's ✕ (looked for on a row of the pane's frame, its
//                                 column counted in cells) stops lens's writes (fullscreen, 160 columns). Inconclusive
//                                 unless lens wrote a file under .forge/usage/ before the close: lens writes it only after
//                                 model steps, so with no prompt sent this is the usual outcome. The test kit cannot raise
//                                 ui.close, so this is the only check of lens's ui.close hook against the engine.
// Until a first real run shows how the engine takes these keys, expect (b2), (d) and the letters' positive controls to
// come out INCONCLUSIVE: that proves nothing either way, and only a FAIL points at the engine or the plugins.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BAND_READY, bandFolds, checkCapture, checkPhoto, closeVerdict, dotted, fillTemplate, findText, letterKeys, lettersOn, moreToggled, PANE_FRAME,
  panelLetter, parseArgs, pressVerdict, stopLetter, stopTriggered, treeKill,
} from './tui/checks.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = path.join(repo, 'scripts', 'tui', 'fixture');
const INSTALL = 'cd <a parent folder of the checkout> && npm i node-pty@1.1.0 @xterm/headless@6.0.0   (or here: npm i --no-save node-pty@1.1.0 @xterm/headless@6.0.0)';
const TRUST = /trust the files|trust this folder|Do you trust/i;
const BAND_WAIT_MS = 60_000;
const SETTLE_MS = 3_000;
const QUIET_MS = 12_000;
// The pause between the writes of one letter press (letterKeys), so the engine reads them as separate keys.
const KEY_GAP_MS = 300;
const PLUGINS = { both: ['waypoint', 'lens'], lens: ['lens'] };

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

// What is still running, so Ctrl+C kills the claude children and removes the temporary folders.
const live = new Set();
function cleanup(p, dir) {
  // On Windows claude runs under cmd.exe, and the pty's kill ends cmd.exe alone: taskkill /T takes its claude child too.
  const tree = p ? treeKill(process.platform, p.pid) : null;
  if (tree) {
    try { spawnSync(tree.file, tree.args, { stdio: 'ignore', windowsHide: true }); } catch { /* already gone */ }
  }
  try { p?.kill(); } catch { /* already gone */ }
  // Windows keeps a folder busy for a moment after its process dies: retry, and never let a failure here lose a capture.
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* left in the temp folder */ }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const [p, dir] of live) cleanup(p, dir);
    process.exit(130);
  });
}

// Runs `body` on a claude started in a fresh fixture copy, with its band up; always kills claude and removes the copy.
// o: { cols, rows, mode, plugins: 'both' | 'lens', configDir }
async function withClaude(engine, o, body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bgkit-tui-'));
  const session = randomUUID();
  const term = new engine.Terminal({ cols: o.cols, rows: o.rows, allowProposedApi: true, scrollback: 2000 });
  let p = null;
  try {
    copyFixture(dir, { session, now: Date.now() });
    const args = ['--session-id', session, ...PLUGINS[o.plugins ?? 'both'].flatMap(name => ['--plugin-dir', path.join(repo, 'plugins', name)])];
    // claude is a .cmd on Windows, which only cmd.exe runs.
    const [file, argv] = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/c', 'claude', ...args]] : ['claude', args];
    const env = { ...process.env, CLAUDE_CODE_NO_FLICKER: o.mode === 'fullscreen' ? '1' : '0' };
    if (o.configDir) env.CLAUDE_CONFIG_DIR = path.resolve(o.configDir);
    p = engine.spawn(file, argv, { name: 'xterm-256color', cols: o.cols, rows: o.rows, cwd: dir, env });
    live.add([p, dir]);
    p.onData(data => { term.write(data); });
    if (await until(term, text => TRUST.test(text), 15_000)) p.write('\r');
    if (!(await until(term, text => BAND_READY.test(text), BAND_WAIT_MS))) throw new Error('no band within 60 s');
    await sleep(SETTLE_MS);
    return await body({ p, term, dir, session });
  } finally {
    for (const entry of live) if (entry[0] === p) live.delete(entry);
    term.dispose();
    cleanup(p, dir);
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

// A button of the band by its letter: ctrl+x tab (the band takes the focus), the letter, Esc (the prompt takes it back).
async function pressLetter(p, letter) {
  for (const keys of letterKeys(letter)) {
    p.write(keys);
    await sleep(KEY_GAP_MS);
  }
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

const result = (verdict, detail, text) => ({ verdict, detail, text });

// (a) A letter of a button folded into ⋯ does nothing. Premise: a band that folded Stop (t) at 60 columns, and keys that
// reach the band, shown by m (the ⋯ button) opening the folded row.
async function foldedLetterNoop(engine, cfg) {
  return withClaude(engine, { ...cfg, cols: 60, rows: 24, mode: 'main' }, async ({ p, term }) => {
    const first = screen(term);
    if (!bandFolds(first)) return result('inconclusive', ['the band did not fold its buttons into ⋯ at 60 columns, so there was nothing to press'], first);
    await pressLetter(p, 'm');
    await sleep(1_500);
    const opened = screen(term);
    if (!moreToggled(first, opened)) return result('inconclusive', ['m (the ⋯ button) did not open the folded row: the keys may not reach the band, so a silent Stop proves nothing'], opened);
    // Stop's letter as the band draws it in the open row, not a letter assumed here.
    const stop = stopLetter(opened);
    if (!stop) return result('inconclusive', ['the open row shows no Stop button, so there is no folded letter to press'], opened);
    await pressLetter(p, 'm');
    await sleep(1_500);
    const baseline = screen(term);
    await pressLetter(p, stop);
    await sleep(SETTLE_MS);
    const after = screen(term);
    return result(stopTriggered(baseline, after) ? 'fail' : 'pass', stopTriggered(baseline, after) ? ['a letter of a folded button did something (Stop was armed or filled)'] : [], after);
  });
}

// (b), (b2), (c) The Panel button's letter runs /lens; the photo draws and does not wrap. `plugins` says whose button it is:
// waypoint's band (both) folds its buttons at 100 columns, and m opening that row is the control before Panel is pressed;
// lens's band (lens) has no ⋯, so when Panel drew no photo, × closing the band says whether the keys reached it.
async function panelButtonPhoto(engine, cfg, plugins) {
  const cols = 100;
  return withClaude(engine, { ...cfg, cols, rows: 30, mode: 'main', plugins }, async ({ p, term }) => {
    const unproven = (note, text) => ({ b: result('inconclusive', note, text), c: result('inconclusive', ['no photo to measure'], text) });
    let shown = screen(term);
    let reached = false;
    if (plugins === 'both') {
      if (!shown.includes('⋯')) return unproven(['the band did not fold its buttons into ⋯, so m had no row to open as the control'], shown);
      await pressLetter(p, 'm');
      await sleep(1_500);
      const opened = screen(term);
      if (!moreToggled(shown, opened)) return unproven(['m (the ⋯ button) did not open the folded row: the keys may not reach the band, so a missing photo proves nothing'], opened);
      reached = true;
      shown = opened;
    }
    const letter = panelLetter(shown);
    if (!letter) return unproven(['no Panel letter on the band, so the button was not pressed'], shown);
    await pressLetter(p, letter);
    await sleep(SETTLE_MS);
    const text = screen(term);
    const fails = checkPhoto(text, { cols, wrapped: wrappedRows(term) });
    const missing = fails.filter(f => f.startsWith('no photo row') || f.startsWith('the photo row has no cards'));
    const wrap = fails.filter(f => !missing.includes(f));
    // The photo drawn is the press's own effect, so it proves the keys reached the band.
    if (!missing.length) reached = true;
    else if (!reached) {
      // lens's band: × closes it when the keys reach it, and its letters go from the screen.
      await pressLetter(p, 'x');
      await sleep(1_500);
      reached = lettersOn(text).includes('x') && moreToggled(text, screen(term));
    }
    const verdict = pressVerdict({ reached, effect: !missing.length });
    const detail = verdict === 'inconclusive' ? ['no photo, and × did not close the band either: the keys may not reach it, so this proves nothing'] : missing;
    return {
      b: result(verdict, detail, text),
      c: missing.length ? result('inconclusive', ['no photo to measure'], text) : result(wrap.length ? 'fail' : 'pass', wrap, text),
    };
  });
}

// (d) Closing the pane with the engine's ✕ stops lens's writes: after it, a change in the run leaves .forge/usage as it was.
async function paneCloseStops(engine, cfg) {
  return withClaude(engine, { ...cfg, cols: 160, rows: 40, mode: 'fullscreen' }, async ({ p, term, dir, session }) => {
    p.write('/lens live\r');
    await sleep(SETTLE_MS);
    const mark = findText(viewport(term), '✕', { row: PANE_FRAME });
    if (!mark) return result('inconclusive', ['no ✕ on a row of a frame, so the pane did not open or has no close mark there'], screen(term));
    // SGR mouse: press and release at the mark (1-based).
    p.write(`\x1b[<0;${mark.col + 1};${mark.row + 1}M\x1b[<0;${mark.col + 1};${mark.row + 1}m`);
    await sleep(SETTLE_MS);
    const closed = screen(term);
    if (findText(viewport(term), '✕', { row: PANE_FRAME })) return result('fail', ['the pane is still open after clicking ✕'], closed);
    const before = usageListing(dir);
    // The run moves on: the fixture's status file is written again, as forge would.
    const file = path.join(dir, '.forge', 'status', 'demo__T001.json');
    writeFileSync(file, fillTemplate(readFileSync(path.join(FIXTURE, 'dot-forge', 'status', 'demo__T001.json'), 'utf8'), { session, now: Date.now() }));
    await sleep(QUIET_MS);
    const { verdict, detail } = closeVerdict(before, usageListing(dir));
    return result(verdict, detail, closed);
  });
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (err) { process.stderr.write(`${err.message}\n`); process.exit(2); }
  const engine = await load();
  const cfg = { configDir: opts.configDir };
  const out = path.resolve(repo, opts.out);
  mkdirSync(out, { recursive: true });
  const index = ['# TUI snapshots', '', `${new Date().toISOString()} · claude with plugins/waypoint and plugins/lens of ${repo}${opts.configDir ? ` · config ${opts.configDir}` : ' · real ~/.claude'}`, ''];
  const failures = [];
  const inconclusive = [];
  for (const mode of opts.engineOnly ? [] : opts.modes) {
    for (const { cols, rows } of opts.sizes) {
      try {
        for (const [kind, text] of await shoot(engine, { cols, rows, mode, ...cfg })) {
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
  if (opts.engine !== false) {
    index.push('', '## Engine checks', '');
    const report = (id, r, file) => {
      index.push(`- ${id}: ${r.verdict.toUpperCase()}${r.detail.length ? ` — ${r.detail.join('; ')}` : ''}${file ? ` ([${file}](${file}))` : ''}`);
      const lines = r.detail.map(d => `${id}: ${d}`);
      if (r.verdict === 'fail') failures.push(...lines);
      if (r.verdict === 'inconclusive') inconclusive.push(...lines);
    };
    const save = (file, r) => { if (r.text) writeFileSync(path.join(out, file), r.text); };
    const single = async (id, fn, file) => {
      try { const r = await fn(); save(file, r); report(id, r, file); } catch (err) { report(id, result('fail', [err.message])); }
    };
    const pair = async (idB, idC, plugins, file) => {
      try {
        const r = await panelButtonPhoto(engine, cfg, plugins);
        save(file, r.b);
        report(idB, r.b, file);
        if (idC) report(idC, r.c, file);
      } catch (err) {
        report(idB, result('fail', [err.message]));
        if (idC) report(idC, result('fail', [err.message]));
      }
    };
    await single('(a) folded-letter-noop', () => foldedLetterNoop(engine, cfg), 'engine-folded-letter.txt');
    await pair('(b) waypoint-panel-to-lens', '(c) photo-not-wrapped', 'both', 'engine-panel-photo.txt');
    await pair('(b2) lens-panel-button-photo', null, 'lens', 'engine-lens-panel-photo.txt');
    await single('(d) pane-close-stops', () => paneCloseStops(engine, cfg), 'engine-pane-close.txt');
  }
  writeFileSync(path.join(out, 'index.md'), `${index.join('\n')}\n`);
  const summary = [...(failures.length ? failures : ['every capture passes its checks']), ...inconclusive.map(l => `INCONCLUSIVE ${l}`)];
  process.stdout.write(`${summary.join('\n')}\n${path.relative(repo, out)}/index.md\n`);
  process.exit(failures.length ? 1 : 0);
}

await main();
