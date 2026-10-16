export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }
export type Split = Price;
export type Group = 'main' | 'impl' | 'review' | 'verify' | 'plan' | 'other';
export interface ReportLoop {
  kind: string; model: string | null; effort: string | null; steps: number; input: number; output: number;
  cacheRead: number; cacheWrite: number; costUsd: number; unpriced: number;
}
export interface ReportFile { project: string; file: string; session: string; label: string; costUsd: number | null; loops: Record<string, ReportLoop> }
export interface AgentRow {
  kind: string; model: string | null; effort: string | null; runs: number; steps: number; avgSteps: number;
  cost: number; avgCost: number; unpriced: number; split: Split; priced: number; diff: number; share: Split | null;
}
export interface SessionRow { project: string; label: string; session: string; sum: number; recorded: number | null; loops: number; groups: Partial<Record<Group, number>> }
export const PRICES: [prefix: string, price: [number, number, number, number]][];
export function priceOf(model: string | null | undefined): Price | null;
export function groupOf(loopId: string, kind: string): Group;
export function splitCost(l: { model: string | null; input: number; output: number; cacheRead: number; cacheWrite: number }): Split | null;
export function readUsageDir(dir: string): ReportFile[];
export function byAgent(files: ReportFile[]): AgentRow[];
export function bySession(files: ReportFile[]): SessionRow[];
export interface StagePath { briefs: number; briefMin: { p50: number; p80: number } | null; stages: Record<'implement' | 'validate' | 'review' | 'verdict' | 'fix', number>; validatorShare: number; cacheHits: number }
export const FORGE_CLI: string;
export function checkoutOf(dir: string): string | null;
export function statsOf(checkout: string, cli?: string): { stats: { byPath: Record<string, StagePath> }; error?: undefined } | { error: string; stats?: undefined };
export function stageLines(dirs: string[], cli?: string): string[];
export function report(files: ReportFile[], dirs: string[], opts?: { forgeCli?: string }): string;
