import { describe, expect, it } from 'vitest';
import { toIso6391 } from './whisper-language';

describe('toIso6391', () => {
  it('returns undefined for null / undefined', () => {
    expect(toIso6391(undefined)).toBeUndefined();
    expect(toIso6391(null)).toBeUndefined();
  });

  it('keeps a two-letter code and drops a region subtag', () => {
    expect(toIso6391('en')).toBe('en');
    expect(toIso6391('EN-us')).toBe('en');
    expect(toIso6391('pt_BR')).toBe('pt');
  });

  it('maps Whisper language names', () => {
    expect(toIso6391('english')).toBe('en');
    expect(toIso6391(' Polish ')).toBe('pl');
  });

  it('returns undefined for anything else', () => {
    expect(toIso6391('klingon')).toBeUndefined();
    expect(toIso6391('toString')).toBeUndefined();
    expect(toIso6391('')).toBeUndefined();
  });
});
