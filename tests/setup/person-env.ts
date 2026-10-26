// w8 FR1: the person's own forge settings never reach a test. FORGE_WORKFLOW (and FORGE_ROUTE_HINT) set in their
// ~/.claude/settings.json `env` are in the environment of a run started from a Claude Code session; a command a test
// runs without its own env reads process.env, so they would change what it prints.
delete process.env.FORGE_WORKFLOW;
delete process.env.FORGE_ROUTE_HINT;
