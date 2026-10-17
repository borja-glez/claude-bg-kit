import { atom, read, update } from 'claude-code';
import type { Register, Timer } from 'claude-code';
import { noneBand, type NoticeBand } from './model.js';
import { join, listOpt, loadBandModel, nowMs, readOpt, renewBindings, type Engine } from './files.js';
import { addDismissal, dismissalKey, dismissalUntil, DISMISS_STORE_KEY, isDismissed, normalizeDismissals, type Dismissals } from './notice-dismiss.js';
import { bandLine, textsFor } from './band-line.js';
import { applyWrite, artifactId, writeFailed, writesOf } from './mirror.js';

const band = atom({ plugin: 'waypoint', key: 'band' } as const, noneBand());
const hidden = atom({ plugin: 'waypoint', key: 'hidden' } as const, false);

/** The bands of the conversation's own work, which × hides for the process. */
const OWN_BANDS: readonly string[] = ['work', 'run', 'design'];

let refreshing = false;
let timer: Timer | null = null;
let lensRecheck: Timer | null = null;

// K5-08: the notices dismissed with ×, read from $.store at each session start and after each write. M6: a hot reload
// starts the module over without a session start, so a notice about to be drawn reads them too, until one read
// resolved (`dismissalsLoaded`).
let dismissals: Dismissals = {};
let dismissalsLoaded = false;
let dismissalsReading: Promise<void> | null = null;
/** Reads the dismissals from the store; whether the read resolved (a refused one keeps what is in memory). */
async function loadDismissals($: Engine): Promise<boolean> {
  try {
    dismissals = normalizeDismissals(await $.store.get(DISMISS_STORE_KEY), await nowMs($));
    dismissalsLoaded = true;
    return true;
  } catch { return false; }
}
/**
 * The read a notice waits for before it is drawn: one at a time, so a second surface drawing meanwhile waits for the
 * same read rather than drawing without it. Once it resolved, every instance is drawn again: a draw the engine did not
 * wait for may show a dismissed notice. A refused read redraws nothing (the next draw tries again, never a loop).
 */
function readDismissals($: Engine): Promise<void> {
  dismissalsReading ??= loadDismissals($).then(read => {
    dismissalsReading = null;
    if (read) $.ui.invalidate('ui.render');
  });
  return dismissalsReading;
}
async function rootOf($: Engine): Promise<string> {
  try { return await $.session.root(); } catch { return ''; }
}
// The notice hides at once; the map, without what expired and at most DISMISS_MAX, goes to the store and is read back.
// When the store refuses it, the notice stays hidden for this process only.
async function dismissNotice($: Engine, n: NoticeBand): Promise<void> {
  const now = await nowMs($);
  let stored: unknown;
  try { stored = await $.store.get(DISMISS_STORE_KEY); } catch { stored = undefined; }
  const next = addDismissal({ ...normalizeDismissals(stored, now), ...dismissals }, dismissalKey(await rootOf($), n.project, n.kind, n.key), dismissalUntil(n, now), now);
  dismissals = next;
  $.ui.invalidate('ui.render');
  try {
    await $.store.set(DISMISS_STORE_KEY, next);
    await loadDismissals($);
  } catch { /* hidden for this process only */ }
}

// A refresh asked while one runs is not dropped: what the running one read may be the old conversation's (a /clear
// meanwhile), so it reads once more when it ends ($.session.id() is asked again each time).
let refreshPending = false;

async function refresh($: Engine): Promise<void> {
  if (refreshing) { refreshPending = true; return; }
  refreshing = true;
  try {
    do {
      refreshPending = false;
      try {
        const model = await loadBandModel($);
        const current = await read($, band);
        if (JSON.stringify(current) !== JSON.stringify(model)) {
          await update($, band, () => model);
          // M2: a takeover turns this conversation's own band into another's notice; the × pressed on its own band does
          // not hide that it lost the seat (its hooks stop recording from then on).
          if (model.mode === 'notice' && OWN_BANDS.includes(current.mode)) await update($, hidden, () => false);
        }
      } catch {
        // leave the band as it was
      }
    } while (refreshPending);
  } finally {
    refreshing = false;
  }
}

// Applies an ArtifactData call's writes to the cached documents of the waypoint project whose roadmap it wrote to
// (the project whose session.json names that artifact). A delete is left to the next listing: the mod cannot remove
// files. Returns whether anything was written.
async function mirror($: Engine, input: unknown): Promise<boolean> {
  const writes = writesOf(input).filter(w => w.op !== 'delete');
  const id = artifactId((input as { url?: unknown } | null)?.url);
  if (!writes.length || !id) return false;
  const root = await $.session.root();
  for (const p of (await listOpt($, join(root, '.waypoint'))).filter(d => d.kind === 'dir')) {
    let url: unknown;
    try { url = JSON.parse((await readOpt($, join(root, '.waypoint', p.name, 'session.json'))) ?? '').url; } catch { continue; }
    if (artifactId(url) !== id) continue;
    for (const w of writes) {
      const file = join(root, '.waypoint', p.name, 'dbcache', w.collection, `${w.docId}.json`);
      const text = applyWrite(await readOpt($, file), w);
      if (text !== null) await $.fs.write(file, text);
    }
    return true;
  }
  return false;
}

