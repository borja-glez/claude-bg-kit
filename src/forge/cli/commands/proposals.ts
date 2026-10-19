import type { Command } from '../context.js';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent, readEvents, forgeDir } from '../../ledger.js';
import { parsePlan, PlanError } from '../../../lib/plan.js';
import {
  PROPOSAL_ID, saveProposal, loadProposals, loadProposal, decideDoc, mirrorProposal, saveApproval, loadApproval, loadApprovals,
  removeApproval, addProposal, ProposalInputError, type AddOutcome, type DecideError,
} from '../../proposals.js';
import {
  normalizeProposal, isActionable, canDecide, normalizeApproval, ownerCheck, ownerApproved, proposalDigest, PROPOSAL_STATUSES,
  type Decision, type ProposalDoc, type ApprovalDoc,
} from '../../../lib/proposals.js';
import { PAGE_RULES } from '../../../lib/publish.js';
import { autoApprovable } from '../../policy.js';
import { proposalToTask, proposalOfIncludes, proposalsOfIncludes } from '../../to-task.js';
import type { PlanTask } from '../../../lib/types.js';
import { parseDocument } from 'yaml';
import { UsageError } from '../errors.js';
import { lastDecisions, approvalsPageFile, pulledRules, bindingDecision, unownedReasons } from '../shared.js';

/** Why `proposals decide` refused, naming who decided and when, or what blocks the reopen. */
function decideRefusal(id: string, doc: ProposalDoc, error: DecideError): string {
  if (doc.status === 'done') return `${id} is done and cannot be reopened`;
  switch (error) {
    case 'decided': {
      const who = `${doc.status}${doc.decidedBy ? ` by ${doc.decidedBy}` : ''}${doc.decidedAt ? ` at ${doc.decidedAt}` : ''}`;
      return `${id} is already decided (${who}); use --reopen after the person confirms`;
    }
    case 'done': return `${id} is done and cannot be reopened`;
    case 'tasked': return `${id} has task ${doc.taskId}; drop the task from the plan (and the taskId) before reopening it`;
    case 'same': return `${id} is already ${doc.status}`;
    case 'discuss': return '--reopen takes approve or reject, not discuss';
    case 'open': return `${id} is ${doc.status}, not decided: decide it without --reopen`;
  }
}

/**
 * The tasks of --plan (a usage error when it cannot be read or parsed), else of every docs/waypoint/<project>/plan.yaml
 * (an unreadable or broken one is skipped).
 */
function planTasksFor(cwd: string, planArg: string | undefined): PlanTask[] {
  if (planArg) {
    let text: string;
    try { text = readFileSync(path.resolve(cwd, planArg), 'utf8'); } catch { throw new UsageError(`cannot read plan ${planArg}`); }
    try { return parsePlan(text).tasks; } catch (e) {
      if (e instanceof PlanError) throw new UsageError(`${planArg}: ${e.issues.join('; ')}`);
      throw new UsageError(`${planArg}: not a valid plan`);
    }
  }
  const docs = path.join(cwd, 'docs', 'waypoint');
  let projects: string[];
  try { projects = readdirSync(docs); } catch { return []; }
  return projects.flatMap(p => { try { return parsePlan(readFileSync(path.join(docs, p, 'plan.yaml'), 'utf8')).tasks; } catch { return []; } });
}

/**
 * The task that holds a proposal in the plans: one made from it (its `includes` ends with the proposal marker), or
 * the task `taskId` names while a plan still has it. A taskId whose task was dropped holds nothing.
 */
function heldTask(tasks: PlanTask[], id: string, taskId: string | undefined): string | undefined {
  return tasks.find(t => proposalOfIncludes(t.includes) === id)?.id ?? (taskId !== undefined && tasks.some(t => t.id === taskId) ? taskId : undefined);
}

