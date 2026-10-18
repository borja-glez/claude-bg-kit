// I-03: the stdin of forge's hook `answer` (PostToolUse on AskUserQuestion) as Claude Code sends it: the questions asked
// in tool_input and the person's answers in tool_response (question → the chosen label, or their own text). The tests of
// the hook and those of the merges that need the person's answer build it here.

export interface HookAnswer {
  /** The project directory the session runs in (the input's `cwd`). */
  cwd: string;
  /** The answers in tool_response; null leaves tool_response out (the hook then reads the transcript). */
  answers: Record<string, string> | null;
  /** The questions of the AskUserQuestion call, in order; the questions of `answers` when left out. */
  questions?: string[];
  /** The session that answered (`session_id`). */
  session?: string;
  /** More fields of the input (`transcript_path`, `tool_use_id`…), or other values of these. */
  extra?: Record<string, unknown>;
}

/** The hook input, as an object. */
export function hookAnswerInput(o: HookAnswer): Record<string, unknown> {
  const questions = o.questions ?? Object.keys(o.answers ?? {});
  return {
    session_id: o.session ?? 's1', cwd: o.cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: questions.map(question => ({ question, header: 'x', options: [], multiSelect: false })) },
    ...(o.answers ? { tool_response: { questions: [], answers: o.answers } } : {}),
    ...o.extra,
  };
}

/** The hook input, as the JSON text of its stdin. */
export const hookAnswerStdin = (o: HookAnswer): string => JSON.stringify(hookAnswerInput(o));
