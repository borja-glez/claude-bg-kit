// G-16: a little Markdown for the plan's texts (includes, done_when, verification, summary, notes): `code`, **bold** and
// http(s) links. It works on text ALREADY escaped with esc(), so it can only add the tags it writes; nothing of the
// text itself becomes HTML. No imports: the roadmap page bundles it.

/** A link: http(s), up to a space, a quote, an angle bracket or an escaped one (&quot; &#39; &lt; &gt;). */
const URL_RE = /\bhttps?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<>"'`])+/g;
/** Punctuation that ends a sentence, not the link. */
const TRAIL = /[.,:!?)\]]+$/;

const link = (raw: string): string => {
  const trail = TRAIL.exec(raw)?.[0] ?? '';
  const url = raw.slice(0, raw.length - trail.length);
  return /^https?:\/\/./.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}` : raw;
};

/** Code spans first (their content stays as it is), then bold and links in the rest. `escaped` must come from esc(). */
export function inlineMd(escaped: string): string {
  return escaped.split(/(`[^`\n]+`)/g).map((part, i) => (i % 2 === 1
    ? `<code>${part.slice(1, -1)}</code>`
    : part.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(URL_RE, link))).join('');
}
