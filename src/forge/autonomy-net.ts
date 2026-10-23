// Plan 6b-1, Task 5 (fix round 1): the three rules that keep an autonomous run from writing OFF the machine — `network`
// (HTTP writes to a host that is not local, publishing, and copies to another host, by Bash or PowerShell), `cloud` (the
// cloud and deploy CLIs read by their SHAPE, T5-CLOUD-SHAPE-2: only a read or local word at the shape's verb position allows,
// and an unknown global option before it cancels the allow) and `mcp-write` (an MCP tool whose name says it writes, plus
// the person's signed-in browser tools, T5-BROWSER). Built fail-closed from the start (T5-LESSONS): a client option a tool's
// table does not know, a dynamic/unreadable URL, or a runner option the hook cannot read cancels the «this only reads»
// answer; a runner (npx, pnpm dlx, uvx, python -m, …) counts as the CLI it runs, its package spec mapped to the bin; a write
// verb anywhere wins. PowerShell web reading is Task 4's, reused from autonomy-parse.ts. Pure: reads no file, starts no
// process. T5-FILE: re-exported from autonomy-rules.ts; this file never imports it.
import type { GuardCtx, GuardInput, GuardRule, GuardVerdict } from './guard.js';
import { isLocalHost } from './resources.js';
import { commandName, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny, mcpWords } from './autonomy-shared.js';
import { BASH_TABLES, scan, type OptTable } from './autonomy-tables.js';
import { readWebRequest, type WebReq } from './autonomy-parse.js';

const NET_INSTEAD = 'only local services may be written; record the action as not done';
const CLOUD_INSTEAD = "read-only commands of that CLI are fine; anything that changes the service is the person's";
const MCP_INSTEAD = 'read tools of that server are fine; record the write as not done';
const BROWSER_INSTEAD = "drive an isolated browser (Playwright, chrome-devtools) to test the run's own pages; anything on the person's signed-in browser is theirs";

// ---- the lists (brief, Interfaces) ----------------------------------------------------------------------------------

const CLOUD_CLIS = new Set(['aws', 'gcloud', 'gsutil', 'az', 'kubectl', 'helm', 'terraform', 'tofu', 'pulumi', 'vercel', 'netlify',
  'fly', 'flyctl', 'heroku', 'firebase', 'wrangler', 'doctl', 'railway', 'serverless', 'sls', 'eas', 'supabase', 'stripe', 'gh',
  'glab', 'cdk', 'sam', 'amplify', 'oc', 'argocd', 'ansible', 'ansible-playbook', 'nomad', 'vault', 'consul', 'eb', 'copilot', 'hcloud']);
// The brief's read verbs, fix 2 (T5-CLOUD-SHAPE-2): `init` leaves (a local verb of terraform/tofu/cdk/sam/supabase only), `tail` and `read` join.
const READ_VERBS = new Set(['list', 'ls', 'get', 'describe', 'show', 'view', 'status', 'plan', 'whoami', 'version', 'help', 'logs',
  'log', 'diff', 'search', 'inspect', 'info', 'explain', 'validate', 'fmt', 'output', 'top', 'checks', 'tail', 'read']);
const CLOUD_WRITE_VERBS = new Set(['deploy', 'delete', 'destroy', 'rm', 'remove', 'create', 'apply', 'put', 'update', 'set',
  'terminate', 'run', 'scale', 'push', 'publish', 'start', 'stop', 'restart', 'cp', 'mv', 'sync', 'invoke', 'exec', 'import',
  'attach', 'detach', 'enable', 'disable', 'rollback', 'promote']);
// The brief's words plus the fix-round-1 additions (Minor 9): manage, rerun, toggle, accept, decline, retry, terminate, kill.
const MCP_WRITE_WORDS = new Set(['add', 'append', 'apply', 'approve', 'archive', 'assign', 'attach', 'batch', 'book', 'buy',
  'cancel', 'charge', 'clear', 'close', 'comment', 'commit', 'create', 'delete', 'deploy', 'destroy', 'detach', 'disable',
  'dismiss', 'dispatch', 'drop', 'edit', 'enable', 'exec', 'execute', 'follow', 'fork', 'generate', 'import', 'insert', 'install',
  'invite', 'label', 'like', 'link', 'lock', 'mark', 'merge', 'modify', 'move', 'notify', 'order', 'patch', 'pause', 'pay', 'pin',
  'post', 'provision', 'publish', 'purge', 'push', 'put', 'react', 'rebase', 'refund', 'register', 'reject', 'remove', 'rename',
  'reopen', 'replace', 'reply', 'request', 'reset', 'resolve', 'restart', 'restore', 'resume', 'revoke', 'rollback', 'run', 'save',
  'schedule', 'send', 'set', 'share', 'star', 'submit', 'subscribe', 'sync', 'transfer', 'trigger', 'unfollow', 'uninstall',
  'unlink', 'unlock', 'unpin', 'unpublish', 'unstar', 'unsubscribe', 'update', 'upload', 'upsert', 'vote', 'write',
  'manage', 'rerun', 'toggle', 'accept', 'decline', 'retry', 'terminate', 'kill']);
const MCP_READ_FIRST = new Set(['list', 'get', 'search', 'read', 'fetch', 'view', 'show', 'describe', 'query', 'find', 'count',
  'check', 'inspect', 'lookup', 'take', 'export', 'download', 'preview', 'explain', 'validate', 'analyze', 'summarize', 'diff',
  'status', 'whoami', 'ping']);
const MCP_LOCAL_TOOLS = new Set(['tabs_create_mcp', 'tabs_close_mcp', 'new_page', 'select_page', 'close_page']);

// ---- URLs and hosts -------------------------------------------------------------------------------------------------

