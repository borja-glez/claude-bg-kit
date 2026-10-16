const WILD = /[*?[{]/;

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

export function staticPrefix(glob: string): string {
  const out: string[] = [];
  for (const part of norm(glob).split('/')) {
    if (WILD.test(part)) break;
    out.push(part);
  }
  return out.join('/');
}

/** a is b, or a lives inside directory b ('' = repository root). */
const under = (a: string, b: string) => b === '' || a === b || a.startsWith(`${b}/`);

/** Conservative: may report an overlap that real matching would not, never misses a real one. */
export function globsOverlap(a: string, b: string): boolean {
  const wa = WILD.test(a);
  const wb = WILD.test(b);
  if (!wa && !wb) {
    const na = norm(a);
    const nb = norm(b);
    return under(na, nb) || under(nb, na);
  }
  if (wa && wb) {
    const pa = staticPrefix(a);
    const pb = staticPrefix(b);
    return under(pa, pb) || under(pb, pa);
  }
  const literal = norm(wa ? b : a);
  const prefix = staticPrefix(wa ? a : b);
  return under(literal, prefix) || under(prefix, literal);
}

export function overlappingZones(a: string[], b: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const x of a) for (const y of b) if (globsOverlap(x, y)) out.push([x, y]);
  return out;
}

/** D-09: the zones a task occupies. A task without zones may touch anything, so it counts as the whole repository. */
export function effectiveZones(zones: readonly string[]): string[] {
  return zones.length ? [...zones] : ['**'];
}
