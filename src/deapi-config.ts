import {
  combineHeaders,
  loadApiKey,
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
   * automatically from the resolved API key and MUST NOT be set here.
   */
  headers?: Record<string, string | undefined>;

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
 * - Strips ALL trailing slashes from the path so `https://h/v1//` and
 *   `https://h/v1` produce the same endpoint.
 * - Guards against the native async surface: if the URL's path contains an
 *   `/api/v2` segment we THROW a clear configuration error rather than warn.
 *   Rationale: pointing this synchronous OpenAI-compatible provider at the
 *   async/job-based native endpoint produces confusing runtime failures on
 *   every request; failing fast at construction with an actionable message is
 *   the cleaner, KISS choice. The match is a path-segment boundary (case
 *   insensitive) so `/api/v20` and a `/api/v2` query string are not false
 *   positives, while `/API/V2` is still caught.
 * - Rejects a baseURL carrying a query string or hash fragment: appending a
 *   model path (`/embeddings`) to such a URL would silently corrupt the request
 *   target. Per-request query parameters are a future `queryParams` option.
 */
export function normalizeBaseURL(baseURL?: string): string {
  const trimmed = baseURL?.trim() || undefined;
  const candidate = trimmed ?? DEAPI_DEFAULT_BASE_URL;

  if (isNativeApiV2Surface(candidate)) {
    throw new Error(
      `Invalid deAPI baseURL "${candidate}": '/api/v2' is the native ` +
        `async/job-based surface and is not OpenAI-compatible. Use the ` +
        `OpenAI-compatible base URL instead (default: "${DEAPI_DEFAULT_BASE_URL}").`,
    );
  }

  // Security: the API key travels as a Bearer token on every request. Reject a
  // baseURL that could leak it — a relative/garbage URL, embedded credentials,
  // or a cleartext (http) host other than loopback.
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      `Invalid deAPI baseURL "${candidate}": must be an absolute URL ` +
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
      `Invalid deAPI baseURL "${candidate}": must use https (http is allowed ` +
        `only for localhost). The API key is sent as a Bearer token and must ` +
        `not travel over cleartext.`,
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      `Invalid deAPI baseURL "${candidate}": must not contain a query string ` +
        `or hash fragment (a model path is appended to it). Per-request query ` +
        `parameters will be a future "queryParams" option.`,
    );
  }

  // Strip ALL trailing slashes from the path so `/v1//` collapses to `/v1`.
  // Rebuild from origin + pathname to avoid re-introducing query/hash (already
  // rejected above).
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
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
    // Security: never let a caller-supplied header override the managed Bearer
    // token. combineHeaders spreads later args last, so a user-set
    // `Authorization` would otherwise win. Reject it (case-insensitive) with an
    // actionable message before building any headers.
    if (settings.headers) {
      for (const key of Object.keys(settings.headers)) {
        if (key.toLowerCase() === 'authorization') {
          throw new Error(
            `deAPI: do not set an 'Authorization' header in settings.headers; ` +
              `the API key is managed by the provider via apiKey/DEAPI_API_KEY.`,
          );
        }
      }
    }

    const apiKey = loadApiKey({
      apiKey: settings.apiKey,
      environmentVariableName: DEAPI_API_KEY_ENV_VAR,
      description: 'deAPI API key',
    });

    // Authorization is applied LAST so the provider key always wins, even if a
    // future change loosened the guard above. combineHeaders spreads later args
    // last.
    return combineHeaders(settings.headers, {
      Authorization: `Bearer ${apiKey}`,
    });
  };
}
