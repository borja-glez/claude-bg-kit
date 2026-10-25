import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { forgeDir } from './ledger.js';
import { parseSwarm, type SwarmState } from '../lib/swarm-state.js';
import type { WidthProfile } from './schedule.js';
import type { MofReason } from './auth.js';

export const swarmFile = (root: string) => path.join(root, '.forge', 'swarm.json');

export function readSwarm(root: string): SwarmState | null {
  const file = swarmFile(root);
  if (!existsSync(file)) return null;
  try { return parseSwarm(readFileSync(file, 'utf8')); } catch { return null; }
}

export function saveSwarm(root: string, s: SwarmState): void {
  forgeDir(root);
  const file = swarmFile(root);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}

// The lines the coordinator prints to the person as they are (`announce` of `swarm start`, `say` of `swarm integrate`).

/** The hint of a python project without swarm.setup (the tail of its setup result is the English one). */
export const VENV_HINT = {
  en: 'python project: set swarm.setup in .forge/config.yaml to create the venv in each worktree',
  es: 'proyecto Python: define swarm.setup en .forge/config.yaml para crear el venv en cada worktree',
};

/**
 * `cmd` as one inline code span: whitespace and newlines collapsed, fenced by a backtick run longer than any inside it.
 * A command can come from the merged tree (a task wrote it): it never breaks out of its span into the line's prose.
 */
