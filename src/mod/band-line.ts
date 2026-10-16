import type { BandModel, NoticeBand } from './model.js';

const TITLE_MAX = 40;
// A slot's task id in the run line: loose task ids (`<slug>-<tag>`) run up to 45 characters.
const SLOT_ID_MAX = 20;

export function clip(text: string, max = TITLE_MAX): string {
  const chars = Array.from(String(text).replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

export const TEXT = {
  es: {
    design: 'DISEÑO', proposals: 'propuestas', proposal: 'propuesta', critical: 'críticas', criticalOne: 'crítica', noCritique: 'sin crítica aún',
    pending: 'pendientes', pendingOne: 'pendiente', nothingPending: 'sin pendientes',
    noTask: 'sin tarea en curso', track: 'frente', tasks: 'tareas', overall: 'global', decision: 'decisión pendiente',
    applyAll: 'Aplicar todas', pick: 'Elegir…', round: 'Otra ronda', rewrite: 'Reescribir', interview: 'Preguntarme',
    approve: 'Aprobar', viewDesign: 'Ver diseño', nextTask: 'Siguiente tarea', status: 'Estado',
    launch: 'Lanzar sesión en un frente…', roadmap: 'Abrir roadmap',
    pressEnter: 'Comando listo en el prompt: pulsa Enter',
    panel: 'Panel',
    run: 'EJECUCIÓN', subagents: 'subagentes', sessions: 'sesiones', silentSfx: 'sin señal', stoppedSfx: 'parada', stopRun: 'Parar',
    integratedN: 'integradas', memberOf: 'de la ejecución de {c}',
    otherTrack: 'Otro frente', view: 'Ver', join: 'Unirme', resume: 'Retomar', release: 'Liberar', close: 'Cerrar',
    stopFilled: '/forge:stop está en el prompt: pulsa Enter para parar toda la ejecución',
    ago: 'hace {ago}',
    noticeOtherTask: 'otra sesión ({seat}) trabaja en {task}', noticeOtherBound: 'otra sesión ({seat}) está ligada al roadmap',
    noticeOtherRun: 'ejecución de forge en curso, la coordina otra sesión · {i}/{t}',
    noticePrevTask: 'quedó a medias: {task} {title}', noticePrevDesign: 'diseño a medias: {project}',
    noticeRunStopped: 'ejecución parada: {i}/{t} integradas', noticeRunOrphan: 'ejecución sin coordinadora: {i}/{t} integradas',
    stage: { brief: 'brief', implement: 'implementar', validate: 'validar', verify: 'verificar', review: 'revisar', verdict: 'veredicto', integrate: 'integrar', execution: 'ejecución' },
  },
  en: {
    design: 'DESIGN', proposals: 'proposals', proposal: 'proposal', critical: 'critical', criticalOne: 'critical', noCritique: 'no critique yet',
    pending: 'pending', pendingOne: 'pending', nothingPending: 'nothing pending',
    noTask: 'no task in progress', track: 'track', tasks: 'tasks', overall: 'overall', decision: 'decision pending',
    applyAll: 'Apply all', pick: 'Pick…', round: 'Another round', rewrite: 'Rewrite', interview: 'Interview me',
    approve: 'Approve', viewDesign: 'View design', nextTask: 'Next task', status: 'Status',
    launch: 'Launch session on track…', roadmap: 'Open roadmap',
    pressEnter: 'Command ready in the prompt: press Enter',
    panel: 'Panel',
    run: 'EXECUTION', subagents: 'subagents', sessions: 'sessions', silentSfx: 'no signal', stoppedSfx: 'stopped', stopRun: 'Stop',
    integratedN: 'integrated', memberOf: "in {c}'s execution",
    otherTrack: 'Other track', view: 'View', join: 'Join', resume: 'Resume', release: 'Release', close: 'Close',
    stopFilled: '/forge:stop is in the prompt: press Enter to stop the whole execution',
    ago: '{ago} ago',
    noticeOtherTask: 'another session ({seat}) works on {task}', noticeOtherBound: 'another session ({seat}) is bound to the roadmap',
    noticeOtherRun: 'forge execution running, coordinated by another session · {i}/{t}',
    noticePrevTask: 'left in progress: {task} {title}', noticePrevDesign: 'design left in progress: {project}',
    noticeRunStopped: 'execution stopped: {i}/{t} integrated', noticeRunOrphan: 'execution without a coordinator: {i}/{t} integrated',
    stage: { brief: 'brief', implement: 'implement', validate: 'validate', verify: 'verify', review: 'review', verdict: 'verdict', integrate: 'integrate', execution: 'execution' },
  },
} as const;
export type Texts = (typeof TEXT)[keyof typeof TEXT];

export const textsFor = (locale: string | undefined): Texts => (locale === 'es' ? TEXT.es : TEXT.en);

// forge's automatic decisions of the last day, appended to any band.
function autoPart(m: { auto?: { count: number; lastMajor: string | null } }): string[] {
  return m.auto ? [`⚑ auto · ${m.auto.count}${m.auto.lastMajor ? ` · ${clip(m.auto.lastMajor, 30)}` : ''}`] : [];
}

/** How long ago, as a notice says it: minutes (at least 1) under an hour, hours under two days, else days; null without a date. */
export function agoText(since: string | null, nowMs: number): string | null {
  const t = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t)) return null;
  const min = Math.max(1, Math.floor(Math.max(0, nowMs - t) / 60000));
  return min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`;
}

// §4.5: a notice, dim and without a clock of its own: ◦ for another live session, ◌ for what an earlier one left behind.
function noticeLine(m: NoticeBand, nowMs: number, t: Texts): string {
  const vals: Record<string, string> = {
    seat: m.seat ?? '', task: m.task ?? '', title: m.title ? clip(m.title) : '', project: m.project,
    i: String(m.integrated ?? 0), t: String(m.total ?? 0),
  };
  const fill = (s: string) => s.replace(/\{(seat|task|title|project|i|t)\}/g, (_, k: string) => vals[k]).replace(/\s+/g, ' ').trim();
  const ago = agoText(m.since, nowMs);
  if (m.kind === 'other-live') {
    if (m.subject === 'run') return `◦ ${fill(t.noticeOtherRun)}`;
    const head = `◦ ${fill(m.task ? t.noticeOtherTask : t.noticeOtherBound)}`;
    return ago ? `${head} · ${t.ago.replace('{ago}', ago)}` : head;
  }
  const text = m.subject === 'run' ? (m.stopReason ? t.noticeRunStopped : t.noticeRunOrphan) : m.subject === 'design' ? t.noticePrevDesign : t.noticePrevTask;
  const head = `◌ ${fill(text)}`;
  return ago ? `${head} (${t.ago.replace('{ago}', ago)})` : head;
}

export function bandLine(m: BandModel, nowMs: number): string {
  if (m.mode === 'none') return '';
  const t = textsFor(m.locale);
  if (m.mode === 'notice') return noticeLine(m, nowMs, t);
  if (m.mode === 'design') {
    const head = `◆ ${t.design} · ${m.project} · v${m.version}`;
    if (m.round === 0) return [`${head} · ${t.noCritique}`, ...autoPart(m)].join(' · ');
    // The proposals of every round still undecided, not the latest critique's total.
    if (m.pending === 0) return [`${head} · ${t.nothingPending}`, ...autoPart(m)].join(' · ');
    return [`${head} · ${m.pending} ${m.pending === 1 ? t.pendingOne : t.pending} · ${m.pendingCritical} ${m.pendingCritical === 1 ? t.criticalOne : t.critical}`, ...autoPart(m)].join(' · ');
  }
  if (m.mode === 'run') {
    if (m.stalled) return [`▶ ${t.run} ${t.stoppedSfx}`, ...autoPart(m)].join(' · ');
    const parts = [`▶ ${t.run}`, `${m.executor === 'sessions' ? t.sessions : t.subagents} ${m.running}/${m.parallel}`,
      ...m.slots.map(s => `${clip(s.task, SLOT_ID_MAX)} ${t.stage[s.stage as keyof typeof t.stage] ?? s.stage}${s.round > 1 ? ` (r${s.round})` : ''}`),
      `${m.integrated}/${m.total}`, `${t.integratedN} ${m.integrated}`];
    if (m.worst !== 'alive') parts.push(`⚠ ${m.worst === 'silent' ? t.silentSfx : t.stoppedSfx}`);
    parts.push(...autoPart(m));
    return parts.join(' · ');
  }
  // A session on a track names it with its progress; one without a track counts the plan's tasks.
  const parts = [m.track ? `● ${t.track} ${m.track} ${m.trackDone}/${m.trackTotal}` : `● ${m.sid}`];
  if (m.swarm) parts.push(t.run.toLowerCase());
  if (m.current) {
    parts.push(`${m.current.id} ${clip(m.current.title)}`);
    const started = m.current.startedAt ? Date.parse(m.current.startedAt) : NaN;
    if (Number.isFinite(started) && nowMs >= started) {
      const min = Math.floor((nowMs - started) / 60000);
      parts.push(`${min} min${m.current.estimateMin ? `/${m.current.estimateMin}` : ''}`);
    }
  } else {
    parts.push(t.noTask);
  }
  if (m.run) parts.push(`${t.stage[m.run.stage as keyof typeof t.stage] ?? m.run.stage} · ${t.memberOf.replace('{c}', m.run.coordinator)}`);
  if (!m.track) parts.push(`${t.tasks} ${m.trackDone}/${m.trackTotal}`);
  parts.push(`${t.overall} ${m.percent} %`);
  if (m.inbox > 0) parts.push(`✉ ${m.inbox}`);
  if (m.escalation) parts.push(`⚠ ${t.decision}`);
  parts.push(...autoPart(m));
  return parts.join(' · ');
}
