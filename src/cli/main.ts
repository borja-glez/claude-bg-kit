import path from 'node:path';
import { readFileSync } from 'node:fs';
import { run } from './run.js';

let stdin = '';
if (process.argv[2] === 'hook') { try { stdin = readFileSync(0, 'utf8'); } catch { stdin = ''; } }
const r = run(process.argv.slice(2), {
  stdin,
  env: process.env,
  cwd: process.cwd(),
  now: () => new Date(),
  assetsDir: process.env.WAYPOINT_ASSETS ?? path.resolve(path.dirname(process.argv[1]), '../assets'),
});
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exitCode = r.code;
