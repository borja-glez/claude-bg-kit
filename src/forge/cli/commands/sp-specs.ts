import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { readLocal, updateLocal } from '../../local.js';
import { spSpecs } from '../../superpowers.js';
import { committedAt, declinedSpecs, routedSpecs } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json } = ctx;
  if (has('decline')) {
    const rel = (flag('decline') ?? '').replace(/\\/g, '/');
    if (!/^docs\/superpowers\/specs\/[^/]+\.md$/.test(rel)) throw new UsageError('sp-specs: --decline needs a docs/superpowers/specs/<file>.md path');
    updateLocal(io.cwd, s => ({ ...s, declinedSpecs: [...new Set([...declinedSpecs(s), rel])] }));
    return json({ declined: rel });
  }
  const now = io.now().getTime();
  // T7: the specs routes handed off, without the commit subjects only the plans need.
  return json(spSpecs(repoDir, now, { committedAt: committedAt(io, repoDir), declined: declinedSpecs(readLocal(io.cwd)), routed: routedSpecs(io) }));
};
