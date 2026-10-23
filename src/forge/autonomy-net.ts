// Plan 6b-1, Task 5: the three rules that keep an autonomous run from writing OFF the machine — `network` (HTTP writes to
// a host that is not local, publishing, and copies to another host, by Bash or PowerShell), `cloud` (the cloud and deploy
// CLIs unless the command only reads) and `mcp-write` (an MCP tool whose name says it writes). They are built fail-closed
// from the start (T5-LESSONS): a client option the tool's table does not know, or a dynamic/unreadable URL, cancels the
// «this only reads» answer and denies as an unknown target; a runner (npx, pnpm dlx, uvx, python -m, …) counts as the CLI
// it runs; a write verb anywhere wins in `cloud`. Pure: reads no file, starts no process. T5-FILE: re-exported from
// autonomy-rules.ts; this file never imports it.
import type { GuardCtx, GuardInput, GuardRule, GuardVerdict } from './guard.js';
import { isLocalHost } from './resources.js';
import { commandName, type Dialect, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny, mcpWords } from './autonomy-shared.js';
import { BASH_TABLES, scan } from './autonomy-tables.js';

const word = (text: string, dynamic = false): Word => ({ text, dynamic, glob: false });

const NET_INSTEAD = 'only local services may be written; record the action as not done';
const CLOUD_INSTEAD = "read-only commands of that CLI are fine; anything that changes the service is the person's";
const MCP_INSTEAD = 'read tools of that server are fine; record the write as not done';

// ---- the lists (brief, Interfaces) ----------------------------------------------------------------------------------

/** A cloud / deploy CLI: denied unless the command only reads (cloudSeg). */
const CLOUD_CLIS = new Set(['aws', 'gcloud', 'gsutil', 'az', 'kubectl', 'helm', 'terraform', 'tofu', 'pulumi', 'vercel', 'netlify',
  'fly', 'flyctl', 'heroku', 'firebase', 'wrangler', 'doctl', 'railway', 'serverless', 'sls', 'eas', 'supabase', 'stripe', 'gh',
  'glab', 'cdk', 'sam', 'amplify', 'oc', 'argocd', 'ansible', 'ansible-playbook', 'nomad', 'vault', 'consul', 'eb', 'copilot', 'hcloud']);
/** A read verb of a cloud CLI; and any word that begins with `describe-`, `list-`, `get-` or `head-`. */
const READ_VERBS = new Set(['list', 'ls', 'get', 'describe', 'show', 'view', 'status', 'plan', 'whoami', 'version', 'help', 'logs',
  'log', 'diff', 'search', 'inspect', 'info', 'explain', 'validate', 'fmt', 'output', 'top', 'init', 'checks']);
/** A write verb of a cloud CLI: its presence anywhere wins (M10). */
const CLOUD_WRITE_VERBS = new Set(['deploy', 'delete', 'destroy', 'rm', 'remove', 'create', 'apply', 'put', 'update', 'set',
  'terminate', 'run', 'scale', 'push', 'publish', 'start', 'stop', 'restart', 'cp', 'mv', 'sync', 'invoke', 'exec', 'import',
  'attach', 'detach', 'enable', 'disable', 'rollback', 'promote']);
/** A word of an MCP tool name that says it writes. */
const MCP_WRITE_WORDS = new Set(['add', 'append', 'apply', 'approve', 'archive', 'assign', 'attach', 'batch', 'book', 'buy',
  'cancel', 'charge', 'clear', 'close', 'comment', 'commit', 'create', 'delete', 'deploy', 'destroy', 'detach', 'disable',
  'dismiss', 'dispatch', 'drop', 'edit', 'enable', 'exec', 'execute', 'follow', 'fork', 'generate', 'import', 'insert', 'install',
  'invite', 'label', 'like', 'link', 'lock', 'mark', 'merge', 'modify', 'move', 'notify', 'order', 'patch', 'pause', 'pay', 'pin',
  'post', 'provision', 'publish', 'purge', 'push', 'put', 'react', 'rebase', 'refund', 'register', 'reject', 'remove', 'rename',
  'reopen', 'replace', 'reply', 'request', 'reset', 'resolve', 'restart', 'restore', 'resume', 'revoke', 'rollback', 'run', 'save',
  'schedule', 'send', 'set', 'share', 'star', 'submit', 'subscribe', 'sync', 'transfer', 'trigger', 'unfollow', 'uninstall',
  'unlink', 'unlock', 'unpin', 'unpublish', 'unstar', 'unsubscribe', 'update', 'upload', 'upsert', 'vote', 'write']);
