import type { DesignPageData, PageCritique, PageProposal, TocEntry, VersionDiff } from './build.js';
import type { EntryKind } from '../lib/history.js';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ENT[c]);

type Sev = 'critical' | 'major' | 'minor';
const SEVS: Sev[] = ['critical', 'major', 'minor'];
type StatusKey = 'draft' | 'approved' | 'amended' | 'parked';
type FateKey = PageProposal['fate'];
const FATES: FateKey[] = ['applied', 'resolved', 'dismissed', 'rewritten', 'pending'];
export type Tab = 'doc' | 'review' | 'history';
const TABS: Tab[] = ['doc', 'review', 'history'];
type KindKey = EntryKind | 'unknown';
/** The colour family of a version by what made it: drafting, editing, rewriting, approving or reopening. */
const KIND_CLASS: Record<KindKey, string> = {
  draft: 'k-draft', round: 'k-edit', apply: 'k-edit', interview: 'k-edit', rewrite: 'k-rewrite', approve: 'k-ok', amend: 'k-ok', reopen: 'k-reopen', unknown: 'k-draft',
};

interface Dict {
  eyebrow: string; version: string; words: string; rounds: string; source: string; prompt: string; copy: string; copied: string;
  versions: string; earlier: string; toc: string; current: string; imported: string; intro: string; round: string; none: string;
  moreRounds: string; moreProposals: string; pillars: string;
  /** Carry 9 and 10: the pending count, a diff across a history gap, a critique of an unknown version, the version shown. */
  pending: string; gap: string; unknownVersion: string; shown: string;
  tabs: Record<Tab, string>; views: string; sections: string; map: string; mapSum: string; reading: string; minutes: string;
  wordsN: string; subsections: string; changedIn: string; addedIn: string; old: string; goCurrent: string;
  byRound: string; fates: string; proposals: string; problem: string; change: string; lastVerdict: string; noRounds: string;
  evolution: string; kinds: Record<KindKey, string>; wordsShort: string; badDiagram: string;
  status: Record<StatusKey, string>;
  verdict: { ready: string; changes: string };
  sev: Record<Sev, string>;
  short: Record<Sev, string>;
  cat: Record<string, string>;
  fate: { applied: string; resolved: string; dismissed: string; rewritten: string; pending: string };
  fateKey: Record<FateKey, string>;
  diff: { changed: string; added: string; removed: string };
}
const DICT: Record<string, Dict> = {
  en: {
    eyebrow: 'DESIGN DOCUMENT · EXECUTABLE SPECIFICATION', version: 'Version', words: 'Words', rounds: 'Rounds', source: 'Source', prompt: 'Start prompt',
    copy: 'Copy prompt', copied: 'Copied', versions: 'Versions', earlier: 'Earlier versions', toc: 'Contents', current: 'current', imported: 'Imported from',
    intro: 'Intro', round: 'Round', none: 'No proposals: nothing critical or major is left.',
    moreRounds: '{n} older rounds not shown', moreProposals: '{n} older proposals not shown', pillars: 'Pillars',
    pending: 'Pending', gap: 'against v{v}: versions missing from the history', unknownVersion: 'unknown version', shown: 'Showing v{v}',
    tabs: { doc: 'Document', review: 'Review', history: 'History' }, views: 'Views', sections: 'Sections', map: 'Document map',
    mapSum: '{s} sections · {w} words · {m} min read', reading: 'Reading', minutes: '{m} min', wordsN: '{n} words', subsections: '{n} subsections',
    changedIn: 'changed in v{v}', addedIn: 'new in v{v}', old: 'You are reading v{v}{date}, not the current version.', goCurrent: 'Go to v{v}',
    byRound: 'Proposals per round', fates: 'What became of each proposal', proposals: 'proposals', problem: 'Problem', change: 'Proposed change',
    lastVerdict: 'Last verdict', noRounds: 'This design has not been through the critic yet. Ask for a round with /waypoint:design round.',
    evolution: 'How the document grew', wordsShort: 'words', badDiagram: 'This diagram has an error in its source:',
    kinds: { draft: 'draft', round: 'round', apply: 'proposals applied', interview: 'interview', rewrite: 'rewrite', approve: 'approval', amend: 'amendment', reopen: 'reopened', unknown: 'change' },
    status: { draft: 'draft', approved: 'approved', amended: 'approved · amended', parked: 'parked' },
    verdict: { ready: 'ready', changes: 'changes' },
    sev: { critical: 'critical', major: 'major', minor: 'minor' },
    short: { critical: 'C', major: 'M', minor: 'm' },
    cat: { scope: 'Scope', done_criteria: 'Done criteria', risk: 'Risk', contradiction: 'Contradiction', gap: 'Gap' },
    fate: { applied: 'applied in v{v}', resolved: 'resolved in the interview', dismissed: 'dismissed', rewritten: 'rewritten', pending: 'pending' },
    fateKey: { applied: 'applied', resolved: 'resolved', dismissed: 'dismissed', rewritten: 'rewritten', pending: 'pending' },
    diff: { changed: 'changed', added: 'new', removed: 'removed' },
  },
  es: {
    eyebrow: 'DOCUMENTO DE DISEÑO · ESPECIFICACIÓN EJECUTABLE', version: 'Versión', words: 'Palabras', rounds: 'Rondas', source: 'Fuente', prompt: 'Prompt de arranque',
    copy: 'Copiar prompt', copied: 'Copiado', versions: 'Versiones', earlier: 'Versiones anteriores', toc: 'Índice', current: 'actual', imported: 'Importado de',
    intro: 'Introducción', round: 'Ronda', none: 'Sin propuestas: no queda nada crítico ni mayor.',
    moreRounds: '{n} rondas anteriores no se muestran', moreProposals: '{n} propuestas anteriores no se muestran', pillars: 'Pilares',
    pending: 'Pendientes', gap: 'frente a v{v}: faltan versiones en la historia', unknownVersion: 'versión desconocida', shown: 'Mostrando v{v}',
    tabs: { doc: 'Documento', review: 'Revisión', history: 'Historia' }, views: 'Vistas', sections: 'Secciones', map: 'Mapa del documento',
    mapSum: '{s} secciones · {w} palabras · {m} min de lectura', reading: 'Lectura', minutes: '{m} min', wordsN: '{n} palabras', subsections: '{n} subsecciones',
    changedIn: 'cambió en v{v}', addedIn: 'nueva en v{v}', old: 'Estás leyendo la v{v}{date}, no la versión actual.', goCurrent: 'Ir a la v{v}',
    byRound: 'Propuestas por ronda', fates: 'Qué pasó con cada propuesta', proposals: 'propuestas', problem: 'Problema', change: 'Cambio propuesto',
    lastVerdict: 'Último veredicto', noRounds: 'Este diseño aún no ha pasado por el crítico. Pide una ronda con /waypoint:design round.',
    evolution: 'Cómo creció el documento', wordsShort: 'palabras', badDiagram: 'Este diagrama tiene un error en su fuente:',
    kinds: { draft: 'borrador', round: 'ronda', apply: 'propuestas aplicadas', interview: 'entrevista', rewrite: 'reescritura', approve: 'aprobación', amend: 'enmienda', reopen: 'reapertura', unknown: 'cambio' },
    status: { draft: 'borrador', approved: 'aprobado', amended: 'aprobado · enmendado', parked: 'aparcado' },
    verdict: { ready: 'lista', changes: 'con cambios' },
    sev: { critical: 'crítica', major: 'mayor', minor: 'menor' },
    short: { critical: 'C', major: 'M', minor: 'm' },
    cat: { scope: 'Alcance', done_criteria: 'Criterio de hecho', risk: 'Riesgo', contradiction: 'Contradicción', gap: 'Hueco' },
    fate: { applied: 'aplicada en v{v}', resolved: 'resuelta en la entrevista', dismissed: 'descartada', rewritten: 'reescrita', pending: 'pendiente' },
    fateKey: { applied: 'aplicadas', resolved: 'resueltas', dismissed: 'descartadas', rewritten: 'reescritas', pending: 'pendientes' },
    diff: { changed: 'cambió', added: 'nueva', removed: 'quitada' },
  },
};
const langOf = (loc: string | undefined): string => (loc ?? 'en').toLowerCase().split(/[-_]/)[0];
const dictFor = (loc: string | undefined): Dict => {
  const key = langOf(loc);
  return Object.hasOwn(DICT, key) ? DICT[key] : DICT.en;
};
const fill = (t: string, vars: Record<string, string | number>): string => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
const pad = (n: number): string => String(n).padStart(2, '0');
const minutes = (words: number): number => Math.max(1, Math.round(words / 200));

