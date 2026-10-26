export type Size = 'trivial' | 'small' | 'medium' | 'large' | 'question' | 'agent';
export type ProviderError = 'timeout' | 'spawn' | 'no-result' | 'auth' | 'api';
export interface EvalPrompt { id: string; size: Size; lang: 'es' | 'en'; expected: 'route' | 'none' | 'either'; competing?: 'direct' | 'brainstorming'; text: string }
export interface EvalConfig { name: string; superpowers: boolean; hint: boolean }
export interface EvalResult {
  id: string; size: Size; lang: EvalPrompt['lang']; expected: EvalPrompt['expected']; competing?: 'direct' | 'brainstorming' | null; config: string;
  firstSkill: string | null; plugins: string[] | null; cost: number | null; error: string | null;
  // Absent reads as rep 1, no error, hook ran.
  rep?: number; provider?: ProviderError | null; hookRan?: boolean | null;
}
export interface Summary {
  config: string; routed: number; routable: number; rate: number; falseNegatives: number; falsePositives: number; others: number;
  either: number; eitherRouted: number; competing: number; competingRouted: number; plugins: 'ok' | 'contradicts' | null; cost: number | null;
  ci: { low: number; high: number } | null; providerErrors: number; hookMissing: number;
}
export function parseArgs(argv: string[]): { dry: boolean; keep: boolean; only: string | null; config: string | null; reps: number; resume: string | null } | { error: string };
export const CONFIGS: EvalConfig[];
export const DEMO_SHOP: Record<string, string>;
export function demoRepo(repo: string): { reset: () => void };
export function sessionEnv(config: EvalConfig, env: Record<string, string | undefined>): Record<string, string | undefined>;
export function readStream(text: string): { firstSkill: string | null; plugins: string[] | null; stop: string | null; cost: number | null;
  isError: boolean | null; apiStatus: number | null; hooks: string[]; promptHooks: number };
export function forgeHookRan(promptHooks: number, foreign: number): boolean;
export function foreignPromptHooks(o: { configDir: string; superpowers: boolean; pluginDirs?: string[] }): string[];
export function providerError(o: { spawnError: string | null; stop: string | null; isError: boolean | null; apiStatus: number | null }): ProviderError | null;
export function trialKey(r: { config: string; id: string; rep?: number }): string;
export function readTrials(text: string): EvalResult[];
/** Appends one trial as a JSONL line; a file whose last line was cut (no final newline) gets one first, so the new line stands alone. */
export function appendTrial(file: string, row: EvalResult): void;
export function isValidTrial(r: EvalResult, configs?: EvalConfig[]): boolean;
export function pending(prompts: EvalPrompt[], configs: EvalConfig[], reps: number, done: EvalResult[]): { config: EvalConfig; prompt: EvalPrompt; rep: number }[];
export function stopReason(trials: EvalResult[], configs?: EvalConfig[]): string | null;
export function wilson(k: number, n: number, z?: number): { low: number; high: number } | null;
export function claudeArgs(prompt: string, o: { settings: string; pluginDirs: string[] }): string[];
export function settingsFor(installedKeys: string[]): { enabledPlugins: Record<string, boolean>; env: { FORGE_WORKFLOW: 'ask' } };
export function projectSettingsFor(withSuperpowers: boolean, installedKeys: string[]): { enabledPlugins: Record<string, boolean> };
export function summarize(results: EvalResult[], configs?: EvalConfig[]): Summary[];
export function passes(summary: Summary[]): boolean;
export function table(results: EvalResult[], summary: Summary[]): string;
