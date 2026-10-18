// R2 (final review I2, carry 4b-1): the page is built from named sections, and a repaint skips those that did not change.
// The renderer marks each section (one element) with two comments; app.ts keeps the string it last painted for each one,
// and a section whose string is the same again goes to the morph as a stub: its own tag, class and keys, with
// data-morph="skip" and data-stub, and nothing inside. morphInto leaves the node the page has for it as it is, so it is
// neither parsed nor diffed; what the 30 s tick rewrote in it stays. A section that changed is morphed as before, its own
// unchanged sections stubbed in turn.

const OPEN = '<!--sec:';
const END = '-->';
const CLOSE = '<!--/sec-->';
const MARKS = /<!--(?:sec:[\w.-]+|\/sec)-->/g;
/** What a stub keeps of its element's opening tag: what morphInto matches it by (nodeKey) and checks it against. */
const KEPT = /\s(?:class|id|data-k|data-scroll-key)="[^"]*"/g;

/** A section of the page called `name` (letters, digits, «_», «.» and «-»; unique in the page, or it is only painted in
 *  full more often): `html` is one element. Nothing stays nothing. */
export const section = (name: string, html: string): string => (html ? `${OPEN}${name}${END}${html}${CLOSE}` : '');

/** The page with every section in full, as renderApp returns it and the full replace paints it: the marks go. */
export const stripSections = (html: string): string => html.replace(MARKS, '');

/** The stub of a section: its element's tag, class and keys, said to be skipped, with nothing in it. A body that does not
 *  start with an element is painted in full (never expected: a section is one element). Attribute values are escaped, so
 *  no «>» nor «"» ends the opening tag or a value early. */
const stubOf = (body: string): string | null => {
  const tag = /^<([a-zA-Z][\w-]*)/.exec(body)?.[1];
  const gt = body.indexOf('>');
  if (!tag || gt < 0) return null;
  return `<${tag}${body.slice(0, gt).match(KEPT)?.join('') ?? ''} data-morph="skip" data-stub></${tag}>`;
};

/** Where the section whose body starts at `from` ends (its closing mark), past the sections inside it. */
function closeOf(html: string, from: number): number {
  let depth = 1;
  let at = from;
  for (;;) {
    const c = html.indexOf(CLOSE, at);
    if (c < 0) throw new Error('[waypoint] a section of the page is not closed');
    const o = html.indexOf(OPEN, at);
    if (o >= 0 && o < c) { depth++; at = o + OPEN.length; continue; }
    if (--depth === 0) return c;
    at = c + CLOSE.length;
  }
}

/**
 * The HTML the morph takes for a page renderPage built: each section whose string is the one `painted` says the page holds
 * becomes its stub, every other one is painted in full (its own sections looked at in turn), and the marks go. `next`
 * receives every section of this page, stubbed or not, with its string: what the page holds once the morph is done.
 */
export function paintSections(html: string, painted: ReadonlyMap<string, string>, next: Map<string, string>): string {
  const out: string[] = [];
  const walk = (from: number, to: number, emit: boolean): void => {
    let at = from;
    for (;;) {
      const o = html.indexOf(OPEN, at);
      if (o < 0 || o >= to) { if (emit) out.push(html.slice(at, to)); return; }
      if (emit) out.push(html.slice(at, o));
      const named = html.indexOf(END, o + OPEN.length);
      const name = html.slice(o + OPEN.length, named);
      const start = named + END.length;
      const end = closeOf(html, start);
      const body = html.slice(start, end);
      next.set(name, body);
      const stub = emit && painted.get(name) === body ? stubOf(body) : null;
      if (stub !== null) out.push(stub);
      walk(start, end, emit && stub === null);
      at = end + CLOSE.length;
    }
  };
  walk(0, html.length, true);
  return out.join('');
}
