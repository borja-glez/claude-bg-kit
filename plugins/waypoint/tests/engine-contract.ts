// K5-11: the engine's session API, as the engine declares it (types/claude-code), must still fit the contract waypoint
// is written against (src/mod/engine-session.d.ts). Types only: `npm run typecheck:mod` fails when the engine renames
// a field or changes a value of `source` or `reason`. Not a test file: claude plugin test runs *.test.ts only.
import type { Args, ClassicHookInputs, EngineInterface } from 'claude-code';
import type {
  ClassicSessionEndContract, ClassicSessionStartContract, SessionApiContract, SessionEndContract, SessionEndReasonContract,
  SessionStartSourceContract, StoreContract,
} from '../../../src/mod/engine-session';

/** A, checked to be assignable to B. */
type Fits<A extends B, B> = A;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type SessionFits = Fits<EngineInterface['session'], SessionApiContract>;
export type StoreFits = Fits<EngineInterface['store'], StoreContract>;
export type EndFits = Fits<Args<'session.end'>, SessionEndContract>;
export type ClassicStartFits = Fits<ClassicHookInputs['SessionStart'], ClassicSessionStartContract>;
export type ClassicEndFits = Fits<ClassicHookInputs['SessionEnd'], ClassicSessionEndContract>;
// The unions must be the same both ways: a value the engine adds or drops is a change waypoint has to read.
export type SourcesSame = Assert<Same<ClassicHookInputs['SessionStart']['source'], SessionStartSourceContract>>;
export type ReasonsSame = Assert<Same<Args<'session.end'>['reason'], SessionEndReasonContract>>;
export type ClassicReasonsSame = Assert<Same<ClassicHookInputs['SessionEnd']['reason'], SessionEndReasonContract>>;
