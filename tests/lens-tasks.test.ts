import { describe, it, expect } from 'vitest';
import { taskCall, CC_TASKS_MAX, type CcTask } from '../src/lens/tasks.js';

// w8 M1: Claude Code's tasks come from the TaskCreate and TaskUpdate calls that ran (their input and result as tool.call
// carries them in 2.1.310), not from the classic TaskCreated / TaskCompleted hooks.
const created = (id: string, subject: string) => ({ task: { id, subject } });
const updated = (taskId: string, to?: string) => ({ success: true, taskId, updatedFields: to ? ['status'] : [], ...(to ? { statusChange: { from: 'pending', to } } : {}) });

describe('Claude Code tasks from their tool calls (w8 M1)', () => {
  it('TaskCreate adds the task its result names, open', () => {
    expect(taskCall([], 'TaskCreate', { subject: 'Write the spec', description: 'd' }, created('1', 'Write the spec')))
      .toEqual([{ id: '1', subject: 'Write the spec', done: false }]);
    // The subject of the input when the result has none; an id given as a number is kept as text.
    expect(taskCall([], 'TaskCreate', { subject: 'Ship it', description: 'd' }, { task: { id: 7 } })).toEqual([{ id: '7', subject: 'Ship it', done: false }]);
  });
  it('TaskUpdate completes, reopens, renames and deletes the task it names', () => {
    const one: CcTask[] = [{ id: '1', subject: 'Write the spec', done: false }, { id: '2', subject: 'Ship it', done: false }];
    const done = taskCall(one, 'TaskUpdate', { taskId: '1', status: 'completed' }, updated('1', 'completed'))!;
    expect(done).toEqual([{ id: '1', subject: 'Write the spec', done: true }, { id: '2', subject: 'Ship it', done: false }]);
    expect(taskCall(done, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, updated('1', 'in_progress'))![0]).toEqual({ id: '1', subject: 'Write the spec', done: false });
    expect(taskCall(one, 'TaskUpdate', { taskId: '2', subject: 'Ship it today' }, updated('2'))![1]).toEqual({ id: '2', subject: 'Ship it today', done: false });
    expect(taskCall(one, 'TaskUpdate', { taskId: '1', status: 'deleted' }, updated('1', 'deleted'))).toEqual([{ id: '2', subject: 'Ship it', done: false }]);
  });
  it('a task lens did not see created is counted by its update, named by its id when the call gives no subject', () => {
    expect(taskCall([], 'TaskUpdate', { taskId: '4', status: 'completed' }, updated('4', 'completed'))).toEqual([{ id: '4', subject: '#4', done: true }]);
    expect(taskCall([], 'TaskUpdate', { taskId: '4', status: 'deleted' }, updated('4', 'deleted'))).toEqual([]);
  });
  it('a failed update changes nothing, and other tools say nothing', () => {
    const one: CcTask[] = [{ id: '1', subject: 's', done: false }];
    expect(taskCall(one, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: false, taskId: '1', updatedFields: [], error: 'no such task' })).toBeNull();
    expect(taskCall(one, 'TaskCreate', { subject: 's' }, { nothing: true })).toBeNull();
    expect(taskCall(one, 'TaskUpdate', { status: 'completed' }, updated('', 'completed'))).toBeNull();
    expect(taskCall(one, 'TodoWrite', { todos: [] }, {})).toBeNull();
    expect(taskCall(one, 'TaskList', {}, { tasks: [] })).toBeNull();
  });
  it('keeps at most CC_TASKS_MAX, the newest', () => {
    let list: CcTask[] = [];
    for (let i = 0; i < CC_TASKS_MAX + 5; i++) list = taskCall(list, 'TaskCreate', { subject: `t${i}` }, created(String(i), `t${i}`))!;
    expect(list).toHaveLength(CC_TASKS_MAX);
    expect(list[0].id).toBe('5');
    expect(list.at(-1)!.id).toBe(String(CC_TASKS_MAX + 4));
  });
});
