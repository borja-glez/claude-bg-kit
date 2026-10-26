import type { Command } from '../context.js';
import { loadConfig, configDefault, configValue } from '../../config.js';
import { UsageError } from '../errors.js';
import { mainCheckout } from '../../local.js';

export const command: Command = (args, ctx) => {
  const { io, ok } = ctx;
  // The config of the main checkout, whatever --cwd says: a config the person writes by hand is untracked and
  // exists only there.
  const [sub, key] = args;
  if (sub !== 'get' || !key || key.startsWith('--')) throw new UsageError('usage: forge config get <key> (reads .forge/config.yaml of the main checkout, defaults applied; --cwd does not change it)');
  let value = configValue(loadConfig(mainCheckout(io.cwd)), key);
  if (value === undefined) {
    // FC4: a known key the file leaves unset prints its default, or nothing when it has none.
    const unset = configDefault(key);
    if (!unset) throw new UsageError(`config get: ${key} is not a config key`);
    value = unset.value;
  }
  if (value === undefined) return { code: 0, stdout: '', stderr: '' };
  return ok(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value));
};
