// A8: the script pieces of the /compact scenario. A `.e2e.ts` is not imported from another, so they live here.
import { messageText, type MessagesRequest, type Predicate, type ReplyBlock, userHas } from './messages-server.js';

/** The turns of a compaction session: some work, the /compact command, and a prompt that comes after it. */
export const COMPACT_TURNS = (marker: string): string[] => [`${marker}: work`, '/compact', 'E2E-AFTER: continue'];

/** The request that asks the model for the summary: the marker is in the conversation and the last user message asks to summarize.
 *  Never `requestText`: Claude Code's system prompt talks about summaries too and would match every request. */
export const compacting = (marker: string): Predicate => r => {
  if (!userHas(marker)(r)) return false;
  const users = (r.messages ?? []).filter(m => m.role === 'user');
  return users.length > 0 && /summar/i.test(messageText(users[users.length - 1]));
};

/** The scripted summary: the shape Claude Code reads (an analysis block and a summary block). */
export const SUMMARY_REPLY: ReplyBlock[] = [{ type: 'text', text: '<analysis>e2e</analysis>\n<summary>E2E compact summary</summary>' }];

/** A tool_use of Skill with the fields its input_schema in this request lists (`skill`, and no other required one). */
export function skillUse(r: MessagesRequest, id: string, skill: string): ReplyBlock {
  const tool = (r.tools ?? []).find(t => t.name === 'Skill');
  if (!tool) throw new Error('e2e: the request offers no Skill tool');
  const schema = tool.input_schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const props = Object.keys(schema?.properties ?? {});
  const field = props.includes('skill') ? 'skill' : props.includes('name') ? 'name' : (schema?.required ?? [])[0];
  if (!field) throw new Error('e2e: the Skill input_schema has no field to name the skill in');
  return { type: 'tool_use', id, name: 'Skill', input: { [field]: skill } };
}
