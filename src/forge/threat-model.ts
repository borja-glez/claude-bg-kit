import type { ThreatModel } from './config.js';

// K4-02: the threat model as the section the brief and the security reviewer read, in English for the model. One bullet
// per entry, each folded to one line so an entry can never pose as a heading of the brief: JS's \s covers U+2028 and
// U+2029, and NEL (U+0085), which some readers also break lines on, is folded too.

const oneLine = (s: string) => s.replace(/[\s\u0085]+/g, ' ').trim();

export function renderThreatModel(tm: ThreatModel): string {
  const lines = ['## Threat model', ''];
  for (const s of tm.protects) lines.push(`- Protects: ${oneLine(s)}`);
  for (const s of tm.trusted) lines.push(`- Trusted: ${oneLine(s)}`);
  for (const s of tm.untrusted) lines.push(`- Untrusted: ${oneLine(s)}`);
  for (const s of tm.outOfScope) lines.push(`- Out of scope: ${oneLine(s)}`);
  if (tm.notes) lines.push(`- Notes: ${oneLine(tm.notes)}`);
  return lines.join('\n') + '\n';
}
