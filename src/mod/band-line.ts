// The band's line as parts with a priority (F-04): band-fit.ts fits them to the band's width and register.tsx draws
// them; bandLine joins them all, for the tests and for a reader with room for the whole line.
import type { BandModel, NoticeBand } from './model.js';
import { clipWidth } from '../lib/text-width.js';
import { minutesText } from '../lib/duration.js';
import { joinParts, type BandPart } from './band-fit.js';

export type { BandPart } from './band-fit.js';

const TITLE_MAX = 40;
// A slot's task id in the run line: loose task ids (`<slug>-<tag>`) run up to 45 characters.
const SLOT_ID_MAX = 20;
// The seat's task id in the work line: the plan's id rule allows 64 characters (src/lib/ids.ts), so a valid id shows
// whole. M1: planLite keeps only tasks whose id follows that rule.
const TASK_ID_MAX = 64;

/**
 * A title or an id as the band shows it, cut by the cells it takes (F-13), not by code points: a wide title is cut where
 * the terminal would cut it. M1: the text is already one clean line: buildBandModel cleans it (oneLine, src/lib/one-line.ts).
 */
export function clip(text: string, max = TITLE_MAX): string {
  return clipWidth(String(text), max);
}

/** F-09: a stage as a short band says it: «T001 impl · T002 rev r2 · T003 val». The same in every language. */
export const STAGE_SHORT: Readonly<Record<string, string>> = {
  triage: 'tri', brief: 'brief', implement: 'impl', validate: 'val', verify: 'ver', review: 'rev', verdict: 'verd',
  integrate: 'int', execution: 'exec',
};

