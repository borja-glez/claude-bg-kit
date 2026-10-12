// Generates the animated SVGs used by the READMEs, in English and Spanish, from one set of templates.
// Run with `npm run art`; commit the SVGs it writes next to this file.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

// Catppuccin Mocha, the roadmap's and lens's palette.
const C = {
  crust: '#11111b', mantle: '#181825', base: '#1e1e2e', s0: '#313244', s1: '#45475a', s2: '#585b70', ov: '#7f849c',
  sub: '#a6adc8', text: '#cdd6f4', blue: '#89b4fa', peach: '#fab387', yellow: '#f9e2af', red: '#f38ba8', green: '#a6e3a1',
  mauve: '#cba6f7', teal: '#94e2d5', lav: '#b4befe', sky: '#89dceb', pink: '#f5c2e7',
};
const MONO = `ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace`;
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;

function svg(w, h, title, desc, css, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<style>
text{font-family:${SANS};fill:${C.text}}
.m{font-family:${MONO}}
.dim{fill:${C.sub}}
.faint{fill:${C.ov}}
.flow{stroke-dasharray:4 6;animation:dash 1s linear infinite}
.spin{transform-box:fill-box;transform-origin:center;animation:spin 1s linear infinite}
.blink{animation:blink 1.1s steps(1) infinite}
@keyframes dash{to{stroke-dashoffset:-20}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes blink{50%{opacity:0}}
${css}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
${body}
</svg>
`;
}

const text = (x, y, s, { size = 13, cls = '', fill, weight, anchor, extra = '' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}"${cls ? ` class="${cls}"` : ''}${fill ? ` style="fill:${fill}"` : ''}${weight ? ` font-weight="${weight}"` : ''}${anchor ? ` text-anchor="${anchor}"` : ''}${extra}>${esc(s)}</text>`;

const rect = (x, y, w, h, { rx = 8, fill = C.s0, stroke, sw = 1, extra = '' } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}${extra}/>`;

const arrowDefs = (colors) => `<defs>${Object.entries(colors).map(([k, c]) =>
  `<marker id="a-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')}</defs>`;

const window_ = (w, h, label) => [
  rect(0.5, 0.5, w - 1, h - 1, { rx: 14, fill: C.base, stroke: C.s0 }),
  `<path d="M0.5 14.5a14 14 0 0 1 14-14h${w - 29}a14 14 0 0 1 14 14v19.5h-${w - 1}z" fill="${C.mantle}"/>`,
  `<circle cx="20" cy="18" r="5.5" fill="${C.red}"/><circle cx="38" cy="18" r="5.5" fill="${C.yellow}"/><circle cx="56" cy="18" r="5.5" fill="${C.green}"/>`,
  text(w / 2, 22, label, { size: 12, cls: 'm dim', anchor: 'middle' }),
].join('\n');

// A bar that grows from `from` to `to` of its width over the cycle, holds, then starts over.
let barN = 0;
function growBar(x, y, w, h, color, from, to, cycle, { delay = 0, hold = 0.8 } = {}) {
  const id = `g${barN++}`;
  const css = `@keyframes ${id}{0%{transform:scaleX(${from})}${Math.round(hold * 100)}%{transform:scaleX(${to})}100%{transform:scaleX(${to})}}
.${id}{transform-box:fill-box;transform-origin:left center;animation:${id} ${cycle}s ease-in-out ${delay}s infinite both}`;
  const body = rect(x, y, w, h, { rx: h / 2, fill: C.s1 }) + rect(x, y, w, h, { rx: h / 2, fill: color, extra: ` class="${id}"` });
  return { css, body };
}

// Keyframes that light an element for `on` seconds once per cycle; each element passes its own delay.
const litCss = (name, cycle, on, from, to) => {
  const a = r1((0.25 / cycle) * 100), b = r1((on / cycle) * 100), c = r1(((on + 0.5) / cycle) * 100);
  return `@keyframes ${name}{0%{${from}}${a}%{${to}}${b}%{${to}}${c}%{${from}}100%{${from}}}`;
};

// Fades through states: each state is visible for 1/n of the cycle.
const statesCss = (cycle, n) => {
  const slot = 100 / n, f = r1(Math.min(3, slot / 6));
  return `@keyframes st{0%{opacity:0}${f}%{opacity:1}${r1(slot - f)}%{opacity:1}${r1(slot)}%{opacity:0}100%{opacity:0}}
.st{opacity:0;animation:st ${cycle}s infinite both}`;
};
const state = (i, cycle, n, inner) => `<g class="st" style="animation-delay:${r1((i * cycle) / n)}s">${inner}</g>`;

const btn = (x, y, label, { primary = false, size = 12 } = {}) => {
  const w = Math.round(label.length * size * 0.62 + 18);
  return {
    w,
    body: rect(x, y, w, 22, { rx: 6, fill: primary ? C.blue : C.s0, stroke: primary ? C.blue : C.s1 }) +
      text(x + w / 2, y + 15, label, { size, cls: 'm', anchor: 'middle', fill: primary ? C.crust : C.text, weight: primary ? 600 : undefined }),
  };
};
const buttons = (x, y, list) => {
  let cx = x;
  return list.map((b) => { const o = btn(cx, y, b.label, b); cx += o.w + 8; return o.body; }).join('');
};

// ───────────────────────── The full flow ─────────────────────────

function flow(t) {
  const W = 1000, H = 724, cycle = 20, step = 0.62;
  let i = 0;
  const nodes = [];
  const node = (x, y, w, h, label, sub, color) => {
    const d = r1(i++ * step);
    nodes.push(`<g>
${rect(x, y, w, h, { rx: 10, fill: C.s0 })}
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${color}" stroke="${color}" stroke-width="1.5" class="lit" style="animation-delay:${d}s"/>
${text(x + w / 2, sub ? y + 22 : y + h / 2 + 5, label, { size: 13, cls: 'm', anchor: 'middle', weight: 600 })}
${sub ? text(x + w / 2, y + 40, sub, { size: 11, cls: 'dim', anchor: 'middle' }) : ''}
</g>`);
    return d;
  };
  const arrow = (x1, y1, x2, y2, k) =>
    `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${C.s2}" stroke-width="1.5" fill="none" class="flow" marker-end="url(#a-${k})"/>`;
  const band = (y, h, num, title, chip, color) => {
    const cw = chip.length * 7 + 16;
    const tx = 76 + title.length * 8.6;
    return `${rect(32, y, 688, h, { rx: 12, fill: C.mantle, stroke: C.s0 })}
<circle cx="56" cy="${y + 20}" r="11" fill="${color}"/>${text(56, y + 24.5, num, { size: 12, anchor: 'middle', weight: 700, fill: C.crust })}
${text(76, y + 25, title, { size: 15, weight: 700 })}
${rect(tx, y + 11, cw, 19, { rx: 9.5, fill: 'none', stroke: color })}${text(tx + cw / 2, y + 24.5, chip, { size: 11, cls: 'm', anchor: 'middle', fill: color })}`;
  };

  const parts = [];
  // 1 · Design
  parts.push(band(92, 104, '1', t.design, 'waypoint', C.mauve));
  node(48, 128, 110, 52, t.idea, t.ideaSub, C.mauve);
  node(184, 128, 170, 52, '/waypoint:design', t.designSub, C.mauve);
  node(380, 128, 170, 52, 'design-critic', t.criticSub, C.mauve);
  node(576, 128, 130, 52, t.approve, t.approveSub, C.mauve);
  parts.push(arrow(160, 154, 182, 154, 'g'), arrow(356, 154, 378, 154, 'g'), arrow(552, 154, 574, 154, 'g'));
  // 2 · Plan
  parts.push(band(208, 104, '2', t.plan, 'waypoint · forge', C.blue));
  node(48, 244, 150, 52, 'forge-planner', t.plannerSub, C.blue);
  node(224, 244, 140, 52, 'plan.yaml', t.planSub, C.blue);
  node(390, 244, 150, 52, '/waypoint:plan', t.publishSub, C.blue);
  node(566, 244, 140, 52, t.roadmap, t.roadmapSub, C.blue);
  parts.push(arrow(200, 270, 222, 270, 'g'), arrow(366, 270, 388, 270, 'g'), arrow(542, 270, 564, 270, 'g'));
  // 3 · Build
  parts.push(band(324, 152, '3', t.build, '/forge:run', C.peach));
  const buildStart = r1(i * step);
  node(48, 360, 96, 52, 'triage', t.triageSub, C.peach);
  node(170, 360, 116, 52, t.implement, t.implementSub, C.peach);
  node(312, 360, 104, 52, t.validate, t.validateSub, C.peach);
  node(442, 360, 124, 52, t.review, t.reviewSub, C.peach);
  node(592, 360, 114, 52, t.verdict, t.verdictSub, C.peach);
  parts.push(arrow(146, 386, 168, 386, 'g'), arrow(288, 386, 310, 386, 'g'), arrow(418, 386, 440, 386, 'g'), arrow(568, 386, 590, 386, 'g'));
  const loopD = r1(i * step);
  parts.push(`<path d="M649 414C649 450 228 450 228 416" stroke="${C.peach}" stroke-width="1.5" fill="none" class="flow" marker-end="url(#a-p)"/>`,
    `<g class="litT" style="animation-delay:${loopD}s">${text(438, 464, t.fixLoop, { size: 11, anchor: 'middle', fill: C.peach })}</g>`);
  i++;
  // 4 · Parallel
  parts.push(band(488, 122, '4', t.parallel, 'forge swarm tick', C.teal));
  node(48, 524, 130, 64, t.coordinator, 'forge swarm tick', C.teal);
  const fronts = [['T004', 5.5], ['T005', 8], ['T008', 6.5]];
  fronts.forEach(([name, dur], k) => {
    const y = 526 + k * 22;
    parts.push(text(206, y + 11, name, { size: 11, cls: 'm dim' }));
    parts.push(`<path d="M180 556L${200} ${y + 7}" stroke="${C.s2}" stroke-width="1" fill="none"/>`);
    const b = growBar(290, y + 3, 166, 8, C.teal, 0.05, 1, dur, { delay: k * 0.7, hold: 0.85 });
    css.push(b.css); parts.push(b.body);
    parts.push(`<path d="M458 ${y + 7}L480 556" stroke="${C.s2}" stroke-width="1" fill="none"/>`);
  });
  parts.push(text(373, 604, t.ownWorktree, { size: 10.5, cls: 'faint', anchor: 'middle' }));
  node(482, 524, 120, 64, t.integrate, t.integrateSub, C.teal);
  node(628, 524, 78, 64, 'main', t.mainSub, C.green);
  parts.push(arrow(604, 556, 626, 556, 'g'));
  // ∞ Infinite mode
  parts.push(`${rect(32, 622, 688, 86, { rx: 12, fill: C.mantle, stroke: C.s0 })}
${text(48, 646, `∞  ${t.infinite}`, { size: 15, weight: 700, fill: C.yellow })}${text(48 + (t.infinite.length + 3) * 8.6, 646, t.infiniteSub, { size: 11.5, cls: 'dim' })}`);
  node(48, 658, 120, 38, 'forge-scout', null, C.yellow);
  node(194, 658, 130, 38, t.proposals, null, C.yellow);
  node(350, 658, 130, 38, t.youDecide, null, C.yellow);
  node(506, 658, 120, 38, t.newTasks, null, C.yellow);
  parts.push(arrow(170, 677, 192, 677, 'g'), arrow(326, 677, 348, 677, 'g'), arrow(482, 677, 504, 677, 'g'));
  parts.push(`<path d="M628 677H713V440" stroke="${C.yellow}" stroke-width="1.5" fill="none" class="flow" marker-end="url(#a-y)"/>`);
  parts.push(text(668, 670, t.toBuild, { size: 10.5, anchor: 'middle', fill: C.yellow }));

  // lens, on the right
  const L = [];
  L.push(rect(744, 92, 224, 330, { rx: 12, fill: C.mantle, stroke: C.lav }));
  L.push(text(760, 117, '◉ lens', { size: 15, weight: 700, fill: C.lav }), text(952, 117, t.livePanel, { size: 11, cls: 'dim', anchor: 'end' }));
  L.push(text(760, 143, 'Opus 5.5 · ' + t.effortHigh, { size: 11.5, cls: 'm dim' }));
  // roadmap bar
  L.push(text(760, 170, 'Roadmap', { size: 12, weight: 600, fill: C.blue }));
  const rb = growBar(760, 178, 192, 8, C.blue, 0.15, 0.95, cycle, { hold: 0.9 }); css.push(rb.css); L.push(rb.body);
  // forge stages, lit with the Build nodes
  L.push(text(760, 210, 'forge · T7', { size: 12, weight: 600, fill: C.peach }));
  t.stages.forEach((s, k) => {
    const x = 760 + k * 39;
    L.push(rect(x, 218, 35, 18, { rx: 5, fill: C.s0 }),
      `<rect x="${x}" y="218" width="35" height="18" rx="5" fill="${C.peach}" stroke="${C.peach}" class="lit" style="animation-delay:${r1(buildStart + k * step)}s"/>`,
      text(x + 17.5, 231, s, { size: 9.5, cls: 'm', anchor: 'middle' }));
  });
  // subagents
  L.push(text(760, 262, t.subagents, { size: 12, weight: 600, fill: C.lav }));
  L.push(`<path d="M766 272a6 6 0 1 1 -6 6" stroke="${C.peach}" stroke-width="2" fill="none" class="spin"/>`,
    text(778, 282, 'impl · Opus 5.5 · medium', { size: 11, cls: 'm' }));
  L.push(`<path d="M766 292a6 6 0 1 1 -6 6" stroke="${C.blue}" stroke-width="2" fill="none" class="spin"/>`,
    text(778, 302, 'review · Opus 5.5 · xhigh', { size: 11, cls: 'm' }));
  // usage
  L.push(text(760, 330, t.usage, { size: 12, weight: 600, fill: C.teal }), text(952, 330, '1.84M tok · $6.20', { size: 11, cls: 'm', anchor: 'end' }));
  const seg = [[0.5, C.lav], [0.2, C.green], [0.2, C.blue], [0.06, C.mauve], [0.04, C.yellow]];
  let sx = 760;
  for (const [f, c] of seg) { L.push(rect(sx, 338, 192 * f - 1, 8, { rx: 2, fill: c })); sx += 192 * f; }
  L.push(text(760, 364, t.withoutForge, { size: 10.5, cls: 'dim' }));
  L.push(text(760, 400, t.lensObserves, { size: 10.5, cls: 'faint' }));
  // roadmap artifact
  L.push(rect(744, 434, 224, 176, { rx: 12, fill: C.mantle, stroke: C.blue }));
  L.push(text(760, 459, 'Roadmap', { size: 15, weight: 700, fill: C.blue }), text(952, 459, 'claude.ai', { size: 11, cls: 'dim', anchor: 'end' }));
  const tracks = ['api', 'ui', 'data'];
  tracks.forEach((name, row) => {
    L.push(text(760, 488 + row * 26, name, { size: 11, cls: 'm dim' }));
    for (let k = 0; k < 8; k++) {
      const d = r1(buildStart + (row * 8 + k) * 0.45);
      L.push(`<rect x="${800 + k * 19}" y="${477 + row * 26}" width="14" height="14" rx="3" fill="${C.s1}" class="done" style="animation-delay:${d}s"/>`);
    }
  });
  L.push(text(760, 578, t.views1, { size: 10.5, cls: 'dim' }), text(760, 594, t.views2, { size: 10.5, cls: 'dim' }));
  // you
  L.push(rect(744, 622, 224, 86, { rx: 12, fill: C.mantle, stroke: C.yellow }));
  L.push(text(760, 646, t.you, { size: 15, weight: 700, fill: C.yellow }));
  t.youLines.forEach((s, k) => L.push(text(760, 666 + k * 16, `· ${s}`, { size: 11, cls: 'dim' })));
  // observation links
  for (const y of [154, 270, 386, 556]) parts.push(`<path d="M722 ${y}H742" stroke="${C.lav}" stroke-width="1" stroke-opacity=".6" class="flow"/>`);

  const head = [
    text(32, 46, t.flowTitle, { size: 22, weight: 700 }),
    text(32, 70, t.flowSub, { size: 13, cls: 'dim' }),
  ];
  const style = [
    litCss('lit', cycle, 1.6, 'fill-opacity:0;stroke-opacity:.3', 'fill-opacity:.22;stroke-opacity:1'),
    `.lit{animation:lit ${cycle}s infinite both}`,
    litCss('litT', cycle, 1.6, 'opacity:.55', 'opacity:1'),
    `.litT{animation:litT ${cycle}s infinite both}`,
    `@keyframes done{0%{fill:${C.s1}}2%{fill:${C.blue}}70%{fill:${C.blue}}74%{fill:${C.s1}}100%{fill:${C.s1}}}`,
    `.done{animation:done ${cycle}s infinite both}`,
    ...css,
  ].join('\n');
  return svg(W, H, t.flowTitle, t.flowDesc, style,
    [rect(0, 0, W, H, { rx: 18, fill: C.base }), arrowDefs({ g: C.s2, p: C.peach, y: C.yellow }), ...head, ...parts, ...nodes, ...L].join('\n'));
}
let css = [];

// ───────────────────────── waypoint roadmap ─────────────────────────

function roadmap(t) {
  const W = 900, H = 520, cycle = 12;
  const css = [], p = [];
  p.push(window_(W, H, 'claude.ai/artifact/… · checkout-v2'));
  p.push(text(28, 72, 'checkout-v2', { size: 20, weight: 700 }), text(28, 92, t.rmSub, { size: 12, cls: 'dim' }));
  let px = 170;
  for (const [label, color] of [['v3', C.sub], [t.rmCycle, C.yellow], [t.rmSwarm, C.teal]]) {
    const w = label.length * 7 + 18;
    p.push(rect(px, 58, w, 20, { rx: 10, fill: 'none', stroke: color }), text(px + w / 2, 72, label, { size: 11, cls: 'm', anchor: 'middle', fill: color }));
    px += w + 8;
  }
  p.push(text(872, 74, '62 %', { size: 22, weight: 700, anchor: 'end', fill: C.blue }));
  const ob = growBar(712, 84, 160, 6, C.blue, 0.55, 0.68, cycle); css.push(ob.css); p.push(ob.body);
  // nav
  let nx = 28;
  t.nav.forEach((n, k) => {
    p.push(text(nx, 126, n, { size: 13, weight: k === 0 ? 700 : 400, fill: k === 0 ? C.text : C.sub }));
    if (k === 0) p.push(rect(nx, 132, n.length * 7.6, 2.5, { rx: 1, fill: C.blue }));
    nx += n.length * 7.6 + 28;
  });
  p.push(`<path d="M24 138H876" stroke="${C.s0}"/>`);
  p.push(rect(664, 112, 212, 22, { rx: 11, fill: C.s0 }), rect(668, 115, 88, 16, { rx: 8, fill: C.base }),
    text(712, 127, t.byPhase, { size: 11, anchor: 'middle', cls: 'dim' }), rect(760, 115, 112, 16, { rx: 8, fill: C.blue }),
    text(816, 127, `${t.byTrack} ?`, { size: 11, anchor: 'middle', fill: C.crust, weight: 600 }));
  // tracks
  const tracks = [
    ['api', C.blue, 'dddddwpp', 5, 6], ['ui', C.mauve, 'ddwbpppp', 2, 3], ['data', C.teal, 'dddddddw', 7, 8], ['docs', C.green, 'dwpp', 1, 2],
  ];
  tracks.forEach(([name, color, boxes, from, to], k) => {
    const y = 156 + k * 82;
    p.push(rect(24, y, 520, 70, { rx: 10, fill: C.mantle, stroke: C.s0 }));
    p.push(`<rect x="24" y="${y}" width="4" height="70" rx="2" fill="${color}"/>`);
    p.push(text(42, y + 24, `${t.front} ${name}`, { size: 13, weight: 700 }));
    p.push(text(528, y + 24, `${from}/${boxes.length}`, { size: 12, cls: 'm dim', anchor: 'end' }));
    const b = growBar(150, y + 15, 320, 8, color, from / boxes.length, to / boxes.length, cycle, { hold: 0.7 }); css.push(b.css); p.push(b.body);
    [...boxes].forEach((s, j) => {
      const x = 42 + j * 24, by = y + 38;
      if (s === 'd') p.push(rect(x, by, 18, 18, { rx: 4, fill: C.blue }));
      else if (s === 'p') p.push(rect(x + 0.75, by + 0.75, 16.5, 16.5, { rx: 4, fill: 'none', stroke: C.s2, sw: 1.5 }));
      else if (s === 'b') p.push(rect(x, by, 18, 18, { rx: 4, fill: C.yellow }));
      else p.push(`<rect x="${x}" y="${by}" width="18" height="18" rx="4" class="wip"/>`);
    });
    const cur = t.rmTasks[k];
    p.push(text(42 + boxes.length * 24 + 10, y + 52, cur, { size: 11.5, cls: 'dim' }));
  });
  // timeline
  p.push(rect(562, 156, 314, 194, { rx: 10, fill: C.mantle, stroke: C.s0 }));
  p.push(text(578, 180, t.timeline, { size: 13, weight: 700 }));
  const tl = [['api', C.blue, 0, 150], ['ui', C.mauve, 70, 220], ['data', C.teal, 20, 120], ['docs', C.green, 150, 250]];
  tl.forEach(([n, c, a, b], k) => {
    const y = 198 + k * 34;
    p.push(text(578, y + 14, n, { size: 11, cls: 'm dim' }), rect(620 + a, y + 2, b - a, 16, { rx: 5, fill: c, extra: ' fill-opacity=".8"' }));
  });
  p.push(`<path d="M720 190V342" stroke="${C.red}" stroke-width="1.5" stroke-dasharray="3 3"/>`, text(720, 186, t.today, { size: 10, anchor: 'middle', fill: C.red }));
  // sessions
  p.push(rect(562, 362, 314, 134, { rx: 10, fill: C.mantle, stroke: C.s0 }));
  p.push(text(578, 386, t.sessions, { size: 13, weight: 700 }));
  t.rmSessions.forEach((s, k) => {
    const y = 410 + k * 26;
    p.push(`<circle cx="584" cy="${y - 4}" r="4.5" fill="${k === 2 ? C.ov : C.green}"${k === 2 ? '' : ' class="pulse"'}/>`, text(598, y, s, { size: 11.5, cls: 'm' }));
  });
  p.push(rect(24, 486, 520, 0.01, { fill: 'none' }));
  css.push(`@keyframes wip{0%{fill:${C.peach};opacity:1}25%{opacity:.45}50%{opacity:1}65%{fill:${C.peach}}70%{fill:${C.blue}}100%{fill:${C.blue}}}
.wip{animation:wip ${cycle}s ease-in-out infinite both}
@keyframes pulse{50%{opacity:.35}}
.pulse{animation:pulse 2s ease-in-out infinite}`);
  return svg(W, H, t.rmTitle, t.rmDesc, css.join('\n'), p.join('\n'));
}

// ───────────────────────── The band ─────────────────────────

function band(t) {
  const W = 900, H = 252, cycle = 15;
  const p = [window_(W, H, 'claude — checkout-v2')];
  t.bandLog.forEach(([s, c], k) => p.push(text(24, 64 + k * 22, s, { size: 13, cls: 'm', fill: c })));
  p.push(`<path d="M16 156H884" stroke="${C.s0}"/>`);
  const modes = [
    [t.bandDesign, t.bandDesignBtns],
    [t.bandWork, t.bandWorkBtns],
    [t.bandRun, t.bandRunBtns],
  ];
  modes.forEach(([line, btns], k) => {
    p.push(state(k, cycle, modes.length, [
      text(24, 178, line, { size: 12.5, cls: 'm', fill: C.peach }),
      buttons(24, 188, [...btns, { label: 'Panel' }, { label: '×' }]),
      text(876, 178, t.bandModes[k], { size: 11, cls: 'faint', anchor: 'end' }),
    ].join('')));
  });
  p.push(rect(16, 218, 868, 24, { rx: 6, fill: C.mantle, stroke: C.s0 }), text(28, 235, '>', { size: 13, cls: 'm', fill: C.sub }),
    `<rect x="42" y="224" width="8" height="14" fill="${C.text}" class="blink"/>`);
  return svg(W, H, t.bandTitle, t.bandDesc, statesCss(cycle, modes.length), p.join('\n'));
}

// ───────────────────────── lens panel ─────────────────────────

function lens(t) {
  const W = 900, H = 640, cycle = 10;
  const css = [], p = [window_(W, H, 'claude — /lens')];
  // transcript
  t.lensLog.forEach(([s, c], k) => p.push(text(24, 64 + k * 22, s, { size: 12.5, cls: 'm', fill: c })));
  p.push(`<path d="M452 34V628" stroke="${C.s0}"/>`);
  const X = 468, CW = 416;
  const card = (y, h, title, color, chip) => {
    const o = [rect(X, y, CW, h, { rx: 10, fill: C.mantle, stroke: C.s0 }), `<rect x="${X}" y="${y + 8}" width="3" height="${h - 16}" rx="1.5" fill="${color}"/>`,
      text(X + 16, y + 22, title, { size: 13, weight: 700, fill: color })];
    if (chip) {
      const w = chip.length * 7 + 16;
      o.push(rect(X + CW - 12 - w, y + 9, w, 18, { rx: 9, fill: 'none', stroke: color }), text(X + CW - 12 - w / 2, y + 22, chip, { size: 11, cls: 'm', anchor: 'middle', fill: color }));
    }
    return o.join('');
  };
  // Now
  p.push(card(44, 50, t.now, C.lav), text(X + 16, 82, `Opus 5.5 · ${t.effortHigh}`, { size: 11.5, cls: 'm' }), text(X + CW - 12, 82, `Bash · 14 s · ${t.turn} 3:12`, { size: 11.5, cls: 'm dim', anchor: 'end' }));
  // Roadmap
  p.push(card(104, 86, 'Roadmap', C.blue, '62 %'));
  const rb = growBar(X + 16, 136, CW - 32, 8, C.blue, 0.56, 0.66, cycle, { hold: 0.75 }); css.push(rb.css); p.push(rb.body);
  p.push(`<rect x="${X + 16}" y="136" width="60" height="8" rx="4" fill="url(#sheen)" class="sheen"/>`);
  for (let k = 0; k < 14; k++) {
    const x = X + 16 + k * 22;
    if (k < 8) p.push(rect(x, 152, 16, 16, { rx: 3.5, fill: C.blue }));
    else if (k === 8) p.push(`<rect x="${x}" y="152" width="16" height="16" rx="3.5" fill="${C.peach}" class="breathe"/>`);
    else if (k === 9) p.push(rect(x, 152, 16, 16, { rx: 3.5, fill: C.yellow }));
    else p.push(rect(x + 0.75, 152.75, 14.5, 14.5, { rx: 3.5, fill: 'none', stroke: C.s2, sw: 1.5 }));
  }
  p.push(text(X + 16, 184, t.lensRoadmapLine, { size: 11.5, cls: 'dim' }));
  // forge
  p.push(card(200, 142, 'forge · T7 · medium', C.peach));
  const stW = 72;
  t.stagesLong.forEach((s, k) => {
    const x = X + 16 + k * (stW + 6);
    p.push(rect(x, 234, stW, 22, { rx: 6, fill: C.s0 }),
      `<rect x="${x}" y="234" width="${stW}" height="22" rx="6" fill="${C.peach}" stroke="${C.peach}" class="lit" style="animation-delay:${r1(k * 1.6)}s"/>`,
      text(x + stW / 2, 249, s, { size: 11, cls: 'm', anchor: 'middle' }));
  });
  p.push(`<path d="M${X + 22} 274a6 6 0 1 1 -6 6" stroke="${C.green}" stroke-width="2" fill="none" class="spin"/>`,
    rect(X + 34, 270, 36, 18, { rx: 5, fill: C.green }), text(X + 52, 283, 'impl', { size: 11, cls: 'm', anchor: 'middle', fill: C.crust, weight: 600 }),
    text(X + 78, 283, t.lensImplDesc, { size: 11.5 }), text(X + CW - 12, 283, 'Opus 5.5 · medium  2:10', { size: 11, cls: 'm dim', anchor: 'end' }));
  p.push(text(X + 16, 306, t.lensValidators, { size: 11.5, cls: 'm', fill: C.green }), text(X + CW - 12, 306, t.lensRound, { size: 11.5, cls: 'm dim', anchor: 'end' }));
  p.push(text(X + 16, 329, t.lensProposal, { size: 11.5, cls: 'dim' }));
  p.push(buttons(X + CW - 168, 314, [{ label: t.approveBtn, size: 10.5 }, { label: t.rejectBtn, size: 10.5 }]));
  // subagents
  p.push(card(350, 74, t.subagents, C.lav));
  [[C.blue, 'correctness', t.lensRevC, 'xhigh  0:48'], [C.red, 'security', t.lensRevS, 'xhigh  0:31']].forEach(([c, tag, d, right], k) => {
    const y = 386 + k * 22;
    p.push(`<path d="M${X + 22} ${y - 10}a6 6 0 1 1 -6 6" stroke="${c}" stroke-width="2" fill="none" class="spin"/>`,
      rect(X + 34, y - 13, 82, 18, { rx: 5, fill: c }), text(X + 75, y, tag, { size: 10.5, cls: 'm', anchor: 'middle', fill: C.crust, weight: 600 }),
      text(X + 124, y, d, { size: 11.5 }), text(X + CW - 12, y, `Opus 5.5 · ${right}`, { size: 11, cls: 'm dim', anchor: 'end' }));
  });
  // usage
  p.push(card(432, 196, t.usage, C.teal, '$6.20'));
  p.push(text(X + CW - 12, 476, t.lensScope, { size: 11, cls: 'dim', anchor: 'end' }));
  p.push(text(X + 16, 476, `${t.total}  1.84M tok · $6.20`, { size: 12, cls: 'm', weight: 600 }));
  const groups = [[t.gMain, 'Opus 5.5', '0.92M · $3.90', 0.63, C.lav], [t.gImpl, 'Sonnet 5.5', '0.61M · $1.10', 0.18, C.green], [t.gReview, 'Opus 5.5', '0.28M · $1.05', 0.17, C.blue], [t.gTracking, 'waypoint+forge', '~9k · $0.04', 0.02, C.yellow]];
  let sx = X + 16;
  for (const g of groups) { p.push(rect(sx, 486, (CW - 32) * g[3] - 1.5, 8, { rx: 2, fill: g[4] })); sx += (CW - 32) * g[3]; }
  groups.forEach(([n, m, v, f, c], k) => {
    const y = 514 + k * 20;
    p.push(`<circle cx="${X + 20}" cy="${y - 4}" r="4" fill="${c}"/>`, text(X + 30, y, n, { size: 11.5 }), text(X + 170, y, m, { size: 11, cls: 'm dim' }),
      text(X + 340, y, v, { size: 11, cls: 'm', anchor: 'end' }), text(X + CW - 12, y, `${Math.round(f * 100)} %`, { size: 11, cls: 'm dim', anchor: 'end' }));
  });
  p.push(text(X + 16, 604, t.lensWithout, { size: 11.5, fill: C.teal }), text(X + 16, 618, t.pricesAsOf, { size: 10.5, cls: 'faint' }));
  css.push(litCss('lit', cycle, 1.5, 'fill-opacity:0;stroke-opacity:.3', 'fill-opacity:.25;stroke-opacity:1'),
    `.lit{animation:lit ${cycle}s infinite both}`,
    `@keyframes sheen{0%{transform:translateX(0);opacity:0}10%{opacity:.9}90%{opacity:.9}100%{transform:translateX(${CW - 92}px);opacity:0}}
.sheen{animation:sheen 2.6s ease-in-out infinite}
@keyframes breathe{50%{opacity:.4}}
.breathe{animation:breathe 1.6s ease-in-out infinite}`);
  const defs = `<defs><linearGradient id="sheen"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;
  return svg(W, H, t.lensTitle, t.lensDesc, css.join('\n'), defs + p.join('\n'));
}

// ───────────────────────── forge paths ─────────────────────────

function paths(t) {
  const W = 900, H = 470, cycle = 12;
  const p = [rect(0, 0, W, H, { rx: 18, fill: C.base })];
  p.push(text(32, 44, t.pathsTitle, { size: 20, weight: 700 }), text(32, 66, t.pathsSub, { size: 12.5, cls: 'dim' }));
  p.push(rect(32, 184, 110, 56, { rx: 10, fill: C.s0, stroke: C.s2 }), text(87, 208, t.task, { size: 13, weight: 700, anchor: 'middle' }),
    text(87, 226, '/forge:run', { size: 11, cls: 'm dim', anchor: 'middle' }));
  p.push(`<path d="M196 182L236 212L196 242L156 212Z" fill="${C.s0}" stroke="${C.peach}" stroke-width="1.5"/>`, text(196, 216, 'triage', { size: 11, cls: 'm', anchor: 'middle', weight: 600 }));
  p.push(`<path d="M143 212H154" stroke="${C.s2}" stroke-width="1.5"/>`);
  const lanes = t.lanes;
  const colors = [C.sky, C.teal, C.green, C.peach];
  lanes.forEach(([name, steps], k) => {
    const y = 88 + k * 64;
    p.push(`<path d="M236 212C262 212 262 ${y + 24} 286 ${y + 24}" stroke="${C.s2}" stroke-width="1.5" fill="none"/>`);
    p.push(`<g class="st" style="animation-delay:${r1((k * cycle) / 4)}s">
<path d="M236 212C262 212 262 ${y + 24} 286 ${y + 24}" stroke="${colors[k]}" stroke-width="2.5" fill="none" class="flow"/>
${rect(286, y, 582, 48, { rx: 10, fill: colors[k], extra: ' fill-opacity=".14"' })}
</g>`);
    p.push(rect(286, y, 582, 48, { rx: 10, fill: 'none', stroke: colors[k], extra: ' stroke-opacity=".55"' }));
    p.push(text(302, y + 29, name, { size: 13, weight: 700, fill: colors[k] }));
    let x = 392;
    steps.forEach((s, j) => {
      const w = s.length * 6.3 + 16;
      if (j) p.push(text(x - 9, y + 28, '→', { size: 12, cls: 'faint', anchor: 'middle' }));
      p.push(rect(x, y + 13, w, 22, { rx: 6, fill: C.s0 }), text(x + w / 2, y + 28, s, { size: 11, anchor: 'middle' }));
      x += w + 18;
    });
  });
  // ladder
  p.push(text(32, 372, t.ladder, { size: 13, weight: 700 }));
  const ladder = [['mech', 'Haiku', C.sky], ['light', 'Sonnet', C.teal], ['impl', 'Opus · medium', C.green], ['heavy', 'Opus · xhigh', C.peach], ['fable', t.fableOnly, C.red]];
  ladder.forEach(([n, m, c], k) => {
    const x = 32 + k * 120;
    p.push(rect(x, 384, 112, 44, { rx: 8, fill: c, extra: ' fill-opacity=".16"' }), rect(x, 384, 112, 4, { rx: 2, fill: c }),
      text(x + 10, 404, n, { size: 12, cls: 'm', weight: 700, fill: c }), text(x + 10, 420, m, { size: 10.5, cls: 'dim' }));
  });
  p.push(text(652, 372, t.reviewers, { size: 13, weight: 700 }));
  [['correctness', C.blue], ['security', C.red], ['perf', C.yellow]].forEach(([n, c], k) => {
    const y = 384 + k * 16;
    p.push(`<circle cx="658" cy="${y + 6}" r="4" fill="${c}"/>`, text(668, y + 10, `${n} · Opus · xhigh`, { size: 11, cls: 'm' }));
  });
  p.push(text(32, 452, t.pathsFoot, { size: 11, cls: 'faint' }));
  return svg(W, H, t.pathsTitle, t.pathsDesc, statesCss(cycle, 4), p.join('\n'));
}

// ───────────────────────── forge swarm ─────────────────────────

function swarm(t) {
  const W = 900, H = 464, cycle = 14;
  const css = [], p = [rect(0, 0, W, H, { rx: 18, fill: C.base })];
  p.push(text(32, 44, t.swarmTitle, { size: 20, weight: 700 }), text(32, 66, t.swarmSub, { size: 12.5, cls: 'dim' }));
  // coordinator
  p.push(rect(32, 92, 836, 50, { rx: 10, fill: C.mantle, stroke: C.teal }));
  p.push(text(48, 115, t.coordinator, { size: 13, weight: 700, fill: C.teal }), text(48, 132, t.coordSub, { size: 11, cls: 'dim' }));
  p.push(text(852, 122, t.runPill, { size: 13, cls: 'm', anchor: 'end', fill: C.teal }));
  const fronts = [['T004', C.blue, 0], ['T005', C.mauve, 1.2], ['T008', C.teal, 0.5]];
  const dur = [0.42, 0.62, 0.52];
  fronts.forEach(([name, c, d], k) => {
    const y = 164 + k * 52;
    // Nested elbows left of the fronts: the deeper the front, the further left its trunk, so no line crosses a box.
    p.push(`<path d="M${120 - k * 30} 142V${y + 20}H150" stroke="${C.s2}" stroke-width="1" fill="none" class="flow"/>`);
    p.push(rect(150, y, 470, 40, { rx: 10, fill: C.mantle, stroke: C.s0 }));
    p.push(text(166, y + 18, `${name} · ${t.subagent}`, { size: 12.5, weight: 700, fill: c }), text(166, y + 33, `.claude/worktrees/task-${name} · task/${name}`, { size: 10, cls: 'm faint' }));
    const b = growBar(370, y + 16, 150, 8, c, 0.05, 1, cycle, { delay: d, hold: dur[k] }); css.push(b.css); p.push(b.body);
    const at = r1(((dur[k] * cycle + d) / cycle) * 100);
    css.push(`@keyframes ok${k}{0%{opacity:0}${at}%{opacity:0}${r1(at + 2)}%{opacity:1}96%{opacity:1}100%{opacity:0}}
.ok${k}{animation:ok${k} ${cycle}s infinite both}`);
    // The top front merges furthest right so the merge curves nest instead of crossing.
    const mx = 672 + (fronts.length - 1 - k) * 50;
    p.push(`<g class="ok${k}">${text(536, y + 25, `✓ ${t.integrated}`, { size: 11.5, cls: 'm', fill: C.green })}
<path d="M620 ${y + 20}C700 ${y + 20} ${mx} 350 ${mx} 370" stroke="${c}" stroke-width="1.8" fill="none"/>
<circle cx="${mx}" cy="380" r="7" fill="${c}"/></g>`);
  });
  p.push(rect(150, 320, 470, 30, { rx: 10, fill: 'none', stroke: C.s1, extra: ' stroke-dasharray="4 4"' }),
    text(166, 340, t.waiting, { size: 11.5, cls: 'dim' }));
  // main line
  p.push(`<path d="M32 380H868" stroke="${C.green}" stroke-width="2.5"/>`, text(40, 372, 'forge/run-<project> · .claude/worktrees/run', { size: 12, cls: 'm', weight: 700, fill: C.green }));
  p.push(text(32, 404, t.swarmFoot0, { size: 11.5, cls: 'dim' }), text(32, 422, t.swarmFoot1, { size: 11.5, cls: 'dim' }), text(32, 440, t.swarmFoot2, { size: 11.5, cls: 'dim' }));
  return svg(W, H, t.swarmTitle, t.swarmDesc, css.join('\n'), p.join('\n'));
}

// ───────────────────────── Texts ─────────────────────────

const EN = {
  flowTitle: 'claude-bg-kit · from idea to merged code',
  flowSub: 'waypoint designs and tracks, forge builds and reviews, lens shows it all live',
  flowDesc: 'Diagram of the full flow: design with critic rounds, plan and live roadmap, the forge loop of triage, implement, validate, review and verdict, a parallel execution of tasks by subagents that is integrated into a run branch and merged into your branch at the end, and infinite mode with scout proposals. lens and the roadmap observe every stage.',
  design: 'Design', idea: 'Idea', ideaSub: 'your request', designSub: 'apply · round · rewrite', criticSub: 'numbered proposals', approve: 'Approve', approveSub: 'you sign off',
  plan: 'Plan', plannerSub: 'design → tasks', planSub: 'tracks · phases', publishSub: 'publish', roadmap: 'Live roadmap', roadmapSub: 'claude.ai artifact',
  build: 'Build', triageSub: 'by size', implement: 'implement', implementSub: 'mech → heavy', validate: 'validate', validateSub: 'your tools first',
  review: 'review ×3', reviewSub: 'independent', verdict: 'verdict', verdictSub: 'weighted score',
  fixLoop: 'fix round · up to 4 · a stronger model from round 3',
  parallel: 'Parallel', coordinator: 'coordinator', front: 'front', ownWorktree: 'one subagent and one git worktree per task', integrate: 'integrate', integrateSub: 'one merge at a time', mainSub: 'final merge',
  infinite: 'Infinite mode', infiniteSub: 'cycles until the budget runs out', proposals: 'proposals', youDecide: 'you decide', newTasks: 'new tasks', toBuild: 'to Build',
  livePanel: 'live panel', effortHigh: 'effort high', stages: ['tri', 'impl', 'val', 'rev', 'ver'], subagents: 'Subagents', usage: 'Usage',
  withoutForge: 'without forge (estimate): ~$4.70', lensObserves: 'reads the same files, adds no tokens',
  views1: 'Tracking · Versions · Sessions', views2: 'Notes · Proposals', you: 'You', youLines: ['approve the design', 'decide proposals', 'authorize merges'],

  rmTitle: 'waypoint roadmap', rmDesc: 'Mock of the waypoint roadmap artifact: header with progress, infinite and execution pills, views, four fronts with their task boxes, a timeline and the live sessions.',
  rmSub: 'Live roadmap · plan v3', rmCycle: '∞ cycle 4/10', rmSwarm: '▶ execution · subagents 2/3', nav: ['Tracking', 'Versions', 'Sessions', 'Notes', 'Proposals'],
  byPhase: 'By phase', byTrack: 'By track', front: 'track', rmTasks: ['T7 Webhook retries', 'T3 Checkout form', 'T8 Backfill orders', 'T2 API guide'],
  timeline: 'Timeline', today: 'today', sessions: 'Sessions', rmSessions: ['api · T7 · 12 min', 'data · T8 · 4 min', 'ui · waiting for api T3'],

  bandTitle: 'waypoint band', bandDesc: 'Mock of the band above the Claude Code prompt in its three modes: design, work and run (the execution), with their buttons.',
  bandLog: [['> /waypoint:work api', C.sub], ['● T7 Webhook retries — claimed, 30 min estimate', C.text], ['● forge: medium · impl (Opus 5.5 · medium) · validators unit, lint', C.text], ['● review: correctness 0.92 · security 0.88 → accepted', C.green]],
  bandModes: ['design mode', 'work mode', 'run mode'],
  bandDesign: '◆ DESIGN · checkout-v2 · v3 · 7 proposals · 2 critical',
  bandDesignBtns: [{ label: 'Apply all' }, { label: 'Pick…' }, { label: 'Another round' }, { label: 'Rewrite' }, { label: 'Interview me' }, { label: 'Approve', primary: true }],
  bandWork: '● track api 2/5 · T7 Webhook retries · 12 min/30 · overall 38 % · ✉ 1',
  bandWorkBtns: [{ label: 'Next task', primary: true }, { label: 'Status' }, { label: 'Launch session on track…' }, { label: 'Open roadmap' }],
  bandRun: '▶ EXECUTION · subagents 2/3 · T004 review (r2) · T008 implement · 3/12 · integrated 3',
  bandRunBtns: [{ label: 'Status' }, { label: 'Stop' }, { label: 'Open roadmap' }],

  lensTitle: 'lens panel', lensDesc: 'Mock of the lens side panel: the model and effort in use, the roadmap card, the forge card with its stages, the running subagents and the Usage card with cost by part and the without-forge estimate.',
  lensLog: [['> /forge:run add webhook retries', C.sub], ['● triage → medium', C.text], ['  4 files · validators unit, lint', C.sub], ['● brief-1 → forge-impl', C.text], ['● validate: unit ✓  lint ✓', C.green], ['● reviewers: correctness, security', C.text], ['', C.text], ['> /lens', C.sub], ['● panel open', C.lav]],
  now: 'Now', turn: 'turn', lensRoadmapLine: 'Phase 2 · T7 Webhook retries · 12/30 min · ✉ 1',
  stagesLong: ['triage', 'implement', 'validate', 'review', 'verdict'], lensImplDesc: 'Webhook retries', lensValidators: '✓ unit  ✓ lint', lensRound: 'round 1/4',
  lensProposal: 'Cache tax rates · perf · low', approveBtn: 'Approve', rejectBtn: 'Reject',
  lensRevC: 'diff vs brief', lensRevS: 'signature checks', lensScope: 'this session ▸ run', total: 'Total',
  gMain: 'Main session', gImpl: 'Implementers', gReview: 'Reviewers', gTracking: 'Tracking ≈',
  lensWithout: 'Without forge (estimate): ~$4.70 · no independent review', pricesAsOf: 'prices as of 2026-10-12',

  pathsTitle: 'forge · one task, the path its size calls for', pathsSub: 'triage reads the task, the files it touches and the sensitive zones, and picks a path',
  pathsDesc: 'Diagram of forge triage: a task goes to the Trivial, Small, Medium or Large path, each with its executor, validation and review; below, the implementer ladder by model and the three reviewers.',
  task: 'task', lanes: [
    ['Trivial', ['main session', 'validators on the file']],
    ['Small', ['delegated: mech / light', 'all validators', 'read the diff']],
    ['Medium', ['short plan', 'impl / heavy', 'validators', 'correctness +security']],
    ['Large', ['approved design', 'plan', 'Medium loop per task', 'final review']],
  ],
  ladder: 'Implementers, cool to warm', fableOnly: 'only on request', reviewers: 'Reviewers',
  pathsFoot: 'Validators (tests, lint, types, build) always run before any reviewer; a review that fails goes back for a fix round.',

  swarmTitle: 'forge execution · several tasks at once', swarmSub: 'the coordinator only coordinates: it launches a subagent per ready task and integrates their work into the run branch',
  swarmDesc: 'Diagram of a forge execution in subagents mode: a coordinator session on the run branch forge/run-project, in .claude/worktrees/run, launches an implementer subagent per ready task, each in its own worktree .claude/worktrees/task-T; each task goes through review and is integrated into the run branch one at a time, and the run branch is merged into your branch at the end with your permission.',
  coordinatorFull: 'coordinator', coordSub: 'forge swarm tick: launch ready tasks, review, integrate, sleep, repeat', integrated: 'integrated', waiting: 'T009 · waits for T004 · launched once it is integrated', subagent: 'subagent', runPill: '▶ execution · subagents 3/3',
  swarmFoot0: 'At the end the run branch is merged into your branch, with your permission (or the one you gave at the start).',
  swarmFoot1: 'Up to swarm.parallel tasks at once (default 3) · one merge at a time, validators after each one compared with what already failed.',
  swarmFoot2: 'Subagents or sessions mode · manual sessions join at any time · loose requests run in parallel too.',
};
EN.coordinator = 'coordinator';

const ES = {
  flowTitle: 'claude-bg-kit · de la idea al código integrado',
  flowSub: 'waypoint diseña y sigue, forge construye y revisa, lens lo enseña todo en vivo',
  flowDesc: 'Diagrama del flujo completo: diseño con rondas de crítica, plan y roadmap en vivo, el bucle de forge (triaje, implementar, validar, revisar y veredicto), una ejecución en paralelo de tareas con subagentes que se integra en una rama de ejecución y se fusiona en tu rama al final, y el modo infinito con propuestas del scout. lens y el roadmap observan cada etapa.',
  design: 'Diseño', idea: 'Idea', ideaSub: 'tu petición', designSub: 'aplicar · ronda · reescribir', criticSub: 'propuestas numeradas', approve: 'Aprobar', approveSub: 'das el visto bueno',
  plan: 'Plan', plannerSub: 'diseño → tareas', planSub: 'frentes · fases', publishSub: 'publicar', roadmap: 'Roadmap vivo', roadmapSub: 'artifact de claude.ai',
  build: 'Construir', triageSub: 'por tamaño', implement: 'implementar', implementSub: 'mech → heavy', validate: 'validar', validateSub: 'tus herramientas',
  review: 'revisión ×3', reviewSub: 'independiente', verdict: 'veredicto', verdictSub: 'nota ponderada',
  fixLoop: 'ronda de arreglo · hasta 4 · modelo más fuerte desde la ronda 3',
  parallel: 'En paralelo', coordinator: 'coordinadora', front: 'frente', ownWorktree: 'un subagente y un worktree de git por tarea', integrate: 'integrar', integrateSub: 'un merge cada vez', mainSub: 'fusión final',
  infinite: 'Modo infinito', infiniteSub: 'ciclos hasta agotar el presupuesto', proposals: 'propuestas', youDecide: 'tú decides', newTasks: 'tareas nuevas', toBuild: 'a Construir',
  livePanel: 'panel en vivo', effortHigh: 'esfuerzo alto', stages: ['tri', 'impl', 'val', 'rev', 'ver'], subagents: 'Subagentes', usage: 'Consumo',
  withoutForge: 'sin forge (estimado): ~4,70 $', lensObserves: 'lee los mismos ficheros, no gasta tokens',
  views1: 'Seguimiento · Versiones · Sesiones', views2: 'Notas · Propuestas', you: 'Tú', youLines: ['apruebas el diseño', 'decides las propuestas', 'autorizas los merges'],

  rmTitle: 'roadmap de waypoint', rmDesc: 'Maqueta del roadmap de waypoint: cabecera con el progreso, las píldoras de modo infinito y ejecución, las vistas, cuatro frentes con sus tareas, una línea temporal y las sesiones vivas.',
  rmSub: 'Roadmap vivo · plan v3', rmCycle: '∞ ciclo 4/10', rmSwarm: '▶ ejecución · subagentes 2/3', nav: ['Seguimiento', 'Versiones', 'Sesiones', 'Notas', 'Propuestas'],
  byPhase: 'Por fases', byTrack: 'Por frentes', front: 'frente', rmTasks: ['T7 Reintentos de webhooks', 'T3 Formulario de pago', 'T8 Rellenar pedidos', 'T2 Guía de la API'],
  timeline: 'Línea temporal', today: 'hoy', sessions: 'Sesiones', rmSessions: ['api · T7 · 12 min', 'data · T8 · 4 min', 'ui · espera a api T3'],

  bandTitle: 'banda de waypoint', bandDesc: 'Maqueta de la banda sobre el prompt de Claude Code en sus tres modos: diseño, trabajo y ejecución, con sus botones.',
  bandLog: [['> /waypoint:work api', C.sub], ['● T7 Reintentos de webhooks — reclamada, estimación 30 min', C.text], ['● forge: medium · impl (Opus 5.5 · medium) · validadores unit, lint', C.text], ['● revisión: correctness 0,92 · security 0,88 → aceptada', C.green]],
  bandModes: ['modo diseño', 'modo trabajo', 'modo ejecución'],
  bandDesign: '◆ DISEÑO · checkout-v2 · v3 · 7 propuestas · 2 críticas',
  bandDesignBtns: [{ label: 'Aplicar todas' }, { label: 'Elegir…' }, { label: 'Otra ronda' }, { label: 'Reescribir' }, { label: 'Preguntarme' }, { label: 'Aprobar', primary: true }],
  bandWork: '● frente api 2/5 · T7 Reintentos de webhooks · 12 min/30 · global 38 % · ✉ 1',
  bandWorkBtns: [{ label: 'Siguiente tarea', primary: true }, { label: 'Estado' }, { label: 'Lanzar sesión en un frente…' }, { label: 'Abrir roadmap' }],
  bandRun: '▶ EJECUCIÓN · subagentes 2/3 · T004 revisar (r2) · T008 implementar · 3/12 · integradas 3',
  bandRunBtns: [{ label: 'Estado' }, { label: 'Parar' }, { label: 'Abrir roadmap' }],

  lensTitle: 'panel de lens', lensDesc: 'Maqueta del panel lateral de lens: el modelo y el esfuerzo en uso, la tarjeta del roadmap, la de forge con sus etapas, los subagentes en marcha y la tarjeta Consumo con el coste por parte y la estimación sin forge.',
  lensLog: [['> /forge:run añade reintentos a los webhooks', C.sub], ['● triaje → medium', C.text], ['  4 ficheros · validadores unit, lint', C.sub], ['● brief-1 → forge-impl', C.text], ['● validar: unit ✓  lint ✓', C.green], ['● revisores: correctness, security', C.text], ['', C.text], ['> /lens', C.sub], ['● panel abierto', C.lav]],
  now: 'Ahora', turn: 'turno', lensRoadmapLine: 'Fase 2 · T7 Reintentos de webhooks · 12/30 min · ✉ 1',
  stagesLong: ['triaje', 'implem.', 'validar', 'revisar', 'veredicto'], lensImplDesc: 'Reintentos de webhooks', lensValidators: '✓ unit  ✓ lint', lensRound: 'ronda 1/4',
  lensProposal: 'Cachear impuestos · perf · low', approveBtn: 'Aprobar', rejectBtn: 'Rechazar',
  lensRevC: 'diff contra el brief', lensRevS: 'firmas', lensScope: 'esta sesión ▸ ejecución', total: 'Total',
  gMain: 'Sesión principal', gImpl: 'Implementadores', gReview: 'Revisores', gTracking: 'Seguimiento ≈',
  lensWithout: 'Sin forge (estimado): ~4,70 $ · sin revisiones independientes', pricesAsOf: 'precios a 2026-10-12',

  pathsTitle: 'forge · cada tarea, el camino que pide su tamaño', pathsSub: 'el triaje lee la tarea, los ficheros que toca y las zonas sensibles, y elige un camino',
  pathsDesc: 'Diagrama del triaje de forge: una tarea va al camino Trivial, Small, Medium o Large, cada uno con su ejecutor, su validación y su revisión; debajo, la escalera de implementadores por modelo y los tres revisores.',
  task: 'tarea', lanes: [
    ['Trivial', ['sesión principal', 'validadores del fichero']],
    ['Small', ['delegada: mech / light', 'todos los validadores', 'leer el diff']],
    ['Medium', ['plan corto', 'impl / heavy', 'validadores', 'correctness +security']],
    ['Large', ['diseño aprobado', 'plan', 'bucle Medium por tarea', 'revisión final']],
  ],
  ladder: 'Implementadores, de frío a cálido', fableOnly: 'solo si lo pides', reviewers: 'Revisores',
  pathsFoot: 'Los validadores (tests, lint, tipos, build) corren siempre antes que los revisores; una revisión que falla vuelve en una ronda de arreglo.',

  swarmTitle: 'ejecución de forge · varias tareas a la vez', swarmSub: 'la coordinadora solo coordina: lanza un subagente por tarea lista e integra su trabajo en la rama de ejecución',
  swarmDesc: 'Diagrama de una ejecución de forge en modo subagentes: una sesión coordinadora en la rama de ejecución forge/run-proyecto, en .claude/worktrees/run, lanza un subagente implementador por tarea lista, cada uno en su worktree .claude/worktrees/task-T; cada tarea pasa por revisión y se integra en la rama de ejecución de una en una, y al final esa rama se fusiona en la tuya con tu permiso.',
  coordSub: 'forge swarm tick: lanza tareas listas, revisa, integra, duerme y repite', integrated: 'integrado', waiting: 'T009 · espera a T004 · se lanza al integrarse', subagent: 'subagente', runPill: '▶ ejecución · subagentes 3/3',
  swarmFoot0: 'Al final la rama de ejecución se fusiona en la tuya, con tu permiso (o el que diste al empezar).',
  swarmFoot1: 'Hasta swarm.parallel tareas a la vez (3 por defecto) · un merge cada vez, validadores tras cada uno comparados con lo que ya fallaba.',
  swarmFoot2: 'Modo subagentes o sesiones · las sesiones manuales se unen cuando quieran · las peticiones sueltas también van en paralelo.',
};

const ART = { flow, roadmap, band, lens, paths, swarm };
for (const [lang, t] of [['en', EN], ['es', ES]]) {
  for (const [name, fn] of Object.entries(ART)) {
    css = [];
    barN = 0;
    writeFileSync(join(OUT, `${name}.${lang}.svg`), fn(t));
  }
}
console.log(`wrote ${Object.keys(ART).length * 2} SVGs to ${OUT}`);
