import {
  type APICallError,
  type TranscriptionModelV3,
  type TranscriptionModelV3CallOptions,
} from '@ai-sdk/provider';
import {
  type FetchFunction,
  type ResponseHandler,
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

/** deAPI transcription JSON response (`response_format=json`): `{ text }`. */
const deapiTranscriptionResponseSchema = z.object({
  text: z.string(),
});

/**
 * deAPI transcription model (`POST {baseURL}/audio/transcriptions`).
 *
 * SYNCHRONOUS, OpenAI-shaped multipart upload: the audio is sent as a `file`
 * form field (deAPI uses `file`, not `source_file`/`source_url`) alongside
 * `model` and `response_format`. With `response_format=json` the API returns
 * `{ "text": "..." }`.
 *
 * Web APIs only (Blob/File/FormData/Uint8Array) — no Buffer / Node streams — so
 * the model runs on edge runtimes. The API key is resolved lazily by the
 * provider's `fetch` wrapper, never here.
 */
export class DeAPITranscriptionModel implements TranscriptionModelV3 {
  readonly specificationVersion = 'v3' as const;
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
    options: TranscriptionModelV3CallOptions,
  ): Promise<Awaited<ReturnType<TranscriptionModelV3['doGenerate']>>> {
    const currentDate = new Date();

    // Normalize the audio to bytes backed by a plain ArrayBuffer: V3 accepts a
    // Uint8Array or a base64 string. Copying into a fresh Uint8Array also
    // guarantees a concrete `ArrayBuffer` (not `SharedArrayBuffer`) so it is a
    // valid `BlobPart` under strict typings.
    const audioBytes =
      typeof options.audio === 'string'
        ? convertBase64ToUint8Array(options.audio)
        : new Uint8Array(options.audio);

    // Guard the per-file size limit before building/sending the request.
    assertAudioWithinLimit(audioBytes.byteLength);

    const { response_format, language, warnings } =
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

    const {
      value: response,
      responseHeaders,
      rawValue: rawResponse,
    } = await postFormDataToApi({
      url: this.config.url({
        modelId: this.modelId,
        path: '/audio/transcriptions',
      }),
      headers: this.config.headers(),
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
      // deAPI's json response carries no segment timings, language, or duration.
      segments: [],
      language: undefined,
      durationInSeconds: undefined,
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
