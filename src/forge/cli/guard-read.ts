// w7 integration (A4 R16): the PreToolUse hook of Read, Grep and Glob, built alone into dist/guard-read.cjs. Outside a
// forge agent `hook guard` prints nothing for these tools before it builds its context, but loading forge.cjs to learn
// that cost 105-205 ms a call against about 57 ms for a bare node, on every Read, Grep and Glob of every session. This
// script exits at once, with no output, for what readPassesAtOnce passes; anything else (a forge agent's call) goes to
// `forge.cjs hook guard` next to it with the same stdin, and its stdout, stderr and exit code come back unchanged.
// forge.cjs runs its CLI as soon as it loads, so it cannot be required here: it runs as a child process.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readPassesAtOnce } from '../guard-fast.js';

let stdin = '';
// Never from a terminal (it would wait for input), as forge.cjs reads it.
if (!process.stdin.isTTY) { try { stdin = readFileSync(0, 'utf8'); } catch { stdin = ''; } }
if (!readPassesAtOnce(stdin)) {
  const forge = path.join(path.dirname(process.argv[1]), 'forge.cjs');
  const r = spawnSync(process.execPath, [forge, 'hook', 'guard'], { input: stdin, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  // A child that did not start is an error of the hook, and these tools fail open: nothing is printed.
  if (!r.error) {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exitCode = r.status ?? 1;
  }
}
