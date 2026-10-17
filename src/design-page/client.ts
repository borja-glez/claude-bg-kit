import type { DesignPageData, PageCritique, PageProposal, VersionDiff } from './build.js';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ENT[c]);

type Sev = 'critical' | 'major' | 'minor';
const SEVS: Sev[] = ['critical', 'major', 'minor'];
type StatusKey = 'draft' | 'approved' | 'amended' | 'parked';

interface Dict {
  eyebrow: string; version: string; words: string; rounds: string; source: string; prompt: string; copy: string; copied: string;
  versions: string; toc: string; current: string; imported: string; intro: string; round: string; none: string;
  moreRounds: string; moreProposals: string;
  status: Record<StatusKey, string>;
  verdict: { ready: string; changes: string };
  sev: Record<Sev, string>;
  short: Record<Sev, string>;
  cat: Record<string, string>;
  fate: { applied: string; resolved: string; dismissed: string; rewritten: string; pending: string };
  diff: { changed: string; added: string; removed: string };
}
const DICT: Record<string, Dict> = {
  en: {
    eyebrow: 'DESIGN DOCUMENT · EXECUTABLE SPECIFICATION', version: 'Version', words: 'Words', rounds: 'Rounds', source: 'Source', prompt: 'Start prompt',
    copy: 'Copy prompt', copied: 'Copied', versions: 'Versions', toc: 'Contents', current: 'current', imported: 'Imported from',
    intro: 'Intro', round: 'Round', none: 'No proposals: nothing critical or major is left.',
    moreRounds: '{n} older rounds not shown', moreProposals: '{n} older proposals not shown',
    status: { draft: 'draft', approved: 'approved', amended: 'approved · amended', parked: 'parked' },
    verdict: { ready: 'ready', changes: 'changes' },
    sev: { critical: 'critical', major: 'major', minor: 'minor' },
    short: { critical: 'C', major: 'M', minor: 'm' },
    cat: { scope: 'Scope', done_criteria: 'Done criteria', risk: 'Risk', contradiction: 'Contradiction', gap: 'Gap' },
    fate: { applied: 'applied in v{v}', resolved: 'resolved in the interview', dismissed: 'dismissed', rewritten: 'rewritten', pending: 'pending' },
    diff: { changed: 'changed', added: 'new', removed: 'removed' },
  },
  es: {
    eyebrow: 'DOCUMENTO DE DISEÑO · ESPECIFICACIÓN EJECUTABLE', version: 'Versión', words: 'Palabras', rounds: 'Rondas', source: 'Fuente', prompt: 'Prompt de arranque',
    copy: 'Copiar prompt', copied: 'Copiado', versions: 'Versiones', toc: 'Índice', current: 'actual', imported: 'Importado de',
    intro: 'Introducción', round: 'Ronda', none: 'Sin propuestas: no queda nada crítico ni mayor.',
    moreRounds: '{n} rondas anteriores no se muestran', moreProposals: '{n} propuestas anteriores no se muestran',
    status: { draft: 'borrador', approved: 'aprobado', amended: 'aprobado · enmendado', parked: 'aparcado' },
    verdict: { ready: 'lista', changes: 'con cambios' },
    sev: { critical: 'crítica', major: 'mayor', minor: 'menor' },
    short: { critical: 'C', major: 'M', minor: 'm' },
    cat: { scope: 'Alcance', done_criteria: 'Criterio de hecho', risk: 'Riesgo', contradiction: 'Contradicción', gap: 'Hueco' },
    fate: { applied: 'aplicada en v{v}', resolved: 'resuelta en la entrevista', dismissed: 'descartada', rewritten: 'reescrita', pending: 'pendiente' },
    diff: { changed: 'cambió', added: 'nueva', removed: 'quitada' },
  },
};
const dictFor = (loc: string | undefined): Dict => {
  const key = (loc ?? 'en').toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(DICT, key) ? DICT[key] : DICT.en;
};

/** K3-09: the status badge: draft, approved, approved · amended, or parked. */
function badge(data: DesignPageData, d: Dict): string {
  const key: StatusKey = data.status === 'approved' ? (data.amended ? 'amended' : 'approved') : data.status === 'parked' ? 'parked' : 'draft';
  return `<span class="badge st-${key}">${esc(d.status[key])}</span>`;
}

/** K3-09: under the versions, what the shown version changed against the one before: «cambió §a · nueva §b · quitada §c». */
function diffLine(diff: VersionDiff | null | undefined, d: Dict): string {
  if (!diff) return '';
  const name = (heading: string) => `§${heading === '_intro' ? d.intro : heading}`;
  const parts: [string, string[]][] = [[d.diff.changed, diff.changed], [d.diff.added, diff.added], [d.diff.removed, diff.removed]];
  const text = parts.filter(([, list]) => list.length).map(([word, list]) => `${word} ${list.map(name).join(', ')}`).join(' · ');
  return text ? `<p class="diff">${esc(text)}</p>` : '';
}

/** A proposal's section by its heading in the version its critique read (else the latest), the intro by a word. */
function sectionName(data: DesignPageData, c: PageCritique, slug: string, d: Dict): string {
  if (slug === '_intro') return d.intro;
  const v = data.versions.find(x => x.version === c.version) ?? data.versions[data.versions.length - 1];
  return v?.toc.find(t => t.slug === slug)?.heading ?? slug;
}

function fateText(p: PageProposal, d: Dict): string {
  if (p.fate === 'applied') return d.fate.applied.replace('{v}', String(p.appliedIn ?? '?'));
  if (p.fate === 'dismissed' && p.reason) return `${d.fate.dismissed}: ${p.reason}`;
  return d.fate[p.fate];
}