/** A first word of an MCP tool name that reads: a write word later is harmless unless it follows `and`/`or`/`then` (M12). */
const MCP_READ_FIRST = new Set(['list', 'get', 'search', 'read', 'fetch', 'view', 'show', 'describe', 'query', 'find', 'count',
  'check', 'inspect', 'lookup', 'take', 'export', 'download', 'preview', 'explain', 'validate', 'analyze', 'summarize', 'diff',
  'status', 'whoami', 'ping']);
/** A browser MCP's local tab tool (by the part after the last `__`): navigating is reading, so it is always allowed (M12). */
const MCP_LOCAL_TOOLS = new Set(['tabs_create_mcp', 'tabs_close_mcp', 'new_page', 'select_page', 'close_page']);

// ---- URLs and hosts -------------------------------------------------------------------------------------------------

/** Whether a URL's host is local: true / false, or 'unknown' when the URL is dynamic or `new URL()` cannot read it. */
function hostLocal(w: Word): boolean | 'unknown' {
  if (w.dynamic) return 'unknown';
  try { const h = new URL(w.text).hostname; return h ? isLocalHost(h) : 'unknown'; } catch { return 'unknown'; }
}
/** Every URL word is a confirmed local host (and there is at least one): then a client call is a local-service matter, allowed. */
const allLocal = (urls: Word[]): boolean => urls.length > 0 && urls.every(w => hostLocal(w) === true);
/** A concrete off-machine target: every URL is readable (so none is dynamic/unparseable) — the deny names a host, not an unknown. */
const knownRemote = (urls: Word[]): boolean => urls.length > 0 && urls.every(w => hostLocal(w) !== 'unknown');

const netWrite = (what: string): GuardVerdict => deny('network', what, NET_INSTEAD);
const netUnknown = (what: string): GuardVerdict => deny('network', `unknown target: ${what}`, NET_INSTEAD);

// ---- runners --------------------------------------------------------------------------------------------------------

// A runner's own options that take a value (so the CLI it runs is the next operand, not the value).
const RUNNER_VALUED = new Set(['-p', '--package', '--from', '--with', '--python', '--spec', '--pip-args', '--index', '--index-url',
  '--extra-index-url', '--constraint', '--refresh-package', '-c', '--call']);

function afterFlags(args: Word[], valued: ReadonlySet<string>): Word[] {
  let i = 0;
  while (i < args.length) {
    const t = args[i].text;
    if (t === '--') { i++; break; }
    if (!t.startsWith('-')) break;
    i += valued.has(t) && !t.includes('=') ? 2 : 1;
  }
  return args.slice(i);
}
const inner = (rest: Word[]): { name: string; args: Word[] } | null =>
  rest.length && !rest[0].dynamic ? { name: commandName(rest[0]), args: rest.slice(1) } : null;

/** T5-LESSONS 3: a runner (npx, pnpm dlx/exec, yarn dlx, bunx, uvx, pipx run, npm exec/x, python -m) resolved to the CLI it runs; null when the call is not a runner. `docker run <image>` is NOT a runner. */
function unwrapRunner(name: string, args: Word[]): { name: string; args: Word[] } | null {
  if (name === 'npx' || name === 'bunx' || name === 'uvx') return inner(afterFlags(args, RUNNER_VALUED));
  if ((name === 'pnpm' && (args[0]?.text === 'dlx' || args[0]?.text === 'exec')) || (name === 'yarn' && args[0]?.text === 'dlx'))
    return inner(afterFlags(args.slice(1), RUNNER_VALUED));
  if (name === 'npm' && (args[0]?.text === 'exec' || args[0]?.text === 'x')) return inner(afterFlags(args.slice(1), RUNNER_VALUED));
  if (name === 'pipx' && args[0]?.text === 'run') return inner(afterFlags(args.slice(1), RUNNER_VALUED));
  if (/^(?:python[0-9.]*|py)$/.test(name)) {
    const mi = args.findIndex(w => w.text === '-m');
    if (mi >= 0 && args[mi + 1] && !args[mi + 1].dynamic) return { name: commandName(args[mi + 1]), args: args.slice(mi + 2) };
  }
  return null;
}

/** The effective command of a segment: its name and arguments, a runner unwrapped to the CLI it runs; null when argv is empty or hidden. */
function effectiveCommand(seg: Segment): { name: string; args: Word[] } | null {
  if (!seg.argv.length || seg.argv[0].dynamic) return null;
  const name = commandName(seg.argv[0]), args = seg.argv.slice(1);
  return unwrapRunner(name, args) ?? { name, args };
}

