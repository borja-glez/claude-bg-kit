import { readFileSync } from 'node:fs';
import { run, defaultExec, defaultGit } from './run.js';

const cwd = process.cwd();
let stdin = '';
// Only the hook reads stdin, and never from a terminal (it would wait for input).
if (process.argv[2] === 'hook' && !process.stdin.isTTY) { try { stdin = readFileSync(0, 'utf8'); } catch { stdin = ''; } }
const r = run(process.argv.slice(2), { cwd, stdin, now: () => new Date(), exec: defaultExec(cwd), git: defaultGit(cwd), env: process.env });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.code;
