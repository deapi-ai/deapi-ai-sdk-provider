import {
  type EmbeddingModelV3,
  type ImageModelV3,
  type ImageModelV3CallOptions,
  type LanguageModelV3,
  NoSuchModelError,
  type ProviderV3,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import {
  type FetchFunction,
  withUserAgentSuffix,
} from '@ai-sdk/provider-utils';
import {
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel,
  type ProviderErrorStructure,
} from '@ai-sdk/openai-compatible';
import {
  createLazyHeaders,
  type DeAPIEmbeddingModelId,
  type DeAPIImageModelId,
  type DeAPIProviderSettings,
  normalizeBaseURL,
} from './deapi-config';
import {
  type DeAPIErrorData,
  deapiErrorDataSchema,
  deapiErrorToMessage,
} from './deapi-error';

/**
 * deAPI provider.
 *
 * A {@link ProviderV3}-compatible object. For the 0.1.0 release the surface is
 * IMAGE + EMBEDDINGS only:
 *
 * - {@link DeAPIProvider.imageModel} / {@link DeAPIProvider.image}
 * - {@link DeAPIProvider.embeddingModel} / {@link DeAPIProvider.embedding}
 *
 * {@link DeAPIProvider.languageModel} is required by the `ProviderV3` interface
 * but throws `NoSuchModelError` — chat/completion support ships later.
 * Speech/transcription are intentionally omitted (planned for 0.2.0).
 */
export interface DeAPIProvider extends ProviderV3 {
  readonly specificationVersion: 'v3';

  /**
   * Not supported in 0.1.0. Always throws `NoSuchModelError`.
   */
  languageModel(modelId: string): LanguageModelV3;

  /**
   * Returns an embedding model backed by the OpenAI-compatible surface
   * (`POST /embeddings`).
   */
  embeddingModel(modelId: DeAPIEmbeddingModelId): EmbeddingModelV3;

  /**
   * Returns an image model backed by the OpenAI-compatible surface
   * (`POST /images/generations`).
   */
  imageModel(modelId: DeAPIImageModelId): ImageModelV3;

  /** Alias for {@link DeAPIProvider.embeddingModel}. */
  embedding(modelId: DeAPIEmbeddingModelId): EmbeddingModelV3;

  /** Alias for {@link DeAPIProvider.imageModel}. */
  image(modelId: DeAPIImageModelId): ImageModelV3;
}

/**
 * deAPI error structure shared by every model.
 *
 * P0.2 contract: BOTH the OpenAI envelope `{ error: { message, ... } }` and the
 * native envelope `{ data, message, ... }` must produce a typed `APICallError`
 * carrying the real message. By injecting this `errorStructure` into the
 * directly-constructed `@ai-sdk/openai-compatible` model classes, the native
 * message surfaces end-to-end through `embed()` / `generateImage()` — not only
 * the OpenAI shape (which is all the package's default handler understands).
 */
const deapiErrorStructure: ProviderErrorStructure<DeAPIErrorData> = {
  errorSchema: deapiErrorDataSchema,
  errorToMessage: deapiErrorToMessage,
};

/**
 * Wraps an {@link ImageModelV3} to GUARD against image editing.
 *
 * `@ai-sdk/openai-compatible` routes a `doGenerate` call to `POST /images/edits`
 * whenever `files` or a `mask` is supplied. deAPI's OpenAI surface returns 400
 * for that path (inpainting/editing is unsupported and untested in 0.1.0), so we
 * fail fast with a typed `UnsupportedFunctionalityError` instead of leaking a
 * confusing upstream 400. All other members are forwarded 1:1 so the wrapper
 * remains a thin, fully-compliant `ImageModelV3`.
 */
function guardImageEditing(model: ImageModelV3): ImageModelV3 {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    maxImagesPerCall: model.maxImagesPerCall,
    doGenerate(options: ImageModelV3CallOptions) {
      if (options.files?.length || options.mask) {
        throw new UnsupportedFunctionalityError({
          functionality: 'image editing (files/mask)',
        });
      }
      return model.doGenerate(options);
    },
  };
}

