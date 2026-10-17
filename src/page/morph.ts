// H-06: the page's HTML applied with morphdom: only the nodes that changed are touched, so the scroll of any container,
// the focus, an open <select>, the hover and the modal survive a snapshot. renderApp stays a pure function that returns
// a string; this is the only place that knows how it reaches the DOM.
import morphdom from 'morphdom';

/** What the render still says about a focused field (besides aria-*): its value and its selection stay the person's. */
const FIELD_ATTRS = ['readonly', 'disabled', 'placeholder', 'maxlength'];
const FIELDS = 'input,textarea,select';
/** The elements nodeKey gives a key to. */
const KEYED = '[id],[data-k],[data-scroll-key]';

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

/** Carry 4: the fields whose live state (what was typed, checked or chosen) is not what their markup says, read once per
 *  morph (it was read again for every unchanged node). A node whose markup equals the render's still differs when one of
 *  these is inside it. A select always counts: what was chosen cannot be told from its markup everywhere (some DOMs move
 *  the `selected` attribute with the choice), and there are only a few. */
const dirtyFields = (root: Element): Field[] => Array.from(root.querySelectorAll<Field>(FIELDS)).filter(f => {
  if (f.tagName === 'SELECT') return true;
  if (f.tagName === 'TEXTAREA') return f.value !== (f.textContent ?? '');
  const i = f as HTMLInputElement;
  if (i.type === 'checkbox' || i.type === 'radio') return i.checked !== i.hasAttribute('checked');
  return i.value !== (i.getAttribute('value') ?? '');
});

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

/**
 * Review M3: morphdom, given a keyed node it does not find in the page, walks on through the siblings that follow, sets
 * each one aside and appends it again after the new node: one item new at the top of a list moved every item under it,
 * which blurs a focused field and loses the scroll of anything inside. So before the morph, a run of new keyed nodes
 * that the render puts right before a keyed node already in the page gets empty stand-ins (their tag and attributes)
 * right before that node: morphdom finds each one in its place and fills it, and nothing else moves. Only in the same
 * container (the same keyed one, or none on both sides) and only for an item new all through: filling the stand-in then
 * moves no node of the page, which morphdom's walk could still be pointing at. A stand-in morphdom never reaches is
 * taken out after the morph.
 */
const placeStandIns = (root: HTMLElement, next: HTMLElement): Set<Element> => {
  const placed = new Set<Element>();
  const live = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll(KEYED))) { const k = nodeKey(el); if (k && !live.has(k)) live.set(k, el); }
  if (!live.size) return placed;
  const isNew = (el: Element): boolean => { const k = nodeKey(el); return !!k && !live.has(k); };
  /** The key of the nearest keyed ancestor below `top`, or null. */
  const boxOf = (el: Element, top: Element): string | null => {
    for (let p = el.parentElement; p && p !== top; p = p.parentElement) { const k = nodeKey(p); if (k) return k; }
    return null;
  };
  for (const el of Array.from(next.querySelectorAll(KEYED))) {
    if (!isNew(el)) continue;
    let after = el.nextElementSibling;
    while (after && isNew(after)) after = after.nextElementSibling;
    const anchor = after ? live.get(nodeKey(after) ?? '') : undefined;
    if (!anchor?.parentNode || boxOf(el, next) !== boxOf(anchor, root)) continue;
    if (Array.from(el.querySelectorAll(KEYED)).some(d => !isNew(d))) continue;
    const stand = el.cloneNode(false) as Element;
    anchor.parentNode.insertBefore(stand, anchor);
    placed.add(stand);
  }
  return placed;
};

/** The children of `root` become those of `html`. Throws when morphdom does (the caller replaces everything then). */
export function morphInto(root: HTMLElement, html: string): void {
  // A string would lose all but its first node: morph into a sibling element that holds the whole HTML.
  const next = root.cloneNode(false) as HTMLElement;
  next.innerHTML = html;
  const active = root.ownerDocument.activeElement;
  const dirty = dirtyFields(root);
  const stands = placeStandIns(root, next);
  morphdom(root, next, {
    childrenOnly: true,
    getNodeKey: nodeKey,
    onBeforeElUpdated(from, to) {
      stands.delete(from);
      // `from === f` too: some DOMs (happy-dom) say a node does not contain itself.
      if (from.isEqualNode(to) && !dirty.some(f => from === f || from.contains(f))) return false;
      // Filled by hand (the arrows of the dependencies): never entered.
      if (from.getAttribute('data-morph') === 'skip') return false;
      // The person is typing or choosing there: its value, its selection and its open list stay.
      if (from === active && isField(from)) { mirrorAttrs(from, to); return false; }
      if (from.tagName === 'DETAILS') to.toggleAttribute('open', (from as HTMLDetailsElement).open);
      return true;
    },
  });
  for (const s of stands) s.remove();
}
