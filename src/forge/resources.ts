// The register of what an autonomous run created outside its worktree (databases, containers, SQLite files): the run
// notes each one when it creates it, with FORGE resource add, and only what the run itself can have made is accepted.
// Whatever is registered is the run's own; the guard and the cleanup read this file and never touch anything else.
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AutonomousRun } from '../lib/forge-run.js';
import { confinedIn } from './guard.js';

export const RESOURCE_KINDS = ['postgres', 'mysql', 'mongo', 'redis', 'sqlite', 'container', 'volume', 'compose'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export interface Resource { kind: ResourceKind; name: string; host: string | null; at: string }

/** L3: the only list of local hosts of the plan: one of these, 127.x.y.z or a *.localhost, without case. */
export const LOCAL_HOSTS: readonly string[] = ['localhost', '::1', '[::1]', '0.0.0.0'];
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (LOCAL_HOSTS.includes(h)) return true;
  if (!/^[a-z0-9.-]+$/.test(h)) return false;
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return octets ? octets.slice(1).every(o => Number(o) <= 255) : h.endsWith('.localhost');
}

const MAX_RESOURCES = 200;
// The ports of the person's own redis, never the run's.
const PERSONAL_REDIS_PORTS = [6379, 6380, 6381];

/** The start of every database name of the run: the double `_` ends the run id, so a run whose id starts with this one's never matches (M3). */
export const dbPrefix = (runId: string): string => `fg_${runId.replace(/[^a-z0-9]/g, '_')}__`;
/** The start of every container, volume and compose project name of the run (the double `-` ends the run id, M3). */
export const dockerPrefix = (runId: string): string => `fg-${runId}--`;
export const autonomousDir = (main: string, runId: string): string => path.join(main, '.forge', 'autonomous', runId);
export const resourcesFile = (main: string, runId: string): string => path.join(autonomousDir(main, runId), 'resources.json');
/** The temporary folder of the run: the one place outside its worktree where it may create files. */
export const runTmp = (runId: string): string => path.join(os.tmpdir(), `forge-${runId}`);

export class ResourceError extends Error {}

const isKind = (x: unknown): x is ResourceKind => RESOURCE_KINDS.includes(x as ResourceKind);

const isResource = (r: unknown): r is Resource => !!r && typeof r === 'object' && isKind((r as Resource).kind) && typeof (r as Resource).name === 'string'
  && typeof (r as Resource).at === 'string' && ((r as Resource).host === null || typeof (r as Resource).host === 'string');

/** The register as written: [] when there is no file, null when the file exists and is not an array of resources. */
function loadResources(main: string, runId: string): Resource[] | null {
  const file = resourcesFile(main, runId);
  if (!exists(file)) return [];
  try {
    const x: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(x) && x.every(isResource) ? x : null;
  } catch { return null; }
}

/** The registered resources of the run, for reading: an unreadable register lists as empty (addResource refuses to write over it). */
export const readResources = (main: string, runId: string): Resource[] => loadResources(main, runId) ?? [];

function writeResources(main: string, runId: string, list: Resource[]): void {
  mkdirSync(autonomousDir(main, runId), { recursive: true });
  const file = resourcesFile(main, runId);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}

/** Whether anything is at p, a dangling link included. */
const exists = (p: string): boolean => { try { lstatSync(p); return true; } catch { return false; } };

/** Registers a resource the run created, or throws a ResourceError when the run cannot have made it. A sqlite name is an absolute path. */
export function addResource(main: string, run: AutonomousRun, input: { kind: string; name: string; host?: string }, at: string, tmp: string): Resource {
  const { kind } = input;
  let name = input.name;
  if (!isKind(kind)) throw new ResourceError(`resource: --kind must be one of ${RESOURCE_KINDS.join(', ')}`);
  if (!name) throw new ResourceError('resource: --name is required');
  const host = input.host ?? null;
  // Every kind: a host that is given must be local, even where none is kept.
  if (host !== null && !isLocalHost(host)) throw new ResourceError(`resource: ${kind} on ${host} is not a local host; the run registers only what it created on this machine`);
  if (kind === 'postgres' || kind === 'mysql' || kind === 'mongo') {
    const prefix = dbPrefix(run.runId);
    if (!name.startsWith(prefix) || !/^[a-z0-9_]+$/.test(name)) throw new ResourceError(`resource: a ${kind} database of this run is named ${prefix}<name> (lowercase letters, digits and _)`);
  } else if (kind === 'redis') {
    const port = /^\d+$/.test(name) ? Number(name) : NaN;
    if (!(port >= 1024 && port <= 65535) || PERSONAL_REDIS_PORTS.includes(port)) {
      throw new ResourceError(`resource: a redis of this run listens on a port from 1024 to 65535 that is not ${PERSONAL_REDIS_PORTS.join(', ')} (the ones of the person's own redis)`);
    }
    name = String(port); // canonical: 08080 and 8080 are one entry
  } else if (kind !== 'sqlite') {
    const prefix = dockerPrefix(run.runId);
    if (!name.startsWith(prefix) || !/^[a-zA-Z0-9_.-]+$/.test(name)) throw new ResourceError(`resource: a ${kind} of this run is named ${prefix}<name>`);
  }
  const list = loadResources(main, run.runId);
  if (list === null) throw new ResourceError(`resource: ${resourcesFile(main, run.runId)} cannot be read as a list of resources; it is left as it is`);
  const same = list.find(r => r.kind === kind && r.name === name);
  if (same) return same;
  if (kind === 'sqlite') {
    if (!confinedIn(name, run.worktree) && !confinedIn(name, tmp)) throw new ResourceError(`resource: a sqlite file of this run lives inside ${run.worktree} or ${tmp}`);
    if (exists(name)) throw new ResourceError(`resource: ${name} already exists; the run registers only the files it creates`);
  }
  if (list.length >= MAX_RESOURCES) throw new ResourceError(`resource: at most ${MAX_RESOURCES} resources per run`);
  const resource: Resource = { kind, name, host: kind === 'sqlite' || kind === 'container' || kind === 'volume' || kind === 'compose' ? null : host, at };
  writeResources(main, run.runId, [...list, resource]);
  return resource;
}
