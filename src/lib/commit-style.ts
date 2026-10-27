// w9: the commit titles forge and waypoint write, in the repository's style. `.forge/config.yaml` `commits.style` says
// it (`auto`, `conventional` or `plain`); with `auto` the repository's own history does: Conventional Commits when most of
// its recent commits use a standard type, else `plain`, forge's and waypoint's own titles. A history too short to say
// (a new repository) takes the person's default, FORGE_COMMIT_STYLE. Of these titles only the integrate one is read back
// (integratedTaskOf, in both styles: a run's flow passes and the step's lost integration find tasks by it).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { GitRun } from './git-info.js';

export const COMMIT_STYLE_SETTINGS = ['auto', 'conventional', 'plain'] as const;
export type CommitStyleSetting = (typeof COMMIT_STYLE_SETTINGS)[number];
export type CommitStyle = 'conventional' | 'plain';
export interface CommitStyleOf { style: CommitStyle; source: 'config' | 'history' | 'env' | 'default' }
type Env = Readonly<Record<string, string | undefined>>;
/** The person's style for a repository whose history does not say one yet, in the `env` of ~/.claude/settings.json. */
export const COMMIT_STYLE_ENV = 'FORGE_COMMIT_STYLE';

/** The commits of HEAD `auto` reads, merges left out. */
export const HISTORY_SPAN = 20;
/** Fewer subjects than this say nothing; from this many, Conventional Commits when this share of them use a type. */
const MIN_SUBJECTS = 3;
const SHARE = 0.6;
/** The standard types (commitlint's config-conventional): a project's own prefix (`w8: …`, `api: …`) is no type. */
const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
const CONVENTIONAL = new RegExp(`^(?:${TYPES.join('|')})(?:\\([^()\\s][^()\\r\\n]{0,63}\\))?!?: \\S`);
/** The types a brief offers its implementer. */
const BRIEF_TYPES = 'feat, fix, refactor, perf, test, docs, build, ci or chore';

/**
 * Conventional Commits when at least SHARE of the subjects start with a standard type; null below MIN_SUBJECTS of them,
 * where the history says nothing yet (else forge's own first titles would decide every later one).
 */
export function styleOfSubjects(subjects: readonly string[]): CommitStyle | null {
  if (subjects.length < MIN_SUBJECTS) return null;
  return subjects.filter(s => CONVENTIONAL.test(s)).length >= SHARE * subjects.length ? 'conventional' : 'plain';
}

/** `commits.style` of `<root>/.forge/config.yaml`, read leniently: a file, key or value that does not say one is null. */
export function commitStyleSetting(root: string): CommitStyleSetting | null {
  let raw: unknown;
  try { raw = parse(readFileSync(path.join(root, '.forge', 'config.yaml'), 'utf8')); } catch { return null; }
  const commits = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).commits : null;
  const style = commits && typeof commits === 'object' && !Array.isArray(commits) ? (commits as Record<string, unknown>).style : null;
  return (COMMIT_STYLE_SETTINGS as readonly unknown[]).includes(style) ? style as CommitStyleSetting : null;
}

/**
 * The setting when it names a style; else (`auto`, none) the history of HEAD that `git` reads; else, while that history
 * is too short to say, FORGE_COMMIT_STYLE of `env` (`conventional` or `plain`, anything else ignored); else `plain`.
 */
export function resolveCommitStyle(setting: CommitStyleSetting | null | undefined, git: GitRun, env: Env = process.env): CommitStyleOf {
  if (setting === 'conventional' || setting === 'plain') return { style: setting, source: 'config' };
  const log = git(['log', '-n', String(HISTORY_SPAN), '--no-merges', '--format=%s', 'HEAD']) ?? '';
  const style = styleOfSubjects(log.split(/\r?\n/).filter(Boolean));
  if (style) return { style, source: 'history' };
  const own = env[COMMIT_STYLE_ENV];
  return own === 'conventional' || own === 'plain' ? { style: own, source: 'env' } : { style: 'plain', source: 'default' };
}

/** The style of the repository at `root`: its `.forge/config.yaml`, then the history `git` reads there, then `env`. */
export const commitStyleAt = (root: string, git: GitRun, env: Env = process.env): CommitStyleOf => resolveCommitStyle(commitStyleSetting(root), git, env);

/** A title's first letter in lower case when it starts a word in lower case (`Login form`), never an acronym's (`API`). */
const lowerFirst = (s: string): string => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * The brief's `Commit title:` line: how its implementer titles its commits. `task`: a plan task's id, its prefix (or its
 * scope); null for a brief written by hand (Small, Medium, an ephemeral run's task), whose ids are forge's own.
 */
export function briefCommitLine(style: CommitStyle, task: string | null): string {
  if (style === 'conventional') {
    return `Commit title: <type>${task ? `(${task})` : ''}: <what the commit does>, in Conventional Commits as this repository writes them (<type>: ${BRIEF_TYPES})`;
  }
  return task ? `Commit title: ${task}: <what the commit does>` : "Commit title: <what the commit does>, in the style of this repository's recent commits (git log --oneline -10)";
}

/** The commits forge makes itself. */
export type ForgeCommit =
  | { kind: 'integrate'; task: string }
  | { kind: 'merge'; branch: string }
  | { kind: 'bring'; base: string; branch: string }
  | { kind: 'notes'; task: string }
  | { kind: 'undo'; task: string; tree: string };

export function forgeCommitTitle(style: CommitStyle, c: ForgeCommit): string {
  const conv = style === 'conventional';
  switch (c.kind) {
    case 'integrate': return `${conv ? 'chore(forge)' : 'forge'}: integrate ${c.task}`;
    case 'merge': return `${conv ? 'chore(forge)' : 'forge'}: merge ${c.branch}`;
    case 'bring': return `${conv ? 'chore(forge)' : 'forge'}: bring ${c.base} into ${c.branch}`;
    case 'notes': return `${conv ? `chore(${c.task})` : c.task}: learned notes of its verification`;
    case 'undo': return `${conv ? `revert(${c.task})` : c.task}: undo the attempt for a redo (back to the tree of ${c.tree})`;
  }
}

/** The task a merge's subject integrates, in either style (`forge: integrate T1`, `chore(forge): integrate T1`), else null. */
export const integratedTaskOf = (subject: string): string | null =>
  /^(?:forge|chore\(forge\)): integrate (.+)$/.exec(subject.trim())?.[1] ?? null;

/** A waypoint task's commit (`/waypoint:work`): the type is the session's to choose, so it stays `<type>`. */
export const taskCommitTitle = (style: CommitStyle, task: string, title: string): string =>
  (style === 'conventional' ? `<type>(${task}): ${lowerFirst(title)}` : `${task}: ${title}`);
