// F-17: what a capture of the real paint must show, as pure functions that vitest checks on sample captures
// (tests/tui-checks.test.ts): no task id of the fixture split across two rows, ▲ and ✎ in the band at 80 columns,
// letters on the band's buttons outside fullscreen («x: ×»), and «↓» when the inline pane was cut. The snapshot script
// runs them on every capture; it also reads its options here and fills the fixture with fillTemplate and dotted.
// The engine checks (a) to (d) of the script use the helpers below checkCapture: letterKeys (how a letter is pressed),
// lettersOn, moreToggled and panelLetter (the positive control and the button to press), pressVerdict, BAND_READY,
// stopLetter and bandFolds (folded means a ⋯ and no Stop button), stopTriggered, checkPhoto, cellsOf, PANE_FRAME and
// findText (the pane's close mark, in cells), changedFiles, closeVerdict, and treeKill (the cleanup on Windows).

export const FIXTURE_IDS = ['T001', 'T002', 'T003'];
export const MODES = ['fullscreen', 'main'];
export const DEFAULT_SIZES = [60, 80, 100, 120, 160].flatMap(cols => [14, 24, 40].map(rows => ({ cols, rows })));

/**
 * The options: --out <dir>, --sizes 80x24,120x40, --modes fullscreen,main, --config-dir <dir> (CLAUDE_CONFIG_DIR of the
 * sessions), --no-engine and --engine-only. configDir, engine and engineOnly are present only when given. A malformed or
 * unknown option throws.
 */
export function parseArgs(argv, today = new Date().toISOString().slice(0, 10)) {
  const out = { out: `docs/superpowers/notes/tui-${today}`, sizes: DEFAULT_SIZES, modes: MODES };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--out' && value) { out.out = value; i++; continue; }
    if (flag === '--sizes' && value) {
      const sizes = value.split(',').map(s => /^(\d{2,3})x(\d{1,3})$/.exec(s.trim())).map(m => (m ? { cols: Number(m[1]), rows: Number(m[2]) } : null));
      if (!sizes.length || sizes.some(s => s === null)) throw new Error(`--sizes takes <cols>x<rows> joined by commas (80x24,120x40), not ${value}`);
      out.sizes = sizes;
      i++;
      continue;
    }
    if (flag === '--modes' && value) {
      const modes = value.split(',').map(s => s.trim());
      if (!modes.length || modes.some(m => !MODES.includes(m))) throw new Error(`--modes takes fullscreen and/or main, not ${value}`);
      out.modes = modes;
      i++;
      continue;
    }
    if (flag === '--config-dir' && value) { out.configDir = value; i++; continue; }
    if (flag === '--no-engine') { out.engine = false; continue; }
    if (flag === '--engine-only') { out.engineOnly = true; continue; }
    throw new Error(`unknown option ${flag}`);
  }
  return out;
}

/** The ids of `ids` cut between the end of a row and the start of the next one (frames and blanks aside). */
export function splitIds(text, ids = FIXTURE_IDS) {
  const rows = String(text).split(/\r?\n/);
  const out = [];
  for (const id of ids) {
    for (let i = 0; i + 1 < rows.length && !out.includes(id); i++) {
      const tail = rows[i].replace(/[\s│]+$/, '');
      const head = rows[i + 1].replace(/^[\s│]+/, '');
      for (let k = 1; k < id.length; k++) {
        if (tail.endsWith(id.slice(0, k)) && head.startsWith(id.slice(k))) { out.push(id); break; }
      }
    }
  }
  return out;
}

/** What one capture fails: o is { cols, rows, mode: 'fullscreen' | 'main', kind: 'band' | 'lens' | 'live', ids? }. */
export function checkCapture(text, o) {
  const fails = splitIds(text, o.ids).map(id => `${id} is split across two rows`);
  if (o.kind === 'band' && o.cols === 80) {
    if (!text.includes('▲')) fails.push('no ▲ at 80 columns');
    if (!text.includes('✎')) fails.push('no ✎ at 80 columns');
  }
  if (o.kind === 'band' && o.mode === 'main' && !/(^|\s)[a-z]: \S/m.test(text)) fails.push('no letter on the buttons outside fullscreen');
  if (o.kind === 'live' && o.mode === 'main' && o.rows <= 24 && !text.includes('↓')) fails.push('the inline pane was not cut with ↓');
  return fails;
}

