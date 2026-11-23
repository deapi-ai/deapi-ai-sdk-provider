import {
  type EmbeddingModelV4,
  type Experimental_VideoModelV4 as VideoModelV4,
  type ImageModelV4,
  type ImageModelV4CallOptions,
  type LanguageModelV4,
  type ProviderV4,
  type SpeechModelV4,
  type TranscriptionModelV4,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import {
  type FetchFunction,
  isSameOrigin,
  withUserAgentSuffix,
} from '@ai-sdk/provider-utils';
import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel,
  type ProviderErrorStructure,
} from '@ai-sdk/openai-compatible';
import {
  createLazyHeaders,
  type DeAPIEmbeddingModelId,
  type DeAPIImageModelId,
  type DeAPIProviderSettings,
  type DeAPISpeechModelId,
  type DeAPITranscriptionModelId,
  type DeAPIVideoModelId,
  normalizeBaseURL,
} from './deapi-config';
import {
  type DeAPIErrorData,
  deapiErrorDataSchema,
  deapiErrorToMessage,
  failedResponseHandler,
} from './deapi-error';
import {
  type DeAPIChatModelId,
  deapiChatMetadataExtractor,
  supportsJsonSchema,
  withJsonSchemaInstruction,
} from './chat/deapi-chat';
import {
  type DeAPIListModelsOptions,
  type DeAPIModelInfo,
  fetchDeAPIModels,
} from './models/deapi-models';
import { DeAPISpeechModel } from './speech/deapi-speech-model';
import { DeAPITranscriptionModel } from './transcription/deapi-transcription-model';
import { DeAPIVideoModel } from './video/deapi-video-model';

/**
 * Maximum number of strings per `POST /embeddings` request. Larger inputs are
 * rejected with `400 input_too_large`, so `embedMany` splits above this.
 */
const DEAPI_MAX_EMBEDDINGS_PER_CALL = 100;

/**
 * deAPI provider.
 *
 * A {@link ProviderV4}-compatible provider (AI SDK 7). As of 0.4.0 the surface
 * is CHAT + IMAGE (generation + editing) + VIDEO + EMBEDDINGS + SPEECH +
 * TRANSCRIPTION:
 *
 * - `deapi(modelId)` / {@link DeAPIProvider.languageModel} /
 *   {@link DeAPIProvider.chatModel}
 * - {@link DeAPIProvider.imageModel} / {@link DeAPIProvider.image}
 * - {@link DeAPIProvider.videoModel} / {@link DeAPIProvider.video}
 * - {@link DeAPIProvider.embeddingModel} / {@link DeAPIProvider.embedding}
 * - {@link DeAPIProvider.speechModel} / {@link DeAPIProvider.speech}
 * - {@link DeAPIProvider.transcriptionModel} / {@link DeAPIProvider.transcription}
 */
export interface DeAPIProvider extends ProviderV4 {
  readonly specificationVersion: 'v4';

  /** Shorthand for {@link DeAPIProvider.languageModel}. */
  (modelId: DeAPIChatModelId): LanguageModelV4;

  /**
   * Returns a chat model backed by the OpenAI-compatible surface
   * (`POST /chat/completions`). The amount deAPI charged for each call is
   * returned as `providerMetadata.deapi.cost` (USD), also when streaming.
   */
  languageModel(modelId: DeAPIChatModelId): LanguageModelV4;

  /** Alias for {@link DeAPIProvider.languageModel}. */
  chatModel(modelId: DeAPIChatModelId): LanguageModelV4;

  /**
   * Lists the models the key can call (`GET /models`): chat models by default,
   * with context window, output limit, input modalities, supported parameters
   * and per-token prices; `{ type: 'media' }` or `{ type: 'all' }` for the rest.
   * The list and the prices depend on the key.
   */
  listModels(options?: DeAPIListModelsOptions): Promise<DeAPIModelInfo[]>;

  /**
   * Returns an embedding model backed by the OpenAI-compatible surface
   * (`POST /embeddings`).
   */
  embeddingModel(modelId: DeAPIEmbeddingModelId): EmbeddingModelV4;

  /**
   * Returns an image model backed by the OpenAI-compatible surface
   * (`POST /images/generations`, and `POST /images/edits` when input images
   * are supplied).
   */
  imageModel(modelId: DeAPIImageModelId): ImageModelV4;

