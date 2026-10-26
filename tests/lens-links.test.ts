import { describe, it, expect } from 'vitest';
import {
  addOwnTask, endAgent, knownTasks, linkSpawn, ownTaskOf, pruneLinks, setTool, syncListed, taskOfPrompt,
  DONE_LINK_MS, LINKS_MAX, LIST_GRACE_MS, PROMPT_SCAN, WORKFLOW_AGENT_TTL_MS, type AgentLink,
} from '../src/lens/links.js';
import { taskLine } from '../src/forge/task-ref.js';

const known = new Set(['T001', 'T002', 't-1']);
const NOW = Date.parse('2026-10-16T10:00:00.000Z');
type Over = Partial<{ description: string; parentId: string | null; workflow: { runId: string; index: number } | null; type: string }>;
const spawn = (id: string, prompt: string, over: Over = {}) => ({
  id, type: over.type ?? 'forge:forge-impl', description: over.description ?? '', prompt, parentId: over.parentId ?? null, workflow: over.workflow ?? null, now: NOW,
});
const bare = (id: string, parentId: string | null, task: string | null = null): AgentLink => ({
  id, type: 'x', description: '', since: NOW, task, brief: null, project: null, via: task ? 'contract' : null, parentId, workflow: null, status: 'running', tool: null, endedAt: null,
});

describe('taskOfPrompt (E-02)', () => {
  it('reads the contract line, then Task id:, then a work path, then a known id in the description', () => {
    expect(taskOfPrompt('forge-task: T001-2 @shop\nImplement the brief.', '', known)).toEqual({ task: 'T001', brief: 2, project: 'shop', via: 'contract' });
    expect(taskOfPrompt('Brief below.\nTask id: T001-2\n', '', known)).toEqual({ task: 'T001', brief: 2, project: null, via: 'task-id' });
    expect(taskOfPrompt('Read .forge/work/shop/T001/brief-2.md first', '', known)).toEqual({ task: 'T001', brief: 2, project: 'shop', via: 'work-path' });
    expect(taskOfPrompt('Review .forge/work/T002/reviews-1-1/ as correctness', '', known)).toEqual({ task: 'T002', brief: null, project: null, via: 'work-path' });
    expect(taskOfPrompt('No task named here', 'Implement T002: orders', known)).toEqual({ task: 'T002', brief: null, project: null, via: 'description' });
    expect(taskOfPrompt('forge-task: T002-1\r\nTask id: T001-3\n.forge/work/T001/', '', known)).toMatchObject({ task: 'T002', brief: 1, via: 'contract' });
  });
  it('a known id with a dash wins whole; unsafe ids, a line past 8 KB, Windows paths and junk never throw (Review Focus 3)', () => {
    expect(taskOfPrompt('forge-task: t-1', '', known)).toEqual({ task: 't-1', brief: null, project: null, via: 'contract' });
    expect(taskOfPrompt('forge-task: t-2', '', known)).toEqual({ task: 't', brief: 2, project: null, via: 'contract' });
    expect(taskOfPrompt('Read .forge\\work\\T002\\brief-1.md', '', known)).toEqual({ task: 'T002', brief: 1, project: null, via: 'work-path' });
    expect(taskOfPrompt('forge-task: ../x @..', '', known)).toBeNull();
    expect(taskOfPrompt('forge-task: T001 @a b', '', known)).toBeNull();
    expect(taskOfPrompt(`${'x'.repeat(PROMPT_SCAN)}\nforge-task: T001-1`, '', known)).toBeNull();
    expect(taskOfPrompt('.forge/work/run/step.json', 'T009 work', known)).toBeNull();
    expect(taskOfPrompt(undefined as unknown as string, 42 as unknown as string, known)).toBeNull();
  });
  it('reads what forge writes: taskLine, a 120-character project, a plan task brief path, CRLF and backslashes', () => {
    const project = 'p'.repeat(120);
    expect(taskOfPrompt(`${taskLine('T001-2', project)}\nImplement.`, '', known)).toEqual({ task: 'T001', brief: 2, project, via: 'contract' });
    expect(taskOfPrompt(`${taskLine('T001', null)}\nImplement.`, '', known)).toEqual({ task: 'T001', brief: null, project: null, via: 'contract' });
    expect(taskOfPrompt(`Read .forge/work/${project}/T001/brief-2.md`, '', known)).toEqual({ task: 'T001', brief: 2, project, via: 'work-path' });
    expect(taskOfPrompt(`Read .forge\\work\\${project}\\T001\\brief-2.md`, '', known)).toEqual({ task: 'T001', brief: 2, project, via: 'work-path' });
    expect(taskOfPrompt(`${taskLine('T001-2', 'shop')}\r\nImplement.\r\n`, '', known)).toEqual({ task: 'T001', brief: 2, project: 'shop', via: 'contract' });
    expect(taskOfPrompt(`${taskLine('T001-2', 'shop')}\r`, '', known)).toMatchObject({ task: 'T001', project: 'shop' });
    expect(taskOfPrompt(`forge-task: T001-1 @${'p'.repeat(121)}`, '', known)).toBeNull();
  });
  it('a hostile prompt gets no task, or the right one, and never throws', () => {
    const hostile = [
      'forge-task: ../x @..', 'forge-task: .. @..', 'forge-task: T001 @../../etc', 'forge-task: ' + 'a'.repeat(5000),
      'Task id: ../..', '.forge/work/../x/y', '.forge\\work\\..\\..\\x', '', '\0\0\0', 'forge-task:', 'forge-task: @shop',
    ];
    for (const p of hostile) expect(() => taskOfPrompt(p, '', known)).not.toThrow();
    for (const p of hostile.slice(0, 5)) expect(taskOfPrompt(p, '', known)).toBeNull();
    expect(taskOfPrompt('.forge/work/../x/y', '', known)).toBeNull();
    expect(taskOfPrompt('.forge\\work\\..\\..\\x', '', known)).toBeNull();
    for (const bad of [null, {}, [], 7, Symbol.iterator, () => 1]) {
      expect(taskOfPrompt(bad as unknown as string, bad as unknown as string, known)).toBeNull();
    }
    expect(taskOfPrompt('forge-task: T001-1', undefined as unknown as string, known)).toMatchObject({ task: 'T001' });
  });
  it('a prompt without a contract line that mentions the work path of another task takes that task (pinned fallback order)', () => {
    expect(taskOfPrompt('Compare with .forge/work/T002/brief-1.md', 'T001 helper', known)).toEqual({ task: 'T002', brief: 1, project: null, via: 'work-path' });
  });
});