/** K3-09: the status badge: draft, approved, approved · amended, or parked. */
function badge(data: DesignPageData, d: Dict): string {
  const key: StatusKey = data.status === 'approved' ? (data.amended ? 'amended' : 'approved') : data.status === 'parked' ? 'parked' : 'draft';
  return `<span class="badge st-${key}">${esc(d.status[key])}</span>`;
}

/**
 * K3-09: what the shown version changed against the one before: «cambió §a · nueva §b · quitada §c»;
 * carry 9: against which earlier version, when the history lacks the one right before it.
 */
function diffLine(diff: VersionDiff | null | undefined, d: Dict): string {
  if (!diff) return '';
  const name = (heading: string) => `§${heading === '_intro' ? d.intro : heading}`;
  const parts: [string, string[]][] = [[d.diff.changed, diff.changed], [d.diff.added, diff.added], [d.diff.removed, diff.removed]];
  const text = [
    ...parts.filter(([, list]) => list.length).map(([word, list]) => `${word} ${list.map(name).join(', ')}`),
    ...(diff.against !== undefined ? [d.gap.replace('{v}', String(diff.against))] : []),
  ].join(' · ');
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

/** Carry 10: a section's label is a real heading, and the section is named by it. */
const label = (id: string, text: string): string => `<h2 class="lbl" id="${id}">${esc(text)}</h2>`;

/** The rounds open at first: the latest one. */
function latestOpen(data: DesignPageData): Set<number> {
  const crits = data.critiques ?? [];
  return new Set(crits.length ? [crits[crits.length - 1].round] : []);
}

/** The headings of a version, numbered as the page numbers them: `01`, `02`… and `2.1` for a `###`. */
interface Numbered { entry: TocEntry; no: string; children: Numbered[] }
function numbered(toc: TocEntry[]): Numbered[] {
  const out: Numbered[] = [];
  let h2 = 0;
  let h3 = 0;
  for (const entry of toc) {
    if (entry.level === 2) { h2++; h3 = 0; out.push({ entry, no: pad(h2), children: [] }); continue; }
    h3++;
    const item = { entry, no: `${h2}.${h3}`, children: [] };
    if (out.length) out[out.length - 1].children.push(item); else out.push(item);
  }
  return out;
}

const changeLabel = (t: TocEntry, d: Dict, v: number): string => (t.change === 'added' ? d.addedIn : d.changedIn).replace('{v}', String(v));

/** The article: the version's HTML with the headings this version added or changed marked for the page. */
function article(html: string, toc: TocEntry[], d: Dict, v: number): string {
  let out = html;
  for (const t of toc) {
    if (!t.change) continue;
    const open = `<h${t.level} id="${esc(t.slug)}">`;
    out = out.replace(open, () => `<h${t.level} id="${esc(t.slug)}" data-change="${t.change}" data-label="${esc(changeLabel(t, d, v))}">`);
  }
  return out;
}

/** The section picker of the bar: every heading, numbered, with its words and whether this version touched it. */
function sectionList(items: Numbered[], d: Dict, fmt: Intl.NumberFormat): string {
  const link = (n: Numbered) => `<a href="#${esc(n.entry.slug)}" data-slug="${esc(n.entry.slug)}"${n.entry.change ? ` class="chg-${n.entry.change}"` : ''}><span class="no">${esc(n.no)}</span><span class="t">${esc(n.entry.heading)}</span><span class="w">${esc(fmt.format(n.entry.words))}</span></a>`;
  const list = items.map(n => `<li class="l${n.entry.level}">${link(n)}${n.children.length ? `<ol>${n.children.map(c => `<li class="l3">${link(c)}</li>`).join('')}</ol>` : ''}</li>`).join('');
  return `<nav class="sn-list" aria-labelledby="wp-l-toc">${label('wp-l-toc', d.toc)}<ol>${list}</ol></nav>`;
}

/** The map of the document: a card per `##` with its number, lead, size against the longest section and its change. */
function docMap(items: Numbered[], words: number, d: Dict, fmt: Intl.NumberFormat, v: number): string {
  const top = items.filter(n => n.entry.level === 2);
  if (!top.length) return '';
  const max = Math.max(...top.map(n => n.entry.words), 1);
  const changed = top.filter(n => n.entry.change).length;
  const cards = top.map(n => {
    const t = n.entry;
    const meta = [fill(d.wordsN, { n: fmt.format(t.words) }), ...(n.children.length ? [fill(d.subsections, { n: n.children.length })] : [])].join(' · ');
    return `<li><a class="card" href="#${esc(t.slug)}" data-slug="${esc(t.slug)}"><span class="no">${esc(n.no)}</span><b>${esc(t.heading)}</b>${t.lead ? `<span class="ld">${esc(t.lead)}</span>` : ''}<span class="sz"><i style="--f:${(t.words / max).toFixed(3)}"></i></span><span class="cm">${esc(meta)}${t.change ? `<span class="chip ${t.change}">${esc(changeLabel(t, d, v))}</span>` : ''}</span></a></li>`;
  }).join('');
  const sum = fill(d.mapSum, { s: top.length, w: fmt.format(words), m: minutes(words) });
  return `<section class="map" aria-labelledby="wp-l-map"><div class="map-h">${label('wp-l-map', d.map)}<p class="map-sum">${esc(sum)}${changed ? ` · <span class="chip changed">${esc(fill(d.changedIn, { v }))}: ${changed}</span>` : ''}</p></div><ol class="cards">${cards}</ol></section>`;
}

/** K3-09: proposals per round, stacked by severity: whether the critic is converging. */
function roundsChart(crits: PageCritique[], d: Dict): string {
  const H = 140;
  const totals = crits.map(c => c.proposals.length);
  const max = Math.max(...totals, 1);
  const cols = crits.map(c => {
    const counts = SEVS.map(s => c.proposals.filter(p => p.severity === s).length);
    const tip = `${d.round} ${c.round} · v${c.version} · ${SEVS.map((s, i) => `${counts[i]} ${d.sev[s]}`).join(', ')} · ${d.verdict[c.verdict]}`;
    const segs = SEVS.map((s, i) => (counts[i] ? `<i class="sv-${s}" style="height:${Math.max(3, Math.round((counts[i] / max) * H))}px"></i>` : '')).join('');
    return `<div class="col" title="${esc(tip)}"><span class="tot">${c.proposals.length}</span><span class="stk">${segs}</span><span class="x${c.verdict === 'ready' ? ' ready' : ''}">R${esc(c.round)}</span></div>`;
  }).join('');
  const key = SEVS.map(s => `<span class="sv-${s}">${esc(d.sev[s])}</span>`).join('');
  return `<figure class="viz"><figcaption><b>${esc(d.byRound)}</b><span class="key">${key}</span></figcaption><div class="cols" style="--h:${H}px">${cols}</div></figure>`;
}

/** K3-09: what became of the proposals shown, as one bar split by fate and its counts. */
function fatesChart(crits: PageCritique[], d: Dict, fmt: Intl.NumberFormat): string {
  const all = crits.flatMap(c => c.proposals);
  const counts = FATES.map(f => all.filter(p => p.fate === f).length);
  const total = all.length;
  const bar = total ? FATES.map((f, i) => (counts[i] ? `<i class="f-${f}" style="--g:${counts[i]}" title="${esc(`${d.fateKey[f]}: ${counts[i]}`)}"></i>` : '')).join('') : '<i class="f-empty" style="--g:1"></i>';
  const rows = FATES.map((f, i) => `<li class="f-${f}"><span class="sw"></span><span>${esc(d.fateKey[f])}</span><b>${esc(fmt.format(counts[i]))}</b></li>`).join('');
  return `<figure class="viz"><figcaption><b>${esc(d.fates)}</b><span class="key-n">${esc(fmt.format(total))} ${esc(d.proposals)}</span></figcaption><div class="fbar">${bar}</div><ul class="fkey">${rows}</ul></figure>`;
}

/** K3-09: each round, folded, newest first, with its verdict, its counts by severity and every proposal with its fate. */
function renderRounds(data: DesignPageData, d: Dict, open: ReadonlySet<number>, slugs: ReadonlySet<string>): string {
  const crits = data.critiques ?? [];
  if (!crits.length) return '';
  const items = [...crits].reverse().map(c => {
    const counts = SEVS.map(s => `${c.proposals.filter(p => p.severity === s).length} ${d.short[s]}`).join(' · ');
    const list = c.proposals.length
      ? `<ol class="props">${c.proposals.map(p => {
        const cat = Object.hasOwn(d.cat, p.category) ? d.cat[p.category] : p.category;
        const name = esc(sectionName(data, c, p.section, d));
        const sec = slugs.has(p.section) ? `<a class="sec" href="#${esc(p.section)}" data-slug="${esc(p.section)}">${name}</a>` : `<b class="sec">${name}</b>`;
        return `<li class="pp sv-${esc(p.severity)}"><div class="pp-h"><span class="sev">${esc(d.sev[p.severity])}</span><span class="cat">${esc(cat)}</span>${sec}<span class="fate f-${esc(p.fate)}">${esc(fateText(p, d))}</span></div><div class="pp-p"><span class="lbl">${esc(d.problem)}</span><p>${esc(p.problem)}</p></div><div class="pp-c"><span class="lbl">${esc(d.change)}</span><p>${esc(p.change)}</p></div></li>`;
      }).join('')}</ol>`
      : `<p class="none">${esc(d.none)}</p>`;
    const version = `v${esc(c.version)}${c.unknownVersion ? ` (${esc(d.unknownVersion)})` : ''}`;
    return `<details class="rd" data-round="${esc(c.round)}"${open.has(c.round) ? ' open' : ''}><summary><b>${esc(d.round)} ${esc(c.round)}</b><span>${version}</span><span class="vd vd-${esc(c.verdict)}">${esc(d.verdict[c.verdict])}</span><span class="cnt">${esc(counts)}</span></summary>${moreLine(d.moreProposals, c.proposalsMore)}${list}</details>`;
  }).join('');
  return `<section class="rounds" aria-labelledby="wp-l-rounds">${label('wp-l-rounds', d.rounds)}${moreLine(d.moreRounds, data.critiquesMore)}${items}</section>`;
}

function reviewPanel(data: DesignPageData, d: Dict, open: ReadonlySet<number>, slugs: ReadonlySet<string>, fmt: Intl.NumberFormat): string {
  const crits = data.critiques ?? [];
  if (!crits.length) return `<p class="empty">${esc(d.noRounds)}</p>`;
  const last = crits[crits.length - 1];
  const total = crits.reduce((n, c) => n + c.proposals.length, 0);
  const facts = [
    [d.rounds, fmt.format(data.rounds), ''],
    [d.proposals, fmt.format(total), ''],
    [d.pending, fmt.format(data.pending ?? 0), (data.pending ?? 0) > 0 ? ' hot' : ''],
    [d.lastVerdict, d.verdict[last.verdict], ` vd-${last.verdict}`],
  ].map(([k, v, cls]) => `<div><dt>${esc(k)}</dt><dd class="${cls.trim()}">${esc(v)}</dd></div>`).join('');
  return `<dl class="rv-facts">${facts}</dl><div class="rv-top">${roundsChart(crits, d)}${fatesChart(crits, d, fmt)}</div>${renderRounds(data, d, open, slugs)}`;
}

/** The versions as columns by their words, coloured by what made them, then the changelog, newest first. */
function historyPanel(data: DesignPageData, d: Dict, shown: number, fmt: Intl.NumberFormat): string {
  const H = 120;
  const embedded = new Set(data.versions.map(v => v.version));
  const all = [
    ...(data.earlier ?? []).map(e => ({ version: e.version, date: e.date, note: e.note, words: e.words, kind: e.kind, diff: null as VersionDiff | null })),
    ...data.versions.map(v => ({ version: v.version, date: v.date, note: v.note, words: v.words, kind: v.kind, diff: v.diff })),
  ];
  const max = Math.max(...all.map(v => v.words), 1);
  const kindOf = (k: EntryKind | null | undefined): KindKey => k ?? 'unknown';
  const cols = all.map(v => {
    const k = kindOf(v.kind);
    const tip = `v${v.version}${v.date ? ` · ${v.date}` : ''} · ${d.kinds[k]} · ${fmt.format(v.words)} ${d.wordsShort}`;
    const bar = `<span class="stk"><i class="${KIND_CLASS[k]}" style="height:${Math.max(3, Math.round((v.words / max) * H))}px"></i></span>`;
    const inner = `<span class="tot">${esc(fmt.format(v.words))}</span>${bar}<span class="x">v${esc(v.version)}</span>`;
    return embedded.has(v.version)
      ? `<button type="button" class="col${v.version === shown ? ' on' : ''}" data-version="${esc(v.version)}" data-to="doc" title="${esc(tip)}">${inner}</button>`
      : `<div class="col past" title="${esc(tip)}">${inner}</div>`;
  }).join('');
  const kinds = [...new Set(all.map(v => kindOf(v.kind)))];
  const key = kinds.map(k => `<span class="${KIND_CLASS[k]}">${esc(d.kinds[k])}</span>`).join('');
  const list = [...all].reverse().map(v => {
    const k = kindOf(v.kind);
    const head = embedded.has(v.version)
      ? `<button type="button" class="hs-v" data-version="${esc(v.version)}" data-to="doc">v${esc(v.version)}</button>`
      : `<b class="hs-v">v${esc(v.version)}</b>`;
    return `<li>${head}<div><p class="hs-m"><span class="kd ${KIND_CLASS[k]}">${esc(d.kinds[k])}</span>${v.date ? `<span>${esc(v.date)}</span>` : ''}<span>${esc(fill(d.wordsN, { n: fmt.format(v.words) }))}</span>${v.version === data.current ? `<span class="chip changed">${esc(d.current)}</span>` : ''}</p>${v.note ? `<p class="hs-n">${esc(v.note)}</p>` : ''}${diffLine(v.diff, d)}</div></li>`;
  }).join('');
  return `<figure class="viz evo"><figcaption><b>${esc(d.evolution)}</b><span class="key">${key}</span></figcaption><div class="cols" style="--h:${H}px">${cols}</div></figure>${(data.earlier ?? []).length ? `<p class="more">${esc(d.earlier)}: v${esc(data.earlier![0].version)}–v${esc(data.earlier![data.earlier!.length - 1].version)}</p>` : ''}<ol class="hs-list">${list}</ol>`;
}

export function renderDesignPage(data: DesignPageData, version: number, open: ReadonlySet<number> = latestOpen(data), tab: Tab = 'doc'): string {
  const d = dictFor(data.meta.locale);
  const fmt = new Intl.NumberFormat(langOf(data.meta.locale) === 'es' ? 'es-ES' : 'en-US');
  const v = data.versions.find(x => x.version === version) ?? data.versions[data.versions.length - 1];
  const no = v?.version ?? data.current;
  const toc = v?.toc ?? [];
  const items = numbered(toc);
  const words = v?.words ?? data.words;
  const slugs = new Set(toc.map(t => t.slug));
  // K3-11: each version button says whether it is the one shown.
  const vers = data.versions.map(x => {
    const on = x.version === no;
    return `<button type="button" class="v${on ? ' on' : ''}" data-version="${esc(x.version)}" aria-pressed="${on}">v${esc(x.version)}${x.version === data.current ? ` · ${esc(d.current)}` : ''}</button>`;
  }).join('');
  const facts = [
    [d.version, `v${no}`, ''],
    [d.sections, fmt.format(items.filter(n => n.entry.level === 2).length), ''],
    [d.words, fmt.format(words), ''],
    [d.reading, fill(d.minutes, { m: minutes(words) }), ''],
    [d.rounds, fmt.format(data.rounds), ''],
    [d.pending, fmt.format(data.pending ?? 0), (data.pending ?? 0) > 0 ? 'hot' : ''],
  ].map(([k, val, cls]) => `<div><dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ''}>${esc(val)}</dd></div>`).join('');
  const pillars = data.meta.pillars.map(p => `<div class="p"><b>${esc(p.title)}</b><span>${esc(p.text)}</span></div>`).join('');
  const strip = items.filter(n => n.entry.level === 2)
    .map(n => `<span class="seg" data-slug="${esc(n.entry.slug)}" style="--g:${Math.max(1, n.entry.words)}" title="${esc(`${n.no} ${n.entry.heading}`)}"><i></i></span>`).join('');
  const old = no !== data.current
    ? `<div class="old"><p>${esc(fill(d.old, { v: no, date: v?.date ? ` (${v.date})` : '' }))}</p><button type="button" class="go" data-version="${esc(data.current)}">${esc(fill(d.goCurrent, { v: data.current }))}</button></div>`
    : '';
  const count = { doc: '', review: data.rounds ? `<span class="n">${esc(data.rounds)}</span>` : '', history: `<span class="n">${esc(data.current)}</span>` };
  const tabs = TABS.map(t => `<button type="button" role="tab" class="tab" id="wp-t-${t}" data-tab="${t}" aria-controls="wp-p-${t}" aria-selected="${t === tab}" tabindex="${t === tab ? 0 : -1}">${esc(d.tabs[t])}${count[t]}</button>`).join('');
  const panel = (t: Tab, inner: string) => `<div class="panel" id="wp-p-${t}" role="tabpanel" aria-labelledby="wp-t-${t}" tabindex="-1"${t === tab ? '' : ' hidden'}><div class="wrap">${inner}</div></div>`;
  const first = items.find(n => n.entry.level === 2);
  return `<header class="hero"><div class="wrap hero-in">
<div class="hero-main">
<div class="eb">${esc(d.eyebrow)}${v?.date ? ` · ${esc(v.date)}` : ''}${badge(data, d)}</div>
<h1>${esc(data.meta.title)}<span class="dot">.</span></h1>
${data.meta.source ? `<p class="imp">${esc(d.imported)} <code>${esc(data.meta.source)}</code></p>\n` : ''}<p class="lead">${esc(data.meta.summary)}</p>
</div>
<div class="hero-side">
<dl class="met">${facts}</dl>
<section class="vers" aria-labelledby="wp-l-versions">${label('wp-l-versions', d.versions)}<div class="vl">${vers}</div>${diffLine(v?.diff, d)}${v?.note ? `<p class="note">${esc(v.note)}</p>` : ''}</section>
<section class="pr" aria-labelledby="wp-l-prompt"><div>${label('wp-l-prompt', d.prompt)}<code>${esc(data.meta.start_prompt)}</code></div><button type="button" class="cp" data-action="copy">${esc(d.copy)}</button></section>
<p class="src"><span>${esc(d.source)}</span> <code>${esc(data.source)}</code></p>
</div>
</div></header>
<div class="bar"><div class="wrap bar-in">
<div class="tabs" role="tablist" aria-label="${esc(d.views)}">${tabs}</div>
${items.length ? `<details class="secnav"${tab === 'doc' ? '' : ' hidden'}><summary><span class="sn-l">${esc(d.sections)}</span><span class="sn-cur">${first ? `<span class="no">${esc(first.no)}</span>${esc(first.entry.heading)}` : esc(d.intro)}</span></summary>${sectionList(items, d, fmt)}</details>` : ''}
</div>${strip ? `<div class="wrap strip-w"${tab === 'doc' ? '' : ' hidden'}><div class="strip" aria-hidden="true">${strip}</div></div>` : ''}</div>
<main>
${panel('doc', `${old}${pillars ? `<section class="pil" aria-label="${esc(d.pillars)}">${pillars}</section>` : ''}${docMap(items, words, d, fmt, no)}<article class="body">${article(v?.html ?? '', toc, d, no)}</article>`)}
${panel('review', reviewPanel(data, d, open, slugs, fmt))}
${panel('history', historyPanel(data, d, no, fmt))}
</main>`;
}

/**
 * The Mermaid build the page loads when the version shown has diagrams. The artifact viewer does not draw the
 * ```mermaid blocks of this page (the page writes its document from its data), so the page draws them itself.
 */
export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';
export interface Mermaid {
  initialize(config: Record<string, unknown>): void;
  parse(text: string, opts: { suppressErrors: true }): Promise<unknown>;
  run(opts: { nodes: HTMLElement[] }): Promise<unknown>;
}

function loadMermaid(doc: Document): Promise<Mermaid> {
  const win = doc.defaultView as (Window & { mermaid?: Mermaid }) | null;
  if (win?.mermaid) return Promise.resolve(win.mermaid);
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = MERMAID_URL;
    s.async = true;
    s.onload = () => (win?.mermaid ? resolve(win.mermaid) : reject(new Error('mermaid did not load')));
    s.onerror = () => reject(new Error('mermaid did not load'));
    doc.head.appendChild(s);
  });
}

