// A8: the scripted Messages API that the real `claude` runs against in the e2e of the hooks: a fixed script of
// text and tool_use replies, each step answering once. It has no dependencies beyond node:http.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type ReplyBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export interface MessagesRequest {
  model?: string; stream?: boolean; system?: unknown;
  tools?: { name: string; input_schema?: unknown }[];
  messages: { role: 'user' | 'assistant'; content: unknown }[];
}
export type Predicate = (r: MessagesRequest) => boolean;
export interface Step {
  name: string; // unique in the script: '<scenario>#<n>'
  when: Predicate;
  reply: ReplyBlock[] | ((r: MessagesRequest) => ReplyBlock[] | Promise<ReplyBlock[]>);
}
export interface Logged { method: string; path: string; step: string | null; body: MessagesRequest | null; error?: string }
export interface ScriptedServer { url: string; log: Logged[]; close(): Promise<void> }

export const FALLBACK: readonly ReplyBlock[] = [{ type: 'text', text: 'ok' }];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// The text of a tool_result's content (a string or text blocks), or of a message's content.
function blocksText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    if (!isObj(b)) continue;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'tool_result') parts.push(blocksText(b.content));
  }
  return parts.join('\n');
}

export function messageText(m: { content: unknown }): string {
  return blocksText(m.content);
}

export function requestText(r: MessagesRequest): string {
  return [blocksText(r.system), ...(r.messages ?? []).map(messageText)].filter(s => s !== '').join('\n');
}

export function toolNames(r: MessagesRequest): string[] {
  return (r.tools ?? []).map(t => t.name);
}

export function toolResults(r: MessagesRequest): { tool_use_id: string; is_error: boolean; text: string }[] {
  const out: { tool_use_id: string; is_error: boolean; text: string }[] = [];
  for (const m of r.messages ?? []) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (isObj(b) && b.type === 'tool_result') out.push({ tool_use_id: String(b.tool_use_id), is_error: b.is_error === true, text: blocksText(b.content) });
    }
  }
  return out;
}

const userMessages = (r: MessagesRequest) => (r.messages ?? []).filter(m => m.role === 'user');

export const hasTools: Predicate = r => Array.isArray(r.tools) && r.tools.length > 0;
export const userHas = (text: string): Predicate => r => userMessages(r).some(m => messageText(m).includes(text));
export const lastHas = (text: string): Predicate => r => {
  const u = userMessages(r);
  return u.length > 0 && messageText(u[u.length - 1]).includes(text);
};
export const turn = (n: number): Predicate => r => (r.messages ?? []).filter(m => m.role === 'assistant').length === n;
export const not = (p: Predicate): Predicate => r => !p(r);
export const all = (...ps: Predicate[]): Predicate => r => ps.every(p => p(r));

// The first step, in script order, that is not used yet and whose predicate holds. It is marked used on the spot.
export function pickStep(steps: readonly Step[], used: Set<string>, r: MessagesRequest): Step | null {
  for (const s of steps) {
    if (used.has(s.name) || !s.when(r)) continue;
    used.add(s.name);
    return s;
  }
  return null;
}

const USAGE = { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const stopReason = (reply: readonly ReplyBlock[]) => (reply.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn');

export function sseBody(reply: readonly ReplyBlock[], model: string, id: string): string {
  const out: string[] = [];
  const ev = (type: string, data: Record<string, unknown>) => out.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: USAGE } });
  reply.forEach((b, index) => {
    if (b.type === 'text') {
      ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    ev('content_block_stop', { index });
  });
  ev('message_delta', { delta: { stop_reason: stopReason(reply), stop_sequence: null }, usage: { output_tokens: 1 } });
  ev('message_stop', {});
  return out.join('');
}

export function messageBody(reply: readonly ReplyBlock[], model: string, id: string): Record<string, unknown> {
  return {
    id, type: 'message', role: 'assistant', model,
    content: reply.map(b => (b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', id: b.id, name: b.name, input: b.input })),
    stop_reason: stopReason(reply), stop_sequence: null, usage: USAGE,
  };
}

export function parseSse(text: string): { event: string; data: any }[] {
  const out: { event: string; data: any }[] = [];
  for (const chunk of text.split(/\r?\n\r?\n/)) {
    let event = '';
    const data: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (event && data.length > 0) out.push({ event, data: JSON.parse(data.join('\n')) });
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const errorBody = (type: string, message: string) => ({ type: 'error', error: { type, message } });

export async function startMessagesServer(steps: readonly Step[]): Promise<ScriptedServer> {
  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.name)) throw new Error(`e2e: duplicate step name ${s.name}`);
    seen.add(s.name);
  }
  const used = new Set<string>();
  const log: Logged[] = [];
  let counter = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const raw = await readBody(req);
    if (method === 'POST' && (path === '/v1/messages' || path === '/v1/messages/count_tokens')) {
      let body: MessagesRequest | null = null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isObj(parsed) && !Array.isArray(parsed)) body = parsed as unknown as MessagesRequest;
      } catch { /* answered below */ }
      if (!body) {
        log.push({ method, path, step: null, body: null });
        sendJson(res, 400, errorBody('invalid_request_error', 'e2e: the body is not a JSON object'));
        return;
      }
      if (path === '/v1/messages/count_tokens') {
        log.push({ method, path, step: null, body });
        sendJson(res, 200, { input_tokens: 1 });
        return;
      }
      const step = pickStep(steps, used, body);
      const entry: Logged = { method, path, step: step ? step.name : null, body };
      log.push(entry);
      let reply: readonly ReplyBlock[] = FALLBACK;
      if (step) {
        try {
          reply = typeof step.reply === 'function' ? await step.reply(body) : step.reply;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          entry.error = message;
          reply = [{ type: 'text', text: `e2e: step ${step.name} failed: ${message}` }]; // a 5xx would make Claude Code retry
        }
      }
      const model = body.model ?? 'e2e-model';
      const id = `msg_e2e_${++counter}`;
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.end(sseBody(reply, model, id));
      } else {
        sendJson(res, 200, messageBody(reply, model, id));
      }
      return;
    }
    log.push({ method, path, step: null, body: null });
    sendJson(res, 404, errorBody('not_found_error', `e2e: no route for ${method} ${path}`));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(e => {
      if (!res.headersSent) sendJson(res, 500, errorBody('api_error', e instanceof Error ? e.message : String(e)));
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    log,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    }),
  };
}
