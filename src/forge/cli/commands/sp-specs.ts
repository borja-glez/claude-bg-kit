import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { readLocal, updateLocal } from '../../local.js';
import { spSpecs } from '../../superpowers.js';
import { committedAt, declinedSpecs, spContext } from '../shared.js';

export const command: Command = (args, ctx) => {
  const { io, repoDir, flag, has, json } = ctx;
  if (has('decline')) {
    const rel = (flag('decline') ?? '').replace(/\\/g, '/');
    if (!/^docs\/superpowers\/specs\/[^/]+\.md$/.test(rel)) throw new UsageError('sp-specs: --decline needs a docs/superpowers/specs/<file>.md path');
    updateLocal(io.cwd, s => ({ ...s, declinedSpecs: [...new Set([...declinedSpecs(s), rel])] }));
    return json({ declined: rel });
  }
  const now = io.now().getTime();
  const { routed } = spContext(io, repoDir, now);
  return json(spSpecs(repoDir, now, { committedAt: committedAt(io, repoDir), declined: declinedSpecs(readLocal(io.cwd)), routed }));
};