/** Mermaid's base theme painted with the page's tokens, so a diagram follows the reader's light or dark theme. */
export function mermaidConfig(doc: Document): Record<string, unknown> {
  const css = doc.defaultView?.getComputedStyle(doc.documentElement);
  const token = (name: string) => css?.getPropertyValue(`--${name}`).trim() || undefined;
  const base = /^#([0-9a-f]{6})$/i.exec(token('base') ?? '')?.[1];
  const dark = base ? [0, 2, 4].reduce((s, i) => s + parseInt(base.slice(i, i + 2), 16), 0) / 3 < 128 : true;
  const vars: Record<string, string | boolean> = { darkMode: dark, fontSize: '15px' };
  for (const [key, name] of [
    ['background', 'mantle'], ['primaryColor', 'base'], ['primaryTextColor', 'text'], ['primaryBorderColor', 's2'], ['lineColor', 'o1'],
    ['secondaryColor', 's0'], ['tertiaryColor', 'crust'], ['edgeLabelBackground', 'mantle'], ['clusterBkg', 'base'], ['clusterBorder', 's1'],
    ['noteBkgColor', 's0'], ['noteTextColor', 'text'], ['noteBorderColor', 's2'], ['actorBkg', 'base'], ['actorBorder', 's2'], ['actorTextColor', 'text'],
    ['signalColor', 'sub1'], ['signalTextColor', 'text'], ['labelBoxBkgColor', 's0'], ['labelTextColor', 'text'],
  ] as const) {
    const v = token(name);
    if (v) vars[key] = v;
  }
  return { startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: "'IBM Plex Sans', system-ui, sans-serif", themeVariables: vars };
}

