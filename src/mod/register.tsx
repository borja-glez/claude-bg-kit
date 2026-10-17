import { atom, read, update } from 'claude-code';
import type { Register, RenderElement, Timer, UiPressArgument } from 'claude-code';
import { noneBand, type NoticeBand } from './model.js';
import { join, listOpt, loadBandModel, nowMs, readOpt, renewBindings, type Engine } from './files.js';
import { addDismissal, dismissalKey, dismissalUntil, DISMISS_STORE_KEY, isDismissed, normalizeDismissals, type Dismissals } from './notice-dismiss.js';
import { bandParts, textsFor } from './band-line.js';
import { DISMISS_KEY, layoutBand, MORE_HOTKEY, MORE_KEY, MORE_LABEL, SEP, type BandControl, type BandHue } from './band-fit.js';
import { applyWrite, artifactId, writeFailed, writesOf } from './mirror.js';

const band = atom({ plugin: 'waypoint', key: 'band' } as const, noneBand());
const hidden = atom({ plugin: 'waypoint', key: 'hidden' } as const, false);
// F-16, for lens: whether this band is drawn now (unless a survey holds it); null until this module has said it.
const drawn = atom({ plugin: 'waypoint', key: 'drawn' } as const, null as boolean | null);

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
  void publishDrawn($);
  try {
    await $.store.set(DISMISS_STORE_KEY, next);
    await loadDismissals($);
    // Carry 2: the map read back is what the band goes by from here, so drawn is worked out from it too.
    await publishDrawn($);
  } catch { /* hidden for this process only */ }
}

// F-16, carry 2: every publish is numbered, and one a later publish overtook writes nothing: the last word is the
// freshest, so a refresh that read before × never draws the band back for lens.
let drawnGen = 0;
// Carry 2: whether the band's last drawing threw (its catch left the site to what is beneath); drawn says so until it
// draws again.
let renderFailed = false;
// Carry 2: the one timer that publishes again when the dismissal of the notice the band shows ends; one further off
// than EXPIRY_MAX_MS is left to the 30 s refresh.
let expiry: Timer | null = null;
const EXPIRY_MAX_MS = 2 * 24 * 3600_000;

function watchExpiry($: Engine, ms: number): void {
  expiry?.cancel();
  expiry = null;
  if (!Number.isFinite(ms) || ms <= 0 || ms > EXPIRY_MAX_MS) return;
  expiry = $.clock.after(ms + 1, () => {
    expiry = null;
    $.ui.invalidate('ui.render');
    void publishDrawn($);
  });
}

// F-16: false with the band hidden with ×, a notice dismissed, nothing to draw or a drawing that threw; true otherwise.
// Worked out here, never while drawing, and written only when it changes; lens reads it before drawing a band of its own.
async function publishDrawn($: Engine): Promise<void> {
  const gen = ++drawnGen;
  try {
    const m = await read($, band);
    let shown = !renderFailed && !(await read($, hidden)) && m.mode !== 'none';
    if (shown && m.mode === 'notice') {
      // M6, carry 2: after a hot reload no session start read the dismissals; the notice waits for them, as its drawing does.
      if (!dismissalsLoaded) await readDismissals($);
      const key = dismissalKey(await rootOf($), m.project, m.kind, m.key);
      const now = await nowMs($);
      shown = !isDismissed(dismissals, key, now);
      if (!shown) watchExpiry($, Date.parse(Object.prototype.hasOwnProperty.call(dismissals, key) ? dismissals[key]! : '') - now);
    }
    const current = await read($, drawn);
    if (gen !== drawnGen) return;
    if (current !== shown) await update($, drawn, () => shown);
  } catch { /* lens keeps what it read */ }
}

// Carry 2: a drawing that throws leaves the band to what is beneath, and lens is told; and told again once it draws.
function noteDrawing($: Engine, ok: boolean): void {
  if (renderFailed === !ok) return;
  renderFailed = !ok;
  void publishDrawn($);
}

