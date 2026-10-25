// A8 e2e probe: appends the stdin of a hook as one {event, input} line to BGKIT_E2E_HOOK_LOG. Prints nothing, always exits 0.
import { appendFileSync, readFileSync } from 'node:fs';

try {
  const log = process.env.BGKIT_E2E_HOOK_LOG;
  if (log) {
    let text = '';
    try { text = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
    let record;
    try {
      const input = JSON.parse(text);
      record = { event: typeof input?.hook_event_name === 'string' ? input.hook_event_name : 'unknown', input };
    } catch {
      record = { event: 'unparsed', input: { text } };
    }
    appendFileSync(log, JSON.stringify(record) + '\n');
  }
} catch { /* a probe never fails a hook */ }
process.exit(0);
