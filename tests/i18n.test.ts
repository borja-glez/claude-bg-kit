import { describe, it, expect, vi } from 'vitest';
import { dictFor, dur } from '../src/page/i18n.js';

/** The key paths of a dictionary: functions and strings are leaves. */
const keys = (o: unknown, at = ''): string[] => (o && typeof o === 'object'
  ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v, at ? `${at}.${k}` : k))
  : [at]);

describe('the texts of the page (G-19, G-20, H-20)', () => {
  it('es and en have the same keys, recursively', () => {
    expect(keys(dictFor('es')).sort()).toEqual(keys(dictFor('en')).sort());
  });

  it('dur: minutes, hours with minutes, days with hours; the same in both languages', () => {
    expect(dur(45)).toBe('45 min');
    expect(dur(60)).toBe('1 h');
    expect(dur(125)).toBe('2 h 05 min');
    expect(dur(1440)).toBe('1 d');
    expect(dur(4560)).toBe('3 d 4 h');
    expect(dur(-5)).toBe('0 min');
    expect(dur(Number.NaN)).toBe('0 min');
    expect(dictFor('es').dur(125)).toBe(dictFor('en').dur(125));
  });

  it('plural and num come from Intl in the language of the page', () => {
    const select = vi.spyOn(Intl.PluralRules.prototype, 'select');
    const es = dictFor('es');
    expect(es.plural(1, { one: '# tarea', other: '# tareas' })).toBe('1 tarea');
    expect(es.plural(3, { one: '# tarea', other: '# tareas' })).toBe('3 tareas');
    expect(dictFor('en').plural(0, { one: '# task', other: '# tasks' })).toBe('0 tasks');
    expect(select).toHaveBeenCalled();
    select.mockRestore();
    expect(es.num(12345)).toBe('12.345');
    expect(dictFor('en').num(12345)).toBe('12,345');
  });

  it('plural and num at the edges: 0, 1, 2, a large number and non-finite ones; every # is the number (carry 1)', () => {
    const es = dictFor('es');
    const en = dictFor('en');
    const f = { one: '# tarea', other: '# tareas' };
    expect([0, 1, 2, 1_000_000].map(n => es.plural(n, f))).toEqual(['0 tareas', '1 tarea', '2 tareas', '1.000.000 tareas']);
    expect([0, 1, 2, 1_000_000].map(n => en.plural(n, { one: '# task', other: '# tasks' }))).toEqual(['0 tasks', '1 task', '2 tasks', '1,000,000 tasks']);
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(es.num(n)).toBe('0');
      expect(en.num(n)).toBe('0');
      expect(es.plural(n, f)).toBe('0 tareas');
    }
    expect(es.plural(2, { one: '# de #', other: '# de # tareas' })).toBe('2 de 2 tareas');
    expect(en.plural(1, { one: '# of #', other: '# of #' })).toBe('1 of 1');
  });

  it('keeps no texts the views no longer use (carry 6)', () => {
    for (const k of ['nowRunning', 'nothingRunning', 'noEvents', 'minPerTask', 'more']) {
      expect(dictFor('es'), k).not.toHaveProperty(k);
      expect(dictFor('en'), k).not.toHaveProperty(k);
    }
  });

  it('took, lasts and elapsed read durations', () => {
    const es = dictFor('es');
    expect(es.took(125, 30)).toBe('tardó 2 h 05 min · estimado 30 min');
    expect(es.took(20)).toBe('tardó 20 min');
    expect(es.lasts(75)).toBe('lleva 1 h 15 min');
    expect(dictFor('en').elapsed(15, 30)).toBe('15 min / est. 30 min');
  });

  it('the names: Agente, Hecha, Retirada del plan, Sin ejecutor and Libre', () => {
    const es = dictFor('es'), en = dictFor('en');
    expect([es.field.agent, en.field.agent]).toEqual(['Agente', 'Agent']);
    expect([es.status.done, es.legend.done, es.vfilter.done]).toEqual(['Hecha', 'Hecha', 'Hecha']);
    expect([es.status.orphaned, en.status.orphaned]).toEqual(['Retirada del plan', 'Removed from plan']);
    expect([es.run.orphan, en.run.orphan]).toEqual(['Sin ejecutor', 'No executor']);
    expect([es.status.free, es.tl.pending, en.tl.pending]).toEqual(['Libre', 'Libre', 'Free']);
    expect(es.segLabel({ done: 1, in_progress: 2, blocked: 0, free: 3 })).toBe('1 hechas · 2 en curso · 0 bloqueadas · 3 libres');
  });

  it('the dictionaries of path, stage, action and the run task statuses', () => {
    const es = dictFor('es');
    expect(es.path).toEqual({ trivial: 'trivial', small: 'pequeña', medium: 'media', large: 'grande' });
    expect([es.run.stage.triage, es.run.stage.done, es.run.stage.blocked, es.run.stage.stopped]).toEqual(['triaje', 'hecha', 'bloqueada', 'parada']);
    expect(es.action).toEqual({ accept: 'aceptada', fix: 'arreglo', redo: 'rehacer' });
    expect(es.run.taskStatus.stopped).toBe('parada');
    expect(es.run.stoppedHint).toBe('parada con /forge:stop');
    expect(dictFor('en').run.stoppedHint).toBe('stopped with /forge:stop');
  });
});