// F-05: the ⋯ row of a one-row band stays open until an action is pressed or 30 s pass.
const MORE_OPEN_MS = 30_000;
let moreUntil = 0;
// F-06: Stop, and Close on a run still active, ask twice: which button is armed, for which run, and until when.
const CONFIRM_MS = 5_000;
let armed: { key: string; runId: string | null; until: number } | null = null;

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
      await publishDrawn($);
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

/**
 * A control of the band: what the layout measures (band-fit.ts), what a press runs, and a link's address. `confirm`
 * marks one that asks twice: its first press does nothing yet, so it leaves the ⋯ row open.
 */
interface Control extends BandControl { press: (e: UiPressArgument) => void; href?: string; variant?: 'primary'; dismiss?: true; confirm?: true }

// F-06: puts an address on the clipboard of the surface pressed and shows it in a toast; «copied» only when it took.
async function copyUrl($: Engine, url: string, surface: UiPressArgument['surface'], copied: string, shown: string): Promise<void> {
  let ok = false;
  try { ok = (await $.ui.copy({ text: url, surface })).isCopied; } catch { ok = false; }
  try { $.ui.toast((ok ? copied : shown).replace('{url}', url)); } catch { /* nothing else to say */ }
}

// F-05: the ⋯ row, open for 30 s or closed again; the band is redrawn now, and once more when the 30 s are up.
async function toggleMore($: Engine): Promise<void> {
  const now = await nowMs($);
  moreUntil = now < moreUntil ? 0 : now + MORE_OPEN_MS;
  $.ui.invalidate('ui.render');
  if (moreUntil) $.clock.after(MORE_OPEN_MS, () => { $.ui.invalidate('ui.render'); });
}

// F-05: an action closes the ⋯ row.
function closeMore($: Engine): void {
  if (moreUntil) { moreUntil = 0; $.ui.invalidate('ui.render'); }
}

// F-02, F-06: a confirmation armed from the ⋯ row keeps the row open until it is due, so the second press finds its
// button; the band is redrawn when that time is up.
function holdMore($: Engine, now: number, until: number): void {
  if (now >= moreUntil || moreUntil >= until) return;
  moreUntil = until;
  $.clock.after(until - now, () => { $.ui.invalidate('ui.render'); });
}