// ---- publishers -----------------------------------------------------------------------------------------------------

const SSH_LIKE = new Set(['ssh', 'scp', 'sftp', 'nc', 'ncat', 'telnet']);
const NPM_PUBLISH = new Set(['publish', 'unpublish', 'deprecate', 'dist-tag', 'owner', 'access', 'token', 'login', 'adduser']);

/** Whether an rsync operand is a remote spec `[user@]host:path`, `host::module` or `rsync://…` (not a local path or a Windows drive). */
function rsyncRemote(text: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return true;
  const m = /^([^/\\:]+)::?/.exec(text);
  return !!m && !/^[A-Za-z]$/.test(m[1]);
}

/** A command that sends something off this machine whatever its (missing) URL: PUBLISHERS. Null when the command is not one. */
function publisherDeny(name: string, args: Word[]): GuardVerdict | null {
  const ops = args.filter(w => !w.text.startsWith('-') && !w.text.startsWith('/'));
  const o = (i: number): string => ops[i]?.text.toLowerCase() ?? '';
  const D = (what: string): GuardVerdict => netWrite(what);
  if (SSH_LIKE.has(name)) return D(`${name} connects to another host`);
  if (name === 'rsync') return args.some(w => !w.text.startsWith('-') && rsyncRemote(w.text)) ? D('rsync copies to another host') : null;
  if (name === 'git' && o(0) === 'send-email') return D('git send-email sends patches off this machine');
  if ((name === 'npm' || name === 'pnpm') && NPM_PUBLISH.has(o(0))) return D(`${name} ${o(0)} reaches the registry`);
  if (name === 'yarn' && (NPM_PUBLISH.has(o(0)) || (o(0) === 'npm' && NPM_PUBLISH.has(o(1))))) return D('yarn reaches the registry');
  if (name === 'cargo' && ['publish', 'yank', 'owner'].includes(o(0))) return D(`cargo ${o(0)} reaches the registry`);
  if (name === 'twine' && o(0) === 'upload') return D('twine upload reaches the registry');
  if (['poetry', 'uv', 'hatch', 'flit', 'pdm'].includes(name) && o(0) === 'publish') return D(`${name} publish reaches the registry`);
  if (name === 'gem' && ['push', 'yank'].includes(o(0))) return D(`gem ${o(0)} reaches the registry`);
  if (name === 'dotnet' && o(0) === 'nuget' && o(1) === 'push') return D('dotnet nuget push reaches the registry');
  if (name === 'mvn' && ops.some(w => w.text === 'deploy')) return D('mvn deploy reaches the repository');
  if ((name === 'gradle' || name === 'gradlew') && ops.some(w => w.text === 'publish' || w.text.endsWith(':publish'))) return D('gradle publish reaches the repository');
  if (name === 'docker' && (o(0) === 'push' || o(0) === 'login')) return D(`docker ${o(0)} reaches a registry`);
  if (name === 'docker' && o(0) === 'buildx' && args.some(w => w.text === '--push')) return D('docker buildx --push reaches a registry');
  if (name === 'podman' && o(0) === 'push') return D('podman push reaches a registry');
  if ((name === 'vsce' || name === 'ovsx') && o(0) === 'publish') return D(`${name} publish reaches a marketplace`);
  return null;
}

// ---- curl / wget ----------------------------------------------------------------------------------------------------

