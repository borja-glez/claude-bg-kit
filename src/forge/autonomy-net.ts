// Plan 6b-1, Task 5 (fix round 1): the three rules that keep an autonomous run from writing OFF the machine — `network`
// (HTTP writes to a host that is not local, publishing, and copies to another host, by Bash or PowerShell), `cloud` (the
// cloud and deploy CLIs read by their SHAPE, T5-CLOUD-SHAPE) and `mcp-write` (an MCP tool whose name says it writes, plus
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
const READ_VERBS = new Set(['list', 'ls', 'get', 'describe', 'show', 'view', 'status', 'plan', 'whoami', 'version', 'help', 'logs',
  'log', 'diff', 'search', 'inspect', 'info', 'explain', 'validate', 'fmt', 'output', 'top', 'init', 'checks']);
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
// A runner's own options that take a value (so the CLI it runs is the next operand), and its boolean switches.
const RUNNER_VALUED = new Set(['-p', '--package', '--package-spec', '--from', '--with', '--with-requirements', '--python', '--spec',
  '--pip-args', '--index', '--index-url', '--extra-index-url', '--constraint', '--refresh-package', '-c', '--call', '--userconfig', '--cache', '--shell']);
const RUNNER_SWITCHES = new Set(['-y', '--yes', '-q', '--quiet', '--no-install', '--install', '--prefer-offline', '--prefer-online',
  '--offline', '--online', '--ignore-existing', '--silent', '-s', '--loglevel']);
// Package specs whose installed bin differs from the package name.
const PKG_BIN: Record<string, string> = {
  'netlify-cli': 'netlify', 'firebase-tools': 'firebase', 'aws-cdk': 'cdk', 'eas-cli': 'eas', 'vercel': 'vercel', 'wrangler': 'wrangler',
  '@railway/cli': 'railway', '@aws-amplify/cli': 'amplify', '@vscode/vsce': 'vsce', '@supabase/cli': 'supabase', '@cloudflare/wrangler': 'wrangler',
};
const PKG_BUILTINS = new Set(['install', 'i', 'add', 'remove', 'rm', 'update', 'up', 'upgrade', 'run', 'run-script', 'test', 't', 'exec',
  'x', 'dlx', 'publish', 'pack', 'link', 'unlink', 'store', 'config', 'why', 'list', 'ls', 'outdated', 'audit', 'dedupe', 'import',
  'rebuild', 'prune', 'start', 'create', 'init', 'patch', 'version', 'workspace', 'workspaces', 'global', 'node', 'bin', 'cache', 'set', 'info']);
const PUBLISHER_NAMES = new Set(['twine', 'cargo', 'gem', 'vsce', 'ovsx', 'mvn', 'gradle', 'podman', 'docker']);

/** The bin a package spec installs: strip `@version` (keep the scope), then map known packages; else the package's own name. */
function pkgToBin(spec: string): string {
  let s = spec;
  if (s.startsWith('@')) { const slash = s.indexOf('/'); const at = s.indexOf('@', slash + 1); if (at > 0) s = s.slice(0, at); }
  else { const at = s.indexOf('@'); if (at > 0) s = s.slice(0, at); }
  return PKG_BIN[s] ?? commandName({ text: s, dynamic: false, glob: false });
}
/** Skip a runner's own flags to its package operand; 'cancel' when an option the hook does not know comes before the package. */
function runnerRest(args: Word[]): Word[] | 'cancel' {
  let i = 0;
  while (i < args.length) {
    const t = args[i].text;
    if (t === '--') { i++; break; }
    if (!t.startsWith('-')) break;
    const key = t.includes('=') ? t.slice(0, t.indexOf('=')) : t;
    if (RUNNER_VALUED.has(key)) { i += t.includes('=') ? 1 : 2; continue; }
    if (RUNNER_SWITCHES.has(key)) { i++; continue; }
    return 'cancel';
  }
  return args.slice(i);
}
const innerOf = (rest: Word[] | 'cancel'): Eff | 'cancel' | null =>
  rest === 'cancel' ? 'cancel' : !rest.length || rest[0].dynamic ? null : { name: pkgToBin(rest[0].text.toLowerCase()), args: rest.slice(1) };

