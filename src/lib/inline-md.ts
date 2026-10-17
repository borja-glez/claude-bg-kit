// G-16: a little Markdown for the plan's texts (includes, done_when, verification, summary, notes): `code`, **bold** and
// http(s) links. It works on text ALREADY escaped with esc(), so it can only add the tags it writes; nothing of the
// text itself becomes HTML. No imports: the roadmap page bundles it.

/** A link: http(s), up to a space, a quote, an angle bracket or an escaped one (&quot; &#39; &lt; &gt;). */
const URL_RE = /\bhttps?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<>"'`])+/g;
/** Punctuation that ends a sentence, not the link (a `)` only when the link has no `(` it closes). */
const TRAIL = new Set(['.', ',', ':', '!', '?', ']', '*']);

/** A link and the punctuation after it. Carry 2: one pass from the end (a regex anchored at the end was quadratic on a
 *  long run of dots), and a `)` stays when it closes a `(` of the link (https://…/Rust_(lenguaje)). */
const splitTrail = (raw: string): [string, string] => {
  let opens = 0;
  let closes = 0;
  for (const ch of raw) { if (ch === '(') opens++; else if (ch === ')') closes++; }
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1]!;
    if (ch === ')' && closes > opens) closes--;
    else if (!TRAIL.has(ch)) break;
    end--;
  }
  return [raw.slice(0, end), raw.slice(end)];
};

/** Code spans first (their content stays as it is), then links, then bold. `escaped` must come from esc(). Carry 2: the
 *  links are set aside under a mark escaped text cannot hold (<n>) before bold, so a `**` in a link never cuts it and a
 *  link inside bold stays a link. */
export function inlineMd(escaped: string): string {
  return escaped.split(/(`[^`\n]+`)/g).map((part, i) => {
    if (i % 2 === 1) return `<code>${part.slice(1, -1)}</code>`;
    const links: string[] = [];
    const marked = part.replace(URL_RE, raw => {
      const [url, trail] = splitTrail(raw);
      if (!/^https?:\/\/./.test(url)) return raw;
      links.push(url);
      return `<${links.length - 1}>${trail}`;
    });
    return marked.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/<(\d+)>/g, (m, n: string) => { const url = links[Number(n)]; return url === undefined ? m : `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`; });
  }).join('');
}
