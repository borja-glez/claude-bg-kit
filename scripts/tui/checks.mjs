// F-17: what a capture of the real paint must show, as pure functions that vitest checks on sample captures
// (tests/tui-checks.test.ts): no task id of the fixture split across two rows, ▲ and ✎ in the band at 80 columns,
// letters on the band's buttons outside fullscreen («x: ×»), and «↓» when the inline pane was cut. The snapshot script
// runs them on every capture; it also reads its options here and fills the fixture with fillTemplate and dotted.
// The engine checks (a) to (d) of the script use the helpers at the end: bandFolds, stopTriggered, checkPhoto, findText
// and changedFiles.

export const FIXTURE_IDS = ['T001', 'T002', 'T003'];
export const MODES = ['fullscreen', 'main'];
export const DEFAULT_SIZES = [60, 80, 100, 120, 160].flatMap(cols => [14, 24, 40].map(rows => ({ cols, rows })));

/** The options: --out <dir>, --sizes 80x24,120x40, --modes fullscreen,main. A malformed or unknown one throws. */
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

// Check (a): a letter of a button folded into ⋯ does nothing.
/** Whether the band folded its buttons into ⋯ and so shows no «t: » (Stop) letter. */
export function bandFolds(text) {
  const s = String(text);
  return s.includes('⋯') && !/(^|\s)t: \S/m.test(s);
}

/** Whether the screen shows what a press of Stop (t) causes: its confirmation toast or /forge:stop in the prompt. */
export function stopTriggered(text) {
  return /otra vez para parar|again to stop the run|\/forge:stop/.test(String(text));
}

// Checks (b) and (c): the photo of /lens in the transcript, drawn, and not wrapped by an indent of CommandOutput.
const STAMP_ROW = /^\s*lens · \d{2}:\d{2}:\d{2} #\d{1,6} · /;
const FRAME_ROW = /^\s*[╭│╰┌└├─]/;

/**
 * What a capture of `/lens foto` fails: the stamp row must be there with cards drawn under it, and none of those rows
 * wraps (`wrapped` lists the rows the terminal marked as continuations) or is wider than `cols`.
 */
export function checkPhoto(text, o) {
  const rows = String(text).split(/\r?\n/);
  const stamp = rows.findIndex(row => STAMP_ROW.test(row));
  if (stamp < 0) return ['no photo row in the transcript'];
  let end = stamp + 1;
  while (end < rows.length && FRAME_ROW.test(rows[end])) end++;
  if (end === stamp + 1) return ['the photo row has no cards under it'];
  const fails = [];
  for (let i = stamp + 1; i < end; i++) {
    if ((o.wrapped ?? []).includes(i)) fails.push(`row ${i} of the photo wrapped`);
    else if (Array.from(rows[i].replace(/\s+$/, '')).length > o.cols) fails.push(`row ${i} is wider than ${o.cols} columns`);
  }
  return fails;
}

// Check (d): the engine's own close mark of the pane, found on the screen, and the files lens wrote after it.
/** The row and column (0-based, in characters) of the first `needle` on the screen, or null. */
export function findText(text, needle) {
  const rows = String(text).split(/\r?\n/);
  for (let row = 0; row < rows.length; row++) {
    const col = rows[row].indexOf(needle);
    if (col >= 0) return { row, col };
  }
  return null;
}

/** The files whose time (or presence) differs between two listings `{ path: mtimeMs }`. */
export function changedFiles(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter(name => before[name] !== after[name]).sort();
}