const CURL_DATA = ['-d', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json', '-F', '--form', '--form-string', '-T', '--upload-file'];
const WRITE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const isWriteMethod = (m: string): boolean => m !== '' && !WRITE_METHODS.includes(m);

/** curl: a write form is `-X|--request` with a non-read method (or a dynamic one), or any data/form/upload option. Operands are URLs. */
function curlDeny(args: Word[], d: Dialect): GuardVerdict | null {
  const sc = scan(args, BASH_TABLES['curl'], d);
  const urls = sc.ops;
  if (allLocal(urls)) return null;
  const method = sc.vals.filter(v => v.key === '-X' || v.key === '--request');
  const write = method.some(v => v.w.dynamic || isWriteMethod(v.w.text.toUpperCase())) || CURL_DATA.some(f => sc.flags.has(f));
  if (write) return knownRemote(urls) ? netWrite('curl writes to a host that is not local') : netUnknown('curl writes to a host the hook cannot read');
  if (sc.unknown) return netUnknown('curl has an option the hook does not know, so a write to a remote host cannot be ruled out');
  return null;
}

/** wget: a write form is `--method` with a non-read method, or `--post-data`/`--post-file`/`--body-data`/`--body-file`. Operands are URLs. */
function wgetDeny(args: Word[], d: Dialect): GuardVerdict | null {
  const sc = scan(args, BASH_TABLES['wget'], d);
  const urls = sc.ops;
  if (allLocal(urls)) return null;
  const method = sc.vals.filter(v => v.key === '--method');
  const write = method.some(v => v.w.dynamic || isWriteMethod(v.w.text.toUpperCase())) || ['--post-data', '--post-file', '--body-data', '--body-file'].some(f => sc.flags.has(f));
  if (write) return knownRemote(urls) ? netWrite('wget writes to a host that is not local') : netUnknown('wget writes to a host the hook cannot read');
  if (sc.unknown) return netUnknown('wget has an option the hook does not know, so a write to a remote host cannot be ruled out');
  return null;
}

// ---- httpie (http / https / xh) -------------------------------------------------------------------------------------

const HTTPIE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT']);
const HTTPIE_VALUED = new Set(['--pretty', '--style', '-s', '--print', '-p', '--output', '-o', '--session', '--session-read-only',
  '--auth', '-a', '--auth-type', '-A', '--proxy', '--verify', '--ssl', '--cert', '--cert-key', '--cert-key-pass', '--timeout',
  '--max-redirects', '--max-headers', '--format-options', '--default-scheme', '--boundary', '--response-charset', '--response-mime']);
const HTTPIE_SWITCH = new Set(['-j', '--json', '-f', '--form', '--multipart', '-h', '--headers', '-m', '--meta', '-b', '--body',
  '-v', '--verbose', '--all', '-S', '--stream', '-d', '--download', '-c', '--continue', '-F', '--follow', '--check-status',
  '--ignore-stdin', '--path-as-is', '--chunked', '-x', '--compress', '--offline', '-q', '--quiet', '--help', '--version',
  '--debug', '--traceback', '-I', '--ignore-netrc']);

/** The host of an httpie URL argument (may be scheme-less, or httpie's `:port/path` localhost shorthand); null when it cannot be read. */
function httpieHost(text: string): string | null {
  let u = text.replace(/^https?:\/\//i, '');
  if (u.startsWith(':') || u.startsWith('/')) return 'localhost';
  const host = u.split(/[/?#]/)[0].replace(/:\d+$/, '');
  return host || null;
}
const httpieFlag = (t: string): 'valued' | 'switch' | 'unknown' => {
  if (t.startsWith('--no-')) return 'switch';
  const key = t.includes('=') ? t.slice(0, t.indexOf('=')) : t;
  return HTTPIE_VALUED.has(key) ? 'valued' : HTTPIE_SWITCH.has(key) ? 'switch' : 'unknown';
};
/** A request item that adds to the body: `k=v` (data), `k:=v` (raw json) or `k@file` (upload); a header `k:v` or query `k==v` is not. */
const httpieBody = (t: string): boolean => /^[^=:@\s]+(?::=|=(?!=)|@)/.test(t);

function httpieDeny(args: Word[]): GuardVerdict | null {
  let method = '', hasBody = false, unknown = false, seenUrl = false;
  let urlWord: Word | null = null;
  for (let k = 0; k < args.length; k++) {
    const w = args[k], t = w.text;
    if (t.length > 1 && t.startsWith('-')) {
      if (t === '--') continue;
      const kind = httpieFlag(t);
      if (kind === 'valued') { if (!t.includes('=') && args[k + 1]) k++; }
      else if (kind === 'unknown') unknown = true;
      continue;
    }
    if (!method && !seenUrl && !w.dynamic && HTTPIE_METHODS.has(t.toUpperCase())) { method = t.toUpperCase(); continue; }
    if (!seenUrl) { urlWord = w; seenUrl = true; continue; }
    if (w.dynamic || httpieBody(t)) hasBody = true;
  }
  const host = urlWord && !urlWord.dynamic ? httpieHost(urlWord.text) : null;
  if (host !== null && isLocalHost(host)) return null;
  const write = hasBody || isWriteMethod(method);
  if (write) return host !== null ? netWrite('httpie writes to a host that is not local') : netUnknown('httpie writes to a host the hook cannot read');
  if (unknown) return netUnknown('httpie has an option the hook does not know, so a write to a remote host cannot be ruled out');
  return null;
}

// ---- Invoke-WebRequest / Invoke-RestMethod (PowerShell) -------------------------------------------------------------

const PS_WEB_NAMES = new Set(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'curl', 'wget']);
// The documented parameters of Invoke-WebRequest / Invoke-RestMethod (and the common parameters), for the same per-cmdlet reading as Task 4.
const PS_WEB_PARAMS: Record<string, 'v' | 'w'> = {
  uri: 'v', outfile: 'v', infile: 'v', method: 'v', custommethod: 'v', body: 'v', form: 'v', headers: 'v', contenttype: 'v',
  credential: 'v', authentication: 'v', token: 'v', certificate: 'v', certificatethumbprint: 'v', sslprotocol: 'v', useragent: 'v',
  websession: 'v', sessionvariable: 'v', proxy: 'v', proxycredential: 'v', transferencoding: 'v', timeoutsec: 'v',
  connectiontimeoutseconds: 'v', operationtimeoutseconds: 'v', maximumredirection: 'v', maximumretrycount: 'v', retryintervalsec: 'v',
  httpversion: 'v', unixsocket: 'v', maximumfollowrellink: 'v', responseheadersvariable: 'v', statuscodevariable: 'v',
  usebasicparsing: 'w', usedefaultcredentials: 'w', allowunencryptedauthentication: 'w', skipcertificatecheck: 'w',
  disablekeepalive: 'w', skipheadervalidation: 'w', allowinsecureredirect: 'w', preserveauthorizationonredirect: 'w',
  preservehttpmethodonredirect: 'w', noproxy: 'w', proxyusedefaultcredentials: 'w', passthru: 'w', resume: 'w',
  skiphttperrorcheck: 'w', followrellink: 'w',
};
const PS_COMMON: Record<string, 'v' | 'w'> = {
  erroraction: 'v', ea: 'v', warningaction: 'v', wa: 'v', informationaction: 'v', infa: 'v', errorvariable: 'v', ev: 'v',
  warningvariable: 'v', wv: 'v', informationvariable: 'v', iv: 'v', outvariable: 'v', ov: 'v', outbuffer: 'v', ob: 'v',
  pipelinevariable: 'v', pv: 'v', progressaction: 'v', proga: 'v', verbose: 'w', debug: 'w', whatif: 'w', confirm: 'w',
};
/** Resolve a typed parameter name (or an unambiguous prefix) against the web cmdlet's parameters and the common ones (case folded by the caller). */
function resolveWebParam(nm: string): string | null {
  if (PS_WEB_PARAMS[nm] !== undefined || PS_COMMON[nm] !== undefined) return nm;
  const keys = [...Object.keys(PS_WEB_PARAMS), ...Object.keys(PS_COMMON)].filter(k => k.startsWith(nm));
  return keys.length === 1 ? keys[0] : null;
}

function psWebDeny(name: string, args: Word[]): GuardVerdict | null {
  let method = '', methodDynamic = false, hasBody = false, unknown = false;
  let uriWord: Word | null = null;
  const positionals: Word[] = [];
  const apply = (p: string, v: Word) => {
    if (p === 'method' || p === 'custommethod') { if (v.dynamic) methodDynamic = true; else method = v.text.toUpperCase(); }
    else if (p === 'body' || p === 'form' || p === 'infile') hasBody = true;
    else if (p === 'uri') uriWord = v;
  };
  for (let k = 0; k < args.length; k++) {
    const w = args[k], t = w.text;
    const glued = /^-([A-Za-z][\w-]*):(.*)$/s.exec(t);
    if (glued) { const p = resolveWebParam(glued[1].toLowerCase()); if (p) apply(p, word(glued[2], w.dynamic)); else unknown = true; continue; }
    const bare = /^-([A-Za-z][\w-]*)$/.exec(t);
    if (bare) {
      const p = resolveWebParam(bare[1].toLowerCase());
      if (!p) { unknown = true; continue; }
      if ((PS_WEB_PARAMS[p] ?? PS_COMMON[p]) === 'w') continue;
      const nx = args[k + 1];
      if (nx && !nx.text.startsWith('-')) { apply(p, nx); k++; }
      continue;
    }
    positionals.push(w);
  }
  if (!uriWord && positionals.length) uriWord = positionals[0];
  const host = hostLocal(uriWord ?? word('', true));
  if (host === true) return null;
  const write = hasBody || methodDynamic || isWriteMethod(method);
  if (write) return host === false ? netWrite(`${name} writes to a host that is not local`) : netUnknown(`${name} writes to a host the hook cannot read`);
  if (unknown) return netUnknown(`${name} has a parameter the hook does not know, so a write to a remote host cannot be ruled out`);
  return null;
}

// ---- cloud ----------------------------------------------------------------------------------------------------------

const isReadVerb = (w: string): boolean => READ_VERBS.has(w) || /^(?:describe|list|get|head)-/.test(w);

/** The subcommand words for the read test: non-flag words, a long flag's following value skipped so it is never read as a verb (T5-LESSONS 4). */
function commandWords(args: Word[]): string[] {
  const out: string[] = [];
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t.startsWith('-')) { if (t.startsWith('--') && !t.includes('=')) k++; continue; }
    out.push(t.toLowerCase());
  }
  return out;
}

/** gh api is allowed only without a non-GET `-X|--method` and without `-f`, `-F`, `--field`, `--raw-field` or `--input`. */
function ghApiWrites(args: Word[]): boolean {
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    const m = /^(?:-X|--method)(?:=(.*))?$/.exec(t);
    if (m) { let v = m[1]; if (v === undefined) { v = args[k + 1]?.text; k++; } if (v && v.toUpperCase() !== 'GET') return true; continue; }
    if (/^(?:-f|-F|--field|--raw-field|--input)(?:=.*)?$/.test(t)) return true;
  }
  return false;
}

