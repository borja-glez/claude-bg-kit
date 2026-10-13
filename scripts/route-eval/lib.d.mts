export interface EvalPrompt { id: string; size: 'trivial' | 'medium' | 'large'; lang: 'es' | 'en'; text: string }
export interface EvalResult { id: string; size: EvalPrompt['size']; lang: EvalPrompt['lang']; config: string; firstSkill: string | null; plugins: string[] | null; error: string | null }
export interface Summary { config: string; routed: number; routable: number; rate: number; trivialFired: number; trivial: number }
export function readStream(text: string): { firstSkill: string | null; plugins: string[] | null; stop: string | null };
export function claudeArgs(prompt: string, o: { settings: string; pluginDirs: string[] }): string[];
export function settingsFor(withSuperpowers: boolean, installedKeys: string[]): { enabledPlugins: Record<string, boolean> };
export function summarize(results: EvalResult[]): Summary[];
export function passes(summary: Summary[]): boolean;
export function table(results: EvalResult[], summary: Summary[]): string;
