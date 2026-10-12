import { describe, it, expect } from 'vitest';
import { globsOverlap, overlappingZones, staticPrefix } from '../src/lib/zones.js';

describe('staticPrefix', () => {
  it('keeps the path up to the first wildcard segment', () => {
    expect(staticPrefix('src/payments/**')).toBe('src/payments');
    expect(staticPrefix('./src\\db\\*.ts')).toBe('src/db');
    expect(staticPrefix('db/migrations/*refund*')).toBe('db/migrations');
    expect(staticPrefix('**/*.css')).toBe('');
    expect(staticPrefix('README.md')).toBe('README.md');
  });
});

describe('globsOverlap', () => {
  it('nested globs overlap', () => {
    expect(globsOverlap('src/**', 'src/a/*.ts')).toBe(true);
    expect(globsOverlap('src/a/*.ts', 'src/**')).toBe(true);
  });
  it('sibling directories sharing a text prefix do not overlap', () => {
    expect(globsOverlap('src/pay/**', 'src/payments/**')).toBe(false);
    expect(globsOverlap('web/cart/**', 'web/checkout/**')).toBe(false);
  });
  it('literal paths', () => {
    expect(globsOverlap('src/api/routes.ts', 'src/api/routes.ts')).toBe(true);
    expect(globsOverlap('src/api/routes.ts', 'src/api/other.ts')).toBe(false);
    expect(globsOverlap('src/api/routes.ts', 'src/api/**')).toBe(true);
    expect(globsOverlap('src/apix/routes.ts', 'src/api/**')).toBe(false);
  });
  it('a root-level glob overlaps everything (conservative)', () => {
    expect(globsOverlap('**/*.css', 'web/cart/x.ts')).toBe(true);
  });
});

describe('overlappingZones', () => {
  it('returns every overlapping pair', () => {
    expect(overlappingZones(['src/payments/**', 'docs/x.md'], ['src/payments/stripe.ts', 'web/**']))
      .toEqual([['src/payments/**', 'src/payments/stripe.ts']]);
    expect(overlappingZones([], ['src/**'])).toEqual([]);
  });
});

describe('literal directory and file zones (fix round)', () => {
  it('a literal directory overlaps a glob inside it', () => {
    expect(globsOverlap('src', 'src/db/**')).toBe(true);
  });
  it('a literal directory overlaps a literal file inside it', () => {
    expect(globsOverlap('src/payments', 'src/payments/stripe.ts')).toBe(true);
    expect(globsOverlap('src/payments/stripe.ts', 'src/payments')).toBe(true);
  });
  it('sibling literal prefix does not overlap a glob', () => {
    expect(globsOverlap('src/apix', 'src/api/**')).toBe(false);
  });
});