/** The host of an httpie / scheme-less URL argument (httpie's `:port/path` localhost shorthand included); null when it cannot be read. */
function bareHost(text: string): string | null {
  const u = text.replace(/^https?:\/\//i, '');
  if (u.startsWith(':') || u.startsWith('/')) return 'localhost';
  const host = u.split(/[/?#]/)[0].replace(/:\d+$/, '');
  return host || null;
}
/** Whether a URL word is a local host: true / false, or 'unknown' when dynamic or neither `new URL()` nor the scheme-less reading finds a host. */
function urlHostLocal(w: Word): boolean | 'unknown' {
  if (w.dynamic) return 'unknown';
  let h: string | null = null;
  try { h = new URL(w.text).hostname || null; } catch { h = null; }
  if (h === null) h = bareHost(w.text);
  return h ? isLocalHost(h) : 'unknown';
}
const allLocal = (urls: Word[]): boolean => urls.length > 0 && urls.every(w => urlHostLocal(w) === true);
const knownRemote = (urls: Word[]): boolean => urls.length > 0 && urls.every(w => urlHostLocal(w) !== 'unknown');

const netWrite = (what: string): GuardVerdict => deny('network', what, NET_INSTEAD);
const netUnknown = (what: string): GuardVerdict => deny('network', `unknown target: ${what}`, NET_INSTEAD);

const WRITE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const isWriteMethod = (m: string): boolean => m !== '' && !WRITE_METHODS.includes(m);

// ---- runners --------------------------------------------------------------------------------------------------------

type Eff = { name: string; args: Word[] };
/**
 * T5-RUNNER-TABLES: each runner's own options before the package operand — the ones that take a value, its switches, and
 * the ones that name a package (read with PKG_BIN under T5-PKG-FLAG). An option outside its table cancels (unknown target).
 */
interface RunnerTable { valued: Set<string>; switches: Set<string>; pkg: Set<string> }
const COMMON_RUN = '-q --quiet -v --verbose --offline';
const RT = (valued: string, switches: string, pkg = ''): RunnerTable => {
  const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
  return { valued: set(valued), switches: set(`${switches} ${COMMON_RUN}`), pkg: set(pkg) };
};
const NPX_T = RT('-p --package -c --call --userconfig --cache --loglevel --registry --prefix -w --workspace --shell --node-options',
  '-y --yes --no -s --silent --no-install --install --prefer-offline --prefer-online --ignore-existing --workspaces --include-workspace-root --if-present', '-p --package');
const UVX_T = RT(`--from --with --with-editable --with-requirements -p --python --index --default-index --index-url --extra-index-url --find-links -f
  --constraint --override --refresh-package --upgrade-package --python-preference --cache-dir --directory --project --config-file --env-file --prerelease`,
  '--refresh --isolated -n --no-cache --native-tls --upgrade -U --reinstall --no-config --no-progress --no-env-file', '--from');
const BUNX_T = RT('-p --package', '--bun --silent --no-install', '-p --package');
const RUNNER_TABLES: Record<string, RunnerTable> = {
  npx: NPX_T, 'npm exec': NPX_T, bunx: BUNX_T, 'bun x': BUNX_T, uvx: UVX_T, 'uv tool run': UVX_T,
  'pnpm dlx': RT('--package --allow-build', '-c --shell-mode --silent -s', '--package'),
  'pnpm exec': RT('--filter -F --resume-from --workspace-concurrency', '-r --recursive -w --workspace-root -c --shell-mode --parallel --report-summary --no-bail --bail --silent -s'),
  'yarn dlx': RT('-p --package', '', '-p --package'),
  'uv run': RT(`--with --with-editable --with-requirements -p --python --directory --project --package --extra --group --only-group --no-group --env-file
    --index --default-index --index-url --extra-index-url --find-links -f --python-preference --cache-dir --config-file --prerelease --resolution --refresh-package`,
    '--frozen --locked --no-sync --all-extras --dev --no-dev --all-groups --only-dev --no-project --isolated -n --no-cache --refresh --script -s --all-packages --no-env-file --active --no-editable --exact -m --module'),
  'poetry run': RT('-C --directory -P --project', '-vv -vvv -n --no-interaction --ansi --no-ansi --no-plugins --no-cache'),
  'pdm run': RT('-p --project', '-l --list -s --site-packages --recreate -g --global'),
  'hatch run': RT('-e --env -p --project', ''),
  'pipx run': RT('--spec --python --pip-args --index-url', '--no-cache --fetch-missing-python --system-site-packages --path', '--spec'),
};
// Package specs whose installed bin differs from the package name.
const PKG_BIN: Record<string, string> = {
  'netlify-cli': 'netlify', 'firebase-tools': 'firebase', 'aws-cdk': 'cdk', 'eas-cli': 'eas', 'vercel': 'vercel', 'wrangler': 'wrangler',
  '@railway/cli': 'railway', '@aws-amplify/cli': 'amplify', '@vscode/vsce': 'vsce', '@supabase/cli': 'supabase', '@cloudflare/wrangler': 'wrangler',
};
const PKG_BUILTINS = new Set(['install', 'i', 'add', 'remove', 'rm', 'update', 'up', 'upgrade', 'run', 'run-script', 'test', 't', 'exec',
  'x', 'dlx', 'publish', 'pack', 'link', 'unlink', 'store', 'config', 'why', 'list', 'ls', 'outdated', 'audit', 'dedupe', 'import',
  'rebuild', 'prune', 'start', 'create', 'init', 'patch', 'version', 'workspace', 'workspaces', 'global', 'node', 'bin', 'cache', 'set', 'info']);
const PUBLISHER_NAMES = new Set(['twine', 'cargo', 'gem', 'vsce', 'ovsx', 'mvn', 'gradle', 'podman', 'docker']);

/** CLI aliases (fix 2): `vc` is vercel and `ntl` is netlify, as a direct command and as a runner operand. */
const CLI_ALIAS: Record<string, string> = { vc: 'vercel', ntl: 'netlify' };
const alias = (n: string): string => CLI_ALIAS[n] ?? n;

/** The bin a package spec installs: strip `@version` (keep the scope), then map known packages and aliases; else the package's own name. */
function pkgToBin(spec: string): string {
  let s = spec;
  if (s.startsWith('@')) { const slash = s.indexOf('/'); const at = s.indexOf('@', slash + 1); if (at > 0) s = s.slice(0, at); }
  else { const at = s.indexOf('@'); if (at > 0) s = s.slice(0, at); }
  return alias(PKG_BIN[s] ?? commandName({ text: s, dynamic: false, glob: false }));
}
/** A runner line the hook cannot read: the reason becomes the network rule's `unknown target`. */
type Cancel = { cancel: string };
const UNKNOWN_RUNNER_OPT: Cancel = { cancel: 'a runner option the hook does not know hides the command it runs' };
/** Skip a runner's own options (its table) to its package operand, collecting the package-naming values; a Cancel when an option outside the table comes first. */
function runnerRest(args: Word[], table: RunnerTable): { rest: Word[]; pkgs: Word[] } | Cancel {
  const pkgs: Word[] = [];
  let i = 0;
  while (i < args.length) {
    const t = args[i].text;
    if (t === '--') { i++; break; }
    if (!t.startsWith('-') || t === '-') break;
    const eq = t.indexOf('='), key = eq > 0 ? t.slice(0, eq) : t;
    if (table.valued.has(key)) {
      const v = eq > 0 ? { text: t.slice(eq + 1), dynamic: args[i].dynamic, glob: false } : args[i + 1];
      if (table.pkg.has(key) && v) pkgs.push(v);
      i += eq > 0 ? 1 : 2; continue;
    }
    if (table.switches.has(key)) { i++; continue; }
    return UNKNOWN_RUNNER_OPT;
  }
  return { rest: args.slice(i), pkgs };
}
const isCloudOrPublisher = (bin: string): boolean => CLOUD_CLIS.has(bin) || PUBLISHER_NAMES.has(bin);
/**
 * The command a runner runs. T5-PKG-FLAG: a `-p`/`--package` value is read with PKG_BIN; when it names a cloud or publisher
 * package and the operand is not that package's bin (or an alias of it), the line is unreadable (unknown target); when it is,
 * the cloud/publisher reading judges it. A dynamic `-p` value is unreadable too.
 */
function innerOf(r: { rest: Word[]; pkgs: Word[] } | Cancel): Eff | Cancel | null {
  if ('cancel' in r) return r;
  const { rest, pkgs } = r;
  if (pkgs.some(p => p.dynamic)) return { cancel: 'a runner package the shell hides' };
  const named = pkgs.map(p => pkgToBin(p.text.toLowerCase())).filter(isCloudOrPublisher);
  if (!rest.length) return named.length ? { name: named[0], args: [] } : null;
  if (rest[0].dynamic) return named.length ? { cancel: 'a runner command the shell hides' } : null;
  const bin = pkgToBin(rest[0].text.toLowerCase());
  if (named.some(n => n !== bin)) return { cancel: `the runner installs ${named.find(n => n !== bin)} but runs ${bin}` };
  return { name: bin, args: rest.slice(1) };
}

/** Which runner a call is (a RUNNER_TABLES key) and how many of its words name the runner itself; null when it is not one. */
function runnerOf(name: string, args: Word[]): { key: string; skip: number } | null {
  const a0 = args[0]?.text, a1 = args[1]?.text;
  if (name === 'npx' || name === 'bunx' || name === 'uvx') return { key: name, skip: 0 };
  if (name === 'bun' && a0 === 'x') return { key: 'bun x', skip: 1 };
  if (name === 'pnpm' && (a0 === 'dlx' || a0 === 'exec')) return { key: `pnpm ${a0}`, skip: 1 };
  if (name === 'yarn' && a0 === 'dlx') return { key: 'yarn dlx', skip: 1 };
  if (name === 'npm' && (a0 === 'exec' || a0 === 'x')) return { key: 'npm exec', skip: 1 };
  if (name === 'uv' && a0 === 'tool' && a1 === 'run') return { key: 'uv tool run', skip: 2 };
  if (['uv', 'poetry', 'pdm', 'hatch', 'pipx'].includes(name) && a0 === 'run') return { key: `${name} run`, skip: 1 };
  return null;
}
function unwrapRunner(name: string, args: Word[]): Eff | Cancel | null {
  const r = runnerOf(name, args);
  if (r) return innerOf(runnerRest(args.slice(r.skip), RUNNER_TABLES[r.key]));
  if (/^(?:python[0-9.]*|py)$/.test(name)) {
    const mi = args.findIndex(w => w.text === '-m');
    if (mi >= 0 && args[mi + 1] && !args[mi + 1].dynamic) return { name: pkgToBin(args[mi + 1].text.toLowerCase()), args: args.slice(mi + 2) };
  }
  // pnpm <bin> / yarn <bin> that is not a manager command: unwrap only when the bin is a cloud or publisher CLI (bounded).
  if ((name === 'pnpm' || name === 'yarn') && args[0] && !args[0].text.startsWith('-') && !args[0].dynamic && !PKG_BUILTINS.has(args[0].text.toLowerCase())) {
    const bin = pkgToBin(args[0].text.toLowerCase());
    if (isCloudOrPublisher(bin)) return { name: bin, args: args.slice(1) };
  }
  return null;
}
/** The command a segment runs: its name and arguments, runners unwrapped (up to three deep: `uv run python -m twine`). */
function effectiveCommand(seg: Segment): Eff | Cancel | null {
  if (!seg.argv.length || seg.argv[0].dynamic) return null;
  let eff: Eff = { name: alias(commandName(seg.argv[0])), args: seg.argv.slice(1) };
  for (let depth = 0; depth < 3; depth++) {
    const u = unwrapRunner(eff.name, eff.args);
    if (u === null) break;
    if ('cancel' in u) return u;
    eff = u;
  }
  return eff;
}

// ---- publishers -----------------------------------------------------------------------------------------------------

const SSH_LIKE = new Set(['ssh', 'scp', 'sftp', 'nc', 'ncat', 'telnet']);
const NPM_PUBLISH = new Set(['publish', 'unpublish', 'deprecate', 'dist-tag', 'owner', 'access', 'token', 'login', 'adduser']);
const RUN_SUBS = new Set(['run', 'run-script', 'exec', 'x', 'dlx']);
const SSH_VALUED: Record<string, Set<string>> = {
  ssh: new Set(['-p', '-i', '-o', '-l', '-c', '-b', '-e', '-F', '-L', '-R', '-D', '-W', '-J', '-Q', '-m', '-O', '-S', '-w']),
  scp: new Set(['-P', '-i', '-o', '-c', '-l', '-F', '-J', '-S']),
  sftp: new Set(['-P', '-i', '-o', '-c', '-l', '-F', '-J', '-S', '-B', '-D', '-R', '-b']),
  nc: new Set(['-p', '-s', '-w', '-X', '-x', '-b', '-q', '-i', '-O', '-T', '-g', '-G', '-m']),
  ncat: new Set(['-p', '-s', '-w', '-g', '-G', '-m', '-i', '-e', '-c']),
  telnet: new Set(['-b', '-l', '-n', '-e']),
};
/** Whether an rsync/scp operand is a remote spec `[user@]host:path`, `host::module` or `rsync://…` (not a local path or a Windows drive). */
function rsyncRemote(text: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return true;
  const m = /^([^/\\:]+)::?/.exec(text);
  return !!m && !/^[A-Za-z]$/.test(m[1]);
}
/** The host named by a connection spec: drop a scheme and a `user@`, then take the part before the first `:`, `/` or space. */
function hostToken(spec: string): string {
  let s = spec.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const at = s.indexOf('@'); if (at >= 0) s = s.slice(at + 1);
  return s.split(/[:/\s]/)[0];
}
/** Every host an ssh-like command would reach is local (Minor 3). */
function sshAllLocal(name: string, args: Word[]): boolean {
  const valued = SSH_VALUED[name] ?? new Set<string>();
  const ops: Word[] = [];
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '--') { for (let j = k + 1; j < args.length; j++) ops.push(args[j]); break; }
    if (t.startsWith('-')) { const key = t.includes('=') ? t.slice(0, t.indexOf('=')) : t; if (valued.has(key) && !t.includes('=')) k++; continue; }
    ops.push(args[k]);
  }
  if (name === 'scp' || name === 'sftp') {
    const rem = ops.filter(w => rsyncRemote(w.text) || w.text.includes('@'));
    return rem.length ? rem.every(w => !w.dynamic && isLocalHost(hostToken(w.text))) : true;
  }
  const h = ops[0];
  return h ? !h.dynamic && isLocalHost(hostToken(h.text)) : true;
}
function dockerPublish(args: Word[], ops: string[]): GuardVerdict | null {
  if (ops.includes('push') || ops.includes('login')) return netWrite('docker reaches a registry');
  if (args.some(w => /^--push(=.*)?$/.test(w.text))) return netWrite('docker --push reaches a registry');
  for (let k = 0; k < args.length; k++) {
    const m = /^(?:--output|-o)(?:=(.*))?$/.exec(args[k].text);
    if (m) { const v = m[1] ?? args[k + 1]?.text ?? ''; if (/type=registry|push=true|push,/.test(v)) return netWrite('docker --output pushes to a registry'); }
  }
  return null;
}
/** A command that sends something off this machine whatever its (missing) URL: PUBLISHERS. Null when the command is not one. */
function publisherDeny(name0: string, args: Word[]): GuardVerdict | null {
  const name = name0 === 'mvnw' ? 'mvn' : name0 === 'gradlew' ? 'gradle' : name0;
  const ops = args.filter(w => !w.text.startsWith('-') && !w.text.startsWith('/'));
  const words = ops.map(w => w.text.toLowerCase());
  const o0 = words[0] ?? '';
  const has = (set: Set<string>): boolean => words.some(w => set.has(w));
  if (SSH_LIKE.has(name)) return sshAllLocal(name, args) ? null : netWrite(`${name} connects to another host`);
  if (name === 'rsync') { const rem = ops.filter(w => rsyncRemote(w.text)); if (!rem.length) return null; return rem.every(w => !w.dynamic && isLocalHost(hostToken(w.text))) ? null : netWrite('rsync copies to another host'); }
  if (name === 'git' && o0 === 'send-email') return netWrite('git send-email sends patches off this machine');
  if ((name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') && !RUN_SUBS.has(o0) && has(NPM_PUBLISH)) return netWrite(`${name} publishes a package off this machine`);
  if (name === 'cargo' && has(new Set(['publish', 'yank', 'owner']))) return netWrite('cargo reaches the registry');
  if (name === 'twine' && words.includes('upload')) return netWrite('twine upload reaches the registry');
  if (['poetry', 'uv', 'hatch', 'flit', 'pdm'].includes(name) && words.includes('publish')) return netWrite(`${name} publish reaches the registry`);
  if (name === 'gem' && has(new Set(['push', 'yank']))) return netWrite('gem reaches the registry');
  if (name === 'dotnet' && o0 === 'nuget' && words[1] === 'push') return netWrite('dotnet nuget push reaches the registry');
  if (name === 'mvn' && words.includes('deploy')) return netWrite('mvn deploy reaches the repository');
  if (name === 'gradle' && ops.some(w => w.text === 'publish' || w.text.endsWith(':publish'))) return netWrite('gradle publish reaches the repository');
  if (name === 'docker') return dockerPublish(args, words);
  if (name === 'podman' && words.includes('push')) return netWrite('podman push reaches a registry');
  if ((name === 'vsce' || name === 'ovsx') && words.includes('publish')) return netWrite(`${name} publish reaches a marketplace`);
  return null;
}

// ---- curl / wget ----------------------------------------------------------------------------------------------------

// The data options (`-G`/`--get` turns these into a query) and the upload/form options (`-G` leaves them a write).
const CURL_DATA = ['-d', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json'];
const CURL_UPLOAD = ['-F', '--form', '--form-string', '-T', '--upload-file'];

function curlDeny(args: Word[], seg: Segment): GuardVerdict | null {
  const sc = scan(args, BASH_TABLES['curl'], seg.dialect);
  const urls = [...sc.ops, ...sc.vals.filter(v => v.key === '--url').map(v => v.w)];
  const proxied = ['-x', '--proxy', '--resolve', '--connect-to'].some(f => sc.flags.has(f));
  if (!proxied && allLocal(urls)) return null;
  const forceGet = sc.flags.has('-G') || sc.flags.has('--get');
  const method = sc.vals.filter(v => v.key === '-X' || v.key === '--request');
  const write = method.some(v => v.w.dynamic || isWriteMethod(v.w.text.toUpperCase())) || CURL_UPLOAD.some(f => sc.flags.has(f))
    || (!forceGet && CURL_DATA.some(f => sc.flags.has(f)));
  const configUnknown = sc.flags.has('-K') || sc.flags.has('--config');
  if (write) return knownRemote(urls) && !proxied ? netWrite('curl writes to a host that is not local') : netUnknown('curl writes to a host the hook cannot read');
  if (sc.unknown || configUnknown) return netUnknown('curl has an option the hook does not know, so a write to a remote host cannot be ruled out');
  return null;
}
function wgetDeny(args: Word[], seg: Segment): GuardVerdict | null {
  const sc = scan(args, BASH_TABLES['wget'], seg.dialect);
  const urls = sc.ops;
  if (allLocal(urls)) return null;
  const method = sc.vals.filter(v => v.key === '--method');
  const write = method.some(v => v.w.dynamic || isWriteMethod(v.w.text.toUpperCase())) || ['--post-data', '--post-file', '--body-data', '--body-file'].some(f => sc.flags.has(f));
  const execUnknown = sc.flags.has('-e') || sc.flags.has('--execute');
  if (write) return knownRemote(urls) ? netWrite('wget writes to a host that is not local') : netUnknown('wget writes to a host the hook cannot read');
  if (sc.unknown || execUnknown) return netUnknown('wget has an option the hook does not know, so a write to a remote host cannot be ruled out');
  return null;
}

// ---- httpie (http / https / xh) -------------------------------------------------------------------------------------

const HTTPIE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT']);
const HTTPIE_VALUED = new Set(['--pretty', '--style', '-s', '--print', '-p', '--output', '-o', '--session', '--session-read-only',
  '--auth', '-a', '--auth-type', '-A', '--proxy', '--verify', '--ssl', '--cert', '--cert-key', '--cert-key-pass', '--timeout',
  '--max-redirects', '--max-headers', '--format-options', '--default-scheme', '--boundary', '--response-charset', '--response-mime']);
const HTTPIE_SWITCH = new Set(['-j', '--json', '-f', '--form', '--multipart', '-h', '--headers', '-m', '--meta', '-b', '--body',
  '-v', '--verbose', '--all', '-S', '--stream', '-d', '--download', '-c', '--continue', '-F', '--follow', '--check-status',
  '-I', '--ignore-stdin', '--path-as-is', '--chunked', '-x', '--compress', '--offline', '-q', '--quiet', '--help', '--version', '--debug', '--traceback', '--ignore-netrc']);
const httpieFlag = (t: string): 'valued' | 'switch' | 'unknown' => {
  if (t.startsWith('--no-')) return 'switch';
  const key = t.includes('=') ? t.slice(0, t.indexOf('=')) : t;
  return HTTPIE_VALUED.has(key) ? 'valued' : HTTPIE_SWITCH.has(key) ? 'switch' : 'unknown';
};
// A request item that adds to the body: `k=v` (data), `k:=v` (raw json) or `k@file` (upload); a header `k:v` or query `k==v` is not.
const httpieBody = (t: string): boolean => /^[^=:@\s]+(?::=|=(?!=)|@)/.test(t);
// A first operand that is a method: a known one, or any all-uppercase word of letters (a custom method such as PURGE).
const isHttpieMethod = (t: string): boolean => HTTPIE_METHODS.has(t.toUpperCase()) || /^[A-Z]+$/.test(t);

function httpieDeny(args: Word[], seg: Segment): GuardVerdict | null {
  let method = '', hasBody = false, unknown = false, seenUrl = false, ignoreStdin = false;
  let urlWord: Word | null = null;
  for (let k = 0; k < args.length; k++) {
    const w = args[k], t = w.text;
    if (t.length > 1 && t.startsWith('-')) {
      if (t === '--') continue;
      if (t === '-I' || t === '--ignore-stdin') { ignoreStdin = true; continue; }
      const kind = httpieFlag(t);
      if (kind === 'valued') { if (!t.includes('=') && args[k + 1]) k++; }
      else if (kind === 'unknown') unknown = true;
      continue;
    }
    if (!method && !seenUrl && !w.dynamic && isHttpieMethod(t)) { method = t.toUpperCase(); continue; }
    if (!seenUrl) { urlWord = w; seenUrl = true; continue; }
    if (w.dynamic || httpieBody(t)) hasBody = true;
  }
  const stdin = (seg.after === '|' || seg.redirects.some(r => r.op === '<')) && !ignoreStdin;
  const host = urlWord && !urlWord.dynamic ? bareHost(urlWord.text) : null;
  if (host !== null && isLocalHost(host)) return null;
  const write = hasBody || stdin || isWriteMethod(method);
  if (write) return host !== null ? netWrite('httpie writes to a host that is not local') : netUnknown('httpie writes to a host the hook cannot read');
  if (unknown) return netUnknown('httpie has an option the hook does not know, so a write to a remote host cannot be ruled out');
  return null;
}

// ---- Invoke-WebRequest / Invoke-RestMethod (PowerShell) -------------------------------------------------------------

const PS_WEB = new Set(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm']);
/** Judge a web-request reading (Task 4's). `aliasOnly`: a bare `curl`/`wget` read as the cmdlet — only a positive write counts, not an unknown parameter or a splat. */
function webVerdict(req: WebReq | null, label: string, aliasOnly: boolean): GuardVerdict | null {
  if (!req) return null;
  const h = req.uri ? urlHostLocal(req.uri) : 'unknown';
  if (h === true) return null;
  const write = req.hasBody || req.methodDynamic || isWriteMethod(req.method);
  if (write) return h === false ? netWrite(`${label} writes to a host that is not local`) : netUnknown(`${label} writes to a host the hook cannot read`);
  if (aliasOnly) return null;
  if (req.dynamicOther) return netUnknown(`${label} hides its request behind a splat`);
  if (req.unknownParam) return netUnknown(`${label} has a parameter the hook does not know, so a write to a remote host cannot be ruled out`);
  return null;
}

// ---- cloud (T5-CLOUD-SHAPE-2: verb-first, two-level, topic-colon and group shapes) ----------------------------------

type Shape = 'verb' | 'two' | 'topic' | 'group';
const VERB_FIRST = new Set(['kubectl', 'oc', 'helm', 'terraform', 'tofu', 'pulumi', 'cdk', 'vercel', 'netlify', 'fly', 'flyctl',
  'sam', 'serverless', 'sls', 'eas', 'eb', 'ansible', 'ansible-playbook']);
const TWO_LEVEL = new Set(['aws', 'gh', 'glab', 'hcloud', 'argocd']);
const TOPIC_COLON = new Set(['heroku', 'firebase']);
const shapeOf = (cli: string): Shape => (VERB_FIRST.has(cli) ? 'verb' : TWO_LEVEL.has(cli) ? 'two' : TOPIC_COLON.has(cli) ? 'topic' : 'group');
const TF_DENY = new Set(['apply', 'destroy', 'import', 'state', 'taint']);
const KUBE_DENY = new Set(['apply', 'delete', 'patch', 'edit', 'scale', 'rollout', 'create', 'replace', 'exec']);
const ALWAYS_DENY: Record<string, Set<string>> = { terraform: TF_DENY, tofu: TF_DENY, kubectl: KUBE_DENY, oc: KUBE_DENY };

// Each CLI's global options: the ones that take a value and its common switches. An option in neither, before the decisive word, cancels the allow.
interface CliOpts { valued: Set<string>; switches: Set<string> }
const O = (valued: string, switches = ''): CliOpts =>
  ({ valued: new Set(valued.split(/\s+/).filter(Boolean)), switches: new Set(switches.split(/\s+/).filter(Boolean)) });
const NO_OPTS = O('');
const KUBE = O(`-n --namespace --context --kubeconfig -l --selector -o --output --cluster --user -s --server --token --as --as-group --as-uid
  --certificate-authority --client-certificate --client-key --request-timeout --tls-server-name --cache-dir -v --v --vmodule --log-file --password --username
  --profile --profile-output`, '--insecure-skip-tls-verify --match-server-version --warnings-as-errors --disable-compression -A --all-namespaces');
const FLY = O('-a --app -c --config -t --access-token -o --org', '--debug --verbose -j --json');
const SLS = O('--stage -s --region -r --config -c --aws-profile --param --org --app', '--verbose --debug');
const CLI_OPTS: Record<string, CliOpts> = {
  aws: O('--region --profile --output --query --endpoint-url --cli-read-timeout --cli-connect-timeout --ca-bundle --color --cli-binary-format',
    '--debug --no-cli-pager --no-verify-ssl --no-paginate --no-sign-request --cli-auto-prompt --no-cli-auto-prompt'),
  gcloud: O(`--project --region --zone --format --verbosity --account --configuration --billing-project --impersonate-service-account --flags-file
    --flatten --trace-token --access-token-file`, '--quiet -q --log-http --user-output-enabled --no-user-output-enabled'),
  gsutil: O('-h -o -u -i', '-m -q -d -D -DD'),
  az: O('--subscription -o --output --query -g --resource-group -n --name', '--debug --verbose --only-show-errors --yes -y'),
  kubectl: KUBE, oc: KUBE,
  helm: O(`-n --namespace --kube-context --kubeconfig --kube-apiserver --kube-as-group --kube-as-user --kube-ca-file --kube-token --kube-tls-server-name
    --registry-config --repository-cache --repository-config --burst-limit --qps --content-cache`, '--debug --kube-insecure-skip-tls-verify'),
  terraform: O('-chdir'), tofu: O('-chdir'),
  pulumi: O('-C --cwd --color -v --verbose --tracing --profiling --memprofilerate',
    '--emoji -e --logtostderr --non-interactive --disable-integrity-checking --logflow --fully-qualify-stack-names'),
  cdk: O('-a --app -c --context -p --plugin --profile --proxy --ca-bundle-path -o --output --role-arn -r --toolkit-stack-name --build --notices',
    '--debug -v --verbose --trace --strict --ignore-errors -j --json --no-color --ci --lookups --version-reporting --path-metadata --asset-metadata --staging'),
  vercel: O('-t --token -S --scope -A --local-config -Q --global-config --cwd -T --team', '-d --debug --no-color -y --yes --prod --prebuilt -f --force'),
  netlify: O('--auth --filter', '--debug'), fly: FLY, flyctl: FLY,
  sam: O('--profile --region --config-file --config-env -t --template --template-file', '--debug --beta-features'),
  serverless: SLS, sls: SLS, eas: O('', '--non-interactive --json'), eb: O('--profile --region -r --endpoint-url', '--debug --verbose --quiet --no-verify-ssl'),
  gh: O('-R --repo'), glab: O('-R --repo'), hcloud: O('--context --config --endpoint --poll-interval -o --output', '--debug --quiet'),
  argocd: O(`--server --auth-token --config --context --grpc-web-root-path --header -H --loglevel --logformat --port-forward-namespace --kube-context
    --redis-name --repo-server-name --server-name --http-retry-max --client-crt --client-crt-key --controller-name`, '--insecure --grpc-web --plaintext --port-forward --core'),
  heroku: O('-a --app -r --remote'), firebase: O('-P --project --account --token -c --config', '--json -j --debug --non-interactive --interactive'),
  wrangler: O('-c --config -e --env --cwd', '--experimental-json-config'), supabase: O('--workdir --profile', '--debug --experimental --yes --create-ticket'),
  stripe: O('--api-key --color --config --device-name --log-level -p --project-name'),
  doctl: O('-t --access-token -c --config --context -u --api-url -o --output', '--trace -v --verbose --interactive'),
  railway: O('-s --service -e --environment'), vault: O('-address -namespace -ns -format', '-tls-skip-verify'), consul: O('-http-addr -token -datacenter'),
  nomad: O('-address -region -namespace -token', '-tls-skip-verify'), copilot: O('-a --app -e --env -n --name'),
};

// Local verbs (the run's own machine), position-specific: each returns the index of the decisive word, or -1.
const at0 = (...ws: string[]) => (c: string[]): number => (ws.includes(c[0] ?? '') ? 0 : -1);
const hasOpt = (a: Word[], o: string): boolean => a.some(w => w.text === o || w.text.startsWith(o + '='));
const repoClone = (c: string[]): boolean => c[0] === 'repo' && c[1] === 'clone';
const LOCAL: Record<string, (c: string[], a: Word[]) => number> = {
  // wrangler d1/kv/r2 with --local (and no --remote, REMOTE_TARGET) act on the run's own local store
  wrangler: (c, a) => (['dev', 'types'].includes(c[0] ?? '') || (['d1', 'kv', 'r2'].includes(c[0] ?? '') && hasOpt(a, '--local')) ? 0 : -1),
  vercel: at0('dev', 'build'), netlify: at0('dev', 'build'),
  supabase: c => (['start', 'stop', 'status', 'gen', 'init'].includes(c[0] ?? '') ? 0
    : (c[0] === 'db' && ['reset', 'diff'].includes(c[1] ?? '')) || (c[0] === 'functions' && c[1] === 'serve') ? 1 : -1),
  firebase: c => (c[0] === 'serve' || c[0] === 'emulators' || /^emulators:/.test(c[0] ?? '') ? 0 : -1), heroku: at0('local'),
  sam: at0('local', 'build', 'validate', 'init'), helm: at0('template', 'lint', 'package', 'dependency'), stripe: at0('listen'),
  kubectl: at0('port-forward'), oc: at0('port-forward'), cdk: at0('synth', 'diff', 'ls', 'init'), pulumi: at0('preview'),
  serverless: at0('offline'), sls: at0('offline'), terraform: at0('init'), tofu: at0('init'),
  gh: c => (repoClone(c) || (c[0] === 'run' && c[1] === 'watch') ? 1 : -1), glab: c => (repoClone(c) ? 1 : -1), // T5-GLAB-CLONE
};
// T5-VF-GROUPS: a verb-first CLI's group words; after one, the next command word decides.
const VF_GROUPS: Record<string, Set<string>> = {
  kubectl: new Set(['config', 'auth']), oc: new Set(['config', 'auth']), helm: new Set(['repo', 'plugin', 'registry']),
  pulumi: new Set(['stack', 'config', 'plugin']), vercel: new Set(['env', 'project', 'projects', 'domains', 'dns', 'alias', 'teams']),
  fly: new Set(['apps', 'machines', 'machine', 'secrets', 'volumes', 'ips', 'certs', 'config']),
  flyctl: new Set(['apps', 'machines', 'machine', 'secrets', 'volumes', 'ips', 'certs', 'config']),
  terraform: new Set(['workspace', 'providers']), tofu: new Set(['workspace', 'providers']),
};
// Verb-first top-level words that only read, beyond READ_VERBS (kubectl's cluster and API listings).
const VF_READS: Record<string, Set<string>> = {
  kubectl: new Set(['cluster-info', 'api-resources', 'api-versions']), oc: new Set(['cluster-info', 'api-resources', 'api-versions']),
};
/** After a verb-first group word: a read verb or a `get-`/`current-` form reads (kubectl `auth can-i` too). */
const vfGroupRead = (cli: string, group: string, w: string): boolean =>
  isReadVerb(w) || /^current-/.test(w) || ((cli === 'kubectl' || cli === 'oc') && group === 'auth' && w === 'can-i');
// A remote-target option defeats a local verb (`supabase db reset --linked` acts on the linked project).
const REMOTE_TARGET: Record<string, string[]> = { supabase: ['--linked', '--db-url', '--project-ref'], wrangler: ['--remote'] };
const remoteTarget = (cli: string, args: Word[]): boolean =>
  (REMOTE_TARGET[cli] ?? []).some(o => args.some(w => w.text === o || w.text.startsWith(o + '=')));

// Group shape: the write vocabulary (the brief's verbs plus fix 2's), and the position-1 words that name a group, not a verb.
const GROUP_WRITE = new Set([...CLOUD_WRITE_VERBS, 'add', 'assign', 'unassign', 'approve', 'reject', 'associate', 'disassociate', 'authorize',
  'revoke', 'grant', 'cancel', 'close', 'reopen', 'comment', 'review', 'merge', 'fork', 'edit', 'patch', 'replace', 'rename', 'move', 'copy',
  'upload', 'write', 'post', 'send', 'submit', 'trigger', 'resume', 'pause', 'suspend', 'reboot', 'resize', 'reset', 'restore', 'purge',
  'invalidate', 'flush', 'wipe', 'rotate', 'renew', 'install', 'uninstall', 'upgrade', 'register', 'deregister', 'unregister', 'provision',
  'link', 'unlink', 'connect', 'disconnect', 'mount', 'unmount', 'drain', 'cordon', 'uncordon', 'taint', 'untaint', 'label', 'tag', 'untag',
  'annotate', 'expose', 'lock', 'unlock', 'archive', 'unarchive', 'transfer', 'login', 'logout', 'mb', 'rb', 'rsync', 'config', 'configure',
  'modify', 'change', 'allocate', 'release', 'request', 'subscribe', 'unsubscribe', 'poweroff', 'poweron', 'shutdown', 'power']);
const POS1_NOUNS = new Set(['config', 'configure', 'label', 'tag', 'release']);
const POS1_GROUPS: Record<string, Set<string>> = { gcloud: new Set(['run', 'deploy']) };
// gcloud's release tracks: the position-1 word is the one after them (GR-A5).
const RELEASE_TRACKS: Record<string, Set<string>> = { gcloud: new Set(['alpha', 'beta', 'preview']) };
const AZ_GROUP_WORDS = new Set(['log', 'logs', 'search']);
const HEROKU_TOPICS = new Set(['apps', 'addons', 'releases', 'ps', 'config', 'domains', 'buildpacks', 'regions', 'stacks']);
const GH_TOP_READ = new Set(['status', 'search', 'version', 'help']);
const AWS_READ_PREFIX = /^(?:describe|list|get|head|filter|search|lookup|batch-get)-/;

const isReadVerb = (w: string): boolean => READ_VERBS.has(w) || (/^(?:describe|list|get|head|show)-/.test(w) && w !== 'get-credentials');
const awsRead = (w: string): boolean => isReadVerb(w) || (AWS_READ_PREFIX.test(w) && w !== 'get-credentials') || w === 'scan' || w === 'query';
/** A group-shape write: a vocabulary word, a `<verb>-…` or `…:<verb>` form, or `get-credentials` (it rewrites ~/.kube/config). */
function isGroupWrite(w: string): boolean {
  if (w === 'get-credentials' || GROUP_WRITE.has(w)) return true;
  const d = w.indexOf('-'); if (d > 0 && GROUP_WRITE.has(w.slice(0, d))) return true;
  const c = w.lastIndexOf(':'); return c >= 0 && GROUP_WRITE.has(w.slice(c + 1));
}

interface CloudWords { cmd: string[]; help: boolean; versionFlag: boolean; unknownAt: number }
/**
 * Read a cloud CLI's words before `--`: the command words (a known valued option's value skipped: it is a name, T5-KNOWN-VALUES;
 * an unknown option's value stays a command word, so it is still judged), help/version (case-sensitive), and how many command
 * words came before the first option the CLI's table does not know (`unknownAt`).
 */
function cloudParse(args: Word[], cli: string): CloudWords {
  const o = CLI_OPTS[cli] ?? NO_OPTS, tf = cli === 'terraform' || cli === 'tofu';
  const cmd: string[] = [];
  let help = false, versionFlag = false, unknownAt = Infinity;
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '--') break;
    if (t.length > 1 && t.startsWith('-')) {
      const eq = t.indexOf('='), key = eq > 0 ? t.slice(0, eq) : t;
      if (t === '--help' || (t === '-h' && cli !== 'gsutil') || (tf && t === '-help')) { help = true; continue; }
      if (t === '--version' || (tf && t === '-version')) { versionFlag = true; continue; }
      if (o.valued.has(key)) { if (eq < 0) k++; continue; }
      if (o.switches.has(key) || (key.startsWith('--no-') && o.switches.has('--' + key.slice(5)))) continue;
      if (!t.startsWith('--') && t.length > 2 && o.valued.has(t.slice(0, 2))) continue; // a glued short value: -nprod
      if (unknownAt === Infinity) unknownAt = cmd.length;
      continue;
    }
    cmd.push(t.toLowerCase());
  }
  return { cmd, help, versionFlag, unknownAt };
}

/** The index of the command word whose read (or local) meaning allows the line, or -1: the shape decides where that word sits. */
function decisive(cli: string, p: CloudWords, args: Word[]): number {
  const { cmd } = p, c0 = cmd[0] ?? '', c1 = cmd[1] ?? '';
  const loc = LOCAL[cli] && !remoteTarget(cli, args) ? LOCAL[cli](cmd, args) : -1;
  switch (shapeOf(cli)) {
    case 'verb':
      if (ALWAYS_DENY[cli]?.has(c0)) return -1;
      if (loc === 0) return 0;
      if (VF_GROUPS[cli]?.has(c0)) return c1 !== '' && vfGroupRead(cli, c0, c1) ? 1 : -1; // T5-VF-GROUPS
      return c0 !== '' && (isReadVerb(c0) || !!VF_READS[cli]?.has(c0)) ? 0 : -1;
    case 'two':
      if (cli === 'gh' || cli === 'glab') {
        if (GH_TOP_READ.has(c0)) return 0;
        if (loc >= 0) return loc;
        return c1 !== '' && (isReadVerb(c1) || c1 === 'watch' || c1 === 'checks') ? 1 : -1;
      }
      if (cli === 'aws') {
        if (c0 === 'help') return 0;
        if (c0 === 's3') return c1 === 'ls' ? 1 : -1;
        if (c0 === 'configure') return c1 === 'list' || c1 === 'get' ? 1 : -1;
        return c1 !== '' && awsRead(c1) ? 1 : -1;
      }
      return c1 !== '' && isReadVerb(c1) ? 1 : -1; // hcloud, argocd
    case 'topic': {
      if (loc === 0) return 0;
      const colon = c0.lastIndexOf(':');
      if (colon >= 0) return isReadVerb(c0.slice(colon + 1)) ? 0 : -1;
      return isReadVerb(c0) || (cli === 'heroku' && HEROKU_TOPICS.has(c0)) ? 0 : -1;
    }
    default: {
      if (loc >= 0) return loc;
      // the position-1 word sits after a release track (gcloud beta run …); a noun or a group word there is no verb
      const p1 = RELEASE_TRACKS[cli]?.has(c0) ? 1 : 0;
      const exempt = (w: string, i: number): boolean => i === p1 && (POS1_NOUNS.has(w) || !!POS1_GROUPS[cli]?.has(w));
      // the brief's exact write verbs deny anywhere (M10's guarantee)
      if (cmd.some((w, i) => CLOUD_WRITE_VERBS.has(w) && !exempt(w, i))) return -1;
      // T5-NAMES-AFTER-READ: the read verb is the first within four command words; the forms and fix 2's vocabulary apply before it, the words after it are names
      let r = -1;
      for (let i = 0; i < Math.min(4, cmd.length); i++) {
        if (cli === 'az' && AZ_GROUP_WORDS.has(cmd[i])) continue;
        if (isReadVerb(cmd[i])) { r = i; break; }
      }
      if (r < 0) return -1;
      return cmd.slice(0, r).some((w, i) => isGroupWrite(w) && !exempt(w, i)) ? -1 : r;
    }
  }
}
// gh/glab api: a pflag option table (glued, `=`, bundles); an unknown option, a non-GET method or any field/input is a write.
const GH_API_TABLE: OptTable = { opts: {
  '-X': 'v', '--method': 'v', '-f': 'v', '--raw-field': 'v', '-F': 'v', '--field': 'v', '--input': 'v', '-H': 'v', '--header': 'v',
  '-q': 'v', '--jq': 'v', '-t': 'v', '--template': 'v', '-p': 'v', '--preview': 'v', '--hostname': 'v', '--cache': 'v',
  '--paginate': 'w', '--slurp': 'w', '-i': 'w', '--include': 'w', '--silent': 'w', '--verbose': 'w',
} };
function ghApiWrites(args: Word[]): boolean {
  const apiIdx = args.findIndex(w => w.text === 'api');
  const rest = apiIdx >= 0 ? args.slice(apiIdx + 1) : args;
  const sc = scan(rest, GH_API_TABLE, 'bash');
  if (sc.unknown) return true;
  const method = sc.vals.filter(v => v.key === '-X' || v.key === '--method');
  const writeMethod = method.some(v => v.w.dynamic || v.w.text.toUpperCase() !== 'GET');
  const explicitGet = method.some(v => !v.w.dynamic && v.w.text.toUpperCase() === 'GET');
  const fields = sc.vals.filter(v => ['-f', '--raw-field', '-F', '--field', '--input'].includes(v.key));
  if (sc.ops.some(w => w.text === 'graphql')) {
    if (writeMethod && !explicitGet) return true;
    // T5-GH-GRAPHQL + B4: only literal fields read; --input and a typed `-F k=@…` (a file or stdin) are bodies the hook cannot see
    const fromFile = (v: { key: string; w: Word }): boolean => v.key === '--input' || ((v.key === '-F' || v.key === '--field') && /^[^=]*=@/.test(v.w.text));
    return fields.some(v => v.w.dynamic || fromFile(v) || /mutation/i.test(v.w.text));
  }
  if (writeMethod) return true;
  return fields.length > 0 && !explicitGet;
}
function cloudSeg(seg: Segment): GuardVerdict | null {
  const eff = effectiveCommand(seg);
  if (eff === null || 'cancel' in eff) return null; // an unreadable runner is network's to deny
  const { name, args } = eff;
  if (!CLOUD_CLIS.has(name)) return null;
  const p = cloudParse(args, name);
  const D = (): GuardVerdict => deny('cloud', `${name} changes a service off this machine`, CLOUD_INSTEAD);
  if (p.help || (p.versionFlag && p.cmd.length === 0)) return null;
  if (name === 'ansible' || name === 'ansible-playbook') {
    return args.some(w => ['--syntax-check', '--list-hosts', '--list-tasks', '--version', '--help'].includes(w.text)) ? null : D();
  }
  if ((name === 'gh' || name === 'glab') && p.cmd[0] === 'api') return p.unknownAt === 0 || ghApiWrites(args) ? D() : null;
  const d = decisive(name, p, args);
  return d >= 0 && d < p.unknownAt ? null : D(); // an unknown global option before the decisive word cancels the allow
}

// ---- network dispatch -----------------------------------------------------------------------------------------------

function networkSeg(seg: Segment): GuardVerdict | null {
  const eff = effectiveCommand(seg);
  if (eff === null) return null;
  if ('cancel' in eff) return netUnknown(eff.cancel);
  const { name, args } = eff;
  const pub = publisherDeny(name, args);
  if (pub) return pub;
  if (seg.dialect === 'powershell' && PS_WEB.has(name)) return webVerdict(readWebRequest(seg), name, false);
  if (seg.dialect === 'powershell' && (name === 'curl' || name === 'wget')) {
    const nativeExe = /\.(?:exe|cmd|bat|com)$/i.test(seg.argv[0].text);
    const native = name === 'curl' ? curlDeny(args, seg) : wgetDeny(args, seg);
    return nativeExe ? native : native ?? webVerdict(readWebRequest(seg), name, true);
  }
  if (name === 'curl') return curlDeny(args, seg);
  if (name === 'wget') return wgetDeny(args, seg);
  if (['http', 'https', 'xh', 'xhs'].includes(name)) return httpieDeny(args, seg);
  return null;
}

export const networkRule: GuardRule = {
  id: 'network',
  check(input: GuardInput, ctx: GuardCtx): GuardVerdict | null {
    if (!ctx.autonomous) return null;
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (const seg of segs) { const v = networkSeg(seg); if (v) return v; }
    return null;
  },
};

export const cloudRule: GuardRule = {
  id: 'cloud',
  check(input: GuardInput, ctx: GuardCtx): GuardVerdict | null {
    if (!ctx.autonomous) return null;
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (const seg of segs) { const v = cloudSeg(seg); if (v) return v; }
    return null;
  },
};

// ---- mcp-write ------------------------------------------------------------------------------------------------------

/** A write word that follows `and`, `or` or `then` (so `get_or_create_user` writes). */
function writeAfterConnector(words: string[]): boolean {
  let seen = false;
  for (const w of words) {
    if (w === 'and' || w === 'or' || w === 'then') { seen = true; continue; }
    if (seen && MCP_WRITE_WORDS.has(w)) return true;
  }
  return false;
}
// T5-BROWSER: the browser MCPs that act with the person's own sign-ins.
const SIGNIN_BROWSER = ['mcp__claude-in-chrome__', 'mcp__Claude_Browser__', 'mcp__remote-devices__Claude_Browser__'];
/** Whether a signed-in-browser tool only reads or navigates (allowed); everything else there is an interaction, denied. */
function browserRead(suffix: string): boolean {
  if (MCP_LOCAL_TOOLS.has(suffix) || suffix.startsWith('resize_')) return true;
  if (suffix === 'navigate') return true;
  return /^(?:read_|get_|list_|find$|screenshot|take_screenshot|tabs_context)/.test(suffix);
}

export const mcpWriteRule: GuardRule = {
  id: 'mcp-write',
  check(input: GuardInput, ctx: GuardCtx): GuardVerdict | null {
    if (!ctx.autonomous) return null;
    const name = input.tool_name;
    if (!name.startsWith('mcp__')) return null;
    const suffix = name.slice(name.lastIndexOf('__') + 2);
    if (SIGNIN_BROWSER.some(p => name.startsWith(p))) {
      return browserRead(suffix) ? null : deny('mcp-write', `${name} acts in the person's signed-in browser`, BROWSER_INSTEAD);
    }
    if (MCP_LOCAL_TOOLS.has(suffix) || suffix.startsWith('resize_')) return null;
    const words = mcpWords(name);
    if (!words.some(w => MCP_WRITE_WORDS.has(w))) return null;
    if (MCP_READ_FIRST.has(words[0]) && !writeAfterConnector(words)) return null;
    return deny('mcp-write', `${name} is an MCP tool whose name says it writes off this machine`, MCP_INSTEAD);
  },
};
