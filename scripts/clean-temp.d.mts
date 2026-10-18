export const FAMILIES: readonly string[];
export interface CleanGroup { prefix: string; count: number; old: number }
export interface CleanScan { groups: CleanGroup[]; old: string[] }
export function prefixOf(name: string): string | null;
export function scan(root: string, nowMs: number, hours: number): CleanScan;
export function report(r: CleanScan, hours: number): string[];
export function removeOld(root: string, names: string[], warn?: (message: string) => void, rm?: (fullPath: string) => void): { deleted: number; errors: number };
