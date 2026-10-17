export interface Size { cols: number; rows: number }
export type Mode = 'fullscreen' | 'main';
export const FIXTURE_IDS: string[];
export const MODES: Mode[];
export const DEFAULT_SIZES: Size[];
export function parseArgs(argv: string[], today?: string): { out: string; sizes: Size[]; modes: Mode[] };
export function splitIds(text: string, ids?: string[]): string[];
export function checkCapture(text: string, o: Size & { mode: Mode; kind: 'band' | 'lens' | 'live'; ids?: string[] }): string[];
export function fillTemplate(text: string, vars: { session: string; now: number }): string;
export function dotted(rel: string): string;
export function bandFolds(text: string): boolean;
export function stopTriggered(text: string): boolean;
export function checkPhoto(text: string, o: { cols: number; wrapped?: number[] }): string[];
export function findText(text: string, needle: string): { row: number; col: number } | null;
export function changedFiles(before: Record<string, number>, after: Record<string, number>): string[];
