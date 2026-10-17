import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../src/lib/sha256.js';

describe('sha256Hex (FIPS 180-4)', () => {
  it('matches the standard vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('hashes a multi-block non-ASCII UTF-8 message (700 bytes)', () => {
    const m = 'Ñandú «cañón» 日本語 🚀 '.repeat(20);
    expect(new TextEncoder().encode(m).length).toBe(700);
    expect(sha256Hex(m)).toBe('237eaebd583e9df288d3d5cb1f6e5bcde2b417836fb17c9d68a7a5dd5a610bf5');
  });
  it('agrees with node:crypto around every padding boundary', () => {
    for (let n = 0; n <= 200; n++) {
      const m = 'x'.repeat(n);
      expect(sha256Hex(m)).toBe(createHash('sha256').update(m).digest('hex'));
    }
  });
});