  /**
   * Returns a video model backed by the asynchronous OpenAI-compatible video
   * surface (`POST /videos`, `GET /videos/{id}`, `GET /videos/{id}/content`).
   * Use it with `experimental_generateVideo` from `ai`.
   */
  videoModel(modelId: DeAPIVideoModelId): VideoModelV4;

  /**
   * Returns a speech (text-to-speech) model backed by the OpenAI-shaped
   * surface (`POST /audio/speech`).
   */
  speechModel(modelId: DeAPISpeechModelId): SpeechModelV4;

  /**
   * Returns a transcription (speech-to-text) model backed by the OpenAI-shaped
   * surface (`POST /audio/transcriptions`).
   */
  transcriptionModel(modelId: DeAPITranscriptionModelId): TranscriptionModelV4;

  /** Alias for {@link DeAPIProvider.embeddingModel}. */
  embedding(modelId: DeAPIEmbeddingModelId): EmbeddingModelV4;

  /** Alias for {@link DeAPIProvider.imageModel}. */
  image(modelId: DeAPIImageModelId): ImageModelV4;

  /** Alias for {@link DeAPIProvider.videoModel}. */
  video(modelId: DeAPIVideoModelId): VideoModelV4;

  /** Alias for {@link DeAPIProvider.speechModel}. */
  speech(modelId: DeAPISpeechModelId): SpeechModelV4;

  /** Alias for {@link DeAPIProvider.transcriptionModel}. */
  transcription(modelId: DeAPITranscriptionModelId): TranscriptionModelV4;
}

/**
 * deAPI error structure shared by every model.
 *
 * BOTH the OpenAI envelope `{ error: { message, ... } }` and the native
 * envelope `{ data, message, ... }` must produce a typed `APICallError`
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
 * Wraps the openai-compatible {@link ImageModelV4} with deAPI defaults.
 *
 * - **Editing**: `@ai-sdk/openai-compatible` routes a call with input `files`
 *   to `POST /images/edits` (multipart `image` parts), which deAPI supports
 *   for its instruction-following edit models. A `mask` (inpainting) has no
 *   backend model, so it fails fast with a typed
 *   `UnsupportedFunctionalityError` instead of an upstream 400.
 * - **Response format**: deAPI answers with short-lived result URLs by
 *   default. Unless the caller sets `providerOptions.deapi.response_format`,
 *   the wrapper asks for `b64_json`, so the image bytes arrive in the same
 *   response and no second download is needed.
 *
 * All other members are forwarded 1:1 so the wrapper remains a thin,
 * fully-compliant `ImageModelV4`.
 */
function withDeAPIImageDefaults(model: ImageModelV4): ImageModelV4 {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    maxImagesPerCall: model.maxImagesPerCall,
    supportsFileInputs: true,
    supportsMaskInputs: false,
    doGenerate(options: ImageModelV4CallOptions) {
      if (options.mask) {
        throw new UnsupportedFunctionalityError({
          functionality: 'image inpainting (mask)',
        });
      }
      const deapiOptions = options.providerOptions?.deapi ?? {};
      return model.doGenerate({
        ...options,
        providerOptions: {
          ...options.providerOptions,
          deapi: { response_format: 'b64_json', ...deapiOptions },
        },
      });
    },
  };
}

/**
 * Builds a fetch wrapper that injects lazy auth headers at REQUEST time.
 *
 * AUTH MECHANISM (lazy auth):
 * `@ai-sdk/openai-compatible` resolves its `apiKey` / static `headers` into a
 * fixed object at construction time. Passing either would read
 * `DEAPI_API_KEY` when `createDeAPI()` runs, violating the contract that
 * import + `createDeAPI()` must not throw without a key.
 *
 * Instead the model `headers` resolver returns NO auth, and this custom `fetch`
 * runs the lazy header resolver on every call (calling `loadApiKey`, which
 * throws only here, per request) and merges `Authorization: Bearer <key>` plus
 * user-supplied static headers into the outgoing request.
 *
 * ORIGIN SCOPING: the same fetch is also used by the AI SDK for downloads
 * that do not go to deAPI's API (e.g. an input image URL for an edit). The key
 * and the user headers are therefore added ONLY when the request targets the
 * configured `baseURL` origin; any other request is passed through untouched.
 *
 * Internal: exported for unit tests only, not part of the package barrel.
 */
