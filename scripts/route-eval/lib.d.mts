export type Size = 'trivial' | 'small' | 'medium' | 'large' | 'question' | 'agent';
export interface EvalPrompt { id: string; size: Size; lang: 'es' | 'en'; expected: 'route' | 'none' | 'either'; text: string }
export interface EvalConfig { name: string; superpowers: boolean; hint: boolean }
export interface EvalResult {
  id: string; size: Size; lang: EvalPrompt['lang']; expected: EvalPrompt['expected']; config: string;
  firstSkill: string | null; plugins: string[] | null; cost: number | null; error: string | null;
}
export interface Summary {
  config: string; routed: number; routable: number; rate: number; falseNegatives: number; falsePositives: number; others: number;
  either: number; eitherRouted: number; cost: number | null;
}
export const CONFIGS: EvalConfig[];
export const DEMO_SHOP: Record<string, string>;
export function readStream(text: string): { firstSkill: string | null; plugins: string[] | null; stop: string | null; cost: number | null };
export function claudeArgs(prompt: string, o: { settings: string; pluginDirs: string[] }): string[];
export function settingsFor(installedKeys: string[]): { enabledPlugins: Record<string, boolean> };
export function projectSettingsFor(withSuperpowers: boolean, installedKeys: string[]): { enabledPlugins: Record<string, boolean> };
export function summarize(results: EvalResult[]): Summary[];
export function passes(summary: Summary[]): boolean;
export function table(results: EvalResult[], summary: Summary[]): string;