export function codeSpan(cmd: string): string {
  const c = cmd.replace(/\s+/g, ' ').trim();
  const fence = '`'.repeat(Math.max(0, ...(c.match(/`+/g) ?? []).map(r => r.length)) + 1);
  const pad = c.startsWith('`') || c.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${c}${pad}${fence}`;
}

export interface StartFacts {
  es: boolean; kind: 'plan' | 'ephemeral'; resume: boolean; runId: string; mode: 'subagents' | 'sessions'; parallel: number;
  branch: string; base: string; mergeOnFinish: boolean; loose: number;
  setup: { cmd: string | null; ok: boolean; tail: string[] } | null;
  /** I-03: why --merge-on-finish was not taken (no recorded yes to the start question). */ mergeRefused?: MofReason | null;
  /** I-03: the note the person added to their yes, which made it no yes (`answered no`). */ mergeNote?: string | null;
  /** A10: swarm.nested of .forge/config.yaml: 'on' in a plan run of mode subagents, 'ignored' in any other run, null when off. */
  nested?: 'on' | 'ignored' | null;
}

/** I-03: why a run will not merge by itself at the end, in the person's language. */
const REFUSED: Record<MofReason, { es: string; en: string }> = {
  'record unreadable': { es: 'no pude leer un registro de autorización', en: 'an authorization record could not be read' },
  'no answer recorded': { es: 'no hay ninguna respuesta tuya registrada', en: 'no answer of yours is recorded' },
  'answered no': { es: 'respondiste que no', en: 'you answered no' },
  'expired': { es: 'la respuesta tiene más de 24 horas', en: 'the answer is more than 24 hours old' },
  'other run': { es: 'la respuesta era para otra ejecución', en: 'the answer was for another run' },
  'other project': { es: 'la respuesta era para otro proyecto', en: 'the answer was for another project' },
  'other branch': { es: 'la respuesta era para otra rama', en: 'the answer was for another branch' },
  'already used': { es: 'esa respuesta ya se usó', en: 'that answer was already used' },
};
/** A note of the person's as one line of at most NOTE_SHOWN characters. */
const NOTE_SHOWN = 200;
const oneLine = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > NOTE_SHOWN ? `${t.slice(0, NOTE_SHOWN - 1)}…` : t; };

/** How the execution was set up: the mode, the width, the branch, where to see the work and what happens at the end. */
export function startAnnounce(f: StartFacts): string[] {
  const mode = f.es ? (f.mode === 'sessions' ? 'sesiones' : 'subagentes') : f.mode;
  const lines: string[] = [];
  if (f.resume) {
    lines.push(f.es ? `Retomo la ejecución ${f.runId}: modo ${mode}, ${f.parallel} a la vez, rama ${f.branch}.`
      : `Resuming the execution ${f.runId}: ${mode} mode, ${f.parallel} at a time, branch ${f.branch}.`);
  } else if (f.kind === 'ephemeral') {
    const tasks = f.es ? (f.loose === 1 ? 'tarea suelta' : 'tareas sueltas') : (f.loose === 1 ? 'loose task' : 'loose tasks');
    lines.push(f.es ? `${f.loose} ${tasks}, ${f.parallel} a la vez; cada una entra en ${f.branch} en cuanto se acepta. /forge:stop la detiene.`
      : `${f.loose} ${tasks}, ${f.parallel} at a time; each goes into ${f.branch} as soon as it is accepted. /forge:stop stops it.`);
  } else if (f.es) {
    lines.push(
      `Ejecución en marcha: modo ${mode}, ${f.parallel} ${f.parallel === 1 ? 'tarea' : 'tareas'} a la vez, rama ${f.branch}.`,
      'Para ver la app con el trabajo, ábrela desde .claude/worktrees/run.',
      f.mergeOnFinish ? `Al acabar, si la revisión final pasa, integro ${f.branch} en ${f.base}.` : 'Al acabar no integro nada sin preguntarte.',
      '/forge:stop la detiene.',
    );
  } else {
    lines.push(
      `Execution running: ${mode} mode, ${f.parallel} ${f.parallel === 1 ? 'task' : 'tasks'} at a time, branch ${f.branch}.`,
      'To see the app with the work, open it from .claude/worktrees/run.',
      f.mergeOnFinish ? `When it ends, if the final review passes, I merge ${f.branch} into ${f.base}.` : 'When it ends I merge nothing without asking you.',
      '/forge:stop stops it.',
    );
  }
  if (f.nested === 'on') {
    lines.push(f.es ? 'Cada tarea la lleva un runner anidado (forge-runner, Opus a esfuerzo medio, swarm.nested); sus revisores siguen siendo agentes independientes.'
      : 'Each task is driven by a nested runner (forge-runner, Opus at medium effort, swarm.nested); its reviewers stay independent agents.');
  } else if (f.nested === 'ignored') {
    lines.push(f.es ? 'swarm.nested solo vale en la ejecución de un plan en modo subagentes: esta ejecución no lo usa.'
      : 'swarm.nested applies only to a plan run in subagents mode: this run does not use it.');
  }
  if (f.mergeRefused) {
    const note = f.mergeRefused === 'answered no' && f.mergeNote ? oneLine(f.mergeNote) : '';
    const why = note ? (f.es ? `respondiste con una nota: «${note}»` : `you answered with a note: "${note}"`) : REFUSED[f.mergeRefused][f.es ? 'es' : 'en'];
    lines.push(f.es ? `No integro solo al acabar (pregunta del arranque: ${why}).` : `I will not merge by myself at the end (start question: ${why}).`);
  }
  if (f.setup && !f.setup.ok) {
    const tail = f.setup.tail[f.setup.tail.length - 1];
    const last = tail === undefined ? (f.es ? 'sin salida' : 'no output') : f.es && tail === VENV_HINT.en ? VENV_HINT.es : tail;
    lines.push(f.setup.cmd === null
      ? (f.es ? `No hay ningún comando de preparación configurado (swarm.setup en .forge/config.yaml): ${last}` : `No setup command is configured (swarm.setup in .forge/config.yaml): ${last}`)
      : (f.es ? `La preparación del worktree con ${codeSpan(f.setup.cmd)} falló: ${last}` : `The worktree setup ${codeSpan(f.setup.cmd)} failed: ${last}`));
  }
  return lines;
}

/** The person's dependencies were installed for a merge that was rolled back and could not be put back as they were. */
export function rejectedDepsSay(es: boolean, ref: string): string {
  return es ? `Las dependencias de tu copia de trabajo se instalaron para la integración rechazada de ${ref} y puede que no coincidan con tus archivos: reinstálalas antes de usarla.`
    : `The dependencies in your checkout were installed for the rejected merge of ${ref} and may not match your files: reinstall them before you use it.`;
}

const KEPT_SHOWN = 10;

/** Tracked files of the person's that changed during a rejected merge's install and were left as they are (touchedKept). */
export function keptFilesSay(es: boolean, ref: string, files: string[]): string {
  const more = files.length - KEPT_SHOWN;
  const list = files.slice(0, KEPT_SHOWN).map(codeSpan).join(', ') + (more > 0 ? (es ? ` y ${more} más` : ` and ${more} more`) : '');
  return es ? `Estos archivos de tu copia de trabajo cambiaron durante la instalación de dependencias de la integración rechazada de ${ref} y se han dejado como están; revísalos: ${list}.`
    : `These files of your checkout changed during the dependency install for the rejected merge of ${ref} and were left as they are; check them: ${list}.`;
}

/** What an integration brought the person should hear of: each validator that appeared, and those that already failed. */
export function integratedSay(es: boolean, branch: string, newValidators: { name: string; cmd: string }[], preexisting: string[]): string[] {
  const lines = newValidators.map(v => (es ? `Nuevo validador ${v.name}: ${codeSpan(v.cmd)}` : `New validator ${v.name}: ${codeSpan(v.cmd)}`));
  if (preexisting.length) {
    lines.push(es ? `Validadores que ya fallaban en ${branch} y no cuentan: ${preexisting.join(', ')}.`
      : `Validators that already failed on ${branch} and do not count: ${preexisting.join(', ')}.`);
  }
  return lines;
}

/** D-19: the line `swarm propose` prints: tasks and waves, the longest chain, and the zones that serialize the plan. */
export function proposeSay(es: boolean, tasks: number, p: Pick<WidthProfile, 'profile' | 'chain' | 'serializing'>): string {
  const waves = p.profile.join('·');
  const chain = `${p.chain.tasks.join('→')} (${p.chain.length})`;
  const zones = p.serializing.map(z => `${z.zone} (${z.tasks.length} ${es ? 'tareas' : 'tasks'})`).join(', ');
  const w = p.profile.length;
  if (es) {
    const count = `${tasks} ${tasks === 1 ? 'tarea' : 'tareas'}`;
    if (!tasks) return `${count}.`;
    return `${count} en ${w} ${w === 1 ? 'tanda' : 'tandas'}: ${waves}. Cadena más larga: ${chain}.${zones ? ` Zonas que serializan: ${zones}.` : ''}`;
  }
  const count = `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`;
  if (!tasks) return `${count}.`;
  return `${count} in ${w} ${w === 1 ? 'wave' : 'waves'}: ${waves}. Longest chain: ${chain}.${zones ? ` Zones that serialize: ${zones}.` : ''}`;
}
