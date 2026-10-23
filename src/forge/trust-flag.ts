// T6B2-TRUST-LEAF: the tests' switch that counts every config command as trusted (trust.ts reads it). A leaf: it imports
// nothing, so tests/setup/trust-commands.ts, which turns it on, loads no other module, and a test file can still vi.mock
// any module trust.ts imports (vitest does not mock a module a setup file already loaded).
let assumeTrusted = false;

/** Tests only (tests/setup/trust-commands.ts, a vitest setup file): every config command counts as trusted, so the suites
 *  that write a .forge/config.yaml with commands need no answer. tests/forge-trust.test.ts turns it off. */
export function assumeTrustedForTests(on: boolean): void { assumeTrusted = on; }

/** Whether the tests' switch is on. */
export const assumedTrusted = (): boolean => assumeTrusted;
