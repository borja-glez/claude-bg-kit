export const ENGINE_TYPES: string;
export const SKIP_MOD_TYPES: string;
export const PLUGINS: readonly string[];
export interface CiStep { id: string; cmds: string[][]; skip?: string; fresh?: string[]; probe?: boolean; claude?: boolean }
export function isCi(env: Readonly<Record<string, string | undefined>>): boolean;
export function generatedPaths(root: string): string[];
export function ciSteps(root: string, env: Readonly<Record<string, string | undefined>>): CiStep[];
export function describeStep(s: CiStep, i: number, n: number): string;
export function stalePaths(root: string, fresh: string[]): string[];
