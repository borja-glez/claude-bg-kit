// A8: a fake claude for the tests of the session driver. FAKE_CLAUDE_MODE: echo | ask | hang.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_CLAUDE_MODE ?? 'echo';
const argv = process.argv.slice(2);
const after = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const debugFile = after('--debug-file');
if (debugFile) appendFileSync(debugFile, `fake-claude ${mode}\n`);
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
send({ type: 'system', subtype: 'init', session_id: after('--session-id') });

if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (mode === 'echo') {
      if (msg.type === 'user') send({ type: 'result', subtype: 'success', is_error: false, result: msg.message.content[0].text });
    } else if (mode === 'ask') {
      if (msg.type === 'control_request' && msg.request?.subtype === 'initialize') {
        send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
      } else if (msg.type === 'user') {
        send({ type: 'control_request', request_id: 'ask-1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Q?' }] } } });
      } else if (msg.type === 'control_response') {
        send({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(msg.response.response) });
      }
    }
  });
  rl.on('close', () => process.exit(0));
}
