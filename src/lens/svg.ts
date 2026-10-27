// lens on the desktop: each section is one SVG card (a header, then blocks: bars, task cells, forge's stages,
// agent rows), coloured from the roadmap's palette and following the light or dark scheme. CSS animations only
// (a sheen on running bars, active cells breathing, spinners), stopped under prefers-reduced-motion.
import { PALETTE, LATTE, STATE_HUE, type CellState, type Hue, type Stage } from './view.js';

const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const MONO = "ui-monospace,'SF Mono','Cascadia Code',Consolas,monospace";

export const xml = (s: string): string =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Roughly how wide a text draws, so long ones are cut with an ellipsis rather than overflowing the card.
const charW = (size: number) => size * 0.56;
export function fit(s: string, size: number, maxW: number): string {
  const max = Math.max(1, Math.floor(maxW / charW(size)));
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

const vars = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `--${k}:${v}`).join(';');
const STYLE = `<style>
svg{${vars(PALETTE)}}
@media (prefers-color-scheme: light){svg{${vars(LATTE)}}}
.t{fill:var(--text)}.m{fill:var(--sub)}.o{fill:var(--o0)}
.sheen{animation:sheen 2.4s cubic-bezier(.4,0,.2,1) infinite}
@keyframes sheen{0%{transform:translateX(-120px)}70%,100%{transform:translateX(var(--run,600px))}}
.breathe{animation:breathe 1.6s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:1}50%{opacity:.35}}
.glow{animation:glow 1.6s ease-in-out infinite}
@keyframes glow{0%,100%{opacity:.55}50%{opacity:0}}
.spin{animation:spin 1s linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.sheen,.breathe,.glow,.spin{animation:none}.sheen{display:none}}
</style>`;

const c = (hue: Hue) => `var(--${hue})`;

export type Block =
  | { kind: 'bar'; ratio: number; hue: Hue; label?: string; right?: string; moving?: boolean }
  | { kind: 'cells'; cells: CellState[] }
  | { kind: 'stages'; stages: Stage[]; hue: Hue }
  | { kind: 'row'; dot: Hue; text: string; right?: string; tag?: { text: string; hue: Hue }; spinning?: boolean; dim?: boolean; indent?: boolean }
  | { kind: 'text'; text: string; dim?: boolean; hue?: Hue }
  | { kind: 'chips'; chips: { text: string; hue: Hue }[] };

/** Which section a card is: the pane's cut leaves out the least important first (src/lens/layout.ts). */
export type CardId = 'unreadable' | 'now' | 'needs' | 'tasks' | 'execution' | 'roadmap' | 'agents' | 'superpowers' | 'todos' | 'ccTasks' | 'usage';
export interface Card { id?: CardId; icon: string; title: string; hue: Hue; chip?: { text: string; hue: Hue }; subtitle?: string; blocks: Block[] }

const PAD = 14;
const HEAD_H = 34;
const BAR_H = 10;
const CELL = 12;
const CELL_GAP = 4;

// The height each block takes at width `inner`, so the card's height is known before drawing.
function blockHeight(b: Block, inner: number): number {
  switch (b.kind) {
    case 'bar': return (b.label || b.right ? 18 : 0) + BAR_H + 10;
    case 'cells': {
      const per = Math.max(1, Math.floor((inner + CELL_GAP) / (CELL + CELL_GAP)));
      return Math.ceil(b.cells.length / per) * (CELL + CELL_GAP) + 6;
    }
    case 'stages': return 40;
    case 'row': return 24;
    case 'text': return 20;
    case 'chips': return 26;
  }
}

