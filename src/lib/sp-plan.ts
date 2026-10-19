// A superpowers plan (superpowers:writing-plans): its header, its `### Task N: <title>` sections with their files and
// checkboxes, the boxes of one task ticked, and the brief forge hands an implementer for one task. Pure (no node:*, no
// zod), so lens can read plans later.

export interface SpTask { n: number; title: string; files: string[]; steps: number; done: boolean }
export interface SpPlan {
  plan: { title: string; goal: string; architecture: string; techStack: string; spec: string | null };
  constraints: string | null;
  reviewFocus: string | null;
  tasks: SpTask[];
}
export class SpPlanError extends Error {}

interface Line { text: string; eol: string; fenced: boolean }
interface Range { n: number; title: string; head: number; end: number }

const TASK = /^###\s+Task\s+(\d{1,4})\s*[:.—–-]\s*(.+?)\s*#*\s*$/i;
const BOX = /^(\s*[-*+]\s+)\[( |x|X)\](?=\s|$)/;
const FILE = /^\s*[-*+]\s*(?:Create|Modify|Test|Delete|Rename)\s*:\s*`([^`]+)`/i;
const LABEL = /^\*\*([^*]+?):\*\*/;
const RULE = /^\s*-{3,}\s*$/;

/** Every line with its own end of line, flagged when it is part of a fenced code block (the fence lines included), and
 *  the index of a fence still open at the end (null when every fence closes). */
function linesOf(text: string): { lines: Line[]; openAt: number | null } {
  const out: Line[] = [];
  let fence: string | null = null;
  let openAt: number | null = null;
  for (const piece of text.split(/(?<=\n)/)) {
    const eol = /\r?\n$/.exec(piece)?.[0] ?? '';
    const t = piece.slice(0, piece.length - eol.length);
    if (fence) {
      out.push({ text: t, eol, fenced: true });
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(t);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(t);
    if (open) { fence = open[1]; openAt = out.length; }
    out.push({ text: t, eol, fenced: !!open });
  }
  return { lines: out, openAt: fence ? openAt : null };
}

/** Each task from its heading to the next task heading or the next `# ` / `## ` heading. */
function rangesOf(lines: Line[]): Range[] {
  const out: Range[] = [];
  let cur: Range | null = null;
  lines.forEach((l, i) => {
    if (l.fenced) return;
    const task = TASK.exec(l.text);
    if (!task && !/^#{1,2}\s/.test(l.text)) return;
    if (cur) { cur.end = i; out.push(cur); cur = null; }
    if (task) cur = { n: Number(task[1]), title: task[2], head: i, end: lines.length };
  });
  if (cur) out.push(cur);
  return out;
}

/** A `**Label:**` value of the header: the rest of its line and the lines after it, up to the next label, heading or rule. */
function field(lines: Line[], label: string, stop: number): string {
  for (let i = 0; i < stop; i++) {
    const m = lines[i].fenced ? null : LABEL.exec(lines[i].text.trim());
    if (!m || m[1].trim().toLowerCase() !== label) continue;
    const parts = [lines[i].text.trim().slice(m[0].length)];
    for (let j = i + 1; j < stop; j++) {
      const t = lines[j].text;
      if (!lines[j].fenced && (LABEL.test(t.trim()) || /^#{1,6}\s/.test(t) || RULE.test(t))) break;
      parts.push(t);
    }
    return parts.join('\n').trim();
  }
  return '';
}

/** The text of a `## <title>` section of the plan (Global Constraints, Review Focus), without a closing rule. */
function sectionText(lines: Line[], title: RegExp): string | null {
  const i = lines.findIndex(l => !l.fenced && title.test(l.text));
  if (i < 0) return null;
  const body: string[] = [];
  for (let j = i + 1; j < lines.length && (lines[j].fenced || !(/^#{1,2}\s/.test(lines[j].text) || TASK.test(lines[j].text))); j++) body.push(lines[j].text);
  while (body.length && (!body[body.length - 1].trim() || RULE.test(body[body.length - 1]))) body.pop();
  const s = body.join('\n').trim();
  return s || null;
}

function taskOf(lines: Line[], r: Range): SpTask {
  const files: string[] = [];
  let steps = 0;
  let checked = 0;
  for (let i = r.head + 1; i < r.end; i++) {
    if (lines[i].fenced) continue;
    const f = FILE.exec(lines[i].text);
    const p = f ? f[1].trim().replace(/:\d+(?:-\d+)?$/, '') : '';
    if (p && !files.includes(p)) files.push(p);
    const b = BOX.exec(lines[i].text);
    if (b) { steps++; if (b[2] !== ' ') checked++; }
  }
  return { n: r.n, title: r.title, files, steps, done: steps > 0 && checked === steps };
}

function scan(text: string): { lines: Line[]; ranges: Range[] } {
  const { lines, openAt } = linesOf(text);
  // An unclosed fence would swallow every task after it: refuse rather than report the plan done early.
  if (openAt !== null) throw new SpPlanError(`unclosed code fence opened at line ${openAt + 1}`);
  // `### Task 1.5:` would read as task 1 again: say what is wrong instead.
  for (const l of lines) {
    const sub = l.fenced ? null : /^###\s+Task\s+(\d+\.\d+)/i.exec(l.text);
    if (sub) throw new SpPlanError(`"### Task ${sub[1]}" has a sub-number: a superpowers plan numbers its tasks 1, 2, 3`);
  }
  const ranges = rangesOf(lines);
  if (!ranges.length) throw new SpPlanError('no "### Task N: <title>" section: this is not a superpowers plan');
  const seen = new Set<number>();
  for (const r of ranges) {
    if (seen.has(r.n)) throw new SpPlanError(`task ${r.n} appears twice`);
    seen.add(r.n);
  }
  return { lines, ranges };
}

function rangeOf(ranges: Range[], n: number): Range {
  const r = ranges.find(x => x.n === n);
  if (!r) throw new SpPlanError(`task ${n} is not in the plan`);
  return r;
}

export function parseSpPlan(text: string): SpPlan {
  const { lines, ranges } = scan(text);
  const firstH2 = lines.findIndex(l => !l.fenced && /^##\s/.test(l.text));
  const stop = Math.min(ranges[0].head, firstH2 < 0 ? lines.length : firstH2);
  const h1 = lines.slice(0, stop).find(l => !l.fenced && /^#\s+\S/.test(l.text));
  const title = h1 ? h1.text.replace(/^#\s+/, '').replace(/\s+#*\s*$/, '').replace(/\s*Implementation Plan$/i, '').trim() : '';
  const specField = field(lines, 'spec', stop);
  // The spec is the first backticked path of the field ("`docs/…/x.md`: §4 completo" → the path), else the field.
  const spec = (/`([^`]+)`/.exec(specField)?.[1] ?? specField).trim();
  return {
    plan: { title, goal: field(lines, 'goal', stop), architecture: field(lines, 'architecture', stop), techStack: field(lines, 'tech stack', stop), spec: spec || null },
    constraints: sectionText(lines, /^##\s+Global Constraints\s*$/i),
    reviewFocus: sectionText(lines, /^##\s+Review Focus\s*$/i),
    tasks: ranges.map(r => taskOf(lines, r)),
  };
}

/**
 * The tasks superpowers' own executors (executing-plans, subagent-driven-development) recorded as complete in a
 * progress ledger: `Task N: complete …` lines, read only when the ledger's first line (`# SDD ledger — plan: <path>`)
 * names this plan: its repo-relative path, or an absolute path that ends with it (`pkg/docs/…/plan.md` is another
 * plan's). Those executors never tick the plan's boxes.
 */
export function sddComplete(ledger: string, planRel: string): number[] {
  const first = /^#\s*SDD ledger\s*[—–-]\s*plan:\s*(.+?)\s*$/m.exec(ledger.split(/\r?\n/)[0] ?? '');
  const rel = planRel.replace(/\\/g, '/').replace(/^\.\//, '');
  const named = first ? first[1].replace(/\\/g, '/').replace(/^\.\//, '') : null;
  if (!named || !rel || (named !== rel && !(/^(?:[A-Za-z]:)?\//.test(named) && named.endsWith(`/${rel}`)))) return [];
  const done = new Set<number>();
  for (const m of ledger.matchAll(/^Task (\d{1,4}): complete\b/gm)) done.add(Number(m[1]));
  return [...done].sort((a, b) => a - b);
}

/** The plan with these tasks counted as done (a ledger's completions next to the ticked boxes). */
export function markDone(plan: SpPlan, done: number[]): SpPlan {
  return { ...plan, tasks: plan.tasks.map(t => (done.includes(t.n) ? { ...t, done: true } : t)) };
}

/** Ticks `- [ ]` → `- [x]` inside task `n` only (never inside code), keeping every line ending as it was. */
export function checkSpTask(text: string, n: number): { text: string; checked: number } {
  const { lines, ranges } = scan(text);
  const r = rangeOf(ranges, n);
  let checked = 0;
  for (let i = r.head + 1; i < r.end; i++) {
    const b = lines[i].fenced ? null : BOX.exec(lines[i].text);
    if (!b || b[2] !== ' ') continue;
    lines[i].text = `${b[1]}[x]${lines[i].text.slice(b[0].length)}`;
    checked++;
  }
  return { text: lines.map(l => l.text + l.eol).join(''), checked };
}

/** The brief of task `n`: the plan's header and global constraints, the task's body as written (its steps, code and
 *  commands, so the TDD its steps carry is kept), and the rules forge adds. */
export function renderSpBrief(text: string, n: number, opts: { planPath: string; tdd?: string | null }): string {
  const parsed = parseSpPlan(text);
  const { lines, ranges } = scan(text);
  const r = rangeOf(ranges, n);
  const body = lines.slice(r.head + 1, r.end).map(l => l.text);
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && (!body[body.length - 1].trim() || RULE.test(body[body.length - 1]))) body.pop();
  const p = parsed.plan;
  return [
    `# Task ${n} — ${r.title}`,
    '',
    `Plan: ${opts.planPath} (a superpowers plan; this brief is its task ${n})`,
    ...(p.spec ? [`Spec: ${p.spec}`] : []),
    '',
    ...(p.goal ? [`**Goal:** ${p.goal}`, ''] : []),
    ...(p.architecture ? [`**Architecture:** ${p.architecture}`, ''] : []),
    ...(p.techStack ? [`**Tech Stack:** ${p.techStack}`, ''] : []),
    ...(parsed.constraints ? ['## Global Constraints', '', parsed.constraints, ''] : []),
    ...(parsed.reviewFocus ? ['## Review Focus', '', parsed.reviewFocus, ''] : []),
    '## Task',
    '',
    ...body,
    '',
    '## Rules',
    '',
    '- Work only in the files this task lists, unless its steps ask for others.',
    "- Commit as the task's last step says.",
    "- Leave the plan's checkboxes as they are: forge ticks them when the task is accepted.",
    ...(opts.tdd ? ['', opts.tdd] : []),
  ].join('\n') + '\n';
}
