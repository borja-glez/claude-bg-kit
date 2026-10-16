// K5-11: what this design uses of the engine's session API, versioned in the repo (the engine's own types are not).
// plugins/waypoint/tests/engine-contract.ts checks with types that the engine's real API still fits it.

/** The sources of a classic SessionStart hook. */
export type SessionStartSourceContract = 'startup' | 'resume' | 'clear' | 'compact' | 'fork';
/** The reasons of a SessionEnd (the classic hook's `reason`, and `session.end`'s). */
export type SessionEndReasonContract = 'clear' | 'resume' | 'logout' | 'prompt_input_exit' | 'other';

/** $.session: the band's role reads `id()` (it changes after /clear) and the files under `root()`. */
export interface SessionApiContract { id(): Promise<string>; root(): Promise<string> }
/** The input of `session.end`: after a /clear or a resume the process goes on under another id. */
export interface SessionEndContract { reason: SessionEndReasonContract; sessionId: string }
/** The stdin of `waypoint hook session-start` (and of forge's live and route-session hooks). */
export interface ClassicSessionStartContract { session_id: string; source: SessionStartSourceContract; cwd: string; seconds_since_last_response?: number }
/** The stdin of `waypoint hook session-end`. */
export interface ClassicSessionEndContract { session_id: string; reason: SessionEndReasonContract; cwd: string }
/** $.store: where the band keeps a dismissed notice (wave 2b). */
export interface StoreContract { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
