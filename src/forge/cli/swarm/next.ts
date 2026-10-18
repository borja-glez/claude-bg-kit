import type { SwarmCommand } from './context.js';
import { schedule } from '../../schedule.js';
import { readTickInput } from './shared.js';

export const subcommand: SwarmCommand = (rest, ctx) => {
  const { io, deps, flag, json, now, memberCtx } = ctx;
  const { e, session } = memberCtx(true);
  const { plan, states, sessions, integrated } = readTickInput(io, deps, e, flag('plan'), flag('db'), 'next');
  const running = Object.values(e.tasks).filter(t => t.status === 'running').length;
  // The coordinator's own scheduler, seen from this session: its claims count as its own, the coordinator's as another's.
  const d = schedule({ plan, states, sessions, exec: { ...e, coordinator: session, parallel: Math.min(10, running + 1) }, integrated, now: now.getTime() });
  const start = d.actions.find((a): a is { type: 'start'; task: string } => a.type === 'start');
  return json(start ? { task: start.task, reason: null } : { task: null, reason: d.next.stallReason ?? 'nothing is ready' });
};
