// The handoff: once a design is approved (or a plan is ready and nothing of it has started), one question says how the
// work goes on, with the ways this project has (forge and superpowers when they are there, waypoint's own always) and
// the one waypoint recommends, with its reason. The CLI prints it and the plan skill asks it as printed, so the person
// sees the same question every time. Pure: `waypoint handoff` reads the files and the plugins.

export type HandoffStage = 'design' | 'plan';
export const HANDOFF_IDS = ['forge', 'work', 'superpowers', 'launch', 'later'] as const;
export type HandoffId = (typeof HANDOFF_IDS)[number];

/** forge's first version with `/forge:run --handoff`: an older forge is not offered. */
export const FORGE_HANDOFF_MIN = '0.35.0';

/** A plugin as the handoff sees it: `on` when this session can use it; `from` says how it was seen; `tooOld` is a forge
 *  installed below FORGE_HANDOFF_MIN, never offered. */
export interface Detected { on: boolean; version: string | null; from: 'session' | 'installed' | 'both' | null; tooOld?: boolean }

export interface HandoffInput {
  stage: HandoffStage;
  project: string;
  es: boolean;
  forge: Detected;
  superpowers: Detected;
  /** The plan's tasks and tracks (stage `plan`); null before the plan exists. */
  tasks: number | null;
  tracks: number | null;
  /** Stage `plan`: a task of the plan is claimed, in progress, blocked or done. */
  started: boolean;
  /** A forge execution of this project's plan is active. */
  running: boolean;
}

/** `command`: what the option runs, for a session that cannot ask (null: nothing runs). */
export interface HandoffOption { id: HandoffId; label: string; description: string; command: string | null; recommended: boolean }
export interface HandoffAsk { question: string; header: string; multiSelect: false; options: { label: string; description: string }[] }
export interface Handoff {
  stage: HandoffStage;
  project: string;
  detected: { forge: Detected; superpowers: Detected };
  recommended: HandoffId | null;
  options: HandoffOption[];
  /** The AskUserQuestion input, as it is; null when there is nothing to ask (`say` tells why). */
  ask: HandoffAsk | null;
  /** The lines to print before the question (what was detected and why the recommendation), or instead of it. */
  say: string[];
}

/** AskUserQuestion takes at most four options (the person can always write another). */
const MAX_OPTIONS = 4;

const named = (name: string, d: Detected) => (d.version && d.version !== 'unknown' ? `${name} ${d.version}` : name);

function detectedLine(i: HandoffInput): string {
  const on = [i.forge.on ? named('forge', i.forge) : null, i.superpowers.on ? named('superpowers', i.superpowers) : null].filter((x): x is string => !!x);
  const off = [i.forge.on ? null : 'forge', i.superpowers.on ? null : 'superpowers'].filter((x): x is string => !!x);
  if (i.es) {
    if (!on.length) return 'Ni forge ni superpowers están disponibles en esta sesión.';
    return `Disponible${on.length > 1 ? 's' : ''}: ${on.join(' y ')}.${off.length ? ` ${off[0]} no está disponible.` : ''}`;
  }
  if (!on.length) return 'Neither forge nor superpowers is available in this session.';
  return `Available: ${on.join(' and ')}.${off.length ? ` ${off[0]} is not available.` : ''}`;
}

function option(id: HandoffId, i: HandoffInput, recommended: boolean): HandoffOption {
  const d = i.stage === 'design';
  const p = i.project;
  const texts: Record<HandoffId, { label: string; command: string | null; description: string }> = {
    forge: i.es
      ? { label: 'Ejecutar con forge', command: `/forge:run --handoff ${p}`,
        description: `${d ? 'forge escribe el plan, te' : 'forge te'} pregunta el modo y cuántas tareas a la vez, y valida y revisa cada tarea con revisores independientes.` }
      : { label: 'Run it with forge', command: `/forge:run --handoff ${p}`,
        description: `${d ? 'forge writes the plan, asks' : 'forge asks'} you the mode and how many tasks at once, and validates and reviews each task with independent reviewers.` },
    work: i.es
      ? { label: 'Trabajar aquí, tarea a tarea', command: '/waypoint:work',
        description: `${d ? 'waypoint escribe el plan y esta' : 'Esta'} sesión hace sus tareas una a una (/waypoint:work).` }
      : { label: 'Work here, task by task', command: '/waypoint:work',
        description: `${d ? 'waypoint writes the plan and this' : 'This'} session works its tasks one by one (/waypoint:work).` },
    superpowers: i.es
      ? { label: 'Con superpowers', command: '/superpowers:writing-plans',
        description: `superpowers escribe el plan de implementación (writing-plans) y ${i.forge.on ? 'forge lo ejecuta' : 'lo ejecuta con subagentes'}. Sus tareas no salen en el roadmap de waypoint.` }
      : { label: 'With superpowers', command: '/superpowers:writing-plans',
        description: `superpowers writes the implementation plan (writing-plans) and ${i.forge.on ? 'forge runs it' : 'runs it with subagents'}. Its tasks do not show on waypoint's roadmap.` },
    launch: i.es
      ? { label: 'Sesión en segundo plano', command: '/waypoint:launch',
        description: `${d ? 'waypoint escribe el plan y lanza' : 'Lanza'} una sesión en segundo plano en el frente que elijas, en su propio worktree (/waypoint:launch); repítelo para otro frente.` }
      : { label: 'Background session', command: '/waypoint:launch',
        description: `${d ? 'waypoint writes the plan and starts' : 'Starts'} a background session on the track you choose, in its own worktree (/waypoint:launch); repeat it for another track.` },
    // Before the plan exists, `later` still writes it (forge's planner when forge is there, so a later forge run keeps
    // its plan) and starts nothing; once it exists, nothing runs.
    later: i.es
      ? { label: 'Dejarlo planificado', command: d ? (i.forge.on ? `/forge:run --handoff ${p} --plan-only` : `/waypoint:plan ${p}`) : null,
        description: `${d ? `${i.forge.on ? 'forge' : 'waypoint'} escribe el plan y el roadmap` : 'El plan y el roadmap quedan listos'} y no empieza nada. /waypoint:plan ${p} vuelve a esta pregunta.` }
      : { label: 'Plan it, start later', command: d ? (i.forge.on ? `/forge:run --handoff ${p} --plan-only` : `/waypoint:plan ${p}`) : null,
        description: `${d ? `${i.forge.on ? 'forge' : 'waypoint'} writes the plan and the roadmap` : 'The plan and the roadmap stay ready'} and nothing starts. /waypoint:plan ${p} brings this question back.` },
  };
  return { id, ...texts[id], recommended };
}

