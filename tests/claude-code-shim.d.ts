// src/mod/files.ts is excluded from the root typecheck (it needs the claude-code types), but tests/mod-files.test.ts
// imports it: this minimal declaration (just what files.ts uses) lets the root tsc accept that import. session.id and store are the ones the band's role and dismissals use (wave 2b).
declare module 'claude-code' {
  export interface EngineInterface {
    session: { root(): Promise<string>; id(): Promise<string> };
    store: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
    clock: { now(): Promise<number> };
    fs: {
      read(path: string): Promise<string>;
      list(path: string): Promise<{ name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number }[]>;
      exists(path: string): Promise<boolean>;
      stat(path: string): Promise<{ mtimeMs: number }>;
    };
  }
}