/** The fixture's text with the session launched (__SESSION__) and times counted back from now (__NOW__, __AGO_<min>__). */
export function fillTemplate(text, vars) {
  return String(text)
    .replace(/__SESSION__/g, vars.session)
    .replace(/__AGO_(\d{1,5})__/g, (_, min) => new Date(vars.now - Number(min) * 60_000).toISOString())
    .replace(/__NOW__/g, new Date(vars.now).toISOString());
}

/** A fixture path with its dot-<name> folders as .<name>: git ignores .waypoint/ at any depth, so the fixture cannot keep it. */
export function dotted(rel) {
  return String(rel).split('/').map(s => (s.startsWith('dot-') ? `.${s.slice(4)}` : s)).join('/');
}

/** The band is up: its long header, or any short form fitParts leaves at narrow widths (► 2/3, ► 3 tareas…). */
export const BAND_READY = /EJECUCIÓN|EXECUTION|frente|track|otra sesión|another session|►/;

// Pressing a band button by its letter, as the engine documents it (index.d.ts, Button.hotkey and AbovePrompt): a letter
// answers only while the band holds the focus, which ctrl+x tab gives it; Esc then hands the keys back to the prompt, so
// what is typed next (a /lens) goes there.
const FOCUS_BAND = String.fromCharCode(0x18, 0x09);
const LEAVE_BAND = String.fromCharCode(0x1b);

/** The writes, in order, that press the band button with `letter`: ctrl+x tab, the letter, Esc. */
export function letterKeys(letter) {
  const key = String(letter);
  if (!/^[a-z0-9]$/.test(key)) throw new Error(`a band button's letter is one lowercase letter or digit, not «${key}»`);
  return [FOCUS_BAND, key, LEAVE_BAND];
}

const PLAIN_BUTTON = /(?:^|\s)([a-z0-9]): \S/gm;

/** The letters of the plain buttons («k: label») on a screen, in the order drawn. */
export function lettersOn(text) {
  return [...String(text).matchAll(PLAIN_BUTTON)].map(m => m[1]);
}

/**
 * The positive control of the letter checks: m (⋯) opened or closed the band's folded row, so the buttons' letters on the
 * screen changed. A letter that landed in the composer draws no button, so it does not count.
 */
export function moreToggled(before, after) {
  return lettersOn(before).join(' ') !== lettersOn(after).join(' ');
}

/** The letter the band's Panel button shows («p: Panel»), or null when none is drawn. */
export function panelLetter(text) {
  return /(?:^|\s)([a-z0-9]): Panel\b/m.exec(String(text))?.[1] ?? null;
}

/**
 * The verdict of a check that presses a band button: without the positive control (the keys reached the band) nothing is
 * proven, so it is inconclusive and never a fail; once the band was reached, a missing effect fails and a present one passes.
 */
export function pressVerdict(o) {
  if (!o.reached) return 'inconclusive';
  return o.effect ? 'pass' : 'fail';
}

// Check (a): a letter of a button folded into ⋯ does nothing.
/** The letter the band's Stop button shows («t: Parar», «t: Stop»), read from the screen; null when none is drawn. */
export function stopLetter(text) {
  return /(?:^|\s)([a-z0-9]): (?:Parar|Stop)\b/m.exec(String(text))?.[1] ?? null;
}

/** Whether the band folded its buttons into ⋯: the ⋯ is there and no Stop button is drawn. */
export function bandFolds(text) {
  const s = String(text);
  return s.includes('⋯') && stopLetter(s) === null;
}

const STOP_TEXT = /otra vez para parar|again to stop the run|\/forge:stop/g;

/** Whether a press of Stop (t) caused something: its confirmation toast or /forge:stop show more than before the press. */
export function stopTriggered(before, after) {
  return (String(after).match(STOP_TEXT) ?? []).length > (String(before).match(STOP_TEXT) ?? []).length;
}

