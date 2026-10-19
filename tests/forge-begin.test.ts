import { describe, it, expect } from 'vitest';
import { FOREIGN_SHOWN, foreignPaths, foreignSay, isForgeOwn } from '../src/forge/begin.js';

describe('forge begin: whose changes they are (J-12)', () => {
  it("forge's own files are everything under .forge/ but config.yaml and verify/*.md (Review Focus 3)", () => {
    for (const p of ['.forge/.gitignore', '.forge/work/cart/task.txt', '.forge/ledger.jsonl', '.forge\\work\\x\\brief-1.md', '.forge/verify/sub/x.md']) {
      expect(isForgeOwn(p), p).toBe(true);
    }
    for (const p of ['.forge/config.yaml', '.forge/verify/web.md', 'a.txt', 'my notes.txt', 'src/.forge/x', '.forgery/x']) expect(isForgeOwn(p), p).toBe(false);
  });
  it('foreign keeps the order, each path once; the question names 10 at most and counts the rest (Review Focus 3)', () => {
    expect(foreignPaths(['b.txt', '.forge/x', 'a b.txt', 'b.txt', '.forge/config.yaml'])).toEqual(['b.txt', 'a b.txt', '.forge/config.yaml']);
    expect(FOREIGN_SHOWN).toBe(10);
    const many = Array.from({ length: 13 }, (_, i) => `f${i}.ts`);
    const es = foreignSay(many, 'es');
    expect(es).toContain('f9.ts');
    expect(es).not.toContain('f10.ts');
    expect(es).toContain('y 3 más');
    expect(foreignSay(['a.txt'], 'en')).toContain('(a.txt)');
  });
});