// The tone of a part of the line: the decision and the warnings in the theme's colours, a notice dim.
const TONE: Record<BandHue, { color?: string; dimColor?: boolean }> = {
  warn: { color: 'warning' }, alert: { color: 'error' }, dim: { dimColor: true }, accent: { color: 'claude' },
};

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    moreUntil = 0;
    armed = null;
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
    expiry?.cancel();
    expiry = null;
    return next(e);
  });

  // K5-07: the conversation that starts (after /clear, a resume or a fork) gets its own role at once: refresh asks
  // $.session.id() each time. A /clear or a resume is another conversation, so a band hidden with × shows again. A
  // process whose timer an earlier end stopped gets it back.
  // I-11, carry 9: like lens's, this gating hook goes on when it fails (the replay-safe next gives what it settled to).
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e);
    if (e.source === 'clear' || e.source === 'resume') {
      try { await update($, hidden, () => false); } catch { /* ignore */ }
    }
    if (!timer) startTimer($);
    void refresh($);
    return r;
  }).catch(($, e, next) => next(e));

  on('turn.complete', ($, e, next) => {
    void checkLens($);
    void refresh($);
    return next(e);
  });

  // The session's own writes to the roadmap database reach the local copy at once (see mirror.ts), so the band and
  // lens do not wait for the next listing, which a session may skip. It only observes: the call goes on when it fails.
  on('tool.call', { tool: 'ArtifactData' }, async ($, e, next) => {
    const result = await next(e);
    try {
      if (!result.deny && !result.isError && !writeFailed(result.text) && await mirror($, e)) void refresh($);
    } catch { /* the next listing brings the copy up to date */ }
    return result;
  }).catch(($, e, next) => next(e));

  // The band is one instance per chain: drawing without next(e) hides the bands of the plugins beneath, so ours stacks
  // over them. F-04, F-05: its parts fitted to the cells it has, at the level its width, rows and screen allow (wide,
  // two, one with ⋯); F-06: a letter on every button, drawn plain outside fullscreen, where a click does not reach it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    try {
      const m = await read($, band);
      const isHidden = await read($, hidden);
      if (isHidden || !m || e.props.hasSurvey || m.mode === 'none') return below;
      // A running task's minutes and a notice's age are worked out as the band is drawn; the tick redraws only the first.
      const now = await nowMs($);
      // K5-08: a notice dismissed with × stays hidden for as long as that notice lasts.
      if (m.mode === 'notice') {
        if (!dismissalsLoaded) await readDismissals($);
        if (isDismissed(dismissals, dismissalKey(await rootOf($), m.project, m.kind, m.key), now)) return below;
      }
      const { Box, Text, Button, Link } = $.ui.resolve(e);
      const t = textsFor(m.locale);
      // §4.6: an engine that has not said (a remote surface, before it measures) counts as fullscreen, as before.
      const fullscreen = e.viewport?.isFullscreen !== false;
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
      const fill = (text: string) => () => { $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined); };
      // B-08: Stop belongs to the coordinator's run band. A member's Stop leaves /forge:stop in the prompt for the person
      // to confirm, since it stops the whole execution; the toast says so only once the prompt holds it.
      const fillStop = () => {
        $.prompt.fill({ text: '/forge:stop', mode: 'replace' }).then(r => { if (r.isFilled) $.ui.toast(t.stopFilled); }).catch(() => undefined);
      };
      // F-06: a single key must not stop a run. The first press arms the button for 5 s, for the run the band shows, and
      // says so; the second runs it, and closes the ⋯ row. A second press on a band that shows another run sends nothing:
      // it arms the button for that run and asks again.
      const confirmed = (key: string, hotkey: string, command: string, runId: string | null) => () => {
        void (async () => {
          const pressedAt = await nowMs($);
          if (armed && armed.key === key && armed.runId === runId && pressedAt <= armed.until) {
            armed = null;
            closeMore($);
            submit(command)();
            return;
          }
          armed = { key, runId, until: pressedAt + CONFIRM_MS };
          holdMore($, pressedAt, armed.until);
          try { $.ui.toast(t.confirmStop.replace('{k}', hotkey), { timeoutMs: CONFIRM_MS }); } catch { /* the next press asks again */ }
        })();
      };
      // r and d: the link of today in fullscreen; outside it, where nothing opens an address, a button that copies it.
      // An address that is not a web link is shown as plain text.
      const address = (key: string, url: string | null, label: string, short: string, hotkey: string, copied: string, shown: string): Control[] => {
        if (!url) return [];
        if (!/^https?:\/\//i.test(url)) return [{ key, label: url, kind: 'text', press: () => undefined }];
        if (fullscreen) return [{ key, label, short, kind: 'link', href: url, press: () => undefined }];
        return [{ key, label, short, hotkey, press: pressed => { void copyUrl($, url, pressed.surface, copied, shown); } }];
      };
      const roadmap = (url: string | null) => address('roadmap', url, t.roadmap, t.short.roadmap, 'r', t.roadmapCopied, t.roadmapShown);
      // §4.5: what a notice offers. Another live session: what it does and where to work instead. What an earlier one
      // left behind: take it up or let it go. [Close] is /forge:stop, the one entry that stops or closes a run (C2): sent
      // at once for a run already stopped; on one still active (stopReason null), which it would stop, it asks twice, as
      // Stop does. [Resume] of a draft binds this conversation to it without a critique round (design resume).
      const noticeControls = (n: NoticeBand): Control[] => {
        if (n.kind === 'other-live') {
          // Join only where forge takes members: an ephemeral run refuses them (joinable false).
          return n.subject === 'run'
            ? [
                { key: 'view', label: t.view, short: t.short.view, hotkey: 'v', press: submit('/waypoint:status') },
                ...(n.joinable ? [{ key: 'join', label: t.join, short: t.short.join, hotkey: 'j', press: submit('/forge:run --join') }] : []),
              ]
            : [
                { key: 'status', label: t.status, short: t.short.status, hotkey: 's', press: submit('/waypoint:status') },
                // A session on the design holds no track: there is no other one to launch.
                ...(n.subject === 'design' ? [] : [{ key: 'other-track', label: t.otherTrack, short: t.short.otherTrack, hotkey: 'l', press: fill('/waypoint:launch ') }]),
                ...roadmap(n.roadmapUrl),
              ];
        }
        if (n.subject === 'run') {
          return [
            { key: 'view', label: t.view, short: t.short.view, hotkey: 'v', press: submit('/waypoint:status') },
            { key: 'resume', label: t.resume, short: t.short.resume, hotkey: 'e', press: submit('/forge:run --resume') },
            n.stopReason
              ? { key: 'close', label: t.close, short: t.short.close, hotkey: 'c', press: submit('/forge:stop') }
              : { key: 'close', label: t.close, short: t.short.close, hotkey: 'c', confirm: true, press: confirmed('close', 'c', '/forge:stop', n.runId) },
          ];
        }
        if (n.subject === 'design') return [{ key: 'resume', label: t.resume, short: t.short.resume, hotkey: 'e', variant: 'primary', press: submit('/waypoint:design resume') }];
        const release: Control[] = n.task
          ? [{ key: 'release', label: `${t.release} ${n.task}`, short: t.short.release, hotkey: 'f', press: submit(`/waypoint:work release ${n.task}`) }]
          : [];
        return [{ key: 'resume', label: t.resume, short: t.short.resume, hotkey: 'e', variant: 'primary', press: submit('/waypoint:work resume') }, ...release];
      };
      let modeControls: Control[];
      if (m.mode === 'design') {
        const apply: Control[] = m.proposals > 0
          ? [
              { key: 'apply-all', label: t.applyAll, short: t.short.applyAll, hotkey: 'a', press: submit('/waypoint:design apply all') },
              { key: 'pick', label: t.pick, short: t.short.pick, hotkey: 'e', press: fill('/waypoint:design apply ') },
            ]
          : [];
        modeControls = [
          ...apply,
          { key: 'round', label: t.round, short: t.short.round, hotkey: 'o', press: submit('/waypoint:design round') },
          { key: 'rewrite', label: t.rewrite, short: t.short.rewrite, hotkey: 'w', press: submit('/waypoint:design rewrite') },
          { key: 'interview', label: t.interview, short: t.short.interview, hotkey: 'i', press: submit('/waypoint:design interview') },
          { key: 'approve', label: t.approve, hotkey: 'y', variant: 'primary', press: submit('/waypoint:design approve') },
          ...address('design', m.designUrl, t.viewDesign, t.short.viewDesign, 'd', t.designCopied, t.designShown),
        ];
      } else if (m.mode === 'run') {
        modeControls = [
          { key: 'status', label: t.status, short: t.short.status, hotkey: 's', press: submit('/waypoint:status') },
          { key: 'stop-run', label: t.stopRun, hotkey: 't', confirm: true, press: confirmed('stop-run', 't', '/forge:stop', m.viewer.runId) },
          ...roadmap(m.roadmapUrl),
        ];
      } else if (m.mode === 'notice') {
        modeControls = noticeControls(m);
      } else {
        const stop: Control[] = m.run ? [{ key: 'stop-run', label: t.stopRun, hotkey: 't', press: fillStop }] : [];
        modeControls = [
          { key: 'next-task', label: t.nextTask, short: t.short.nextTask, hotkey: 'n', variant: 'primary', press: submit('/waypoint:work') },
          { key: 'status', label: t.status, short: t.short.status, hotkey: 's', press: submit('/waypoint:status') },
          { key: 'launch', label: t.launch, short: t.short.launch, hotkey: 'l', press: fill('/waypoint:launch ') },
          ...stop,
          ...roadmap(m.roadmapUrl),
        ];
      }
      // × on a notice is kept per checkout, project, kind and subject (K5-08); on the conversation's own band it lasts the process.
      const notice = m.mode === 'notice' ? m : null;
      const dismiss = () => {
        (notice ? dismissNotice($, notice) : update($, hidden, () => true).then(() => publishDrawn($))).catch(() => undefined);
      };
      const panel: Control[] = lens ? [{ key: 'panel', label: t.panel, hotkey: 'p', press: submit('/lens') }] : [];
      const controls: Control[] = [...modeControls, ...panel, { key: DISMISS_KEY, label: '×', hotkey: 'x', dismiss: true, press: dismiss }];
      const lay = layoutBand(bandParts(m, now), controls, { bodyColumns: e.props.bodyColumns, maxRows: e.props.maxRows, fullscreen, moreOpen: now < moreUntil });
      // Any action closes the ⋯ row; a press that only arms a confirmation is not one yet.
      const act = (c: Control) => (pressed: UiPressArgument) => {
        if (!c.confirm) closeMore($);
        c.press(pressed);
      };
      const plain = lay.plain ? { plain: true as const } : {};
      // Carry 3: a second row's labels come fitted to the width (lay.labels), so it never wraps onto a third row.
      const draw = (c: Control): RenderElement => {
        const label = lay.labels[c.key] ?? (lay.long ? c.label : c.short ?? c.label);
        if (c.kind === 'text') return <Text key={c.key} dimColor>{lay.labels[c.key] ?? c.label}</Text>;
        if (c.kind === 'link') return <Link key={c.key} href={c.href ?? ''} label={label} />;
        return (
          <Button key={c.key} label={label} hotkey={c.hotkey} {...plain} {...(c.variant ? { variant: c.variant } : {})}
            {...(c.dismiss ? { role: 'dismiss' as const } : {})} onPress={act(c)} />
        );
      };
      const byKey = new Map(controls.map(c => [c.key, c] as const));
      const drawKeys = (keys: readonly string[]) => keys.flatMap(k => { const c = byKey.get(k); return c ? [draw(c)] : []; });
      const base = m.mode === 'notice' ? { dimColor: true } : { color: 'claude' };
      const line = (
        <Text {...base} wrap="truncate-end">
          {lay.shown.map((p, i) => {
            const text = `${i ? p.glue ?? SEP : ''}${p.text}`;
            return p.hue ? <Text key={`part-${p.key}`} {...TONE[p.hue]}>{text}</Text> : text;
          })}
        </Text>
      );
      const tree = (
        <Box flexDirection="column">
          <Box key="band-row" flexDirection="row" columnGap={1}>
            <Box key="band-line" flexShrink={1} minWidth={0}>{line}</Box>
            {drawKeys(lay.inline.filter(k => k !== DISMISS_KEY))}
            {lay.more ? <Button key={MORE_KEY} label={MORE_LABEL} hotkey={MORE_HOTKEY} {...plain} onPress={() => { void toggleMore($); }} /> : null}
            {drawKeys(lay.inline.filter(k => k === DISMISS_KEY))}
          </Box>
          {lay.second.length ? <Box key="band-row2" flexDirection="row" flexWrap="wrap" columnGap={1}>{drawKeys(lay.second)}</Box> : null}
          {below}
        </Box>
      );
      noteDrawing($, true);
      return tree;
    } catch {
      noteDrawing($, false);
      return below;
    }
  });

  // F-06, step 1 of §4.6: outside fullscreen, at the end of the hint line under the prompt, how to reach the band's
  // letters, while the band is drawn and the line has no tail of its own. Carry 3: «drawn» says it, worked out outside any
  // drawing, and reading it subscribes the hint: the tail goes with a × at once, whichever is drawn first.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    try {
      if (e.viewport?.isFullscreen === false && !e.props.tail && (await read($, drawn)) === true) {
        const m = await read($, band);
        return next({ ...e, props: { ...e.props, tail: textsFor(m.locale).bandHint } });
      }
    } catch { /* the engine's line */ }
    return next(e);
  });
};
