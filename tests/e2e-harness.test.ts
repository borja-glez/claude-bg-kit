import { describe, it, expect } from 'vitest';
import {
  all, hasTools, lastHas, messageBody, not, parseSse, pickStep, sseBody, startMessagesServer, toolResults, turn, userHas,
  type MessagesRequest, type Step,
} from './e2e/harness/messages-server.js';

const req = (over: Partial<MessagesRequest> = {}): MessagesRequest => ({ model: 'm', stream: true, tools: [{ name: 'Read' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'E2E-X go' }] }], ...over });

describe('the scripted Messages API (A8)', () => {
  it('sseBody streams a text reply: message_start, one text block, message_delta with end_turn, message_stop', () => {
    const ev = parseSse(sseBody([{ type: 'text', text: 'hi' }], 'm', 'msg_1'));
    expect(ev.map(e => e.event)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(ev.every(e => e.data.type === e.event)).toBe(true);
    expect(ev[0].data.message).toMatchObject({ id: 'msg_1', role: 'assistant', model: 'm', content: [], stop_reason: null });
    expect(ev[2].data).toMatchObject({ index: 0, delta: { type: 'text_delta', text: 'hi' } });
    expect(ev[4].data.delta).toEqual({ stop_reason: 'end_turn', stop_sequence: null });
  });
  it('a tool_use block starts with an empty input, sends it whole as one input_json_delta and stops with tool_use', () => {
    const input = { file_path: 'C:\\r\\a b.txt', n: 1 };
    const ev = parseSse(sseBody([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input }], 'm', 'msg_2'));
    expect(ev[1].data.content_block).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} });
    expect(ev[2].data.delta.type).toBe('input_json_delta');
    expect(JSON.parse(ev[2].data.delta.partial_json)).toEqual(input);
    expect(ev[4].data.delta.stop_reason).toBe('tool_use');
    expect(messageBody([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input }], 'm', 'msg_3'))
      .toMatchObject({ id: 'msg_3', type: 'message', role: 'assistant', content: [{ type: 'tool_use', input }], stop_reason: 'tool_use' });
  });
  it('the predicates: userHas reads every user message and tool_result text, lastHas the last user message, turn counts assistant messages, hasTools needs a tool', () => {
    const r = req({ messages: [
      { role: 'user', content: 'E2E-X go' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { p: 'E2E-IN-INPUT' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file says E2E-Y' }] }] },
    ] });
    expect([userHas('E2E-X')(r), userHas('E2E-Y')(r), userHas('E2E-IN-INPUT')(r)]).toEqual([true, true, false]);
    expect([lastHas('E2E-Y')(r), lastHas('E2E-X')(r)]).toEqual([true, false]);
    expect([turn(1)(r), turn(0)(r)]).toEqual([true, false]);
    expect([hasTools(r), hasTools(req({ tools: [] })), hasTools(req({ tools: undefined }))]).toEqual([true, false, false]);
    expect(toolResults(r)).toEqual([{ tool_use_id: 't1', is_error: false, text: 'file says E2E-Y' }]);
    expect(all(userHas('E2E-X'), not(userHas('E2E-Z')))(r)).toBe(true);
  });
  it('pickStep takes the first unused step whose predicate holds, each once; a request without tools that carries the prompt never takes a scripted step', () => {
    const when = all(hasTools, userHas('E2E-X'), turn(0));
    const steps: Step[] = [{ name: 'a#0', when, reply: [] }, { name: 'a#1', when, reply: [] }];
    const used = new Set<string>();
    expect(pickStep(steps, used, req({ tools: [] }))).toBeNull();
    expect(pickStep(steps, used, req())?.name).toBe('a#0');
    expect(pickStep(steps, used, req())?.name).toBe('a#1');
    expect(pickStep(steps, used, req())).toBeNull();
  });
  it('the server answers a scripted stream, a plain request, count_tokens and an unknown path, and logs each by its path without the query', async () => {
    const server = await startMessagesServer([{ name: 's#0', when: userHas('E2E-X'), reply: [{ type: 'text', text: 'scripted' }] }]);
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const post = (p: string, body: unknown) => fetch(server.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const a = await post('/v1/messages?beta=true', req());
      expect(a.headers.get('content-type')).toContain('text/event-stream');
      expect(parseSse(await a.text())[2].data.delta.text).toBe('scripted');
      expect(await (await post('/v1/messages', req({ stream: false }))).json())
        .toMatchObject({ type: 'message', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
      expect(await (await post('/v1/messages/count_tokens', req())).json()).toEqual({ input_tokens: 1 });
      const d = await fetch(server.url + '/v1/models');
      expect(d.status).toBe(404);
      expect(await d.json()).toMatchObject({ type: 'error', error: { type: 'not_found_error' } });
      expect(server.log.map(l => [l.method, l.path, l.step])).toEqual([
        ['POST', '/v1/messages', 's#0'], ['POST', '/v1/messages', null], ['POST', '/v1/messages/count_tokens', null], ['GET', '/v1/models', null],
      ]);
    } finally { await server.close(); }
  });
  it('an async reply is awaited; a reply that throws answers with its error as text and logs it; a body that is not JSON gets a 400', async () => {
    const server = await startMessagesServer([
      { name: 'a#0', when: turn(0), reply: async () => [{ type: 'text', text: 'later' }] },
      { name: 'b#0', when: turn(0), reply: () => { throw new Error('boom'); } },
    ]);
    try {
      const post = () => fetch(server.url + '/v1/messages', { method: 'POST', body: JSON.stringify(req()) }).then(r => r.text()).then(parseSse);
      expect((await post())[2].data.delta.text).toBe('later');
      expect((await post())[2].data.delta.text).toBe('e2e: step b#0 failed: boom');
      expect(server.log[1]).toMatchObject({ step: 'b#0', error: 'boom' });
      const bad = await fetch(server.url + '/v1/messages', { method: 'POST', body: 'not json' });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } });
      expect(server.log[2]).toMatchObject({ method: 'POST', path: '/v1/messages', step: null, body: null });
    } finally { await server.close(); }
  });
  it('duplicate step names are refused, and after close the port answers no more', async () => {
    await expect(startMessagesServer([{ name: 'x', when: hasTools, reply: [] }, { name: 'x', when: hasTools, reply: [] }])).rejects.toThrow('e2e: duplicate step name x');
    const server = await startMessagesServer([]);
    await server.close();
    await expect(fetch(server.url + '/v1/messages', { method: 'POST', body: '{}' })).rejects.toThrow();
  });
});
