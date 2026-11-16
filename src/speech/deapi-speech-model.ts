import type {
  APICallError,
  SpeechModelV4,
  SpeechModelV4CallOptions,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  createBinaryResponseHandler,
  type FetchFunction,
  parseProviderOptions,
  postJsonToApi,
  type ResponseHandler,
} from '@ai-sdk/provider-utils';
import {
  type DeAPISpeechModelId,
  type DeAPISpeechProviderOptions,
  deapiSpeechProviderOptionsSchema,
  mapSpeechCallOptions,
} from './deapi-speech-options';

/**
 * Provider-name used for logging and for scoping `providerOptions.deapi`.
 */
const PROVIDER = 'deapi.speech';

/**
 * Configuration handed to {@link DeAPISpeechModel} by the provider.
 *
 * The provider supplies the lazy-auth `fetch`, the per-request `headers`
 * resolver (which returns NO auth — auth is injected by the fetch wrapper), the
 * `url` builder, and the two-envelope `failedResponseHandler`. The model never
 * resolves the API key itself, preserving the lazy-auth contract.
 */
export interface DeAPISpeechModelConfig {
  /** Builds the absolute request URL for a given path (e.g. `/audio/speech`). */
  url: (input: { modelId: string; path: string }) => string;
  /** Per-request header resolver. Returns no auth; the fetch wrapper adds it. */
  headers: () => Record<string, string | undefined>;
  /** Lazy-auth fetch wrapper supplied by the provider. */
  fetch?: FetchFunction;
  /** Two-envelope failed-response handler (OpenAI + native deAPI shapes). */
  failedResponseHandler: ResponseHandler<APICallError>;
}

/**
 * deAPI speech model — a {@link SpeechModelV4} backed by the synchronous,
 * OpenAI-shaped `POST {baseURL}/audio/speech` endpoint, which returns binary
 * audio directly (not an async job).
 */
export class DeAPISpeechModel implements SpeechModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = PROVIDER;
  readonly modelId: string;

  private readonly config: DeAPISpeechModelConfig;

  constructor(modelId: DeAPISpeechModelId, config: DeAPISpeechModelConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  async doGenerate(
    options: SpeechModelV4CallOptions,
  ): Promise<Awaited<ReturnType<SpeechModelV4['doGenerate']>>> {
    const currentDate = new Date();

    const providerOptions: DeAPISpeechProviderOptions | undefined =
      await parseProviderOptions({
        provider: 'deapi',
        providerOptions: options.providerOptions,
        schema: deapiSpeechProviderOptionsSchema,
      });

    const rawDeapiOptions = options.providerOptions?.deapi;
    const { body: mappedBody, warnings } = mapSpeechCallOptions(
      options,
      providerOptions,
      rawDeapiOptions,
    );

    const body = { ...mappedBody, model: this.modelId };

    const {
      value: audio,
      responseHeaders,
      rawValue,
    } = await postJsonToApi({
      url: this.config.url({ modelId: this.modelId, path: '/audio/speech' }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: this.config.failedResponseHandler,
      successfulResponseHandler: createBinaryResponseHandler(),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    return {
      audio,
      warnings,
      request: { body },
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawValue,
      },
    };
  }
}
