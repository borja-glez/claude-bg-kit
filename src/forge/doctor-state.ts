import type { DoctorCheck } from './doctor.js';
import { scanJobs, stepLockHeld } from './jobs.js';

/** A4: the checks of forge's own state, read from the main checkout without writing anything. */
const stepLockCheck: DoctorCheck = {
  id: 'step-lock',
  run(ctx) {
    const held = stepLockHeld(ctx.main, ctx.now);
    if (!held) return { id: 'step-lock', status: 'ok', detail: 'no swarm step is running' };
    return {
      id: 'step-lock', status: 'warn',
      detail: `a swarm step is running (.forge/jobs/step.lock, ${held.pid === null ? 'pid unknown' : `pid ${held.pid}`})`,
      data: { pid: held.pid },
      fix: { do: 'wait for the step to end; the next swarm step takes over a step.lock whose process died', kind: 'manual' },
    };
  },
};

const jobsCheck: DoctorCheck = {
  id: 'jobs',
  run(ctx) {
    const live = scanJobs(ctx.main, ctx.now).live;
    return { id: 'jobs', status: 'ok', detail: `${live.length} background forge command(s) running`, data: { jobs: live.map(j => ({ cmd: j.cmd, task: j.task })) } };
  },
};

export const STATE_CHECKS: readonly DoctorCheck[] = [stepLockCheck, jobsCheck];