/**
 * Builds a fetch wrapper that injects lazy auth headers at REQUEST time.
 *
 * AUTH MECHANISM (lazy auth, P0.6):
 * `@ai-sdk/openai-compatible` resolves its `apiKey` / static `headers` into a
 * fixed object at construction time (verified in
 * node_modules/@ai-sdk/openai-compatible/dist/index.js). Passing either would
 * read `DEAPI_API_KEY` when `createDeAPI()` runs, violating the contract that
 * import + `createDeAPI()` must not throw without a key.
 *
 * Instead the model `headers` resolver returns NO auth, and this custom `fetch`
 * runs the lazy header resolver on every call (calling `loadApiKey`, which
 * throws only here, per request) and merges `Authorization: Bearer <key>` plus
 * user-supplied static headers into the outgoing request. Result: a single
 * provider instance, true per-request auth, user headers preserved.
 */
function createAuthInjectingFetch(
  resolveHeaders: () => Record<string, string | undefined>,
  baseFetch: FetchFunction | undefined,
): FetchFunction {
  const fetchImpl = baseFetch ?? globalThis.fetch;

  return (input, init) => {
    // Headers already on the request (set by the SDK), then lazily-resolved
    // auth + user headers layered on top. withUserAgentSuffix lowercases keys
    // and drops undefined values.
    const existing = Object.fromEntries(new Headers(init?.headers));
    const merged = withUserAgentSuffix({ ...existing, ...resolveHeaders() });

    const headers = new Headers();
    for (const [key, value] of Object.entries(merged)) {
      headers.set(key, value);
    }

    // Security: `redirect: 'manual'` so the Bearer token is never auto-replayed
    // to another origin via a 3xx from the configured host. A redirect surfaces
    // as a non-2xx response instead of silently following.
    return fetchImpl(input, { ...init, headers, redirect: 'manual' });
  };
}

/**
 * Creates a deAPI provider instance.
 *
 * Side-effect-free: this does NOT read `DEAPI_API_KEY`. The key is resolved
 * lazily per request (see {@link createAuthInjectingFetch}), so calling this
 * without the env var set does not throw — an error only surfaces when a model
 * is actually invoked.
 */
export function createDeAPI(
  settings: DeAPIProviderSettings = {},
): DeAPIProvider {
  const baseURL = normalizeBaseURL(settings.baseURL);
  const resolveHeaders = createLazyHeaders(settings);
  const fetch = createAuthInjectingFetch(resolveHeaders, settings.fetch);

  // Joins the normalized baseURL with a model path (e.g. `/embeddings`). The
  // openai-compatible model classes call `config.url({ path })` per request.
  const url = ({ path }: { modelId: string; path: string }): string =>
    `${baseURL}${path}`;

  // The per-request headers resolver returns NO auth: auth is injected by the
  // custom fetch above to keep it truly lazy.
  const headers = (): Record<string, string | undefined> => ({});

  const embeddingModel = (modelId: DeAPIEmbeddingModelId): EmbeddingModelV3 =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: 'deapi.embedding',
      url,
      headers,
      fetch,
      errorStructure: deapiErrorStructure,
    });

  const imageModel = (modelId: DeAPIImageModelId): ImageModelV3 =>
    guardImageEditing(
      new OpenAICompatibleImageModel(modelId, {
        provider: 'deapi.image',
        url,
        headers,
        fetch,
        errorStructure: deapiErrorStructure,
      }),
    );

  const languageModel = (modelId: string): LanguageModelV3 => {
    throw new NoSuchModelError({ modelId, modelType: 'languageModel' });
  };

  return {
    specificationVersion: 'v3',
    languageModel,
    embeddingModel,
    imageModel,
    embedding: embeddingModel,
    image: imageModel,
  };
}

/**
 * Default deAPI provider instance.
 *
 * Safe to construct at module load ONLY because auth is lazy: no API key is
 * read here.
 */
export const deapi = createDeAPI();
