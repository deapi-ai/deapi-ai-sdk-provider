import {
  combineHeaders,
  loadApiKey,
  withoutTrailingSlash,
  type FetchFunction,
} from '@ai-sdk/provider-utils';

/**
 * Default OpenAI-compatible base URL for deAPI.
 *
 * IMPORTANT: this is the synchronous OpenAI-compatible surface. The native
 * deAPI API ('https://api.deapi.ai/api/v2') is async/job-based and MUST NOT be
 * used as a baseURL for this provider.
 */
export const DEAPI_DEFAULT_BASE_URL = 'https://oai.deapi.ai/v1';

/**
 * Environment variable holding the deAPI API key (prefix: `dpn-sk-`).
 */
export const DEAPI_API_KEY_ENV_VAR = 'DEAPI_API_KEY';

/**
 * Known image model slug. The id type stays open (`string & {}`) so we never
 * hardcode a runtime model list — new models work without a code change while
 * still offering editor autocomplete for the common one.
 */
export type DeAPIImageModelId = 'Flux1schnell' | (string & {});

/**
 * Known embedding model slug. Open-ended for the same reason as above.
 */
export type DeAPIEmbeddingModelId = 'Bge_M3_FP16' | (string & {});

/**
 * User-facing settings for {@link createDeAPI}.
 */
export interface DeAPIProviderSettings {
  /**
   * deAPI API key. If omitted, it is resolved lazily (per request) from the
   * `DEAPI_API_KEY` environment variable. Never resolved at construction time.
   */
  apiKey?: string;

  /**
   * Base URL for the OpenAI-compatible deAPI surface.
   * Defaults to {@link DEAPI_DEFAULT_BASE_URL}. A trailing slash is stripped.
   */
  baseURL?: string;

  /**
   * Extra headers merged into every request. Authorization is added
   * automatically from the resolved API key.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation (e.g. for testing or proxies).
   */
  fetch?: FetchFunction;
}

/**
 * True if the URL points at the native async `/api/v2` surface.
 *
 * Matches an `/api/v2` PATH SEGMENT (case-insensitive), so `/api/v20` and an
 * `/api/v2` substring inside a query string are not false positives. Falls back
 * to a path-segment regex on the raw string when the value is not a parseable
 * absolute URL (e.g. relative paths).
 */
function isNativeApiV2Surface(url: string): boolean {
  const segmentPattern = /\/api\/v2(?:\/|$)/i;
  try {
    return segmentPattern.test(new URL(url).pathname);
  } catch {
    return segmentPattern.test(url);
  }
}

/**
 * Normalizes the configured base URL.
 *
 * - Treats an empty/whitespace-only value as unset (falls back to the default)
 *   so requests never go to a relative `/embeddings` URL.
 * - Strips a trailing slash via `withoutTrailingSlash`.
 * - Guards against the native async surface: if the URL's path contains an
 *   `/api/v2` segment we THROW a clear configuration error rather than warn.
 *   Rationale: pointing this synchronous OpenAI-compatible provider at the
 *   async/job-based native endpoint produces confusing runtime failures on
 *   every request; failing fast at construction with an actionable message is
 *   the cleaner, KISS choice. The match is a path-segment boundary (case
 *   insensitive) so `/api/v20` and a `/api/v2` query string are not false
 *   positives, while `/API/V2` is still caught.
 */
export function normalizeBaseURL(baseURL?: string): string {
  const normalized =
    withoutTrailingSlash(baseURL?.trim() || undefined) ?? DEAPI_DEFAULT_BASE_URL;

  if (isNativeApiV2Surface(normalized)) {
    throw new Error(
      `Invalid deAPI baseURL "${normalized}": '/api/v2' is the native ` +
        `async/job-based surface and is not OpenAI-compatible. Use the ` +
        `OpenAI-compatible base URL instead (default: "${DEAPI_DEFAULT_BASE_URL}").`,
    );
  }

  // Security: the API key travels as a Bearer token on every request. Reject a
  // baseURL that could leak it — a relative/garbage URL, embedded credentials,
  // or a cleartext (http) host other than loopback.
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(
      `Invalid deAPI baseURL "${normalized}": must be an absolute URL ` +
        `(e.g. "${DEAPI_DEFAULT_BASE_URL}").`,
    );
  }
  if (url.username || url.password) {
    throw new Error(
      `Invalid deAPI baseURL: must not contain embedded credentials.`,
    );
  }
  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
    throw new Error(
      `Invalid deAPI baseURL "${normalized}": must use https (http is allowed ` +
        `only for localhost). The API key is sent as a Bearer token and must ` +
        `not travel over cleartext.`,
    );
  }

  return normalized;
}

/** True for loopback hosts where cleartext http is acceptable. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

/**
 * Builds a LAZY header resolver.
 *
 * The returned function does nothing until it is CALLED (per request). Only
 * then does it resolve the API key via `loadApiKey` (which throws if missing)
 * and merge `Authorization: Bearer <key>` with any user-supplied static
 * headers using `combineHeaders`.
 *
 * This is the core of the lazy-auth contract: importing the package and calling
 * `createDeAPI()` without `DEAPI_API_KEY` must NOT throw. The error only
 * surfaces when a model is actually invoked.
 */
export function createLazyHeaders(
  settings: DeAPIProviderSettings,
): () => Record<string, string | undefined> {
  return () => {
    const apiKey = loadApiKey({
      apiKey: settings.apiKey,
      environmentVariableName: DEAPI_API_KEY_ENV_VAR,
      description: 'deAPI API key',
    });

    return combineHeaders(
      { Authorization: `Bearer ${apiKey}` },
      settings.headers,
    );
  };
}