function unwrapRunner(name: string, args: Word[]): Eff | 'cancel' | null {
  if (name === 'npx' || name === 'bunx' || name === 'uvx') return innerOf(runnerRest(args));
  if (name === 'bun' && args[0]?.text === 'x') return innerOf(runnerRest(args.slice(1)));
  if ((name === 'pnpm' && (args[0]?.text === 'dlx' || args[0]?.text === 'exec')) || (name === 'yarn' && args[0]?.text === 'dlx')) return innerOf(runnerRest(args.slice(1)));
  if (name === 'npm' && (args[0]?.text === 'exec' || args[0]?.text === 'x')) return innerOf(runnerRest(args.slice(1)));
  if (name === 'pipx' && args[0]?.text === 'run') return innerOf(runnerRest(args.slice(1)));
  if (['uv', 'poetry', 'pdm', 'hatch'].includes(name) && args[0]?.text === 'run') return innerOf(runnerRest(args.slice(1)));
  if (/^(?:python[0-9.]*|py)$/.test(name)) {
    const mi = args.findIndex(w => w.text === '-m');
    if (mi >= 0 && args[mi + 1] && !args[mi + 1].dynamic) return { name: pkgToBin(args[mi + 1].text.toLowerCase()), args: args.slice(mi + 2) };
  }
  // pnpm <bin> / yarn <bin> that is not a manager command: unwrap only when the bin is a cloud or publisher CLI (bounded).
  if ((name === 'pnpm' || name === 'yarn') && args[0] && !args[0].text.startsWith('-') && !args[0].dynamic && !PKG_BUILTINS.has(args[0].text.toLowerCase())) {
    const bin = pkgToBin(args[0].text.toLowerCase());
    if (CLOUD_CLIS.has(bin) || PUBLISHER_NAMES.has(bin)) return { name: bin, args: args.slice(1) };
  }
  return null;
}
function effectiveCommand(seg: Segment): Eff | 'cancel' | null {
  if (!seg.argv.length || seg.argv[0].dynamic) return null;
  const name = commandName(seg.argv[0]), args = seg.argv.slice(1);
  return unwrapRunner(name, args) ?? { name, args };
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

const CURL_DATA = ['-d', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json', '-F', '--form', '--form-string', '-T', '--upload-file'];

function curlDeny(args: Word[], seg: Segment): GuardVerdict | null {
  const sc = scan(args, BASH_TABLES['curl'], seg.dialect);
  const urls = [...sc.ops, ...sc.vals.filter(v => v.key === '--url').map(v => v.w)];
  const proxied = ['-x', '--proxy', '--resolve', '--connect-to'].some(f => sc.flags.has(f));
  if (!proxied && allLocal(urls)) return null;
  const forceGet = sc.flags.has('-G') || sc.flags.has('--get');
  const method = sc.vals.filter(v => v.key === '-X' || v.key === '--request');
  const write = !forceGet && (method.some(v => v.w.dynamic || isWriteMethod(v.w.text.toUpperCase())) || CURL_DATA.some(f => sc.flags.has(f)));
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

// ---- cloud (T5-CLOUD-SHAPE) -----------------------------------------------------------------------------------------

const VERB_FIRST = new Set(['kubectl', 'oc', 'helm', 'terraform', 'tofu', 'pulumi', 'cdk', 'vercel', 'netlify', 'fly', 'flyctl',
  'sam', 'serverless', 'sls', 'eas', 'eb', 'ansible', 'ansible-playbook']);
const TF_DENY = new Set(['apply', 'destroy', 'import', 'state', 'taint']);
const KUBE_DENY = new Set(['apply', 'delete', 'patch', 'edit', 'scale', 'rollout', 'create', 'replace', 'exec']);
const ALWAYS_DENY: Record<string, Set<string>> = { terraform: TF_DENY, tofu: TF_DENY, kubectl: KUBE_DENY, oc: KUBE_DENY };
const KUBE_VALUED = new Set(['-n', '--namespace', '--context', '--kubeconfig', '-l', '--selector', '-o', '--output', '--cluster', '--user']);
const GLOBAL_VALUED: Record<string, Set<string>> = {
  aws: new Set(['--region', '--profile', '--output', '--query', '--endpoint-url']),
  gcloud: new Set(['--project', '--region', '--zone', '--format', '--verbosity', '--account', '--configuration']),
  gsutil: new Set(['-h', '-o']), az: new Set(['--subscription', '-o', '--output', '--query', '-g', '--resource-group', '-n', '--name']),
  kubectl: KUBE_VALUED, oc: KUBE_VALUED, helm: new Set(['-n', '--namespace', '--kube-context', '--kubeconfig']),
  gh: new Set(['-R', '--repo']), glab: new Set(['-R', '--repo']), terraform: new Set(['-chdir']), tofu: new Set(['-chdir']),
};
const GROUP_EXC: Record<string, Set<string>> = { gh: new Set(['run']), gcloud: new Set(['run', 'deploy']), aws: new Set(['deploy']) };
const LOCAL_VERBS: Record<string, (c: string[]) => boolean> = {
  wrangler: c => ['dev', 'types'].includes(c[0]), vercel: c => ['dev', 'build'].includes(c[0]), netlify: c => ['dev', 'build'].includes(c[0]),
  supabase: c => ['start', 'stop', 'status', 'gen'].includes(c[0]) || (c[0] === 'db' && ['reset', 'diff'].includes(c[1])),
  firebase: c => c[0] === 'serve' || c[0] === 'emulators' || /^emulators:/.test(c[0] ?? ''),
  sam: c => ['local', 'build', 'validate'].includes(c[0]), helm: c => ['template', 'lint', 'package', 'dependency'].includes(c[0]),
  stripe: c => c[0] === 'listen', kubectl: c => c[0] === 'port-forward', oc: c => c[0] === 'port-forward',
  cdk: c => ['synth', 'diff', 'ls'].includes(c[0]), pulumi: c => c[0] === 'preview', serverless: c => c[0] === 'offline', sls: c => c[0] === 'offline',
  gh: c => c.slice(0, 3).some(w => ['clone', 'watch'].includes(w)),
};
const isReadVerb = (w: string): boolean => READ_VERBS.has(w) || /^(?:describe|list|get|head)-/.test(w);
function isWriteWord(w: string): boolean {
  if (CLOUD_WRITE_VERBS.has(w)) return true;
  const d = w.indexOf('-'); if (d > 0 && CLOUD_WRITE_VERBS.has(w.slice(0, d))) return true;
  const c = w.lastIndexOf(':'); if (c >= 0 && CLOUD_WRITE_VERBS.has(w.slice(c + 1))) return true;
  return false;
}
/** The command words (the subcommand sequence) and the help/version flags, a known valued flag's value skipped, stopping at `--`. */
function cloudParse(args: Word[], valued: Set<string>, cli: string): { cmd: string[]; help: boolean; versionFlag: boolean } {
  const cmd: string[] = []; let help = false, versionFlag = false;
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '--') break;
    if (t.startsWith('-')) {
      const key = t.includes('=') ? t.slice(0, t.indexOf('=')) : t;
      if (t === '--help') help = true; else if (t === '-h' && cli !== 'gsutil') help = true; else if (t === '--version') versionFlag = true;
      if (valued.has(key) && !t.includes('=')) k++;
      continue;
    }
    cmd.push(t.toLowerCase());
  }
  return { cmd, help, versionFlag };
}
/** The non-flag words before `--`, flag values included (the write-verb scan runs over these). */
const opsBeforeDashDash = (args: Word[]): string[] => {
  const out: string[] = [];
  for (const w of args) { if (w.text === '--') break; if (!w.text.startsWith('-')) out.push(w.text.toLowerCase()); }
  return out;
};
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
    return fields.some(v => v.w.dynamic || /mutation/i.test(v.w.text)); // T5-GH-GRAPHQL
  }
  if (writeMethod) return true;
  return fields.length > 0 && !explicitGet;
}
function cloudSeg(seg: Segment): GuardVerdict | null {
  const eff = effectiveCommand(seg);
  if (eff === null || eff === 'cancel') return null; // a cancelled runner is network's to deny
  const { name, args } = eff;
  if (!CLOUD_CLIS.has(name)) return null;
  const { cmd, help, versionFlag } = cloudParse(args, GLOBAL_VALUED[name] ?? new Set<string>(), name);
  const D = (): GuardVerdict => deny('cloud', `${name} changes a service off this machine`, CLOUD_INSTEAD);
  if (help) return null;
  if (versionFlag && cmd.length === 0) return null;
  if (name === 'ansible' || name === 'ansible-playbook') {
    return args.some(w => ['--syntax-check', '--list-hosts', '--list-tasks', '--version', '--help'].includes(w.text)) ? null : D();
  }
  if ((name === 'gh' || name === 'glab') && cmd[0] === 'api') return ghApiWrites(args) ? D() : null;
  const local = LOCAL_VERBS[name];
  if (VERB_FIRST.has(name)) {
    const verb = cmd[0] ?? '';
    if (ALWAYS_DENY[name]?.has(verb)) return D();
    if (local && local(cmd)) return null;
    return verb && isReadVerb(verb) ? null : D();
  }
  if (local && local(cmd)) return null;
  if (ALWAYS_DENY[name]?.has(cmd[0] ?? '')) return D();
  const exc = GROUP_EXC[name];
  if (opsBeforeDashDash(args).some(w => isWriteWord(w) && !exc?.has(w))) return D();
  return cmd.slice(0, 3).some(isReadVerb) ? null : D();
}

// ---- network dispatch -----------------------------------------------------------------------------------------------

function networkSeg(seg: Segment): GuardVerdict | null {
  const eff = effectiveCommand(seg);
  if (eff === null) return null;
  if (eff === 'cancel') return netUnknown('a runner option the hook does not know hides the command it runs');
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
