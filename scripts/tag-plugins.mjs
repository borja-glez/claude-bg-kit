// C8, I-05: after a plan is merged into main with a clean tree, one local tag per plugin whose version changed, as
// `claude plugin tag` makes it (<name>--v<version>, after checking plugin.json against the marketplace). Without --apply
// it only shows them (--dry-run). It never pushes: --push is refused, and publishing tags is the person's call.
// Usage: node scripts/tag-plugins.mjs <waypoint|forge|lens|java>… [--apply]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGINS = ['waypoint', 'forge', 'lens', 'java'];
const USAGE = 'usage: node scripts/tag-plugins.mjs <waypoint|forge|lens|java>… [--apply]';

/** The `claude` arguments that tag each named plugin, or the error that stops the script. */
export function tagCommands(argv) {
  const apply = argv.includes('--apply');
  const rest = argv.filter(a => a !== '--apply');
  const option = rest.find(a => a.startsWith('-'));
  if (option !== undefined) return { error: `tag-plugins: ${option} is not an option of this script (it never pushes); ${USAGE}` };
  const unknown = rest.find(a => !PLUGINS.includes(a));
  if (unknown !== undefined) return { error: `tag-plugins: unknown plugin ${unknown}; ${USAGE}` };
  if (!rest.length) return { error: USAGE };
  return { cmds: [...new Set(rest)].map(p => ['plugin', 'tag', `plugins/${p}`, '-m', `${p} %s`, ...(apply ? [] : ['--dry-run'])]) };
}

// claude is a .cmd shim on Windows, so it goes through the shell; the message is the only argument with a space.
const shellLine = args => ['claude', ...args.map(a => (/\s/.test(a) ? `"${a}"` : a))].join(' ');

function main(argv) {
  const r = tagCommands(argv);
  if ('error' in r) { process.stderr.write(`${r.error}\n`); return 2; }
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const c of r.cmds) {
    process.stdout.write(`${shellLine(c)}\n`);
    const s = spawnSync(shellLine(c), { cwd: root, shell: true, stdio: 'inherit' });
    if (s.status !== 0) return s.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
