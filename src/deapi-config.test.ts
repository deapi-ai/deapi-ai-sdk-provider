import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEAPI_API_KEY_ENV_VAR,
  DEAPI_DEFAULT_BASE_URL,
  createLazyHeaders,
  normalizeBaseURL,
  type DeAPIProviderSettings,
} from './deapi-config';

describe('deapi-config: constants', () => {
  it('exposes the OpenAI-compatible default base URL (not the native /api/v2 surface)', () => {
    expect(DEAPI_DEFAULT_BASE_URL).toBe('https://oai.deapi.ai/v1');
    expect(DEAPI_DEFAULT_BASE_URL).not.toContain('/api/v2');
  });

  it('exposes the env var name', () => {
    expect(DEAPI_API_KEY_ENV_VAR).toBe('DEAPI_API_KEY');
  });
});

describe('normalizeBaseURL', () => {
  it('defaults to DEAPI_DEFAULT_BASE_URL when undefined', () => {
    expect(normalizeBaseURL(undefined)).toBe(DEAPI_DEFAULT_BASE_URL);
  });

  it('strips a single trailing slash', () => {
    expect(normalizeBaseURL('https://oai.deapi.ai/v1/')).toBe(
      'https://oai.deapi.ai/v1',
    );
  });

  it('leaves a URL without a trailing slash unchanged', () => {
    expect(normalizeBaseURL('https://oai.deapi.ai/v1')).toBe(
      'https://oai.deapi.ai/v1',
    );
  });

  it('yields the same endpoint with and without a trailing slash', () => {
    expect(normalizeBaseURL('https://example.com/v1/')).toBe(
      normalizeBaseURL('https://example.com/v1'),
    );
  });

  it('accepts a custom base URL', () => {
    expect(normalizeBaseURL('https://proxy.internal/v1')).toBe(
      'https://proxy.internal/v1',
    );
  });

  it('guards against the native /api/v2 surface by throwing', () => {
    expect(() => normalizeBaseURL('https://api.deapi.ai/api/v2')).toThrow(
      /api\/v2/,
    );
  });

  it('guards against /api/v2 even with a trailing slash', () => {
    expect(() => normalizeBaseURL('https://api.deapi.ai/api/v2/')).toThrow(
      /not OpenAI-compatible/,
    );
  });

  it('error message points at the correct default URL', () => {
    expect(() => normalizeBaseURL('https://x/api/v2')).toThrow(
      DEAPI_DEFAULT_BASE_URL,
    );
  });

  it('falls back to the default for an empty string (no relative URL)', () => {
    expect(normalizeBaseURL('')).toBe(DEAPI_DEFAULT_BASE_URL);
  });

  it('falls back to the default for a whitespace-only string', () => {
    expect(normalizeBaseURL('   ')).toBe(DEAPI_DEFAULT_BASE_URL);
  });

  it('catches an uppercase /API/V2 path segment', () => {
    expect(() => normalizeBaseURL('https://api.deapi.ai/API/V2')).toThrow(
      /api\/v2/i,
    );
  });

  it('does NOT false-positive on /api/v20 (segment boundary)', () => {
    expect(normalizeBaseURL('https://api.deapi.ai/api/v20')).toBe(
      'https://api.deapi.ai/api/v20',
    );
  });

  it('catches /api/v2 in a non-URL relative path (fallback branch)', () => {
    expect(() => normalizeBaseURL('/api/v2')).toThrow(/api\/v2/);
  });

  it('does NOT false-positive on /api/v2 appearing only in a query string', () => {
    expect(normalizeBaseURL('https://oai.deapi.ai/v1?ref=/api/v2')).toBe(
      'https://oai.deapi.ai/v1?ref=/api/v2',
    );
  });
});

describe('createLazyHeaders (lazy auth core)', () => {
  const ORIGINAL = process.env[DEAPI_API_KEY_ENV_VAR];

  beforeEach(() => {
    delete process.env[DEAPI_API_KEY_ENV_VAR];
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[DEAPI_API_KEY_ENV_VAR];
    } else {
      process.env[DEAPI_API_KEY_ENV_VAR] = ORIGINAL;
    }
    vi.unstubAllEnvs();
  });

  it('does NOT resolve the API key when constructed (no throw without env var)', () => {
    const settings: DeAPIProviderSettings = {};
    expect(() => createLazyHeaders(settings)).not.toThrow();
  });

  it('throws only when the resolver is CALLED and no key is available', () => {
    const resolve = createLazyHeaders({});
    expect(() => resolve()).toThrow(/API key is missing/);
  });

  it('resolves Authorization from an explicit apiKey', () => {
    const resolve = createLazyHeaders({ apiKey: 'dpn-sk-explicit' });
    expect(resolve()).toMatchObject({
      Authorization: 'Bearer dpn-sk-explicit',
    });
  });

  it('resolves Authorization from the env var when no apiKey is given', () => {
    process.env[DEAPI_API_KEY_ENV_VAR] = 'dpn-sk-fromenv';
    const resolve = createLazyHeaders({});
    expect(resolve()).toMatchObject({ Authorization: 'Bearer dpn-sk-fromenv' });
  });

  it('explicit apiKey overrides the env var', () => {
    process.env[DEAPI_API_KEY_ENV_VAR] = 'dpn-sk-fromenv';
    const resolve = createLazyHeaders({ apiKey: 'dpn-sk-explicit' });
    expect(resolve()).toMatchObject({
      Authorization: 'Bearer dpn-sk-explicit',
    });
  });

  it('merges user-supplied static headers with Authorization', () => {
    const resolve = createLazyHeaders({
      apiKey: 'dpn-sk-x',
      headers: { 'X-Custom': 'abc' },
    });
    const headers = resolve();
    expect(headers.Authorization).toBe('Bearer dpn-sk-x');
    expect(headers['X-Custom']).toBe('abc');
  });

  it('resolves the key on EACH call (true per-request resolution)', () => {
    process.env[DEAPI_API_KEY_ENV_VAR] = 'dpn-sk-1';
    const resolve = createLazyHeaders({});
    expect(resolve().Authorization).toBe('Bearer dpn-sk-1');
    process.env[DEAPI_API_KEY_ENV_VAR] = 'dpn-sk-2';
    expect(resolve().Authorization).toBe('Bearer dpn-sk-2');
  });
});