// Checks (b) and (c): the photo of /lens in the transcript, drawn, and not wrapped by an indent of CommandOutput.
const STAMP_ROW = /^\s*lens · \d{2}:\d{2}:\d{2} #\d{1,6} · /;
// The photo is drawn inline and unboxed (layout.ts: compact, not boxed): each card is a header row and its body indented
// by two. It ends at a blank row or at the next row of the interface (the prompt, the hint line).
const AFTER_PHOTO = /^\s*$|^\s*(>|\? for|❯)/;

/**
 * What a capture of `/lens foto` fails: the stamp row must be there with cards drawn under it, and none of those rows
 * wraps (`wrapped` lists the rows the terminal marked as continuations) or is wider than `cols`.
 */
export function checkPhoto(text, o) {
  const rows = String(text).split(/\r?\n/);
  const stamp = rows.findIndex(row => STAMP_ROW.test(row));
  if (stamp < 0) return ['no photo row in the transcript'];
  let end = stamp + 1;
  while (end < rows.length && !AFTER_PHOTO.test(rows[end])) end++;
  if (end === stamp + 1) return ['the photo row has no cards under it'];
  const fails = [];
  for (let i = stamp + 1; i < end; i++) {
    if ((o.wrapped ?? []).includes(i)) fails.push(`row ${i} of the photo wrapped`);
    else if (Array.from(rows[i].replace(/\s+$/, '')).length > o.cols) fails.push(`row ${i} is wider than ${o.cols} columns`);
  }
  return fails;
}

// Check (d): the engine's own close mark of the pane, found on the screen, and the files lens wrote after it.
// The cells a text takes as the terminal draws it: an East Asian wide character or an emoji presented as one takes two,
// a combining mark or a format character none, anything else one.
const WIDE_CELL = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}/u;
const ZERO_CELL = /[\p{Mn}\p{Me}\p{Cf}]/u;

/** The cells `text` takes on a terminal. */
export function cellsOf(text) {
  let cells = 0;
  for (const ch of String(text)) cells += ZERO_CELL.test(ch) ? 0 : WIDE_CELL.test(ch) ? 2 : 1;
  return cells;
}

/** A row of a pane's frame: the engine's close mark sits on one, never in a card. */
export const PANE_FRAME = /[─━═╭╮╯╰┌┐└┘]/;

/**
 * The row and column (0-based, in cells: a wide character before it takes two) of the first `needle` on the screen, on
 * a row `o.row` accepts when given, or null.
 */
export function findText(text, needle, o = {}) {
  const rows = String(text).split(/\r?\n/);
  for (let row = 0; row < rows.length; row++) {
    if (o.row && !o.row.test(rows[row])) continue;
    const at = rows[row].indexOf(needle);
    if (at >= 0) return { row, col: cellsOf(rows[row].slice(0, at)) };
  }
  return null;
}

/**
 * How to end the process tree of a session on Windows, where claude runs under cmd.exe and killing the pty ends only
 * cmd.exe: taskkill /T /F on its pid. Null elsewhere, where the pty's kill is enough.
 */
export function treeKill(platform, pid) {
  return platform === 'win32' && Number.isInteger(pid) && pid > 0 ? { file: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] } : null;
}

/** The files whose time (or presence) differs between two listings `{ path: mtimeMs }`. */
export function changedFiles(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter(name => before[name] !== after[name]).sort();
}

/**
 * The verdict of (d) from the listings before and after a quiet window that followed the close: without a write seen
 * before the close there is nothing to compare, so it is inconclusive, never a pass on two empty observations.
 */
export function closeVerdict(before, after) {
  if (!Object.keys(before).length) return { verdict: 'inconclusive', detail: ['lens had written nothing under .forge/usage before the close, so a quiet window proves nothing'] };
  const wrote = changedFiles(before, after);
  return wrote.length ? { verdict: 'fail', detail: wrote.map(name => `lens wrote ${name} after the pane was closed`) } : { verdict: 'pass', detail: [] };
}