// The Panel button belongs to lens: it shows only when the /lens command exists.
let lens = false;
async function checkLens($: Engine): Promise<void> {
  let next = false;
  try { next = (await $.command.list()).some(c => c.name === 'lens' && (c.plugin === undefined || c.plugin === 'lens')); } catch { /* treat as absent */ }
  if (next !== lens) { lens = next; $.ui.invalidate('ui.render'); }
}

// The periodic refresh; a running task's minutes change with time alone, so its band is redrawn too. It never throws:
// a step that fails (a $.session.root() refused, a read, a write) leaves the band as it was until the next tick.
async function tick($: Engine): Promise<void> {
  try { await checkLens($); } catch { /* ignore */ }
  // C3: this conversation's binding stays alive while its band runs (at most one write a minute).
  try { await renewBindings($); } catch { /* the next tick tries again */ }
  await refresh($);
  try {
    const m = await read($, band);
    if (m.mode === 'work' && m.current?.startedAt) $.ui.invalidate('ui.render');
  } catch { /* ignore */ }
}

// One timer per environment: a later session start replaces it rather than adding another.
function startTimer($: Engine): void {
  timer?.cancel();
  timer = $.clock.every(30000, () => { void tick($); });
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try { await update($, hidden, () => false); } catch { /* ignore */ }
    await loadDismissals($);
    await checkLens($);
    await refresh($);
    startTimer($);
    // lens may register /lens after this start: look again a second later rather than waiting for the tick.
    lensRecheck?.cancel();
    lensRecheck = $.clock.after(1000, () => { lensRecheck = null; void checkLens($); });
    return next(e);
  });

  on('session.end', ($, e, next) => {
    // K5-07: /clear and an in-process resume go on under another id and without a session.start: the timers keep
    // running, as lens's do, and classic.SessionStart below draws the band for the new conversation.
    if (e.reason === 'clear' || e.reason === 'resume') return next(e);
    timer?.cancel();
    timer = null;
    lensRecheck?.cancel();
    lensRecheck = null;
    return next(e);
  });

  // K5-07: the conversation that starts (after /clear, a resume or a fork) gets its own role at once: refresh asks
  // $.session.id() each time. A /clear or a resume is another conversation, so a band hidden with × shows again. A
  // process whose timer an earlier end stopped gets it back.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e);
    if (e.source === 'clear' || e.source === 'resume') {
      try { await update($, hidden, () => false); } catch { /* ignore */ }
    }
    if (!timer) startTimer($);
    void refresh($);
    return r;
  });

  on('turn.complete', ($, e, next) => {
    void checkLens($);
    void refresh($);
    return next(e);
  });

  // The session's own writes to the roadmap database reach the local copy at once (see mirror.ts), so the band and
  // lens do not wait for the next listing, which a session may skip.
  on('tool.call', { tool: 'ArtifactData' }, async ($, e, next) => {
    const result = await next(e);
    try {
      if (!result.deny && !result.isError && !writeFailed(result.text) && await mirror($, e)) void refresh($);
    } catch { /* the next listing brings the copy up to date */ }
    return result;
  });

  // The band is one instance per chain: drawing without next(e) hides the bands of the plugins beneath, so ours stacks over them.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    try {
      const m = await read($, band);
      const isHidden = await read($, hidden);
      if (isHidden || !m || e.props.hasSurvey || m.mode === 'none') return below;
      // K5-08: a notice dismissed with × stays hidden for as long as that notice lasts.
      if (m.mode === 'notice') {
        if (!dismissalsLoaded) await readDismissals($);
        if (isDismissed(dismissals, dismissalKey(await rootOf($), m.project, m.kind, m.key), await nowMs($))) return below;
      }
      const { Box, Text, Button, Link } = $.ui.resolve(e);
      // A running task's minutes and a notice's age are worked out as the band is drawn; the tick redraws only the first.
      const drawnAt = m.mode === 'notice' || (m.mode === 'work' && m.current?.startedAt) ? await $.clock.now() : 0;
      const line = bandLine(m, drawnAt);
      const t = textsFor(m.locale);
      // $.prompt.submit refuses a text that starts with '/': slash commands go through $.command.run.
      const submit = (text: string) => () => {
        const [, command = '', args = ''] = /^\/(\S+)\s*(.*)$/.exec(text) ?? [];
        // When the command cannot run from here, leave it in the prompt for the person to send.
        $.command.run({ command, args }).catch(async () => {
          try {
            const r = await $.prompt.fill({ text, mode: 'replace' });
            if (r.isFilled) $.ui.toast(t.pressEnter);
          } catch { /* nothing else to do */ }
        });
      };
      // Only web links are drawn as links; any other address is shown as plain text.
      const link = (href: string, label: string) => /^https?:\/\//i.test(href)
        ? <Link href={href} label={label} />
        : <Text dimColor>{href}</Text>;
      const fill = (text: string) => () => { $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined); };
      // B-08: Stop belongs to the coordinator's run band. A member's Stop, and [Close] on a run still active without its
      // coordinator, leave /forge:stop in the prompt for the person to confirm, since it stops the whole execution; the
      // toast says so only once the prompt holds it.
      const fillStop = () => {
        $.prompt.fill({ text: '/forge:stop', mode: 'replace' }).then(r => { if (r.isFilled) $.ui.toast(t.stopFilled); }).catch(() => undefined);
      };
      // §4.5: what a notice offers. Another live session: what it does and where to work instead. What an earlier one
      // left behind: take it up or let it go. [Close] is /forge:stop, the one entry that stops or closes a run (C2): sent
      // at once for a run already stopped, only filled for one still active (stopReason null), which it would stop.
      // [Resume] of a draft binds this conversation to it without a critique round (design resume).
      const noticeControls = (n: NoticeBand) => {
        if (n.kind === 'other-live') {
          // Join only where forge takes members: an ephemeral run refuses them (joinable false).
          return n.subject === 'run'
            ? [
                <Button key="view" label={t.view} onPress={submit('/waypoint:status')} />,
                ...(n.joinable ? [<Button key="join" label={t.join} onPress={submit('/forge:run --join')} />] : []),
              ]
            : [
                <Button key="status" label={t.status} onPress={submit('/waypoint:status')} />,
                // A session on the design holds no track: there is no other one to launch.
                ...(n.subject === 'design' ? [] : [<Button key="other-track" label={t.otherTrack} onPress={fill('/waypoint:launch ')} />]),
                ...(n.roadmapUrl ? [link(n.roadmapUrl, t.roadmap)] : []),
              ];
        }
        if (n.subject === 'run') {
          return [
            <Button key="view" label={t.view} onPress={submit('/waypoint:status')} />,
            <Button key="resume" label={t.resume} onPress={submit('/forge:run --resume')} />,
            <Button key="close" label={t.close} onPress={n.stopReason ? submit('/forge:stop') : fillStop} />,
          ];
        }
        if (n.subject === 'design') return [<Button key="resume" label={t.resume} variant="primary" onPress={submit('/waypoint:design resume')} />];
        return [
          <Button key="resume" label={t.resume} variant="primary" onPress={submit('/waypoint:work resume')} />,
          ...(n.task ? [<Button key="release" label={`${t.release} ${n.task}`} onPress={submit(`/waypoint:work release ${n.task}`)} />] : []),
        ];
      };
      const controls = m.mode === 'design'
        ? [
            ...(m.proposals > 0
              ? [
                  <Button key="apply-all" label={t.applyAll} onPress={submit('/waypoint:design apply all')} />,
                  <Button key="pick" label={t.pick} onPress={fill('/waypoint:design apply ')} />,
                ]
              : []),
            <Button key="round" label={t.round} onPress={submit('/waypoint:design round')} />,
            <Button key="rewrite" label={t.rewrite} onPress={submit('/waypoint:design rewrite')} />,
            <Button key="interview" label={t.interview} onPress={submit('/waypoint:design interview')} />,
            <Button key="approve" label={t.approve} variant="primary" onPress={submit('/waypoint:design approve')} />,
            ...(m.designUrl ? [link(m.designUrl, t.viewDesign)] : []),
          ]
        : m.mode === 'run'
          ? [
              <Button key="status" label={t.status} onPress={submit('/waypoint:status')} />,
              <Button key="stop-run" label={t.stopRun} onPress={submit('/forge:stop')} />,
              ...(m.roadmapUrl ? [link(m.roadmapUrl, t.roadmap)] : []),
            ]
          : m.mode === 'notice'
            ? noticeControls(m)
            : [
                <Button key="next-task" label={t.nextTask} variant="primary" onPress={submit('/waypoint:work')} />,
                <Button key="status" label={t.status} onPress={submit('/waypoint:status')} />,
                <Button key="launch" label={t.launch} onPress={fill('/waypoint:launch ')} />,
                ...(m.run ? [<Button key="stop-run" label={t.stopRun} onPress={fillStop} />] : []),
                ...(m.roadmapUrl ? [link(m.roadmapUrl, t.roadmap)] : []),
              ];
      // × on a notice is kept per checkout, project, kind and subject (K5-08); on the conversation's own band it lasts the process.
      const notice = m.mode === 'notice' ? m : null;
      const dismiss = () => {
        (notice ? dismissNotice($, notice) : update($, hidden, () => true)).catch(() => undefined);
      };
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Box key="band-line" flexShrink={1} minWidth={0}>
              {m.mode === 'notice'
                ? <Text dimColor wrap="truncate-end">{line}</Text>
                : <Text color="claude" wrap="truncate-end">{line}</Text>}
            </Box>
            {controls}
            {lens ? <Button key="panel" label={t.panel} onPress={submit('/lens')} /> : null}
            <Button key="dismiss" label="×" role="dismiss" onPress={dismiss} />
          </Box>
          {below}
        </Box>
      );
    } catch {
      return below;
    }
  });
};
