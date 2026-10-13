// Cost report over forge usage files (<checkout>/.forge/usage/<session>.json, the format of src/lens/usage-file.ts):
// a table per agent (kind, model, effort) with runs, steps, mean cost per run and the cost split by token type, and a
// breakdown per session by group (main, impl, review, verify, plan, other). Plain JavaScript, so `node` runs it as it is.
// Usage: node scripts/usage-report.mjs <usage dir>...
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// USD per million tokens [input, output, cacheRead, cacheWrite (1-hour rate)]: a mirror of src/lib/prices.ts, which
// tests/usage-report.test.ts keeps in sync. Most specific prefix first.
export const PRICES = [
  ['claude-fable-5-1', [10, 50, 0.25, 20]],
  ['claude-mythos-5-1', [10, 50, 0.25, 20]],
  ['claude-fable-5', [10, 50, 1, 20]],
  ['claude-mythos-5', [10, 50, 1, 20]],
  ['claude-opus-5-5', [4, 20, 0.2, 8]],
  ['claude-opus-5', [5, 25, 0.5, 10]],
  ['claude-opus-4-8', [5, 25, 0.5, 10]],
  ['claude-opus-4-7', [5, 25, 0.5, 10]],
  ['claude-opus-4-6', [5, 25, 0.5, 10]],
  ['claude-opus-4-5', [5, 25, 0.5, 10]],
  ['claude-opus-4-1', [15, 75, 1.5, 30]],
  ['claude-opus-4', [15, 75, 1.5, 30]],
  ['claude-sonnet-5-5', [2, 10, 0.1, 4]],
  ['claude-sonnet-5', [2, 10, 0.2, 4]],
  ['claude-sonnet-4', [3, 15, 0.3, 6]],
  ['claude-haiku-5-5', [0.1, 0.5, 0.01, 0.2]],
  ['claude-haiku-4-5', [1, 5, 0.1, 2]],
  ['claude-haiku-3-5', [0.8, 4, 0.08, 1.6]],
];

const baseId = (model) => String(model ?? '').replace(/\[[^\]]*\]$/, '').trim();

/** The model's base-tier price, or null when unpriced (as priceFor in src/lib/prices.ts with no prompt size). */
export function priceOf(model) {
  const id = baseId(model);
  const hit = PRICES.find(([p]) => id === p || id.startsWith(`${p}-`) || id.startsWith(`${p}[`));
  if (!hit) return null;
  const [input, output, cacheRead, cacheWrite] = hit[1];
  return { input, output, cacheRead, cacheWrite };
}

/** The lens group of a loop (groupOf in src/lens/usage-summary.ts). */
export function groupOf(loopId, kind) {
  if (kind === 'main' || loopId === 'main' || loopId.endsWith('/main')) return 'main';
  if (/forge-(impl|mech|fable)/.test(kind)) return 'impl';
  if (/forge-verify/.test(kind)) return 'verify';
  if (/forge-review/.test(kind)) return 'review';
  if (/forge-(planner|scout)|design-critic/.test(kind)) return 'plan';
  return 'other';
}

