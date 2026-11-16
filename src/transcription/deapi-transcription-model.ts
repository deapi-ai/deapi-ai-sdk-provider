import {
  type APICallError,
  type TranscriptionModelV4,
  type TranscriptionModelV4CallOptions,
} from '@ai-sdk/provider';
import {
  type FetchFunction,
  type ResponseHandler,
  combineHeaders,
  convertBase64ToUint8Array,
  createJsonResponseHandler,
  mediaTypeToExtension,
  postFormDataToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import {
  assertAudioWithinLimit,
  getTranscriptionArgs,
} from './deapi-transcription-options';
import { toIso6391 } from './whisper-language';

/**
 * Configuration supplied by the provider when constructing the transcription
 * model. Mirrors the shape used by the directly-constructed openai-compatible
 * models so lazy auth + the two-envelope error handler are reused verbatim.
 */
export interface DeAPITranscriptionModelConfig {
  /** Provider name for logging, e.g. `'deapi.transcription'`. */
  provider: string;
  /** Resolves the absolute request URL for a given model path. */
  url: (options: { modelId: string; path: string }) => string;
  /**
   * Per-request header resolver. For deAPI this returns NO auth: the Bearer
   * token is injected lazily by the provider's custom `fetch` wrapper.
   */
  headers: () => Record<string, string | undefined>;
  /**
   * Custom fetch (the provider's lazy-auth-injecting wrapper). The API key is
   * NEVER resolved inside this model.
   */
  fetch?: FetchFunction;
  /**
   * Failed-response handler producing a typed `APICallError` from EITHER deAPI
   * error envelope (OpenAI `{ error }` or native `{ message }`).
   */
  failedResponseHandler: ResponseHandler<APICallError>;
}

/**
 * deAPI transcription JSON response. `json` returns `{ text }`; `verbose_json`
 * adds `language`, `duration`, `segments` and (when word timestamps were
 * requested) `words`.
 */
const deapiTranscriptionResponseSchema = z.object({
  text: z.string(),
  language: z.string().nullish(),
  duration: z.number().nullish(),
  segments: z
    .array(
      z.object({
        text: z.string(),
        start: z.number(),
        end: z.number(),
      }),
    )
    .nullish(),
  words: z
    .array(
      z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
      }),
    )
    .nullish(),
});

/**
 * deAPI transcription model (`POST {baseURL}/audio/transcriptions`).
 *
 * SYNCHRONOUS, OpenAI-shaped multipart upload: the audio is sent as a `file`
 * form field alongside `model` and `response_format`. With
 * `response_format=json` the API returns `{ "text": "..." }`; with
 * `verbose_json` it also returns segment (and optionally word) timings, the
 * detected language and the duration.
 *
 * Web APIs only (Blob/File/FormData/Uint8Array) — no Buffer / Node streams — so
 * the model runs on edge runtimes. The API key is resolved lazily by the
 * provider's `fetch` wrapper, never here.
 */
export class DeAPITranscriptionModel implements TranscriptionModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly modelId: string;

  private readonly config: DeAPITranscriptionModelConfig;

  constructor(modelId: string, config: DeAPITranscriptionModelConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate(
    options: TranscriptionModelV4CallOptions,
  ): Promise<Awaited<ReturnType<TranscriptionModelV4['doGenerate']>>> {
    const currentDate = new Date();

    // Normalize the audio to bytes backed by a plain ArrayBuffer: V4 accepts a
    // Uint8Array or a base64 string. Copying into a fresh Uint8Array also
    // guarantees a concrete `ArrayBuffer` (not `SharedArrayBuffer`) so it is a
    // valid `BlobPart` under strict typings.
    const audioBytes =
      typeof options.audio === 'string'
        ? convertBase64ToUint8Array(options.audio)
        : new Uint8Array(options.audio);

    // Guard the per-file size limit before building/sending the request.
    assertAudioWithinLimit(audioBytes.byteLength);

    const { response_format, language, timestampGranularities, warnings } =
      await getTranscriptionArgs(options);

    // Build multipart body. Field name MUST be `file` (deAPI contract).
    const extension = mediaTypeToExtension(options.mediaType);
    const blob = new Blob([audioBytes], { type: options.mediaType });

    const formData = new FormData();
    formData.append('file', blob, `audio.${extension}`);
    formData.append('model', this.modelId);
    formData.append('response_format', response_format);
    if (language !== undefined) {
      formData.append('language', language);
    }
    for (const granularity of timestampGranularities) {
      formData.append('timestamp_granularities[]', granularity);
    }

    const {
      value: response,
      responseHeaders,
      rawValue: rawResponse,
    } = await postFormDataToApi({
      url: this.config.url({
        modelId: this.modelId,
        path: '/audio/transcriptions',
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      formData,
      failedResponseHandler: this.config.failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        deapiTranscriptionResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    return {
      text: response.text,
      segments: (response.segments ?? []).map((segment) => ({
        text: segment.text,
        startSecond: segment.start,
        endSecond: segment.end,
      })),
      ...(response.words != null
        ? {
            words: response.words.map((word) => ({
              text: word.word,
              startSecond: word.start,
              endSecond: word.end,
            })),
          }
        : {}),
      language: toIso6391(response.language),
      durationInSeconds: response.duration ?? undefined,
      warnings,
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawResponse,
      },
    };
  }
}
