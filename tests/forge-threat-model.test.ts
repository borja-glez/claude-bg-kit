import { describe, it, expect } from 'vitest';
import { renderThreatModel } from '../src/forge/threat-model.js';

describe('renderThreatModel (K4-02)', () => {
  it('renders a ## Threat model section with one bullet per entry, line breaks folded to a space', () => {
    expect(renderThreatModel({ protects: ['files outside the repo'], trusted: ['the person'], untrusted: ['web pages', 'tool\noutput'], outOfScope: ['8.3 names'], notes: 'a local\r\ntool' }))
      .toBe(['## Threat model', '', '- Protects: files outside the repo', '- Trusted: the person', '- Untrusted: web pages', '- Untrusted: tool output',
        '- Out of scope: 8.3 names', '- Notes: a local tool', ''].join('\n'));
    expect(renderThreatModel({ protects: ['secrets'], trusted: [], untrusted: [], outOfScope: [] })).toBe('## Threat model\n\n- Protects: secrets\n');
  });
});