/** A loop's tokens priced by type, in USD, or null for an unpriced model. */
export function splitCost(l) {
  const p = l.model ? priceOf(l.model) : null;
  if (!p) return null;
  return {
    input: (l.input * p.input) / 1e6, output: (l.output * p.output) / 1e6,
    cacheRead: (l.cacheRead * p.cacheRead) / 1e6, cacheWrite: (l.cacheWrite * p.cacheWrite) / 1e6,
  };
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
const str = (x) => (typeof x === 'string' && x ? x : null);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** The project a usage dir belongs to: the checkout's name for `<checkout>/.forge/usage`, else the dir's name. */
function projectOf(dir) {
  const abs = path.resolve(dir);
  const parent = path.dirname(abs);
  return path.basename(abs) === 'usage' && path.basename(parent) === '.forge' ? path.basename(path.dirname(parent)) : path.basename(abs);
}

/** Every valid usage file of a directory (the broken and the unreadable ones are skipped), with its project. */
export function readUsageDir(dir) {
  let names;
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const project = projectOf(dir);
  const out = [];
  for (const name of names) {
    let x;
    try { x = JSON.parse(readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    if (!isObj(x) || x.v !== 1 || !str(x.session) || !isObj(x.loops)) continue;
    const loops = {};
    for (const [id, l] of Object.entries(x.loops)) {
      if (!isObj(l)) continue;
      loops[id] = {
        kind: str(l.kind) ?? 'unknown', model: str(l.model), effort: str(l.effort), steps: num(l.steps), input: num(l.input),
        output: num(l.output), cacheRead: num(l.cacheRead), cacheWrite: num(l.cacheWrite), costUsd: num(l.costUsd), unpriced: num(l.unpriced),
      };
    }
    out.push({
      project, file: name, session: x.session, label: str(x.label) ?? x.session,
      costUsd: typeof x.costUsd === 'number' && Number.isFinite(x.costUsd) ? x.costUsd : null, loops,
    });
  }
  return out;
}

const PARTS = ['input', 'output', 'cacheRead', 'cacheWrite'];

/** One row per kind (without the `forge:` prefix), model (without a bracketed suffix) and effort, by cost. */
export function byAgent(files) {
  const rows = new Map();
  for (const f of files) {
    for (const l of Object.values(f.loops)) {
      const kind = l.kind.replace(/^forge:/, '');
      const model = l.model ? baseId(l.model) : null;
      const key = `${kind}|${model}|${l.effort}`;
      let r = rows.get(key);
      if (!r) {
        r = { kind, model, effort: l.effort, runs: 0, steps: 0, cost: 0, unpriced: 0, split: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, pricedCost: 0 };
        rows.set(key, r);
      }
      r.runs++;
      r.steps += l.steps;
      r.cost += l.costUsd;
      r.unpriced += l.unpriced;
      const s = splitCost(l);
      if (s) {
        for (const k of PARTS) r.split[k] += s[k];
        r.pricedCost += l.costUsd;
      }
    }
  }
  return [...rows.values()].map(({ pricedCost, ...r }) => {
    const priced = PARTS.reduce((a, k) => a + r.split[k], 0);
    return {
      ...r, avgSteps: r.steps / r.runs, avgCost: r.cost / r.runs, priced,
      // The recorded cost of the priced loops minus their tokens priced here: 0 when the per-step pricing agrees.
      diff: pricedCost - priced,
      share: priced > 0 ? Object.fromEntries(PARTS.map((k) => [k, r.split[k] / priced])) : null,
    };
  }).sort((a, b) => b.cost - a.cost);
}

/** One row per session, by cost: its recorded cost (else the sum of its loops), its loop count and its cost per group. */
export function bySession(files) {
  return files.map((f) => {
    const groups = {};
    let sum = 0;
    for (const [id, l] of Object.entries(f.loops)) {
      const g = groupOf(id, l.kind);
      groups[g] = (groups[g] ?? 0) + l.costUsd;
      sum += l.costUsd;
    }
    return { project: f.project, label: f.label, session: f.session, cost: f.costUsd ?? sum, loops: Object.keys(f.loops).length, groups };
  }).sort((a, b) => b.cost - a.cost);
}

const GROUPS = ['main', 'impl', 'review', 'verify', 'plan', 'other'];
const usd = (x) => x.toFixed(2);
const pct = (x) => `${Math.round(100 * x)} %`;

/** Both tables as Markdown. */
export function report(files, dirs) {
  const agents = byAgent(files);
  const sessions = bySession(files);
  const lines = [
    `Usage files: ${files.length} from ${dirs.join(', ')}`,
    '',
    '## By agent',
    '',
    '| kind | model | effort | runs | steps | steps/run | cost $ | $/run | input | output | cache read | cache write | recorded - priced $ |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of agents) {
    const sh = r.share ? PARTS.map((k) => pct(r.share[k])) : ['—', '—', '—', '—'];
    const note = r.unpriced > 0 ? ` (${r.unpriced} unpriced steps)` : '';
    lines.push(`| ${r.kind} | ${r.model ?? '—'} | ${r.effort ?? '—'} | ${r.runs} | ${r.steps} | ${r.avgSteps.toFixed(0)} | ${usd(r.cost)} | ${usd(r.avgCost)} | ${sh.join(' | ')} | ${usd(r.diff)}${note} |`);
  }
  const total = agents.reduce((a, r) => a + r.cost, 0);
  lines.push('', `Total over loops: ${usd(total)} $`, '', '## By session', '', `| project | label | cost $ | loops | ${GROUPS.join(' | ')} |`, `|---|---|---|---|${GROUPS.map(() => '---|').join('')}`);
  for (const s of sessions) {
    lines.push(`| ${s.project} | ${s.label} | ${usd(s.cost)} | ${s.loops} | ${GROUPS.map((g) => (s.groups[g] === undefined ? '—' : usd(s.groups[g]))).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    process.stderr.write('Usage: node scripts/usage-report.mjs <usage dir>...\n');
    process.exit(2);
  }
  process.stdout.write(report(dirs.flatMap(readUsageDir), dirs));
}
