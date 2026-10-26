// w8 M3: why /lens failed, in the words its command.run .catch answers with: the failure's own message (HookFailure, on
// next.error), on one line and at most FAILURE_MAX characters, or that it ran out of time. Pure: register.tsx passes its
// texts and next.error.

export const FAILURE_MAX = 200;

export function failureText(t: { outOfTime: string; failedPlain: string }, error: { kind?: unknown; message?: unknown } | undefined): string {
  const message = typeof error?.message === 'string' ? error.message.replace(/\s+/g, ' ').trim().slice(0, FAILURE_MAX) : '';
  if (error?.kind === 'timeout') return message ? `${t.outOfTime} (${message})` : t.outOfTime;
  return message || t.failedPlain;
}