function cloudSeg(seg: Segment): GuardVerdict | null {
  const eff = effectiveCommand(seg);
  if (!eff) return null;
  const { name, args } = eff;
  if (!CLOUD_CLIS.has(name)) return null;
  if (args.some(w => /^(?:--version|--help|-h)$/i.test(w.text))) return null;
  const ops = args.filter(w => !w.text.startsWith('-')).map(w => w.text.toLowerCase());
  const cmd = commandWords(args), sub = cmd[0] ?? '';
  const D = (): GuardVerdict => deny('cloud', `${name} changes a service off this machine`, CLOUD_INSTEAD);
  if ((name === 'terraform' || name === 'tofu') && ['apply', 'destroy', 'import', 'state', 'taint'].includes(sub)) return D();
  if (name === 'kubectl' && ['apply', 'delete', 'patch', 'edit', 'scale', 'rollout', 'create', 'replace', 'exec'].includes(sub)) return D();
  if (name === 'gh' && sub === 'api') return ghApiWrites(args) ? D() : null;
  const reads = cmd.slice(0, 2).some(isReadVerb) && !ops.some(w => CLOUD_WRITE_VERBS.has(w));
  return reads ? null : D();
}

// ---- the rules ------------------------------------------------------------------------------------------------------

function networkSeg(seg: Segment): GuardVerdict | null {
  const eff = effectiveCommand(seg);
  if (!eff) return null;
  const { name, args } = eff;
  const pub = publisherDeny(name, args);
  if (pub) return pub;
  if (seg.dialect === 'powershell' && PS_WEB_NAMES.has(name)) return psWebDeny(name, args);
  if (name === 'curl') return curlDeny(args, seg.dialect);
  if (name === 'wget') return wgetDeny(args, seg.dialect);
  if (['http', 'https', 'xh', 'xhs'].includes(name)) return httpieDeny(args);
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

/** A write word that follows `and`, `or` or `then` (so `get_or_create_user` writes). */
function writeAfterConnector(words: string[]): boolean {
  let seen = false;
  for (const w of words) {
    if (w === 'and' || w === 'or' || w === 'then') { seen = true; continue; }
    if (seen && MCP_WRITE_WORDS.has(w)) return true;
  }
  return false;
}

export const mcpWriteRule: GuardRule = {
  id: 'mcp-write',
  check(input: GuardInput, ctx: GuardCtx): GuardVerdict | null {
    if (!ctx.autonomous) return null;
    const name = input.tool_name;
    if (!name.startsWith('mcp__')) return null;
    const suffix = name.slice(name.lastIndexOf('__') + 2);
    if (MCP_LOCAL_TOOLS.has(suffix) || suffix.startsWith('resize_')) return null;
    const words = mcpWords(name);
    if (!words.some(w => MCP_WRITE_WORDS.has(w))) return null;
    if (MCP_READ_FIRST.has(words[0]) && !writeAfterConnector(words)) return null;
    return deny('mcp-write', `${name} is an MCP tool whose name says it writes off this machine`, MCP_INSTEAD);
  },
};
