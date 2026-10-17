// H-06: the page's HTML applied with morphdom: only the nodes that changed are touched, so the scroll of any container,
// the focus, an open <select>, the hover and the modal survive a snapshot. renderApp stays a pure function that returns
// a string; this is the only place that knows how it reaches the DOM.
import morphdom from 'morphdom';

/** Classes the page sets by hand (the dependencies on hover) that a repaint must not drop. */
const KEEP_CLASSES = ['dep-up', 'dep-down', 'dep-self'];
/** What the render still says about a focused field (besides aria-*): its value and its selection stay the person's. */
const FIELD_ATTRS = ['readonly', 'disabled', 'placeholder', 'maxlength'];
const FIELDS = 'input,textarea,select';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isField = (el: Element): el is Field => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';

/** The key morphdom matches nodes by: the id, data-k (t:<task> and p:<group> rows of the timeline, n:<note> and
 *  pr:<proposal> cards), else data-scroll-key (modal:<task>, evid:<proposal>, vcols…). A keyed node is never reused for
 *  another item, so a focus or a scroll never moves to what a different item now shows. */
export const nodeKey = (node: Node): string | undefined => {
  if (node.nodeType !== 1) return undefined;
  const el = node as Element;
  return el.id || el.getAttribute('data-k') || el.getAttribute('data-scroll-key') || undefined;
};

/** A field's live state (what was typed, checked or chosen) differs from the render's; the markup does not show it. */
const fieldDiffers = (from: Field, to: Field): boolean => {
  if (from.value !== to.value) return true;
  if (from.tagName === 'INPUT') return (from as HTMLInputElement).checked !== (to as HTMLInputElement).checked;
  if (from.tagName === 'SELECT') return (from as HTMLSelectElement).selectedIndex !== (to as HTMLSelectElement).selectedIndex;
  return false;
};

/** Two nodes with equal markup still differ when a field in them (or they themselves) holds another live state. */
const liveDiffers = (from: Element, to: Element): boolean => {
  const a = Array.from(from.querySelectorAll<Field>(FIELDS));
  const b = Array.from(to.querySelectorAll<Field>(FIELDS));
  if (isField(from) && isField(to)) { a.unshift(from); b.unshift(to); }
  return a.some((f, i) => { const t = b[i]; return !t || fieldDiffers(f, t); });
};

/** The render's say on a focused field reaches it (read-only, disabled, hints, aria-*); its value and selection do not. */
const mirrorAttrs = (from: Element, to: Element): void => {
  const names = new Set(FIELD_ATTRS);
  for (const a of [...Array.from(from.attributes), ...Array.from(to.attributes)]) if (a.name.startsWith('aria-')) names.add(a.name);
  for (const n of names) {
    const v = to.getAttribute(n);
    if (v === null) from.removeAttribute(n);
    else if (from.getAttribute(n) !== v) from.setAttribute(n, v);
  }
};

/** The children of `root` become those of `html`. Throws when morphdom does (the caller replaces everything then). */
export function morphInto(root: HTMLElement, html: string): void {
  // A string would lose all but its first node: morph into a sibling element that holds the whole HTML.
  const next = root.cloneNode(false) as HTMLElement;
  next.innerHTML = html;
  const active = root.ownerDocument.activeElement;
  morphdom(root, next, {
    childrenOnly: true,
    getNodeKey: nodeKey,
    onBeforeElUpdated(from, to) {
      if (from.isEqualNode(to) && !liveDiffers(from, to)) return false;
      // Filled by hand (the arrows of the dependencies): never entered.
      if (from.getAttribute('data-morph') === 'skip') return false;
      // The person is typing or choosing there: its value, its selection and its open list stay.
      if (from === active && isField(from)) { mirrorAttrs(from, to); return false; }
      for (const c of KEEP_CLASSES) if (from.classList.contains(c)) to.classList.add(c);
      if (from.tagName === 'DETAILS') to.toggleAttribute('open', (from as HTMLDetailsElement).open);
      return true;
    },
  });
}
