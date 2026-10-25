export type Size = 'trivial' | 'small' | 'medium' | 'large' | 'question' | 'agent';
export interface EvalPrompt { id: string; size: Size; lang: 'es' | 'en'; expected: 'route' | 'none' | 'either'; competing?: 'direct' | 'brainstorming'; text: string }
export interface EvalConfig { name: string; superpowers: boolean; hint: boolean }
export interface EvalResult {
  id: string; size: Size; lang: EvalPrompt['lang']; expected: EvalPrompt['expected']; competing?: 'direct' | 'brainstorming' | null; config: string;
  firstSkill: string | null; plugins: string[] | null; cost: number | null; error: string | null;
}
export interface Summary {
  config: string; routed: number; routable: number; rate: number; falseNegatives: number; falsePositives: number; others: number;
  either: number; eitherRouted: number; competing: number; competingRouted: number; plugins: 'ok' | 'contradicts' | null; cost: number | null;
}
export function parseArgs(argv: string[]): { dry: boolean; keep: boolean; only: string | null; config: string | null } | { error: string };
export const CONFIGS: EvalConfig[];
export const DEMO_SHOP: Record<string, string>;
export function demoRepo(repo: string): { reset: () => void };
export function sessionEnv(config: EvalConfig, env: Record<string, string | undefined>): Record<string, string | undefined>;
export function readStream(text: string): { firstSkill: string | null; plugins: string[] | null; stop: string | null; cost: number | null };
export function claudeArgs(prompt: string, o: { settings: string; pluginDirs: string[] }): string[];
export function settingsFor(installedKeys: string[]): { enabledPlugins: Record<string, boolean> };
export function projectSettingsFor(withSuperpowers: boolean, installedKeys: string[]): { enabledPlugins: Record<string, boolean> };
export function summarize(results: EvalResult[], configs?: EvalConfig[]): Summary[];
export function passes(summary: Summary[]): boolean;
export function table(results: EvalResult[], summary: Summary[]): string;