export const TEXT = {
  es: {
    design: 'DISEÑO', proposals: 'propuestas', proposal: 'propuesta', critical: 'críticas', criticalOne: 'crítica', noCritique: 'sin crítica aún',
    pending: 'pendientes', pendingOne: 'pendiente', nothingPending: 'sin pendientes',
    noTask: 'sin tarea en curso', track: 'frente', tasks: 'tareas', overall: 'global', decision: 'decisión pendiente', decisionShort: 'decisión',
    applyAll: 'Aplicar todas', pick: 'Elegir…', round: 'Otra ronda', rewrite: 'Reescribir', interview: 'Preguntarme',
    approve: 'Aprobar', viewDesign: 'Ver diseño', nextTask: 'Siguiente tarea', status: 'Estado',
    launch: 'Lanzar sesión en un frente…', roadmap: 'Abrir roadmap',
    pressEnter: 'Comando listo en el prompt: pulsa Enter',
    panel: 'Panel',
    run: 'EJECUCIÓN', subagents: 'subagentes', sessions: 'sesiones', silentSfx: 'sin señal', signalShort: 'señal', stoppedSfx: 'parada', stopRun: 'Parar',
    integratedN: 'integradas', queuedN: 'por integrar', memberOf: 'de la ejecución de {c}',
    otherTrack: 'Otro frente', view: 'Ver', join: 'Unirme', resume: 'Retomar', release: 'Liberar', close: 'Cerrar',
    stopFilled: '/forge:stop está en el prompt: pulsa Enter para parar toda la ejecución',
    // F-05: the short labels of the narrow levels (§4.5); Aprobar, Panel and Parar are short already.
    short: {
      nextTask: 'Siguiente', status: 'Estado', launch: 'Lanzar…', roadmap: 'Roadmap', applyAll: 'Aplicar', pick: 'Elegir…', round: 'Ronda',
      rewrite: 'Reescribir', interview: 'Preguntar', viewDesign: 'Diseño', otherTrack: 'Frente', join: 'Unirme', resume: 'Retomar',
      release: 'Liberar', view: 'Ver', close: 'Cerrar',
    },
    confirmStop: 'Pulsa {k} otra vez para parar la ejecución',
    roadmapCopied: 'URL del roadmap copiada: {url}', roadmapShown: 'Roadmap: {url}',
    designCopied: 'URL del diseño copiada: {url}', designShown: 'Diseño: {url}',
    bandHint: 'ctrl+x tab · banda',
    ago: 'hace {ago}', left: 'a medias', noCoordinator: 'sin coordinadora',
    noticeOtherTask: 'otra sesión ({seat}) trabaja en', noticeOtherBound: 'otra sesión ({seat}) está ligada al roadmap',
    noticeOtherDesign: 'otra sesión ({seat}) trabaja en el diseño',
    noticeOtherRun: 'ejecución de forge en curso, la coordina otra sesión',
    noticePrevTask: 'quedó a medias:', noticePrevDesign: 'diseño a medias:',
    noticeRunStopped: 'ejecución parada:', noticeRunOrphan: 'ejecución sin coordinadora:',
    noticeRunOpen: 'ejecución parada, abierta en otra conversación:', openElsewhere: 'en otra conversación',
    stage: { brief: 'brief', implement: 'implementar', validate: 'validar', verify: 'verificar', review: 'revisar', verdict: 'veredicto', integrate: 'integrar', execution: 'ejecución' },
  },
  en: {
    design: 'DESIGN', proposals: 'proposals', proposal: 'proposal', critical: 'critical', criticalOne: 'critical', noCritique: 'no critique yet',
    pending: 'pending', pendingOne: 'pending', nothingPending: 'nothing pending',
    noTask: 'no task in progress', track: 'track', tasks: 'tasks', overall: 'overall', decision: 'decision pending', decisionShort: 'decision',
    applyAll: 'Apply all', pick: 'Pick…', round: 'Another round', rewrite: 'Rewrite', interview: 'Interview me',
    approve: 'Approve', viewDesign: 'View design', nextTask: 'Next task', status: 'Status',
    launch: 'Launch session on track…', roadmap: 'Open roadmap',
    pressEnter: 'Command ready in the prompt: press Enter',
    panel: 'Panel',
    run: 'EXECUTION', subagents: 'subagents', sessions: 'sessions', silentSfx: 'no signal', signalShort: 'signal', stoppedSfx: 'stopped', stopRun: 'Stop',
    integratedN: 'integrated', queuedN: 'to integrate', memberOf: "in {c}'s execution",
    otherTrack: 'Other track', view: 'View', join: 'Join', resume: 'Resume', release: 'Release', close: 'Close',
    stopFilled: '/forge:stop is in the prompt: press Enter to stop the whole execution',
    // F-05: the short labels of the narrow levels (§4.5); Approve, Panel and Stop are short already.
    short: {
      nextTask: 'Next', status: 'Status', launch: 'Launch…', roadmap: 'Roadmap', applyAll: 'Apply', pick: 'Pick…', round: 'Round',
      rewrite: 'Rewrite', interview: 'Ask me', viewDesign: 'Design', otherTrack: 'Track', join: 'Join', resume: 'Resume',
      release: 'Release', view: 'View', close: 'Close',
    },
    confirmStop: 'Press {k} again to stop the run',
    roadmapCopied: 'Roadmap URL copied: {url}', roadmapShown: 'Roadmap: {url}',
    designCopied: 'Design URL copied: {url}', designShown: 'Design: {url}',
    bandHint: 'ctrl+x tab · band',
    ago: '{ago} ago', left: 'left', noCoordinator: 'no coordinator',
    noticeOtherTask: 'another session ({seat}) works on', noticeOtherBound: 'another session ({seat}) is bound to the roadmap',
    noticeOtherDesign: 'another session ({seat}) is working on the design',
    noticeOtherRun: 'forge execution running, coordinated by another session',
    noticePrevTask: 'left in progress:', noticePrevDesign: 'design left in progress:',
    noticeRunStopped: 'execution stopped:', noticeRunOrphan: 'execution without a coordinator:',
    noticeRunOpen: 'execution stopped, open in another conversation:', openElsewhere: 'open elsewhere',
    stage: { brief: 'brief', implement: 'implement', validate: 'validate', verify: 'verify', review: 'review', verdict: 'verdict', integrate: 'integrate', execution: 'execution' },
  },
} as const;
export type Texts = (typeof TEXT)[keyof typeof TEXT];

export const textsFor = (locale: string | undefined): Texts => (locale === 'es' ? TEXT.es : TEXT.en);

const stageText = (t: Texts, stage: string): string => t.stage[stage as keyof typeof t.stage] ?? stage;
const decisionPart = (t: Texts): BandPart => ({ key: 'decision', text: `▲ ${t.decision}`, short: `▲ ${t.decisionShort}`, prio: 1, hue: 'alert' });

// forge's automatic decisions of the last day, appended to any band that draws.
function autoPart(m: { auto?: { count: number; lastMajor: string | null } }): BandPart[] {
  return m.auto
    ? [{ key: 'auto', text: `⚑ auto · ${m.auto.count}${m.auto.lastMajor ? ` · ${clip(m.auto.lastMajor, 30)}` : ''}`, short: `⚑ ${m.auto.count}`, prio: 8 }]
    : [];
}

