// J-12: the start of a forge task (forge begin): which changes of the tree are the person's and not forge's, and the
// question forge:run asks about them. Pure: no Node and no git.

/** forge's own files: everything under `.forge/` that forge's exclusions (or `.forge/.gitignore`) ignore, so neither
 *  `.forge/config.yaml` nor `.forge/verify/*.md`, which are the person's. */
export function isForgeOwn(p: string): boolean {
  const s = p.replace(/\\/g, '/');
  return s.startsWith('.forge/') && s !== '.forge/config.yaml' && !/^\.forge\/verify\/[^/]+\.md$/.test(s);
}

/** The paths of `git status` that are not forge's own, each once, in their order. */
export function foreignPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.filter(p => !isForgeOwn(p)))];
}

/** How many paths the question names; it counts the rest. */
export const FOREIGN_SHOWN = 10;

/** The question forge:run asks with `say` when `foreign` is not empty: commit, stash or leave them. forge never answers it. */
export function foreignSay(paths: readonly string[], locale: 'es' | 'en'): string {
  const shown = paths.slice(0, FOREIGN_SHOWN).join(', ');
  const rest = paths.length - FOREIGN_SHOWN;
  if (locale === 'es') {
    const more = rest > 0 ? ` y ${rest} más` : '';
    return `Hay cambios en el árbol que no son de esta tarea (${shown}${more}). ¿Los incluyo en un commit, los guardo con stash o los dejo como están?`;
  }
  const more = rest > 0 ? ` and ${rest} more` : '';
  return `The tree has changes that are not part of this task (${shown}${more}). Should I commit them, stash them or leave them as they are?`;
}