function drawBlock(b: Block, x: number, y: number, inner: number, id: string): string {
  switch (b.kind) {
    case 'bar': {
      let out = '';
      let top = y;
      if (b.label || b.right) {
        if (b.label) out += `<text class="m" x="${x}" y="${y + 12}" font-family="${FONT}" font-size="11.5">${xml(fit(b.label, 11.5, inner * 0.7))}</text>`;
        if (b.right) out += `<text class="t" x="${x + inner}" y="${y + 12}" text-anchor="end" font-family="${MONO}" font-size="11.5" font-weight="600">${xml(b.right)}</text>`;
        top += 18;
      }
      const w = Math.round(inner * Math.max(0, Math.min(1, b.ratio)));
      out += `<rect x="${x}" y="${top}" width="${inner}" height="${BAR_H}" rx="${BAR_H / 2}" style="fill:var(--s0)"/>`;
      if (w > 0) {
        out += `<defs><linearGradient id="g${id}" x1="0" x2="1"><stop offset="0" style="stop-color:${c(b.hue)};stop-opacity:.75"/><stop offset="1" style="stop-color:${c(b.hue)}"/></linearGradient>`
          + `<clipPath id="k${id}"><rect x="${x}" y="${top}" width="${w}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath>`
          + `<linearGradient id="s${id}" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`
          + `<rect x="${x}" y="${top}" width="${w}" height="${BAR_H}" rx="${BAR_H / 2}" fill="url(#g${id})"/>`;
        if (b.moving) out += `<g clip-path="url(#k${id})"><rect class="sheen" style="--run:${w + 140}px" x="${x}" y="${top}" width="80" height="${BAR_H}" fill="url(#s${id})"/></g>`;
      }
      return out;
    }
    case 'cells': {
      const per = Math.max(1, Math.floor((inner + CELL_GAP) / (CELL + CELL_GAP)));
      return b.cells.map((s, i) => {
        const cx = x + (i % per) * (CELL + CELL_GAP);
        const cy = y + Math.floor(i / per) * (CELL + CELL_GAP);
        const hue = STATE_HUE[s];
        const base = s === 'pending'
          ? `<rect x="${cx + 0.5}" y="${cy + 0.5}" width="${CELL - 1}" height="${CELL - 1}" rx="3" style="fill:none;stroke:var(--s2)"/>`
          : `<rect x="${cx}" y="${cy}" width="${CELL}" height="${CELL}" rx="3" style="fill:${c(hue)}"${s === 'active' ? ' class="breathe"' : ''}/>`;
        const halo = s === 'active' ? `<rect class="glow" x="${cx - 2}" y="${cy - 2}" width="${CELL + 4}" height="${CELL + 4}" rx="5" style="fill:none;stroke:${c(hue)};stroke-width:1.5"/>` : '';
        return `${base}${halo}<title>${s}</title>`;
      }).join('');
    }
    case 'stages': {
      const n = b.stages.length;
      const step = n > 1 ? inner / (n - 1) : 0;
      let out = `<line x1="${x + 6}" y1="${y + 9}" x2="${x + inner - 6}" y2="${y + 9}" style="stroke:var(--s1);stroke-width:2"/>`;
      const doneTo = b.stages.reduce((k, s, i) => (s.state !== 'pending' ? i : k), 0);
      if (doneTo > 0) out += `<line x1="${x + 6}" y1="${y + 9}" x2="${x + step * doneTo}" y2="${y + 9}" style="stroke:${c(b.hue)};stroke-width:2"/>`;
      b.stages.forEach((s, i) => {
        const cx = n > 1 ? x + step * i : x + inner / 2;
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        const tx = i === 0 ? cx - 6 : i === n - 1 ? cx + 6 : cx;
        const cxx = i === 0 ? cx + 6 : i === n - 1 ? cx - 6 : cx;
        if (s.state === 'done') out += `<circle cx="${cxx}" cy="${y + 9}" r="6" style="fill:${c(b.hue)}"/><path d="M${cxx - 3} ${y + 9}l2 2 4-4" style="fill:none;stroke:var(--base);stroke-width:1.6;stroke-linecap:round"/>`;
        else if (s.state === 'active') out += `<circle class="glow" cx="${cxx}" cy="${y + 9}" r="10" style="fill:${c(b.hue)}"/><circle cx="${cxx}" cy="${y + 9}" r="6.5" style="fill:${c(b.hue)}"/><circle cx="${cxx}" cy="${y + 9}" r="2.5" style="fill:var(--base)"/>`;
        else out += `<circle cx="${cxx}" cy="${y + 9}" r="5.5" style="fill:var(--base);stroke:var(--s2);stroke-width:1.5"/>`;
        out += `<text class="${s.state === 'pending' ? 'o' : 't'}" x="${tx}" y="${y + 32}" text-anchor="${anchor}" font-family="${FONT}" font-size="10.5"${s.state === 'active' ? ' font-weight="700"' : ''}>${xml(s.name)}</text>`;
      });
      return out;
    }
    case 'row': {
      let out = '';
      // An agent under its task is indented; a row of another session's work, or of a finished one, is dim.
      const left = b.indent ? x + 14 : x;
      const cy = y + 11;
      if (b.spinning) out += `<g class="spin"><circle cx="${left + 6}" cy="${cy}" r="5.5" style="fill:none;stroke:${c(b.dot)};stroke-width:2;stroke-dasharray:22 13;stroke-linecap:round"/></g>`;
      else out += `<circle cx="${left + 6}" cy="${cy}" r="4.5" style="fill:${c(b.dot)}"/>`;
      let tx = left + 18;
      if (b.tag) {
        const tw = Math.round(b.tag.text.length * charW(10.5) + 12);
        out += `<rect x="${tx}" y="${cy - 8}" width="${tw}" height="16" rx="8" style="fill:${c(b.tag.hue)};fill-opacity:.18;stroke:${c(b.tag.hue)};stroke-opacity:.6"/>`
          + `<text x="${tx + tw / 2}" y="${cy + 3.6}" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="600" style="fill:${c(b.tag.hue)}">${xml(b.tag.text)}</text>`;
        tx += tw + 8;
      }
      const rightW = b.right ? b.right.length * charW(11) + 10 : 0;
      out += `<text class="${b.dim ? 'm' : 't'}" x="${tx}" y="${cy + 4}" font-family="${FONT}" font-size="12">${xml(fit(b.text, 12, x + inner - tx - rightW))}</text>`;
      if (b.right) out += `<text class="m" x="${x + inner}" y="${cy + 4}" text-anchor="end" font-family="${MONO}" font-size="11">${xml(b.right)}</text>`;
      return out;
    }
    case 'text':
      return `<text class="${b.dim ? 'm' : 't'}"${b.hue ? ` style="fill:${c(b.hue)}"` : ''} x="${x}" y="${y + 14}" font-family="${FONT}" font-size="12">${xml(fit(b.text, 12, inner))}</text>`;
    case 'chips': {
      let cx = x;
      let out = '';
      for (const chip of b.chips) {
        const tw = Math.round(chip.text.length * charW(11) + 16);
        if (cx + tw > x + inner) break;
        out += `<rect x="${cx}" y="${y + 3}" width="${tw}" height="19" rx="9.5" style="fill:${c(chip.hue)};fill-opacity:.16;stroke:${c(chip.hue)};stroke-opacity:.55"/>`
          + `<text x="${cx + tw / 2}" y="${y + 16.5}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" style="fill:${c(chip.hue)}">${xml(chip.text)}</text>`;
        cx += tw + 6;
      }
      return out;
    }
  }
}

