// w8 M1: Claude Code's own tasks (the Claude Code tasks card), from the tool calls that make and change them, as tool.call
// carries them in 2.1.310: TaskCreate's result names the new task, TaskUpdate's input the task and its new status or
// subject. The classic TaskCreated / TaskCompleted hooks said the same, but cc-plugin-sec-default passes every classic
// hook of a plugin the person installed over where it is seated, so lens never hangs on them. Pure: register.tsx feeds
// it the calls that ran (neither refused nor failed).

export interface CcTask { id: string; subject: string; done: boolean }
/** At most this many tasks are kept, the newest. */
export const CC_TASKS_MAX = 50;

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null);
const idOf = (x: unknown): string | null => (typeof x === 'string' && x ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : null);
const textOf = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);
const capped = (list: CcTask[]): CcTask[] => list.slice(-CC_TASKS_MAX);

/**
 * The task list after a TaskCreate or TaskUpdate call that ran with `input` and `result`; null when the call says
 * nothing of a task (another tool, a failed update, a result without the task's id). A task lens did not see created
 * is taken in by its update, named by its id when the call gives no subject.
 */
export function taskCall(list: readonly CcTask[], tool: string, input: Record<string, unknown>, result: unknown): CcTask[] | null {
  if (tool === 'TaskCreate') {
    const task = obj(obj(result)?.task);
    const id = idOf(task?.id);
    if (!id) return null;
    const subject = textOf(task?.subject) ?? textOf(input.subject) ?? `#${id}`;
    return capped([...list.filter(t => t.id !== id), { id, subject, done: false }]);
  }
  if (tool === 'TaskUpdate') {
    if (obj(result)?.success === false) return null;
    const id = idOf(input.taskId);
    if (!id) return null;
    const status = input.status;
    if (status === 'deleted') return list.filter(t => t.id !== id);
    const was = list.find(t => t.id === id);
    const done = status === 'completed' ? true : status === 'pending' || status === 'in_progress' ? false : was?.done ?? false;
    const subject = textOf(input.subject) ?? was?.subject ?? `#${id}`;
    const next = { id, subject, done };
    return was ? list.map(t => (t.id === id ? next : t)) : capped([...list, next]);
  }
  return null;
}