export function createAuthInjectingFetch(
  baseURL: string,
  resolveHeaders: () => Record<string, string | undefined>,
  baseFetch: FetchFunction | undefined,
): FetchFunction {
  return (input, init) => {
    const fetchImpl = baseFetch ?? globalThis.fetch;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (!isSameOrigin(url, baseURL)) {
      return fetchImpl(input, init);
    }

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
  const fetch = createAuthInjectingFetch(
    baseURL,
    resolveHeaders,
    settings.fetch,
  );

  // Joins the normalized baseURL with a model path (e.g. `/embeddings`). The
  // models call `config.url({ path })` per request.
  const url = ({ path }: { modelId: string; path: string }): string =>
    `${baseURL}${path}`;

  // The per-request headers resolver returns NO auth: auth is injected by the
  // custom fetch above to keep it truly lazy.
  const headers = (): Record<string, string | undefined> => ({});

  const embeddingModel = (modelId: DeAPIEmbeddingModelId): EmbeddingModelV4 =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: 'deapi.embedding',
      url,
      headers,
      fetch,
      errorStructure: deapiErrorStructure,
      maxEmbeddingsPerCall: DEAPI_MAX_EMBEDDINGS_PER_CALL,
    });

  const imageModel = (modelId: DeAPIImageModelId): ImageModelV4 =>
    withDeAPIImageDefaults(
      new OpenAICompatibleImageModel(modelId, {
        provider: 'deapi.image',
        url,
        headers,
        fetch,
        errorStructure: deapiErrorStructure,
      }),
    );

  const videoModel = (modelId: DeAPIVideoModelId): VideoModelV4 =>
    new DeAPIVideoModel(modelId, {
      provider: 'deapi.video',
      url,
      headers,
      fetch,
      failedResponseHandler,
    });

  const speechModel = (modelId: DeAPISpeechModelId): SpeechModelV4 =>
    new DeAPISpeechModel(modelId, {
      url,
      headers,
      fetch,
      failedResponseHandler,
    });

  const transcriptionModel = (
    modelId: DeAPITranscriptionModelId,
  ): TranscriptionModelV4 =>
    new DeAPITranscriptionModel(modelId, {
      provider: 'deapi.transcription',
      url,
      headers,
      fetch,
      failedResponseHandler,
    });

  const languageModel = (modelId: DeAPIChatModelId): LanguageModelV4 => {
    const jsonSchema = supportsJsonSchema(modelId);
    const model = new OpenAICompatibleChatLanguageModel(modelId, {
      provider: 'deapi.chat',
      url,
      headers,
      fetch,
      // The final usage chunk carries usage.cost, so streams always ask for it.
      includeUsage: true,
      errorStructure: deapiErrorStructure,
      metadataExtractor: deapiChatMetadataExtractor,
      supportsStructuredOutputs: jsonSchema,
    });
    return jsonSchema ? model : withJsonSchemaInstruction(model);
  };

  const provider = (modelId: DeAPIChatModelId): LanguageModelV4 =>
    languageModel(modelId);

  return Object.assign(provider, {
    specificationVersion: 'v4' as const,
    languageModel,
    chatModel: languageModel,
    listModels: (options?: DeAPIListModelsOptions) =>
      fetchDeAPIModels({ url, fetch }, options),
    embeddingModel,
    imageModel,
    videoModel,
    speechModel,
    transcriptionModel,
    embedding: embeddingModel,
    image: imageModel,
    video: videoModel,
    speech: speechModel,
    transcription: transcriptionModel,
  });
}

/**
 * Lists the models a key can call without building a provider first, e.g.
 * `listDeAPIModels({ apiKey })`. Same result as `createDeAPI(settings).listModels(options)`.
 */
export function listDeAPIModels(
  settings: DeAPIProviderSettings & DeAPIListModelsOptions = {},
): Promise<DeAPIModelInfo[]> {
  const { type, abortSignal, ...providerSettings } = settings;
  return createDeAPI(providerSettings).listModels({ type, abortSignal });
}

/**
 * Default deAPI provider instance.
 *
 * Safe to construct at module load ONLY because auth is lazy: no API key is
 * read here.
 */
export const deapi = createDeAPI();
