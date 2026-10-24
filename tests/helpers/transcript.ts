// Builders of the JSONL lines of a Claude Code transcript, in the shape measured on real ones (A6).
export const TX_AT = (min: number): string => new Date(Date.parse('2026-10-24T10:00:00.000Z') + min * 60_000).toISOString();

export interface Usage {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
}
export interface Msg { id: string; usage?: Usage }

export function userText(ts: string, text: string): string {
  return JSON.stringify({ type: 'user', timestamp: ts, sessionId: 's1', message: { role: 'user', content: text } });
}

export function assistantText(ts: string, text: string, msg?: Msg): string {
  return JSON.stringify({
    type: 'assistant', timestamp: ts,
    message: { id: msg?.id ?? 'msg-text', role: 'assistant', content: [{ type: 'text', text }], ...(msg?.usage ? { usage: msg.usage } : {}) },
  });
}

export function toolUse(ts: string, id: string, name: string, input: Record<string, unknown>, msg?: Msg): string {
  return JSON.stringify({
    type: 'assistant', timestamp: ts,
    message: { id: msg?.id ?? `msg-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }], ...(msg?.usage ? { usage: msg.usage } : {}) },
  });
}

export function toolResult(ts: string, id: string, r: { text?: string; error?: string; toolUseResult?: unknown }): string {
  const block = { type: 'tool_result', tool_use_id: id, content: r.error ?? r.text ?? '', ...(r.error !== undefined ? { is_error: true } : {}) };
  return JSON.stringify({
    type: 'user', timestamp: ts, message: { role: 'user', content: [block] },
    ...(r.toolUseResult !== undefined ? { toolUseResult: r.toolUseResult } : {}),
  });
}

export function compaction(ts: string, trigger: string, preTokens: number): string {
  return JSON.stringify({
    type: 'system', subtype: 'compact_boundary', timestamp: ts, content: 'Conversation compacted', compactMetadata: { trigger, preTokens },
  });
}

export const jsonl = (lines: readonly string[]): string => lines.join('\n') + '\n';
