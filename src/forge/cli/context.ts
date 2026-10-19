import type { Io } from './run.js';

export type Result = { code: number; stdout: string; stderr: string };

/** K2-03: the arguments that are forge's: those before a `--`. What follows it is a command forge runs (verify-spawn). */
export const ownArgs = (args: string[]): string[] => {
  const at = args.indexOf('--');
  return at < 0 ? args : args.slice(0, at);
};

/**
 * I-12: what every forge command gets besides its arguments, built once per call by runCommand (after --cwd): the io,
 * the directory of the code, the command's own name, its flag readers and output helpers, and the CLI itself (a command
 * that runs another one, as swarm step does, calls ctx.run instead of importing run.ts).
 */
export function makeCtx(cmd: string, args: string[], io: Io, repoDir: string, run: (argv: string[], io: Io) => Result) {
  const own = ownArgs(args);
  const flag = (name: string) => {
    const i = own.indexOf(`--${name}`);
    const v = i >= 0 ? own[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const has = (name: string) => own.includes(`--${name}`);
  const ok = (out: string): Result => ({ code: 0, stdout: out.endsWith('\n') ? out : `${out}\n`, stderr: '' });
  const json = (v: unknown, code = 0): Result => ({ code, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });
  const ts = () => io.now().toISOString();
  return { io, repoDir, cmd, flag, has, ok, json, ts, run };
}
export type Ctx = ReturnType<typeof makeCtx>;
/** A forge command: its arguments after the command's name, and the context of the call. */
export type Command = (args: string[], ctx: Ctx) => Result;
