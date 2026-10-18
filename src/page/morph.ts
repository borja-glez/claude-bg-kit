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

/** The key morphdom matches nodes by: the id, data-k (t:<task> and p:<group> rows of the timeline, pl:<phase> of the
 *  plan, n:<note> and pr:<proposal> cards), else data-scroll-key (modal:<task>, evid:<proposal>, side…). A keyed node is
 *  never reused for another item, so a focus or a scroll never moves to what a different item now shows. */
export const nodeKey = (node: Node): string | undefined => {
  if (node.nodeType !== 1) return undefined;
  const el = node as Element;
  return el.id || el.getAttribute('data-k') || el.getAttribute('data-scroll-key') || undefined;
};

/** Carry 4: the fields whose live state (what was typed, checked or chosen) is not what their markup says, read once per
 *  morph (it was read again for every unchanged node). A node whose markup equals the render's still differs when one of
 *  these is inside it. A select always counts: the page has three at most, and walking into one costs less than working
 *  out which option its markup chooses by default. */
const dirtyFields = (marked: Element[]): Field[] => marked.filter(isField).filter(f => {
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
 * that the render puts right before a keyed node already in the page goes into the page right before that node, as the
 * render made it, and the render keeps an empty stand-in of each (its tag and attributes): morphdom finds the new node in
 * its place, leaves it as it is (it is the render's own), and nothing else moves. Only in the same container (the same
 * keyed one, or none on both sides) and only for an item new all through, so no node of the page moves into it while
 * morphdom's walk could still be pointing at it. A node placed so that morphdom never reaches is taken out again.
 */
const placeNew = (marked: Element[], root: HTMLElement, next: HTMLElement): Set<Element> => {
  const placed = new Set<Element>();
  const live = new Map<string, Element>();
  for (const el of marked) { const k = nodeKey(el); if (k && !live.has(k)) live.set(k, el); }
  if (!live.size) return placed;
  const isNew = (el: Element): boolean => { const k = nodeKey(el); return !!k && !live.has(k); };
  /** The key of the nearest keyed ancestor below `top`, or null. */
  const boxOf = (el: Element, top: Element): string | null => {
    for (let p = el.parentElement; p && p !== top; p = p.parentElement) { const k = nodeKey(p); if (k) return k; }
    return null;
  };
  const keyed = Array.from(next.querySelectorAll(KEYED));
  // The nodes of the render that hold a node already in the page: one pass up from each of those.
  const holdsLive = new Set<Element>();
  for (const el of keyed) {
    if (isNew(el)) continue;
    for (let p = el.parentElement; p && p !== next && !holdsLive.has(p); p = p.parentElement) holdsLive.add(p);
  }
  // Re-review m2: each run of new siblings is walked once, by its first node, and its anchor kept for the rest of it.
  const anchorOf = new Map<Element, Element | null>();
  const doc = root.ownerDocument;
  for (const el of keyed) {
    if (!isNew(el) || holdsLive.has(el)) continue;
    // Re-review N3: a stub (R2), or a node holding one, is left to morphdom, whose walk sees it added and makes the morph
    // throw: moved in here it would never be walked, and paint an empty section.
    if (el.hasAttribute('data-stub') || el.querySelector('[data-stub]')) continue;
    if (!anchorOf.has(el)) {
      const run = [el];
      let after = el.nextElementSibling;
      while (after && isNew(after)) { run.push(after); after = after.nextElementSibling; }
      const found = (after && live.get(nodeKey(after) ?? '')) || null;
      for (const r of run) anchorOf.set(r, found);
    }
    const anchor = anchorOf.get(el);
    if (!anchor?.parentNode || !el.parentNode || boxOf(el, next) !== boxOf(anchor, root)) continue;
    // Re-review m1: the stand-in never equals the node it stands for (an empty node would, and its parent, otherwise
    // the render's, would then be skipped with the node never reached): it holds an empty comment.
    const stand = el.cloneNode(false);
    stand.appendChild(doc.createComment(''));
    el.parentNode.replaceChild(stand, el);
    anchor.parentNode.insertBefore(el, anchor);
    placed.add(el);
  }
  return placed;
};

/** R2: a stub (sections.ts) stands for the node of the page it was matched with only when that node is the same section:
 *  its tag, its class and its key. */
const sameSection = (from: Element, stub: Element): boolean =>
  from.tagName === stub.tagName && nodeKey(from) === nodeKey(stub) && from.getAttribute('class') === stub.getAttribute('class');

/** Re-review N1: whether a focused field, its attributes mirrored, still differs from the render in more than what the
 *  person typed or chose: a select's options, or an attribute other than the value. */
const leftStale = (from: Field, to: Element): boolean => {
  if (from.tagName === 'SELECT') return from.innerHTML !== to.innerHTML;
  const names = new Set([...Array.from(from.attributes), ...Array.from(to.attributes)].map(a => a.name));
  names.delete('value');
  for (const n of names) if (from.getAttribute(n) !== to.getAttribute(n)) return true;
  return false;
};

/** The children of `root` become those of `html`. Throws when morphdom does (the caller replaces everything then), and when a
 *  section's stub found no node of its own in the page (R2): the caller paints the page in full then. Returns the focused
 *  field it left as the person has it while the render says otherwise (re-review N1), so the caller can paint its section
 *  again once the field loses the focus; else null. */
export function morphInto(root: HTMLElement, html: string): Element | null {
  // A string would lose all but its first node: morph into a sibling element that holds the whole HTML.
  const next = root.cloneNode(false) as HTMLElement;
  next.innerHTML = html;
  const active = root.ownerDocument.activeElement;
  // One query of the page for both: its keyed nodes and its fields.
  const marked = Array.from(root.querySelectorAll(`${KEYED},${FIELDS}`));
  const dirty = dirtyFields(marked);
  const placed = placeNew(marked, root, next);
  let lost = false;
  let kept: Element | null = null;
  morphdom(root, next, {
    childrenOnly: true,
    getNodeKey: nodeKey,
    // R2: a stub the page has no node for would paint an empty section.
    onNodeAdded(node) {
      if (node.nodeType === 1 && (node as Element).hasAttribute('data-stub')) lost = true;
      return node;
    },
    onBeforeElUpdated(from, to) {
      // R2: a section that did not change since it was painted: its node stays as it is, never parsed nor diffed (what the
      // 30 s tick rewrote in it included). Matched with another node, the page is painted in full instead.
      if (to.hasAttribute('data-stub')) {
        if (!sameSection(from, to)) lost = true;
        return false;
      }
      // Placed by placeNew: already the render's node, its stand-in in the render is empty.
      if (placed.delete(from)) return false;
      // `from === f` too: some DOMs (happy-dom) say a node does not contain itself.
      if (from.isEqualNode(to) && !dirty.some(f => from === f || from.contains(f))) return false;
      // Filled by hand (the arrows of the dependencies): never entered.
      if (from.getAttribute('data-morph') === 'skip') return false;
      // The person is typing or choosing there: its value, its selection and its open list stay.
      if (from === active && isField(from)) {
        mirrorAttrs(from, to);
        if (leftStale(from, to)) kept = from;
        return false;
      }
      if (from.tagName === 'DETAILS') to.toggleAttribute('open', (from as HTMLDetailsElement).open);
      return true;
    },
  });
  for (const el of placed) el.remove();
  if (lost) throw new Error('[waypoint] a section stub found no node of its own');
  return kept;
}
