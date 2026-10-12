import type { DesignPageData } from './build.js';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ENT[c]);

interface Dict { eyebrow: string; version: string; words: string; rounds: string; source: string; prompt: string; copy: string; copied: string; versions: string; toc: string; current: string }
const DICT: Record<string, Dict> = {
  en: { eyebrow: 'DESIGN DOCUMENT · EXECUTABLE SPECIFICATION', version: 'Version', words: 'Words', rounds: 'Rounds', source: 'Source', prompt: 'Start prompt', copy: 'Copy prompt', copied: 'Copied', versions: 'Versions', toc: 'Contents', current: 'current' },
  es: { eyebrow: 'DOCUMENTO DE DISEÑO · ESPECIFICACIÓN EJECUTABLE', version: 'Versión', words: 'Palabras', rounds: 'Rondas', source: 'Fuente', prompt: 'Prompt de arranque', copy: 'Copiar prompt', copied: 'Copiado', versions: 'Versiones', toc: 'Índice', current: 'actual' },
};
const dictFor = (loc: string | undefined): Dict => DICT[(loc ?? 'en').toLowerCase().split(/[-_]/)[0]] ?? DICT.en;

export function renderDesignPage(data: DesignPageData, version: number): string {
  const d = dictFor(data.meta.locale);
  const v = data.versions.find(x => x.version === version) ?? data.versions[data.versions.length - 1];
  const no = v?.version ?? data.current;
  const vers = data.versions.map(x =>
    `<button class="v ${x.version === no ? 'on' : ''}" data-version="${esc(x.version)}">v${esc(x.version)}${x.version === data.current ? ` · ${esc(d.current)}` : ''}</button>`).join('');
  const pillars = data.meta.pillars.map(p => `<div class="p"><b>${esc(p.title)}</b><span>${esc(p.text)}</span></div>`).join('');
  const toc = (v?.toc ?? []).map(t => `<a class="l${esc(t.level)}" href="#${esc(t.slug)}">${esc(t.heading)}</a>`).join('');
  return `<header>
<div class="eb">${esc(d.eyebrow)}${v?.date ? ` · ${esc(v.date)}` : ''}</div>
<h1>${esc(data.meta.title)}<span class="dot">.</span></h1>
<p class="lead">${esc(data.meta.summary)}</p>
<div class="met"><div><b>v${esc(no)}</b>${esc(d.version)}</div><div><b>${esc(v?.words ?? data.words)}</b>${esc(d.words)}</div><div><b>${esc(data.rounds)}</b>${esc(d.rounds)}</div><div><b class="src">${esc(data.source)}</b>${esc(d.source)}</div></div>
</header>
<section class="vers"><div class="lbl">${esc(d.versions)}</div><div class="vl">${vers}</div>${v?.note ? `<p class="note">${esc(v.note)}</p>` : ''}</section>
<section class="pil">${pillars}</section>
<section class="pr"><div><div class="lbl">${esc(d.prompt)}</div><code>${esc(data.meta.start_prompt)}</code></div><button class="cp" data-action="copy">${esc(d.copy)}</button></section>
<div class="doc"><nav class="toc"><div class="lbl">${esc(d.toc)}</div>${toc}</nav><article class="body">${v?.html ?? ''}</article></div>`;
}

export function mountDesignPage(root: HTMLElement, data: DesignPageData, deps: { copy?: (t: string) => Promise<void> } = {}): void {
  const d = dictFor(data.meta.locale);
  const paint = (n: number) => { root.innerHTML = renderDesignPage(data, n); };
  paint(data.current);
  root.addEventListener('click', ev => {
    const t = ev.target as Element | null;
    const ver = t?.closest('[data-version]') as HTMLElement | null;
    if (ver) { paint(Number(ver.dataset.version)); return; }
    const cp = t?.closest('[data-action="copy"]') as HTMLElement | null;
    if (!cp) return;
    const copy = deps.copy ?? ((s: string) => navigator.clipboard.writeText(s));
    Promise.resolve().then(() => copy(data.meta.start_prompt)).then(() => {
      cp.textContent = d.copied;
      setTimeout(() => { if (cp.isConnected) cp.textContent = d.copy; }, 1500);
    }, () => {
      const code = root.querySelector('.pr code');
      if (code) { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    });
  });
}

function main(): void {
  const el = document.getElementById('wp-design-data');
  if (!el) return;
  const app = document.getElementById('wp-design-root')!;
  try {
    mountDesignPage(app, JSON.parse(el.textContent ?? ''));
  } catch (e) {
    app.textContent = `Error: ${(e as Error).message}`;
  }
}
main();