const moreLine = (template: string, n: number | undefined): string => (n && n > 0 ? `<p class="more">${esc(template.replace('{n}', String(n)))}</p>` : '');

/** K3-09: each round, folded, with its verdict, its counts by severity and every proposal with what became of it. */
function renderRounds(data: DesignPageData, d: Dict, open: ReadonlySet<number>): string {
  const crits = data.critiques ?? [];
  if (!crits.length) return '';
  const items = crits.map(c => {
    const counts = SEVS.map(s => `${c.proposals.filter(p => p.severity === s).length} ${d.short[s]}`).join(' · ');
    const list = c.proposals.length
      ? `<ol class="props">${c.proposals.map(p => {
        const cat = Object.hasOwn(d.cat, p.category) ? d.cat[p.category] : p.category;
        return `<li><span class="tag">[${esc(cat)} · ${esc(d.sev[p.severity])}]</span> <b>${esc(sectionName(data, c, p.section, d))}</b> — ${esc(p.problem)} → ${esc(p.change)} <span class="fate f-${esc(p.fate)}">${esc(fateText(p, d))}</span></li>`;
      }).join('')}</ol>`
      : `<p class="none">${esc(d.none)}</p>`;
    return `<details class="rd" data-round="${esc(c.round)}"${open.has(c.round) ? ' open' : ''}><summary><b>${esc(d.round)} ${esc(c.round)}</b> · v${esc(c.version)} · <span class="vd vd-${esc(c.verdict)}">${esc(d.verdict[c.verdict])}</span> · ${esc(counts)}</summary>${moreLine(d.moreProposals, c.proposalsMore)}${list}</details>`;
  }).join('');
  return `<section class="rounds"><div class="lbl">${esc(d.rounds)}</div>${moreLine(d.moreRounds, data.critiquesMore)}${items}</section>`;
}

/** The rounds open at first: the latest one. */
function latestOpen(data: DesignPageData): Set<number> {
  const crits = data.critiques ?? [];
  return new Set(crits.length ? [crits[crits.length - 1].round] : []);
}

export function renderDesignPage(data: DesignPageData, version: number, open: ReadonlySet<number> = latestOpen(data)): string {
  const d = dictFor(data.meta.locale);
  const v = data.versions.find(x => x.version === version) ?? data.versions[data.versions.length - 1];
  const no = v?.version ?? data.current;
  // K3-11: each version button says whether it is the one shown.
  const vers = data.versions.map(x => {
    const on = x.version === no;
    return `<button type="button" class="v${on ? ' on' : ''}" data-version="${esc(x.version)}" aria-pressed="${on}">v${esc(x.version)}${x.version === data.current ? ` · ${esc(d.current)}` : ''}</button>`;
  }).join('');
  const pillars = data.meta.pillars.map(p => `<div class="p"><b>${esc(p.title)}</b><span>${esc(p.text)}</span></div>`).join('');
  const toc = (v?.toc ?? []).map(t => `<a class="l${esc(t.level)}" href="#${esc(t.slug)}">${esc(t.heading)}</a>`).join('');
  return `<header>
<div class="eb">${esc(d.eyebrow)}${v?.date ? ` · ${esc(v.date)}` : ''}${badge(data, d)}</div>
<h1>${esc(data.meta.title)}<span class="dot">.</span></h1>
${data.meta.source ? `<p class="imp">${esc(d.imported)} <code>${esc(data.meta.source)}</code></p>\n` : ''}<p class="lead">${esc(data.meta.summary)}</p>
<div class="met"><div><b>v${esc(no)}</b>${esc(d.version)}</div><div><b>${esc(v?.words ?? data.words)}</b>${esc(d.words)}</div><div><b>${esc(data.rounds)}</b>${esc(d.rounds)}</div><div><b class="src">${esc(data.source)}</b>${esc(d.source)}</div></div>
</header>
<section class="vers"><div class="lbl">${esc(d.versions)}</div><div class="vl">${vers}</div>${diffLine(v?.diff, d)}${v?.note ? `<p class="note">${esc(v.note)}</p>` : ''}</section>
<section class="pil">${pillars}</section>
<section class="pr"><div><div class="lbl">${esc(d.prompt)}</div><code>${esc(data.meta.start_prompt)}</code></div><button type="button" class="cp" data-action="copy">${esc(d.copy)}</button></section>
${renderRounds(data, d, open)}<div class="doc"><nav class="toc"><div class="lbl">${esc(d.toc)}</div>${toc}</nav><article class="body">${v?.html ?? ''}</article></div>`;
}

export function mountDesignPage(root: HTMLElement, data: DesignPageData, deps: { copy?: (t: string) => Promise<void> } = {}): void {
  const d = dictFor(data.meta.locale);
  // K3-11: the document says its language (screen readers, hyphenation).
  root.ownerDocument.documentElement.lang = data.meta.locale;
  const open = latestOpen(data);
  const paint = (n: number, focus = false) => {
    root.innerHTML = renderDesignPage(data, n, open);
    // K3-11: repainting keeps the focus on the version button that was pressed.
    if (focus) (root.querySelector(`[data-version="${n}"]`) as HTMLElement | null)?.focus();
  };
  paint(data.current);
  // A round the person opens or closes stays so when the version changes (toggle does not bubble: capture it).
  root.addEventListener('toggle', ev => {
    const el = ev.target as HTMLElement | null;
    const round = Number(el?.dataset?.round);
    if (!el || !Number.isInteger(round) || round <= 0) return;
    if (el.hasAttribute('open')) open.add(round); else open.delete(round);
  }, true);
  root.addEventListener('click', ev => {
    const t = ev.target as Element | null;
    const ver = t?.closest('[data-version]') as HTMLElement | null;
    if (ver) { paint(Number(ver.dataset.version), true); return; }
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
