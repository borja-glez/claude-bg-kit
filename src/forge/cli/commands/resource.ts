import path from 'node:path';
import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { parseRun, readRunText } from '../../run.js';
import { mainCheckout } from '../../local.js';
import { addResource, readResources, ResourceError, runTmp } from '../../resources.js';

export const command: Command = (args, ctx) => {
  const { io, flag, has, json, ts } = ctx;
  const usage = 'usage: forge resource add --kind <postgres|mysql|mongo|redis|sqlite|container|volume|compose> --name <n> [--host <h>] | resource list';
  // The run is the main checkout's, active or not: what a run created can be listed after it ends.
  const main = mainCheckout(io.cwd);
  const auto = parseRun(readRunText(main))?.autonomous;
  switch (args[0]) {
    case 'add': {
      if (!auto) throw new UsageError('resource add: there is no autonomous run in .forge/run.json');
      if (!has('kind') || !has('name')) throw new UsageError(usage);
      const kind = flag('kind') ?? '';
      // A sqlite name is a path: it resolves from the cwd of the command and is stored absolute.
      const name = kind === 'sqlite' ? path.resolve(io.cwd, flag('name') ?? '') : flag('name') ?? '';
      try {
        const resource = addResource(main, auto, { kind, name, ...(has('host') ? { host: flag('host') ?? '' } : {}) }, ts(), runTmp(auto.runId));
        return json({ resource, count: readResources(main, auto.runId).length });
      } catch (e) {
        if (e instanceof ResourceError) throw new UsageError(e.message);
        throw e;
      }
    }
    case 'list': {
      if (!auto) throw new UsageError('resource list: there is no autonomous run in .forge/run.json');
      return json({ runId: auto.runId, resources: readResources(main, auto.runId) });
    }
    default:
      throw new UsageError(usage);
  }
};
