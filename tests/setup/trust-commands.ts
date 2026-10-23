// I-03: in the tests every command of a .forge/config.yaml counts as trusted, so the suites that write a config with
// validators or swarm.setup need no recorded answer. tests/forge-trust.test.ts turns it off for its own tests.
// T6B2-TRUST-LEAF: only the leaf module is loaded here, so a test file can still vi.mock any module trust.ts imports.
import { assumeTrustedForTests } from '../../src/forge/trust-flag.js';

assumeTrustedForTests(true);