/** How long ago, as a notice says it: minutes (at least 1) under an hour, hours under two days, else days; null without a date. */
export function agoText(since: string | null, nowMs: number): string | null {
  const t = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t)) return null;
  const min = Math.max(1, Math.floor(Math.max(0, nowMs - t) / 60000));
  return min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`;
}

// A work band: the seat or its track with its progress, the task with its clock, the member's line of its execution,
// the plan's progress, the inbox and a pending decision.
function workParts(m: Extract<BandModel, { mode: 'work' }>, nowMs: number, t: Texts): BandPart[] {
  const parts: BandPart[] = [m.track
    ? { key: 'progress', text: `● ${t.track} ${m.track} ${m.trackDone}/${m.trackTotal}`, short: `● ${m.trackDone}/${m.trackTotal}`, prio: 5 }
    : { key: 'progress', text: `● ${m.sid}`, prio: 5 }];
  if (m.swarm) parts.push({ key: 'swarm', text: t.run.toLowerCase(), prio: 8 });
  if (m.current) {
    const id = clip(m.current.id, TASK_ID_MAX);
    const title = clip(m.current.title);
    parts.push({ key: 'task', text: `${id} ${title}`, short: id, title, prio: 4 });
    const started = m.current.startedAt ? Date.parse(m.current.startedAt) : NaN;
    if (Number.isFinite(started) && nowMs >= started) {
      const min = Math.floor((nowMs - started) / 60000);
      const est = m.current.estimateMin;
      // F-11: hours and minutes, amber once past the estimate.
      parts.push({ key: 'minutes', text: `${minutesText(min)}${est ? ` / ${minutesText(est)}` : ''}`, short: minutesText(min, true), prio: 6, ...(est && min > est ? { hue: 'warn' as const } : {}) });
    }
  } else {
    parts.push({ key: 'task', text: t.noTask, prio: 6 });
  }
  if (m.run) {
    const stage = stageText(t, m.run.stage);
    parts.push({ key: 'member', text: `${stage} · ${t.memberOf.replace('{c}', m.run.coordinator)}`, short: stage, prio: 6 });
  }
  if (!m.track) parts.push({ key: 'tasks', text: `${t.tasks} ${m.trackDone}/${m.trackTotal}`, short: `${m.trackDone}/${m.trackTotal}`, prio: 5 });
  parts.push({ key: 'percent', text: `${t.overall} ${m.percent} %`, short: `${m.percent}%`, prio: 7 });
  if (m.inbox > 0) parts.push({ key: 'inbox', text: `✎ ${m.inbox}`, prio: 3 });
  if (m.escalation) parts.push(decisionPart(t));
  return [...parts, ...autoPart(m)];
}

// A design band: its version, then the proposals of every round still undecided, not the latest critique's total.
function designParts(m: Extract<BandModel, { mode: 'design' }>, t: Texts): BandPart[] {
  const parts: BandPart[] = [{ key: 'head', text: `◆ ${t.design} · ${m.project} · v${m.version}`, short: `◆ v${m.version}`, prio: 9 }];
  if (m.round === 0) parts.push({ key: 'pending', text: t.noCritique, prio: 4 });
  else if (m.pending === 0) parts.push({ key: 'pending', text: t.nothingPending, prio: 4 });
  else {
    parts.push({ key: 'pending', text: `${m.pending} ${m.pending === 1 ? t.pendingOne : t.pending}`, prio: 4 });
    parts.push({ key: 'critical', text: `${m.pendingCritical} ${m.pendingCritical === 1 ? t.criticalOne : t.critical}`, prio: 3, ...(m.pendingCritical > 0 ? { hue: 'alert' as const } : {}) });
  }
  return [...parts, ...autoPart(m)];
}

// The coordinator's run band: its head with the mode and the slots running, every slot (E-04), one count of what is
// integrated (F-10), those waiting to integrate, the liveness warning, the inbox and a pending decision.
function runParts(m: Extract<BandModel, { mode: 'run' }>, t: Texts): BandPart[] {
  const parts: BandPart[] = m.stalled
    ? [{ key: 'head', text: `► ${t.run}`, prio: 9 }, { key: 'state', text: `▲ ${t.stoppedSfx}`, prio: 2, hue: 'alert' }]
    : [{ key: 'head', text: `► ${t.run} · ${m.executor === 'sessions' ? t.sessions : t.subagents} ${m.running}/${m.parallel}`, short: `► ${m.running}/${m.parallel}`, prio: 5 }];
  if (!m.stalled) {
    for (const s of m.slots) {
      const id = clip(s.task, SLOT_ID_MAX);
      const round = s.round > 1 ? s.round : 0;
      parts.push({
        key: `slot:${s.task}`, text: `${id} ${stageText(t, s.stage)}${round ? ` (r${round})` : ''}`,
        short: `${id} ${STAGE_SHORT[s.stage] ?? s.stage}${round ? ` r${round}` : ''}`, prio: 4,
      });
    }
    // Task 3 minor 1: the tasks running past the twelve slots the model carries are a «+N» of their own, which joins the
    // one fitParts makes of the slots it drops.
    const extra = Number.isInteger(m.running) ? m.running - m.slots.length : 0;
    if (extra > 0) parts.push({ key: 'slot:+', text: `+${extra}`, prio: 4, count: extra });
  }
  parts.push({ key: 'integrated', text: `${m.integrated}/${m.total} ${t.integratedN}`, short: `${m.integrated}/${m.total}`, prio: 5 });
  if ((m.queued ?? 0) > 0) parts.push({ key: 'queued', text: `${t.queuedN} ${m.queued}`, prio: 8 });
  if (!m.stalled && m.worst !== 'alive') {
    const silent = m.worst === 'silent';
    parts.push({ key: 'state', text: `▲ ${silent ? t.silentSfx : t.stoppedSfx}`, short: `▲ ${silent ? t.signalShort : t.stoppedSfx}`, prio: 2, hue: 'alert' });
  }
  if ((m.inbox ?? 0) > 0) parts.push({ key: 'inbox', text: `✎ ${m.inbox}`, prio: 3 });
  if (m.escalation) parts.push(decisionPart(t));
  return [...parts, ...autoPart(m)];
}

// Wave 2's notice, dim, as parts: what it is (2), the task glued to it (4), the integrated count of a run (5) and how
// long ago (7). ◦ another live session, ◌ what an earlier one left behind. The age is worked out as it is drawn.
function noticeParts(m: NoticeBand, nowMs: number, t: Texts): BandPart[] {
  const dim = 'dim' as const;
  const seat = m.seat ?? '';
  const ago = agoText(m.since, nowMs);
  const agoPart: BandPart[] = ago ? [{ key: 'ago', text: t.ago.replace('{ago}', ago), short: ago.replace(' ', ''), prio: 7, hue: dim }] : [];
  const count = `${m.integrated ?? 0}/${m.total ?? 0}`;
  if (m.kind === 'other-live') {
    if (m.subject === 'run') {
      return [
        { key: 'notice', text: `◦ ${t.noticeOtherRun}`, short: `◦ ${t.run.toLowerCase()}`, prio: 2, hue: dim },
        { key: 'count', text: count, prio: 5, hue: dim },
      ];
    }
    const lead: BandPart = { key: 'notice', text: `◦ ${(m.subject === 'design' ? t.noticeOtherDesign : m.task ? t.noticeOtherTask : t.noticeOtherBound).replace('{seat}', seat)}`, short: `◦ ${seat}`, prio: 2, hue: dim };
    return m.task ? [lead, { key: 'task', text: m.task, prio: 4, hue: dim, glue: ' ' }, ...agoPart] : [lead, ...agoPart];
  }
  if (m.subject === 'run') {
    const lead = m.coordinatorOpen ? { text: t.noticeRunOpen, short: t.openElsewhere }
      : m.stopReason ? { text: t.noticeRunStopped, short: t.stoppedSfx } : { text: t.noticeRunOrphan, short: t.noCoordinator };
    return [
      { key: 'notice', text: `◌ ${lead.text}`, short: `◌ ${lead.short}`, prio: 2, hue: dim },
      { key: 'count', text: `${count} ${t.integratedN}`, short: count, prio: 5, hue: dim, glue: ' ' },
      ...agoPart,
    ];
  }
  const lead: BandPart = { key: 'notice', text: `◌ ${m.subject === 'design' ? t.noticePrevDesign : t.noticePrevTask}`, short: `◌ ${t.left}`, prio: 2, hue: dim };
  if (m.subject === 'design') return [lead, { key: 'task', text: clip(m.project), prio: 4, hue: dim, glue: ' ' }, ...agoPart];
  const task = m.task ?? '';
  const title = m.title ? clip(m.title) : '';
  const taskPart: BandPart = title
    ? { key: 'task', text: `${task} ${title}`, short: task, title, prio: 4, hue: dim, glue: ' ' }
    : { key: 'task', text: task, prio: 4, hue: dim, glue: ' ' };
  return [lead, taskPart, ...agoPart];
}

/** F-04: the band's line as parts with a priority, in the order they are drawn; none for a band that draws nothing. */
export function bandParts(m: BandModel, nowMs: number): BandPart[] {
  if (m.mode === 'none') return [];
  const t = textsFor(m.locale);
  if (m.mode === 'notice') return noticeParts(m, nowMs, t);
  if (m.mode === 'design') return designParts(m, t);
  if (m.mode === 'run') return runParts(m, t);
  return workParts(m, nowMs, t);
}

/** The whole line, every part joined: for the tests and for a reader with room for all of it. */
export const bandLine = (m: BandModel, nowMs: number): string => joinParts(bandParts(m, nowMs));
