import type { Command } from '../context.js';
import { UsageError } from '../errors.js';
import { doctorExit, doctorSay, runChecks, type DoctorCheck, type DoctorCtx } from '../../doctor.js';
import { STATE_CHECKS } from '../../doctor-state.js';
import { mainCheckout } from '../../local.js';
import { claudeConfigDir } from '../../superpowers.js';

/** A4: every check forge doctor runs, in the order it reports them. */
export const DOCTOR_CHECKS: readonly DoctorCheck[] = [...STATE_CHECKS];

/** A4, forge doctor: a read-only health report. Exit 0 all well, 2 something to look at, 1 only unverified checks. */
export const command: Command = (_args, ctx) => {
  const { io, flag, has } = ctx;
  const locale = flag('locale');
  if (has('locale') && locale !== 'es' && locale !== 'en') throw new UsageError('doctor: --locale must be es or en');
  const env = io.env ?? process.env;
  const dctx: DoctorCtx = {
    main: mainCheckout(io.cwd), cwd: io.cwd, configDir: claudeConfigDir(env), scriptPath: io.scriptPath ?? process.argv[1] ?? '',
    now: io.now(), locale: locale === 'es' ? 'es' : 'en', env,
  };
  const checks = runChecks(DOCTOR_CHECKS, dctx);
  return { code: doctorExit(checks), stdout: JSON.stringify({ checks, say: doctorSay(checks, dctx.locale) }, null, 2) + '\n', stderr: '' };
};
