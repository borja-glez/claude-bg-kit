import { atom, read, update } from 'claude-code';
import type { Register, Timer } from 'claude-code';
import { noneBand, type NoticeBand } from './model.js';
import { join, listOpt, loadBandModel, readOpt, type Engine } from './files.js';
import { bandLine, textsFor } from './band-line.js';
import { applyWrite, artifactId, writeFailed, writesOf } from './mirror.js';

const band = atom({ plugin: 'waypoint', key: 'band' } as const, noneBand());
const hidden = atom({ plugin: 'waypoint', key: 'hidden' } as const, false);

let refreshing = false;
let timer: Timer | null = null;
let lensRecheck: Timer | null = null;

async function refresh($: Engine): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const model = await loadBandModel($);
    const current = await read($, band);
    if (JSON.stringify(current) !== JSON.stringify(model)) await update($, band, () => model);
  } catch {
    // leave the band as it was
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

// The periodic refresh; a running task's minutes change with time alone, so its band is redrawn too.
async function tick($: Engine): Promise<void> {
  await checkLens($);
  await refresh($);
  try {
    const m = await read($, band);
    if (m.mode === 'work' && m.current?.startedAt) $.ui.invalidate('ui.render');
  } catch { /* ignore */ }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try { await update($, hidden, () => false); } catch { /* ignore */ }
    await checkLens($);
    await refresh($);
    // One timer per environment: a later session start replaces it rather than adding another.
    timer?.cancel();
    timer = $.clock.every(30000, () => { void tick($); });
    // lens may register /lens after this start: look again a second later rather than waiting for the tick.
    lensRecheck?.cancel();
    lensRecheck = $.clock.after(1000, () => { lensRecheck = null; void checkLens($); });
    return next(e);
  });

  on('session.end', ($, e, next) => {
    timer?.cancel();
    timer = null;
    lensRecheck?.cancel();
    lensRecheck = null;
    return next(e);
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
            await $.prompt.fill({ text, mode: 'replace' });
            $.ui.toast(t.pressEnter);
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
          return n.subject === 'run'
            ? [
                <Button key="view" label={t.view} onPress={submit('/waypoint:status')} />,
                <Button key="join" label={t.join} onPress={submit('/forge:run --join')} />,
              ]
            : [
                <Button key="status" label={t.status} onPress={submit('/waypoint:status')} />,
                <Button key="other-track" label={t.otherTrack} onPress={fill('/waypoint:launch ')} />,
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
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {m.mode === 'notice'
              ? <Text dimColor wrap="truncate-end">{line}</Text>
              : <Text color="claude" wrap="truncate-end">{line}</Text>}
            {controls}
            {lens ? <Button key="panel" label={t.panel} onPress={submit('/lens')} /> : null}
            <Button key="dismiss" label="×" role="dismiss" onPress={() => { update($, hidden, () => true).catch(() => undefined); }} />
          </Box>
          {below}
        </Box>
      );
    } catch {
      return below;
    }
  });
};