export function mountDesignPage(root: HTMLElement, data: DesignPageData, deps: { copy?: (t: string) => Promise<void>; mermaid?: () => Promise<Mermaid> } = {}): void {
  const d = dictFor(data.meta.locale);
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  // K3-11: the document says its language (screen readers, hyphenation).
  doc.documentElement.lang = data.meta.locale || 'en';
  const open = latestOpen(data);
  let shown = data.current;
  let tab: Tab = 'doc';
  // Carry 10: a version switch repaints the whole page, so a live region outside it tells a screen reader what shows.
  const live = doc.createElement('div');
  live.className = 'sr';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  root.after(live);

  // Diagrams: Mermaid loads the first time the document view shows one, and draws one diagram at a time in the page's
  // theme. A diagram whose source does not parse stays as its source, with a line that says so; `redraw` paints the
  // drawn ones again from their source (the theme changed).
  let mermaid: Promise<Mermaid> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const drawDiagrams = (redraw = false) => {
    if (tab !== 'doc') return;
    const all = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid'));
    if (!all.length) return;
    for (const n of all) {
      if (n.dataset.src === undefined) n.dataset.src = n.textContent ?? '';
      if (redraw && n.hasAttribute('data-processed')) { n.removeAttribute('data-processed'); n.textContent = n.dataset.src; }
    }
    mermaid ??= (deps.mermaid ?? (() => loadMermaid(doc)))();
    const loaded = mermaid;
    queue = queue.then(() => loaded).then(async m => {
      await doc.fonts?.ready;
      m.initialize(mermaidConfig(doc));
      for (const n of all) {
        if (!n.isConnected || n.hasAttribute('data-processed') || n.hasAttribute('data-bad')) continue;
        if (await m.parse(n.dataset.src ?? '', { suppressErrors: true }) === false) { n.setAttribute('data-bad', d.badDiagram); continue; }
        await m.run({ nodes: [n] });
        // Never narrower than it reads well: on a phone a wide diagram scrolls in its box instead of shrinking.
        const svg = n.querySelector('svg');
        const width = svg?.viewBox?.baseVal?.width;
        if (svg && width) svg.style.minWidth = `${Math.round(Math.min(width, 680))}px`;
      }
    }).catch(() => { if (mermaid === loaded) mermaid = null; /* the source stays readable */ });
  };

  // Where the reader is: the strip under the bar fills section by section, and the picker names the current heading.
  let frame = 0;
  const track = () => {
    frame = 0;
    if (tab !== 'doc') return;
    const heads = Array.from(root.querySelectorAll<HTMLElement>('.body h2[id], .body h3[id]'));
    const bar = root.querySelector('.bar') as HTMLElement | null;
    const y = (bar?.getBoundingClientRect().bottom ?? 0) + 16;
    let cur: HTMLElement | null = null;
    for (const h of heads) { if (h.getBoundingClientRect().top <= y) cur = h; else break; }
    const h2s = heads.filter(h => h.tagName === 'H2');
    const end = (root.querySelector('.body') as HTMLElement | null)?.getBoundingClientRect().bottom ?? 0;
    h2s.forEach((h, i) => {
      const top = h.getBoundingClientRect().top;
      const next = i + 1 < h2s.length ? h2s[i + 1].getBoundingClientRect().top : end;
      const p = next > top ? Math.min(1, Math.max(0, (y - top) / (next - top))) : 0;
      (root.querySelector(`.seg[data-slug="${h.id}"]`) as HTMLElement | null)?.style.setProperty('--p', p.toFixed(3));
    });
    const slug = cur?.id ?? '';
    for (const a of Array.from(root.querySelectorAll('.sn-list a[data-slug]'))) {
      if (a.getAttribute('data-slug') === slug) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
    const named = root.querySelector('.sn-cur');
    const link = slug ? root.querySelector(`.sn-list a[data-slug="${slug}"]`) : null;
    if (named && link) named.innerHTML =`<span class="no">${esc(link.querySelector('.no')?.textContent)}</span>${esc(link.querySelector('.t')?.textContent)}`;
  };
  const schedule = () => { if (!frame) frame = win?.requestAnimationFrame ? win.requestAnimationFrame(track) : (track(), 0); };

  const paint = (focus?: string) => {
    root.innerHTML = renderDesignPage(data, shown, open, tab);
    // K3-11: repainting keeps the focus on the control that was pressed.
    if (focus) (root.querySelector(focus) as HTMLElement | null)?.focus();
    schedule();
    drawDiagrams();
  };

  const setTab = (next: Tab, focus = false) => {
    tab = next;
    for (const t of TABS) {
      const btn = root.querySelector(`#wp-t-${t}`) as HTMLElement | null;
      btn?.setAttribute('aria-selected', String(t === next));
      btn?.setAttribute('tabindex', t === next ? '0' : '-1');
      const p = root.querySelector(`#wp-p-${t}`) as HTMLElement | null;
      if (p) p.hidden = t !== next;
    }
    const nav = root.querySelector('.secnav') as HTMLDetailsElement | null;
    if (nav) { nav.hidden = next !== 'doc'; nav.open = false; }
    const strip = root.querySelector('.strip-w') as HTMLElement | null;
    if (strip) strip.hidden = next !== 'doc';
    if (focus) (root.querySelector(`#wp-t-${next}`) as HTMLElement | null)?.focus();
    schedule();
    drawDiagrams();
  };

  const goTo = (slug: string) => {
    if (tab !== 'doc') setTab('doc');
    const nav = root.querySelector('.secnav') as HTMLDetailsElement | null;
    if (nav) nav.open = false;
    const target = doc.getElementById(slug);
    if (!target || !root.contains(target)) return;
    const still = win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView?.({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    target.setAttribute('tabindex', '-1');
    target.focus?.({ preventScroll: true });
  };

  paint();
  // A diagram follows the theme: the reader's system setting, or the viewer's explicit choice on the root element.
  win?.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => drawDiagrams(true));
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => drawDiagrams(true)).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const hash = win?.location?.hash?.slice(1);
  if (hash && /^[a-z0-9-]+$/.test(hash) && doc.getElementById(hash)) win?.setTimeout?.(() => goTo(hash), 0);

  // A round the person opens or closes stays so when the version changes (toggle does not bubble: capture it).
  root.addEventListener('toggle', ev => {
    const el = ev.target as HTMLElement | null;
    const round = Number(el?.dataset?.round);
    if (!el || !Number.isInteger(round) || round <= 0) return;
    if (el.hasAttribute('open')) open.add(round); else open.delete(round);
  }, true);

  root.addEventListener('click', ev => {
    const t = ev.target as Element | null;
    const tabBtn = t?.closest('[data-tab]') as HTMLElement | null;
    if (tabBtn) { setTab(tabBtn.dataset.tab as Tab); return; }
    const ver = t?.closest('[data-version]') as HTMLElement | null;
    if (ver) {
      const n = Number(ver.dataset.version);
      shown = n;
      const toDoc = ver.dataset.to === 'doc' || ver.classList.contains('go');
      if (toDoc) tab = 'doc';
      paint(toDoc ? '#wp-p-doc' : `.vl [data-version="${n}"]`);
      if (toDoc) (root.querySelector('.bar') as HTMLElement | null)?.scrollIntoView?.({ block: 'start' });
      live.textContent = `${d.shown.replace('{v}', String(n))}${n === data.current ? ` · ${d.current}` : ''}`;
      return;
    }
    const jump = t?.closest('[data-slug]') as HTMLElement | null;
    if (jump) { ev.preventDefault(); goTo(jump.dataset.slug ?? ''); return; }
    const cp = t?.closest('[data-action="copy"]') as HTMLElement | null;
    if (!cp) return;
    const copy = deps.copy ?? ((s: string) => navigator.clipboard.writeText(s));
    Promise.resolve().then(() => copy(data.meta.start_prompt)).then(() => {
      cp.textContent = d.copied;
      setTimeout(() => { if (cp.isConnected) cp.textContent = d.copy; }, 1500);
    }, () => {
      const code = root.querySelector('.pr code');
      if (code) { const r = doc.createRange(); r.selectNodeContents(code); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    });
  });

  // The tabs move with the arrow keys, Home and End; Escape closes the section picker.
  root.addEventListener('keydown', ev => {
    const t = ev.target as Element | null;
    if (ev.key === 'Escape') {
      const nav = root.querySelector('.secnav') as HTMLDetailsElement | null;
      if (nav?.open) { nav.open = false; (nav.querySelector('summary') as HTMLElement | null)?.focus(); }
      return;
    }
    if (!t?.closest('[role="tablist"]')) return;
    const i = TABS.indexOf(tab);
    const next = ev.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : ev.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length]
      : ev.key === 'Home' ? TABS[0] : ev.key === 'End' ? TABS[TABS.length - 1] : null;
    if (!next) return;
    ev.preventDefault();
    setTab(next, true);
  });

  win?.addEventListener('scroll', schedule, { passive: true });
  win?.addEventListener('resize', schedule);
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