describe('the agents and their task (E-02, E-09)', () => {
  it('a spawn takes the task its prompt names; a child without one inherits its parent, five levels up at most', () => {
    let links = linkSpawn([], spawn('a1', 'forge-task: T001-1 @shop'), known);
    links = linkSpawn(links, spawn('a2', 'explore the parser', { parentId: 'a1', type: 'Explore' }), known);
    links = linkSpawn(links, spawn('a3', 'look deeper', { parentId: 'a2', type: 'Explore' }), known);
    expect(links.map(l => [l.id, l.task, l.project, l.via])).toEqual([['a1', 'T001', 'shop', 'contract'], ['a2', 'T001', 'shop', 'parent'], ['a3', 'T001', 'shop', 'parent']]);
    const deep = [bare('x0', null, 'T002'), bare('x1', 'x0'), bare('x2', 'x1'), bare('x3', 'x2'), bare('x4', 'x3'), bare('x5', 'x4')];
    expect(linkSpawn(deep, spawn('y', 'x', { parentId: 'x4' }), known).at(-1)?.task).toBe('T002');
    expect(linkSpawn(deep, spawn('z', 'x', { parentId: 'x5' }), known).at(-1)?.task).toBeNull();
  });
  it('a spawn that resumes an agent keeps its link\'s task, parent and words, whatever the resuming message says (review Minor 4)', () => {
    let links = linkSpawn([], spawn('p', 'forge-task: T002-1'), known);
    links = linkSpawn(links, spawn('a1', 'forge-task: T001-1 @shop', { description: 'implement T001', parentId: 'p' }), known);
    links = endAgent(links, 'a1', NOW, { any: true });
    const resumed = linkSpawn(links, { ...spawn('a1', 'Please also fix the lint', { description: '' }), resume: true, now: NOW + 60_000 }, known).find(l => l.id === 'a1')!;
    expect(resumed).toMatchObject({ task: 'T001', project: 'shop', via: 'contract', parentId: 'p', description: 'implement T001', status: 'running', endedAt: null, since: NOW + 60_000 });
    // Without resume, a spawn of the id is a new agent: its own prompt decides.
    expect(linkSpawn(links, spawn('a1', 'Please also fix the lint'), known).find(l => l.id === 'a1')?.task).toBeNull();
  });
  it('the list is the truth for what it lists: idle stays, gone is done; a workflow agent lives until its turn ends, at most two hours', () => {
    let links = linkSpawn([], spawn('a1', 'forge-task: T001-1'), known);
    links = linkSpawn(links, spawn('w1', 'forge-task: T002-1', { workflow: { runId: 'wf_1', index: 1 } }), known);
    links = syncListed(links, [
      { id: 'a1', type: 'forge:forge-impl', description: 'impl', status: 'idle', parentId: null },
      { id: 'tm', type: 'teammate', description: 'T002 helper', status: 'running', parentId: null },
    ], NOW + 1000, known);
    expect(links.find(l => l.id === 'a1')?.status).toBe('idle');
    expect(links.find(l => l.id === 'w1')?.status).toBe('running');
    expect(links.find(l => l.id === 'tm')).toMatchObject({ task: 'T002', via: 'description', status: 'running' });
    // tm is still running here: only SubagentStop (`any`) ends it, a plain turn.complete does not
    expect(endAgent(links, 'tm', NOW + 1500).find(l => l.id === 'tm')?.status).toBe('running');
    expect(endAgent(links, 'tm', NOW + 1500, { any: true }).find(l => l.id === 'tm')).toMatchObject({ status: 'done', endedAt: NOW + 1500 });
    const GONE = NOW + LIST_GRACE_MS + 2000;
    links = syncListed(links, [], GONE, known);
    expect(links.find(l => l.id === 'a1')).toMatchObject({ status: 'done', endedAt: GONE });
    expect(links.find(l => l.id === 'w1')?.status).toBe('running');
    expect(endAgent(links, 'w1', NOW + 3000).find(l => l.id === 'w1')).toMatchObject({ status: 'done', endedAt: NOW + 3000 });
    expect(endAgent(linkSpawn([], spawn('b1', 'x'), known), 'b1', NOW + 3000)[0].status).toBe('running');
    expect(endAgent(linkSpawn([], spawn('b1', 'x'), known), 'b1', NOW + 3000, { any: true })[0].status).toBe('done');
    expect(pruneLinks(links, NOW + WORKFLOW_AGENT_TTL_MS + 1).find(l => l.id === 'w1')?.status).toBe('done');
    expect(pruneLinks(links, GONE + DONE_LINK_MS + 1).find(l => l.id === 'a1')).toBeUndefined();
  });
  it('a link spawned just before a list that omits it is not ended; an older one is; a future one is not', () => {
    const at = (age: number) => [{ ...bare('r', null), since: NOW - age }];
    expect(syncListed(at(5_000), [], NOW, known)[0].status).toBe('running');
    expect(syncListed(at(LIST_GRACE_MS + 5_000), [], NOW, known)[0]).toMatchObject({ status: 'done', endedAt: NOW });
    expect(syncListed(at(-60_000), [], NOW, known)[0].status).toBe('running');
  });
  it('a listed agent or a tool with odd fields never throws', () => {
    const odd = [{ id: 'o1', type: undefined, description: undefined, status: 'running', parentId: null }, { id: 'o2', type: 7, description: 9, status: 'idle', parentId: null }] as unknown as Parameters<typeof syncListed>[1];
    let links: AgentLink[] = [];
    expect(() => { links = syncListed([], odd, NOW, known); }).not.toThrow();
    expect(links.map(l => l.id)).toEqual(['o1', 'o2']);
    links = linkSpawn(links, spawn('t1', 'x'), known);
    expect(() => { links = setTool(links, 't1', { name: 5 as unknown as string, since: NOW }); }).not.toThrow();
    expect(links.find(l => l.id === 't1')?.tool?.since).toBe(NOW);
    expect(() => setTool(links, 't1', { name: undefined as unknown as string, since: NOW })).not.toThrow();
  });
  it('a tool in flight stays on its agent until it returns; the list keeps 100 agents at most', () => {
    let links = linkSpawn([], spawn('a1', 'forge-task: T001-1'), known);
    links = setTool(links, 'a1', { name: 'Edit', since: NOW });
    expect(links[0].tool).toEqual({ name: 'Edit', since: NOW });
    expect(setTool(links, 'a1', null)[0].tool).toBeNull();
    for (let i = 0; i < 150; i++) links = linkSpawn(links, spawn(`b${i}`, 'x'), known);
    expect(links).toHaveLength(LINKS_MAX);
    expect(links.at(-1)?.id).toBe('b149');
  });
});

