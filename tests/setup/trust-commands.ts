// I-03: in the tests every command of a .forge/config.yaml counts as trusted, so the suites that write a config with
// validators or swarm.setup need no recorded answer. tests/forge-trust.test.ts turns it off for its own tests.
import { assumeTrustedForTests } from '../../src/forge/trust.js';

assumeTrustedForTests(true);
