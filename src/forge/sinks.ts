// A7: the strict sinks a diff adds. `triage --base` reads them from `git diff -U0` so that a small diff outside the
// sensitive zones that adds an `eval` still gets the security review.
import { isBookkeeping } from './triage.js';

export type SinkKind = 'eval' | 'new-function' | 'tls-off' | 'pickle' | 'yaml-load' | 'object-input-stream';
export interface Sink { kind: SinkKind; file: string; line: number }
export const SINKS_MAX = 20;

const JS = /\.[cm]?[jt]sx?$/i;
const PY = /\.py$/i;
const JVM = /\.(?:java|kt|kts|scala|groovy)$/i;
const CODE = /\.(?:[cm]?[jt]sx?|py|java|kt|kts|scala|groovy|rb|php|go|cs)$/i;
// Launching git or any process is no sink (spec, A7): there is no pattern for exec, spawn or shell: true.
const PATTERNS: { kind: SinkKind; files: RegExp; re: RegExp; unless?: RegExp }[] = [
  { kind: 'eval', files: CODE, re: /(?<![\w$.])eval\s*\(/ },
  { kind: 'new-function', files: JS, re: /\bnew\s+Function\s*\(/ },
  { kind: 'tls-off', files: CODE, re: /\brejectUnauthorized\s*:\s*false\b|\bNODE_TLS_REJECT_UNAUTHORIZED\b['"]?\s*[:=]\s*['"]?0\b|\bstrictSSL\s*:\s*false\b|\bverify\s*=\s*False\b|\bcheck_hostname\s*=\s*False\b|\b_create_unverified_context\b|\bCERT_NONE\b|\bInsecureSkipVerify\s*:\s*true\b|\bNoopHostnameVerifier\b|\bALLOW_ALL_HOSTNAME_VERIFIER\b/ },
  { kind: 'pickle', files: PY, re: /\bc?[Pp]ickle\.(?:loads?|Unpickler)\s*\(/ },
  { kind: 'yaml-load', files: PY, re: /\byaml\.(?:load|load_all|full_load|unsafe_load)\s*\(/, unless: /\bLoader\s*=\s*(?:yaml\.)?C?SafeLoader\b/ },
  { kind: 'object-input-stream', files: JVM, re: /\bObjectInputStream\s*\(/ },
];
// Never read: generated, vendored and test code, and forge's own bookkeeping (isBookkeeping).
const SKIP = [/(^|\/)(?:dist|build|vendor|node_modules|third_party)\//, /\.min\.js$/i, /(^|\/)(?:tests?|__tests__|__mocks__|spec|fixtures)\//i,
  /[._-](?:test|spec)\.[a-z]+$/i, /(^|\/)test_[^/]*\.py$/i, /_test\.(?:go|py)$/i];
const COMMENT = /^\s*(?:\/\/|#|\*|\/\*|<!--)/;

const readable = (file: string): boolean => CODE.test(file) && !SKIP.some(re => re.test(file)) && !isBookkeeping(file);

/** The strict sinks on the lines a unified diff adds (`git diff -U0`), in diff order, one per kind and line, at most SINKS_MAX. */
export function diffSinks(patch: string): Sink[] {
  const out: Sink[] = [];
  let file: string | null = null;
  let prev = '';
  let oldLeft = 0, newLeft = 0, next = 0;
  for (const raw of patch.split('\n')) {
    const line = raw.replace(/\r$/, '');
    // A new hunk or file ends a body whose counts fell short.
    if ((oldLeft > 0 || newLeft > 0) && (line.startsWith('@@ ') || line.startsWith('diff '))) oldLeft = newLeft = 0;
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      if (line.startsWith('-')) oldLeft--;
      else if (line.startsWith('+')) {
        newLeft--;
        const at = next++;
        if (file && !COMMENT.test(line.slice(1))) {
          const text = line.slice(1, 2001);
          for (const p of PATTERNS) {
            if (out.length >= SINKS_MAX) return out;
            if (p.files.test(file) && p.re.test(text) && !(p.unless && p.unless.test(text))) out.push({ kind: p.kind, file, line: at });
          }
        }
      } else { oldLeft--; newLeft--; next++; }
      prev = '';
      continue;
    }
    if (line.startsWith('+++ ') && prev.startsWith('--- ')) {
      const p = line.slice(4).split('\t')[0];
      const f = p === '/dev/null' ? null : (p.startsWith('b/') ? p.slice(2) : p);
      file = f !== null && readable(f) ? f : null;
    } else {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        oldLeft = m[1] === undefined ? 1 : Number(m[1]);
        newLeft = m[3] === undefined ? 1 : Number(m[3]);
        next = Number(m[2]);
      }
    }
    prev = line;
  }
  return out;
}

/** `diff adds a strict sink: <kind> (<file>:<line>)`, the first three, then `, +<n>`. */
export function sinkReason(sinks: readonly Sink[]): string {
  const shown = sinks.slice(0, 3).map(s => `${s.kind} (${s.file}:${s.line})`).join(', ');
  return `diff adds a strict sink: ${shown}${sinks.length > 3 ? `, +${sinks.length - 3}` : ''}`;
}