export const command: Command = (args, ctx) => {
  const { io, has, ok, json, ts } = ctx;
  const [sub, ...rest] = args;
  const subFlag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    const v = i >= 0 ? rest[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const writeOf = (d: { status: string; reason?: string }, by: string, at: string) => {
    const w: Record<string, string> = { status: d.status, decidedBy: by, decidedAt: at };
    if (d.reason) w.reason = d.reason;
    return w;
  };
  const readText = (f: string, what: string) => { try { return readFileSync(path.resolve(io.cwd, f), 'utf8'); } catch { throw new UsageError(`proposals: cannot read ${what}`); } };
  // §4.1: the owner's mark of a decision, as approvals/<pid> takes it (only the roadmap's owner can write it).
  const approvalOf = (id: string, status: ApprovalDoc['status'], at: string, p: Parameters<typeof proposalDigest>[1], by: ApprovalDoc['by'] = 'forge:decide') =>
    ({ op: 'set' as const, collection: 'approvals', doc_id: id, data: { status, decidedAt: at, by, digest: proposalDigest(id, p) } });
  switch (sub) {
    case 'add': {
      const file = subFlag('file');
      if (!file) throw new UsageError('proposals add: --file is required');
      let raw: unknown;
      try { raw = JSON.parse(readText(file, '--file')); } catch (e) { if (e instanceof UsageError) throw e; throw new UsageError('proposals add: --file must be a JSON object'); }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UsageError('proposals add: --file must be a JSON object');
      const o = raw as Record<string, unknown>;
      // A v2 names the proposal it revises with --revises, and only that one is exempt from the open-proposal check.
      const revises = subFlag('revises');
      if (has('revises') && (!revises || !PROPOSAL_ID.test(revises))) throw new UsageError('proposals add: --revises needs a proposal id');
      let r: AddOutcome;
      try {
        r = addProposal(io.cwd, o, { ts: ts(), author: subFlag('author') ?? o.author ?? 'session', now: io.now(), rand: io.rand ?? Math.random, ...(revises ? { revises } : {}) });
      } catch (e) {
        if (e instanceof ProposalInputError) throw new UsageError(`proposals add: ${e.message}`);
        throw e;
      }
      if (!r.ok) {
        // Anti-repetition: a rejected one without new evidence, or one still open whatever its evidence.
        const why = r.why === 'rejected' ? `similar to rejected proposal ${r.similar} and without new evidence` : `similar to open proposal ${r.similar}`;
        return { code: 3, stdout: '', stderr: `proposals add: ${why}\n` };
      }
      return json({ id: r.id, doc: r.doc });
    }
    case 'list': {
      const status = subFlag('status');
      if (status !== undefined && !(PROPOSAL_STATUSES as readonly string[]).includes(status)) throw new UsageError(`proposals list: --status must be one of ${PROPOSAL_STATUSES.join('|')}`);
      const all = loadProposals(io.cwd).filter(p => status === undefined || p.status === status);
      all.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id < b.id ? 1 : -1));
      const reasons = unownedReasons(io.cwd, io.now());
      return json({ proposals: all, unowned: Object.keys(reasons).length, unownedReasons: reasons });
    }
    case 'decide': {
      const [id, action] = rest;
      if (!id || !PROPOSAL_ID.test(id)) throw new UsageError('proposals decide: a proposal id (p + 14 digits + 4 letters/digits) is required');
      if (action !== 'approve' && action !== 'reject' && action !== 'discuss' && action !== 'confirm') throw new UsageError('proposals decide: action must be approve|reject|discuss|confirm');
      const rf = subFlag('reason-file');
      const reason = rf !== undefined ? readText(rf, '--reason-file').trim() : undefined;
      const by = subFlag('by') ?? 'user';
      const at = ts();
      const from = subFlag('from');
      const reopen = has('reopen');
      let base: ReturnType<typeof normalizeProposal>;
      if (from !== undefined) {
        // Roadmap path: validate against the db doc only; nothing is written or logged until
        // the roadmap update succeeds and the skill runs `proposals save`.
        try { base = normalizeProposal(JSON.parse(readText(from, '--from'))); } catch (e) { if (e instanceof UsageError) throw e; base = null; }
        if (!base) throw new UsageError('proposals decide: --from must be a valid proposal doc');
      } else {
        base = loadProposal(io.cwd, id);
        if (!base) throw new UsageError(`proposals decide: ${id} not found`);
      }
      // §4.1: confirm marks the decision the proposal already has (one taken on a page that wrote no mark, or before wave 4).
      if (action === 'confirm') {
        const status = base.status;
        if (status !== 'approved' && status !== 'auto_approved' && status !== 'rejected') throw new UsageError(`proposals decide: ${id} is ${status}: only a decided proposal is confirmed`);
        const approval = approvalOf(id, status, at, base);
        // The latest decision of this checkout: a reopen before it no longer voids the mark it makes. On the roadmap path
        // it is logged only once the mark landed (M3): the skill logs the `event` printed here.
        const event = { action: 'confirm', id, status };
        if (from !== undefined) return json({ id, status, approval, event });
        saveApproval(io.cwd, id, approval.data);
        appendEvent(io.cwd, { ts: at, kind: 'proposal', ...event });
        return json({ id, status, approval });
      }
      // A reopen also refuses while the proposal has a task: in the db doc, or in a plan (a task made from it, or
      // the local mirror's taskId, which to-task sets before the roadmap does, while a plan still has that task).
      const held = reopen ? base.taskId ?? heldTask(planTasksFor(io.cwd, subFlag('plan')), id, loadProposal(io.cwd, id)?.taskId) : undefined;
      const checked = held !== undefined ? { ...base, taskId: held } : base;
      const r = decideDoc(checked, action as Decision, by, at, reason || undefined, { reopen });
      if (!r.ok) throw new UsageError(`proposals decide: ${decideRefusal(id, checked, r.error)}`);
      const mark = r.doc.status === 'approved' || r.doc.status === 'rejected' ? approvalOf(id, r.doc.status, at, r.doc) : null;
      // M1: a mark this checkout holds for the pid (one an editor left in place by setting the status back, say) goes
      // first, as a reopened decision's does: the skill pins the delete to the version it lists, and the new mark, if
      // any, is then a create. Read before the local path below replaces it.
      const marked = loadApproval(io.cwd, id) !== null;
      const event = reopen ? { action: 'reopen', id, from: base.status, to: r.doc.status } : { action: 'decide', id, status: r.doc.status };
      if (from === undefined) {
        saveProposal(io.cwd, id, r.doc);
        if (mark) saveApproval(io.cwd, id, mark.data); else removeApproval(io.cwd, id);
        appendEvent(io.cwd, { ts: at, kind: 'proposal', ...event });
      }
      // M3: on the roadmap path the decision is logged only once the roadmap took it: the skill logs this `event`.
      const logLater = from !== undefined ? { event } : {};
      const approvalDelete = reopen || marked ? { approvalDelete: { op: 'delete' as const, collection: 'approvals', doc_id: id } } : {};
      if (!reopen) return json({ id, status: r.doc.status, write: writeOf(r.doc, by, at), approval: mark, ...approvalDelete, ...logLater });
      // The skill sends `write` pinned to the version it read; a stale reason is deleted.
      const write: Record<string, unknown> = { ...writeOf(r.doc, by, at), history: r.doc.history };
      if (!r.doc.reason && base.reason) write.reason = { __delete__: true };
      // The decision reopened no longer stands: its mark in the roadmap goes. Without it an editor who sets the status
      // back finds the old mark.
      return json({ id, status: r.doc.status, previous: base.status, write, approval: mark, ...approvalDelete, ...logLater });
    }
    case 'save': {
      const from = subFlag('from');
      if (!from) throw new UsageError('proposals save: --from is required');
      const id = subFlag('id') ?? path.basename(from).replace(/(\.db)?\.json$/, '');
      if (!PROPOSAL_ID.test(id)) throw new UsageError('proposals save: a proposal id (p + 14 digits + 4 letters/digits) is required (--id, or a <id>.json / <id>.db.json file name)');
      let doc: ReturnType<typeof normalizeProposal>;
      try { doc = normalizeProposal(JSON.parse(readText(from, '--from'))); } catch (e) { if (e instanceof UsageError) throw e; doc = null; }
      if (!doc) throw new UsageError('proposals save: --from must be a valid proposal doc');
      const { previous, previousDoc } = mirrorProposal(io.cwd, id, doc, taskId => heldTask(planTasksFor(io.cwd, subFlag('plan')), id, taskId) === taskId);
      // M3: save only mirrors. Whoever wrote the status (an editor, say), it is no decision of this checkout's owner: only
      // decide, confirm, a reopen and the policy log one (the roadmap path logs the `event` decide prints, once it landed).
      // A decided proposal that changes status is a reopen; one made by hand (not through `decide --reopen`) carries no
      // new history entry for the decision it replaced. Moving to done is the normal lifecycle, never a reopen.
      const reopened = (previous ?? 'proposed') !== doc.status && previousDoc !== null && !canDecide(previousDoc.status) && doc.status !== 'done';
      // Tracked: a history entry the mirror lacks that records the mirror's own decision (status, who, when).
      const known = new Set((previousDoc?.history ?? []).map(e => JSON.stringify(e)));
      const tracked = previousDoc !== null && (doc.history ?? []).some(e => !known.has(JSON.stringify(e))
        && e.status === previousDoc.status && e.decidedBy === previousDoc.decidedBy && e.decidedAt === previousDoc.decidedAt);
      const stderr = reopened && !tracked
        ? `proposals save: ${id} went from ${previousDoc.status} to ${doc.status} with no new history entry: the change was not made through proposals decide --reopen\n`
        : '';
      return { ...json({ id, status: doc.status, previous }), stderr };
    }
    case 'pull': {
      const dir = subFlag('dir');
      if (!dir) throw new UsageError('proposals pull: --dir is required');
      const abs = path.resolve(io.cwd, dir);
      let names: string[] = [];
      if (existsSync(abs)) {
        try { names = readdirSync(abs); } catch { throw new UsageError(`proposals pull: cannot read ${dir}`); }
      }
      // §4.1: the roadmap's marks replace the local ones. Without the owner rule (meta/page.rules under 2: a roadmap
      // published before wave 4, where approvals/ inherits write: admin) no mark counts and every local one goes.
      // Read before anything is written: a folder that cannot be read leaves the mirror as it was.
      const withMarks = has('approvals');
      const db: Record<string, ApprovalDoc> = {};
      let rules = 0;
      let page: unknown = null;
      if (withMarks) {
        const marksDir = subFlag('approvals');
        if (!marksDir) throw new UsageError('proposals pull: --approvals needs the listed approvals folder');
        const pageFile = subFlag('page');
        if (!pageFile) throw new UsageError('proposals pull: --approvals needs --page (the listed meta/page.json)');
        page = (() => { try { return JSON.parse(readFileSync(path.resolve(io.cwd, pageFile), 'utf8')) as unknown; } catch { return null; } })();
        rules = page && typeof page === 'object' && typeof (page as { rules?: unknown }).rules === 'number' ? (page as { rules: number }).rules : 0;
        const marksAbs = path.resolve(io.cwd, marksDir);
        if (rules >= PAGE_RULES && existsSync(marksAbs)) {
          let marks: string[];
          try { marks = readdirSync(marksAbs).sort(); } catch { throw new UsageError(`proposals pull: cannot read ${marksDir}`); }
          for (const name of marks) {
            const id = name.endsWith('.json') ? name.slice(0, -5) : '';
            if (!PROPOSAL_ID.test(id)) continue;
            let a: ApprovalDoc | null = null;
            try { a = normalizeApproval(JSON.parse(readFileSync(path.join(marksAbs, name), 'utf8'))); } catch { a = null; }
            if (a) db[id] = a;
          }
        }
      }
      let n = 0;
      for (const name of names.sort()) {
        if (!name.endsWith('.json')) continue;
        const id = name.slice(0, -5);
        if (!PROPOSAL_ID.test(id)) continue;
        let doc;
        try { doc = normalizeProposal(JSON.parse(readFileSync(path.join(abs, name), 'utf8'))); } catch { continue; }
        if (!doc) continue;
        saveProposal(io.cwd, id, doc);
        n++;
      }
      if (!withMarks) return ok(String(n));
      // Carry 12: the rules this pull read decide whether a newer owner mark may outrank an older local decision.
      forgeDir(io.cwd);
      writeFileSync(approvalsPageFile(io.cwd), JSON.stringify({ rules }) + '\n');
      let removed = 0;
      for (const id of Object.keys(loadApprovals(io.cwd))) if (!db[id]) { removeApproval(io.cwd, id); removed++; }
      for (const [id, a] of Object.entries(db)) saveApproval(io.cwd, id, a);
      const count = Object.keys(db).length;
      // The owner rule is known here only from meta/page.rules, which an editor can also write on a roadmap that lacks it.
      // Said once per checkout and roadmap: the marker lives in .forge/. Carry 10: one source for the key, the page's
      // own id (meta/page.roadmap, the plan's project), and --roadmap only for a page that has none.
      const pageRoadmap = page && typeof page === 'object' && typeof (page as { roadmap?: unknown }).roadmap === 'string' ? (page as { roadmap: string }).roadmap : '';
      const roadmap = pageRoadmap || (subFlag('roadmap') ?? '');
      const markerFile = path.join(io.cwd, '.forge', 'approvals-warned.json');
      const warnedFor = (() => { try { return (JSON.parse(readFileSync(markerFile, 'utf8')) as { roadmap?: unknown }).roadmap; } catch { return undefined; } })();
      const warning = count > 0 && warnedFor !== roadmap ? 'proposals pull: approvals are owner-only once the roadmap is republished with this version; until then an editor could write them\n' : '';
      if (warning) { forgeDir(io.cwd); writeFileSync(markerFile, JSON.stringify({ roadmap }) + '\n'); }
      return { ...json({ proposals: n, approvals: count, removed, rules, ownerRule: rules >= PAGE_RULES }), stderr: warning };
    }
    case 'policy': {
      const id = rest[0];
      if (!id || !PROPOSAL_ID.test(id)) throw new UsageError('proposals policy: a proposal id is required');
      const found = loadProposals(io.cwd).find(p => p.id === id);
      if (!found) throw new UsageError(`proposals policy: ${id} not found`);
      const { id: _id, ...doc } = found;
      // An owner's mark already decided this one (a non-owner reset its status): the policy does not overwrite it.
      // Origin: only a proposal this checkout added (its ledger `add` event carries the digest of the text it added) is auto-approved;
      // one an editor wrote on the page and a pull saved, or whose text changed since, is left to the owner.
      // The policy speaks once and first: a pid already decided, reopened or converted, and a v2 (--revises), are left to the owner.
      const events = readEvents(io.cwd).filter(e => e.kind === 'proposal' && e.id === id);
      const decided = doc.status !== 'proposed' || loadApproval(io.cwd, id) !== null
        || events.some(e => e.action === 'decide' || e.action === 'reopen' || e.action === 'to-task');
      const forgeMade = events.some(e => e.action === 'add' && e.digest === proposalDigest(id, doc) && !e.revises);
      // Carry 5: a refusal says why, so the infinite skill and the person can tell them apart: already decided (or
      // marked, or converted), not this checkout's own text, or its signals.
      const reason = decided ? 'decided' : !forgeMade ? 'origin' : !autoApprovable(doc) ? 'signals' : null;
      if (reason) {
        appendEvent(io.cwd, { ts: ts(), kind: 'proposal', action: 'policy', id, status: doc.status });
        return json({ id, status: doc.status, write: null, approval: null, reason });
      }
      const at = ts();
      saveProposal(io.cwd, id, { ...doc, status: 'auto_approved', decidedBy: 'forge:policy', decidedAt: at });
      const approval = approvalOf(id, 'auto_approved', at, doc, 'forge:policy');
      saveApproval(io.cwd, id, approval.data);
      appendEvent(io.cwd, { ts: at, kind: 'proposal', action: 'policy', id, status: 'auto_approved' });
      return json({ id, status: 'auto_approved', write: { status: 'auto_approved', decidedBy: 'forge:policy', decidedAt: at }, approval });
    }
    case 'to-task': {
      const id = rest[0];
      if (!id || !PROPOSAL_ID.test(id)) throw new UsageError('proposals to-task: a proposal id is required');
      const planArg = subFlag('plan');
      if (!planArg) throw new UsageError('proposals to-task: --plan is required');
      const found = loadProposals(io.cwd).find(p => p.id === id);
      if (!found) throw new UsageError(`proposals to-task: ${id} not found`);
      if (!isActionable(found)) throw new UsageError(`proposals to-task: ${id} is not approved`);
      if (found.taskId !== undefined) throw new UsageError(`proposals to-task: ${id} already has task ${found.taskId}`);
      // §4.1: only the roadmap owner's approvals become tasks: the mark must agree with the proposal and with its text.
      // A decision this checkout reopened since stops counting, even if its mark is still in the roadmap, unless the
      // owner decided again after it (carry 12).
      const mark = loadApproval(io.cwd, id);
      const lastStatus = bindingDecision(lastDecisions(io.cwd)[id], mark, pulledRules(io.cwd) >= PAGE_RULES, io.now().getTime());
      const check = ownerCheck(id, found, mark, lastStatus);
      if (check === 'no-mark') throw new UsageError(`proposals to-task: ${id} has no mark of the roadmap's owner (approvals/${id}); only the owner's approvals become tasks`);
      if (!ownerApproved(id, found, mark, lastStatus)) throw new UsageError(`proposals to-task: ${id} was edited after the owner's approval; it needs a new approval`);
      // A mark is spent once: a proposal that already became a task (the ledger, which a pull never touches, or the plan)
      // is not turned into another by a copy that lost its taskId.
      const spent = readEvents(io.cwd).find(e => e.kind === 'proposal' && e.action === 'to-task' && e.id === id);
      const text = readText(planArg, '--plan');
      let plan;
      try { plan = parsePlan(text); } catch (e) {
        if (e instanceof PlanError) throw new UsageError(`${planArg}: ${e.issues.join('; ')}`);
        throw e;
      }
      const became = plan.tasks.find(t => proposalsOfIncludes(t.includes).includes(id))?.id ?? (spent ? String(spent.taskId ?? '?') : undefined);
      if (became !== undefined) throw new UsageError(`proposals to-task: proposal ${id} already became ${became}: a new approval of a new proposal is needed`);
      const { task, phase } = proposalToTask(plan, found, { track: subFlag('track') });
      // The Document API keeps comments and order; values are nodes, never spliced into text.
      const ydoc = parseDocument(text);
      if (phase) ydoc.addIn(['phases'], ydoc.createNode(phase));
      ydoc.addIn(['tasks'], ydoc.createNode(task));
      const next = String(ydoc);
      try { parsePlan(next); } catch (e) {
        if (e instanceof PlanError) throw new UsageError(`proposals to-task: the resulting plan is invalid: ${e.issues.join('; ')}`);
        throw e;
      }
      writeFileSync(path.resolve(io.cwd, planArg), next);
      const { id: _id, ...doc } = found;
      saveProposal(io.cwd, id, { ...doc, taskId: task.id });
      appendEvent(io.cwd, { ts: ts(), kind: 'proposal', action: 'to-task', id, taskId: task.id });
      return json({ id, taskId: task.id, write: { taskId: task.id } });
    }
    default:
      throw new UsageError('usage: forge proposals <add|list|decide|save|pull|policy|to-task> ...');
  }
};
