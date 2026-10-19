// What the plan skill says when it publishes the roadmap (its steps 3 and 5): the capabilities, whether they make the
// artifact internal, and the lines for the person. Pure; the waypoint CLI reads the plan and the listed meta/page.
import type { Plan } from './types.js';

/** G-13, §4.1: the rules of the page this version publishes; 2 is the first with the owner's approvals rule. */
export const PAGE_RULES = 2;

/** The capabilities of plan skill step 3.2; `assets` (forge's verification screenshots) only when the caller asks for it. */
export function roadmapCapabilities(assets: boolean): Record<string, unknown> {
  return {
    db: { rules: [
      { path: '', read: 'view', write: 'admin' },
      { path: 'notes', read: 'view', write: 'interact' },
      { path: 'proposals', read: 'view', write: 'interact' },
      // §4.1: only the roadmap's owner writes the mark that makes a decision count for forge (not admin: editors comment).
      { path: 'approvals', read: 'view', write: 'owner' },
    ] },
    user: { scopes: ['profile'] },
    downloads: true,
    ...(assets ? { assets: {} } : {}),
  };
}

/**
 * §4.1, final review I5: the rules a publish with these capabilities gives the roadmap. PAGE_RULES only when they hold the
 * owner's rule on approvals, `{path: 'approvals', read: 'view', write: 'owner'}`; 1 otherwise (approvals/ then inherits
 * the root rule, which editors meet, so no mark is the owner's). A second, different rule on approvals makes it 1 too.
 * `capabilities` is what the skill passed to the publish.
 */
export function rulesOf(capabilities: unknown): number {
  const field = (x: unknown, key: string): unknown => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>)[key] : undefined);
  const rules = field(field(capabilities, 'db'), 'rules');
  const onApprovals = Array.isArray(rules) ? rules.filter(r => field(r, 'path') === 'approvals') : [];
  const owner = onApprovals.length > 0 && onApprovals.every(r => field(r, 'read') === 'view' && field(r, 'write') === 'owner');
  return owner ? PAGE_RULES : 1;
}

/** Re-review I1: whether a capabilities object declares `assets` (forge's screenshot store), which makes the artifact internal. */
export const declaresAssets = (capabilities: unknown): boolean =>
  !!capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities) && Object.hasOwn(capabilities, 'assets');

/**
 * Re-review I1: whether a republish with `assets` (true or false) changes who can see and share a roadmap whose listed
 * meta/page recorded `published` (undefined when unknown: no page, or one from before this record). A first publication
 * changes nothing here (`sharingNotice` speaks for it); an unknown record counts as changed when the file declares assets.
 */
export function sharingChanged(plan: Plan, assets: boolean, published: boolean | undefined): boolean {
  if (!plan.artifacts.roadmap) return false;
  return published === undefined ? assets : published !== assets;
}

/** Re-review I1: the line the plan skill asks the person with before a republish that changes the roadmap's sharing. */
export function sharingChangeAsk(plan: Plan, assets: boolean): string {
  if (assets) {
    return isEs(plan.locale)
      ? 'Al republicar, el roadmap pasa a guardar las capturas de verificación de forge: quedará interno de tu organización y su enlace público dejará de funcionar.'
      : "Republishing makes the roadmap keep forge's verification screenshots: it becomes internal to your organization and its public link stops working.";
  }
  // R6b: only /waypoint:plan no-assets drops the store, so the question is about making the roadmap shareable again.
  return isEs(plan.locale)
    ? 'Al republicar, el roadmap vuelve a poder compartirse: deja de guardar las capturas de verificación de forge, así que podrá compartirse públicamente; las capturas ya subidas dejarán de verse y las nuevas de forge se quedan en tu equipo.'
    : "Republishing makes the roadmap shareable again: it stops keeping forge's verification screenshots, so it can be shared publicly; the screenshots already uploaded stop showing, and forge's new ones stay on your machine.";
}

const isEs = (locale: string | undefined) => (locale ?? '').toLowerCase().split(/[-_]/)[0] === 'es';

/** The one-time notice that `assets` makes the roadmap internal: only for a first publication that declares it. */
export function sharingNotice(plan: Plan, internal: boolean): string | null {
  if (!internal || plan.artifacts.roadmap) return null;
  return isEs(plan.locale)
    ? 'El roadmap lleva las capturas de verificación de forge, así que queda interno de tu organización y no se puede compartir públicamente (con evidence: local en .forge/config.yaml no se suben).'
    : "The roadmap carries forge's verification screenshots, so it stays internal to your organization and cannot be shared publicly (with evidence: local in .forge/config.yaml they are not uploaded).";
}

/** The report line after a sync: the roadmap URL and the plan's size; null while the roadmap is not published. */
export function syncSummary(plan: Plan): string | null {
  const url = plan.artifacts.roadmap;
  if (!url) return null;
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return isEs(plan.locale)
    ? `Roadmap: ${url} · ${n(plan.tasks.length, 'tarea', 'tareas')}, ${n(plan.phases.length, 'fase', 'fases')}, ${n(plan.tracks.length, 'frente', 'frentes')}.`
    : `Roadmap: ${url} · ${n(plan.tasks.length, 'task', 'tasks')}, ${n(plan.phases.length, 'phase', 'phases')}, ${n(plan.tracks.length, 'track', 'tracks')}.`;
}