/** One section as an SVG card `W` pixels wide; returns the markup and its height. */
export function cardSvg(card: Card, W: number): { source: string; height: number } {
  // Each Svg is a document of its own, so fixed ids never collide and an unchanged card redraws identically.
  const id = 'l';
  const inner = W - PAD * 2;
  const heights = card.blocks.map(b => blockHeight(b, inner));
  const H = HEAD_H + (card.subtitle ? 16 : 0) + heights.reduce((a, b) => a + b, 0) + PAD - 4;
  let y = HEAD_H + (card.subtitle ? 16 : 0);
  const body = card.blocks.map((b, i) => {
    const out = drawBlock(b, PAD, y, inner, `${id}${i}`);
    y += heights[i];
    return out;
  }).join('');
  const chipW = card.chip ? Math.round(card.chip.text.length * charW(10.5) + 16) : 0;
  const head = `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" style="fill:var(--mantle);stroke:var(--s0)"/>`
    + `<rect x="0.5" y="0.5" width="4" height="${H - 1}" rx="2" style="fill:${c(card.hue)}"/>`
    + `<rect x="${PAD}" y="9" width="20" height="20" rx="6" style="fill:${c(card.hue)};fill-opacity:.18"/>`
    + `<text x="${PAD + 10}" y="23.5" text-anchor="middle" font-family="${FONT}" font-size="12" style="fill:${c(card.hue)}">${xml(card.icon)}</text>`
    + `<text class="t" x="${PAD + 28}" y="23.5" font-family="${FONT}" font-size="13" font-weight="700">${xml(fit(card.title, 13, inner - 40 - chipW))}</text>`
    + (card.chip
      ? `<rect x="${W - PAD - chipW}" y="10" width="${chipW}" height="18" rx="9" style="fill:${c(card.chip.hue)}"/>`
        + `<text x="${W - PAD - chipW / 2}" y="22.5" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="700" style="fill:var(--base)">${xml(card.chip.text)}</text>`
      : '')
    + (card.subtitle ? `<text class="m" x="${PAD}" y="${HEAD_H + 8}" font-family="${FONT}" font-size="11.5">${xml(fit(card.subtitle, 11.5, inner))}</text>` : '');
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${STYLE}${head}${body}</svg>`,
    height: H,
  };
}

/** The band's one row: icon, title, a bar with a sheen, the cells' count and the percentage. */
export function bandSvg(o: { W: number; icon: string; title: string; detail: string; hue: Hue; ratio: number; label: string; moving: boolean; cells: CellState[] }): { source: string; height: number } {
  const H = 30;
  const id = 'b';
  const titleW = Math.min(o.W * 0.32, Math.max(80, (o.title.length + 2) * charW(12.5)));
  const pctText = `${Math.round(o.ratio * 100)}%`;
  const right = 46;
  const barX = 30 + titleW + 10;
  const cellsW = o.cells.length ? Math.min(o.cells.length, 24) * 9 + 8 : 0;
  const detailW = o.detail ? Math.min(o.W * 0.22, o.detail.length * charW(11) + 10) : 0;
  const barW = Math.max(60, o.W - barX - right - cellsW - detailW - 10);
  const w = Math.round(barW * Math.max(0, Math.min(1, o.ratio)));
  const by = (H - 8) / 2;
  let s = `<circle cx="11" cy="${H / 2}" r="9" style="fill:${c(o.hue)};fill-opacity:.2"/>`
    + `<text x="11" y="${H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" style="fill:${c(o.hue)}">${xml(o.icon)}</text>`
    + `<text class="t" x="26" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="12.5" font-weight="600">${xml(fit(o.title, 12.5, titleW))}</text>`
    // Nothing to count yet (no tasks or briefs): no bar, just the title and the detail.
    + (o.cells.length ? `<rect x="${barX}" y="${by}" width="${barW}" height="8" rx="4" style="fill:var(--s0)"/>` : '');
  if (w > 0 && o.cells.length) {
    s += `<defs><linearGradient id="g${id}" x1="0" x2="1"><stop offset="0" style="stop-color:${c(o.hue)};stop-opacity:.7"/><stop offset="1" style="stop-color:${c(o.hue)}"/></linearGradient>`
      + `<clipPath id="k${id}"><rect x="${barX}" y="${by}" width="${w}" height="8" rx="4"/></clipPath>`
      + `<linearGradient id="s${id}" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`
      + `<rect x="${barX}" y="${by}" width="${w}" height="8" rx="4" fill="url(#g${id})"/>`;
    if (o.moving) s += `<g clip-path="url(#k${id})"><rect class="sheen" style="--run:${w + 140}px" x="${barX}" y="${by}" width="70" height="8" fill="url(#s${id})"/></g>`;
  }
  let x = barX + barW + 10;
  for (const st of o.cells.slice(0, 24)) {
    s += st === 'pending'
      ? `<rect x="${x + 0.5}" y="${H / 2 - 3.5}" width="6" height="7" rx="1.5" style="fill:none;stroke:var(--s2)"/>`
      : `<rect x="${x}" y="${H / 2 - 4}" width="7" height="8" rx="1.5" style="fill:${c(STATE_HUE[st])}"${st === 'active' ? ' class="breathe"' : ''}/>`;
    x += 9;
  }
  if (o.detail) s += `<text class="m" x="${x + 2}" y="${H / 2 + 4}" font-family="${FONT}" font-size="11">${xml(fit(o.detail, 11, detailW))}</text>`;
  s += `<text class="t" x="${o.W - 4}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="700">${xml(o.label || pctText)}</text>`;
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${o.W}" height="${H}" viewBox="0 0 ${o.W} ${H}">${STYLE}${s}</svg>`, height: H };
}