/** The question of the handoff, or why there is none. */
export function handoff(i: HandoffInput): Handoff {
  const base = { stage: i.stage, project: i.project, detected: { forge: i.forge, superpowers: i.superpowers } };
  const tooOld = i.forge.tooOld
    ? [i.es ? `forge ${i.forge.version} todavía no ofrece este paso (necesita ${FORGE_HANDOFF_MIN}): actualízalo para ejecutar desde aquí con forge.`
      : `forge ${i.forge.version} does not offer this step yet (it needs ${FORGE_HANDOFF_MIN}): update it to run with forge from here.`]
    : [];
  if (i.running) {
    return { ...base, recommended: null, options: [], ask: null,
      say: [i.es ? `Hay una ejecución de forge activa del plan de ${i.project}: las tareas nuevas las coge ella. Si su sesión ya no está, retómala con /forge:run --resume o párala con /forge:stop.`
        : `A forge execution of ${i.project}'s plan is active: it takes the new tasks. If its session is gone, resume it with /forge:run --resume or stop it with /forge:stop.`] };
  }
  if (i.stage === 'plan' && i.started) {
    const forge = i.forge.on ? (i.es ? ` o /forge:run --handoff ${i.project} para ejecutarlo con forge` : ` or /forge:run --handoff ${i.project} to run it with forge`) : '';
    return { ...base, recommended: null, options: [], ask: null,
      say: [...tooOld, i.es ? `El plan ya está en marcha: para seguir, /waypoint:work${forge}.` : `The plan is under way: to go on, /waypoint:work${forge}.`] };
  }
  const recommended: HandoffId = i.forge.on ? 'forge' : 'work';
  const ids = HANDOFF_IDS.filter(id => (id === 'forge' ? i.forge.on
    : id === 'superpowers' ? i.superpowers.on && i.stage === 'design'
    : id === 'launch' ? i.stage === 'design' || (i.tracks ?? 0) >= 2
    : true));
  // `later` always stays; past four, the background session goes first (forge's own swarm of sessions covers it).
  const kept = ids.length > MAX_OPTIONS ? ids.filter(id => id !== 'launch') : ids;
  const options = [recommended, ...kept.filter(id => id !== recommended)].map(id => option(id, i, id === recommended));
  const mark = i.es ? ' (Recomendado)' : ' (Recommended)';
  const ask: HandoffAsk = {
    question: i.stage === 'design' ? (i.es ? 'Diseño aprobado. ¿Cómo seguimos?' : 'Design approved. How do we go on?')
      : (i.es ? 'El plan está listo. ¿Cómo seguimos?' : 'The plan is ready. How do we go on?'),
    header: i.es ? 'Siguiente' : 'Next step',
    multiSelect: false,
    options: options.map(o => ({ label: o.recommended ? `${o.label}${mark}` : o.label, description: o.description })),
  };
  const size = i.tasks !== null
    ? [i.es ? `El plan tiene ${i.tasks} tarea${i.tasks === 1 ? '' : 's'} en ${i.tracks} frente${i.tracks === 1 ? '' : 's'}.`
      : `The plan has ${i.tasks} task${i.tasks === 1 ? '' : 's'} in ${i.tracks} track${i.tracks === 1 ? '' : 's'}.`]
    : [];
  const why = recommended === 'forge'
    ? (i.es ? 'Te recomiendo forge: valida y revisa cada tarea con revisores independientes y puede ejecutar varias a la vez.'
      : 'I recommend forge: it validates and reviews each task with independent reviewers and can run several at once.')
    : (i.es ? 'Te recomiendo trabajar aquí tarea a tarea: sin forge, es la forma más directa.'
      : 'I recommend working here task by task: without forge, it is the most direct way.');
  return { ...base, recommended, options, ask, say: [detectedLine(i), ...tooOld, ...size, why] };
}
