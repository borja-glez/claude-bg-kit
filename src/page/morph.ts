// H-06: the page's HTML applied with morphdom: only the nodes that changed are touched, so the scroll of any container,
// the focus, an open <select>, the hover and the modal survive a snapshot. renderApp stays a pure function that returns
// a string; this is the only place that knows how it reaches the DOM.
import morphdom from 'morphdom';

/** Classes the page sets by hand (the dependencies on hover) that a repaint must not drop. */
const KEEP_CLASSES = ['dep-up', 'dep-down', 'dep-self'];

/** The key morphdom matches nodes by: the id or data-k (t:T044, p:F1, n:<note>, pr:<proposal>, run:<runId>, s:<sid>…). */
export const nodeKey = (node: Node): string | undefined => {
  if (node.nodeType !== 1) return undefined;
  const el = node as Element;
  return el.id || el.getAttribute('data-k') || undefined;
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
      if (from.isEqualNode(to)) return false;
      // Filled by hand (the arrows of the dependencies): never entered.
      if (from.getAttribute('data-morph') === 'skip') return false;
      // The person is typing or choosing there: its value, its selection and its open list stay.
      if (from === active && (from.tagName === 'INPUT' || from.tagName === 'TEXTAREA' || from.tagName === 'SELECT')) return false;
      for (const c of KEEP_CLASSES) if (from.classList.contains(c)) to.classList.add(c);
      if (from.tagName === 'DETAILS') to.toggleAttribute('open', (from as HTMLDetailsElement).open);
      return true;
    },
  });
}