describe('own tasks and known tasks (E-06)', () => {
  it('reads --task and swarm task from a forge.cjs command, nothing else; keeps the newest 100', () => {
    expect(ownTaskOf('node "/x/dist/forge.cjs" prep --task T001-1 --path medium')).toBe('T001-1');
    expect(ownTaskOf('node /x/forge.cjs swarm task T002 --stage review')).toBe('T002');
    expect(ownTaskOf('npm test -- --task T001')).toBeNull();
    expect(ownTaskOf('node forge.cjs prep --task ../x')).toBeNull();
    expect(ownTaskOf(42)).toBeNull();
    let own: string[] = [];
    for (let i = 0; i < 120; i++) own = addOwnTask(own, `T${i}`);
    own = addOwnTask(own, 'T50');
    expect(own).toHaveLength(100);
    expect(own.at(-1)).toBe('T50');
    expect(addOwnTask(own, null)).toEqual(own);
  });
  it('the known tasks are the forge activities and the slots of the execution', () => {
    expect([...knownTasks({ activities: [{ kind: 'forge', task: 'T001' }, { kind: 'workflow', task: null }], execution: { slots: [{ task: 'T002' }] } })].sort()).toEqual(['T001', 'T002']);
    expect(knownTasks(null).size).toBe(0);
  });
});
