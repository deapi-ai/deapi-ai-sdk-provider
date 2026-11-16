import {
  type APICallError,
  type Experimental_VideoModelV4 as VideoModelV4,
  type Experimental_VideoModelV4CallOptions as VideoModelV4CallOptions,
  type Experimental_VideoModelV4File as VideoModelV4File,
  type Experimental_VideoModelV4OperationStartResult as VideoModelV4OperationStartResult,
  type Experimental_VideoModelV4OperationStatusResult as VideoModelV4OperationStatusResult,
  InvalidArgumentError,
  type JSONValue,
  type SharedV4Warning,
} from '@ai-sdk/provider';
import {
  type FetchFunction,
  type ResponseHandler,
  combineHeaders,
  convertUint8ArrayToBase64,
  createBinaryResponseHandler,
  createJsonResponseHandler,
  getFromApi,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { DeAPIVideoModelId } from '../deapi-config';

/**
 * Configuration handed to {@link DeAPIVideoModel} by the provider. Same shape
 * as the speech/transcription models: the lazy-auth `fetch`, a header resolver
 * that returns NO auth, the `url` builder and the two-envelope error handler.
 */
export interface DeAPIVideoModelConfig {
  /** Provider name for logging, e.g. `'deapi.video'`. */
  provider: string;
  /** Builds the absolute request URL for a given path (e.g. `/videos`). */
  url: (input: { modelId: string; path: string }) => string;
  /** Per-request header resolver. Returns no auth; the fetch wrapper adds it. */
  headers: () => Record<string, string | undefined>;
  /** Lazy-auth fetch wrapper supplied by the provider. */
  fetch?: FetchFunction;
  /** Two-envelope failed-response handler (OpenAI + native deAPI shapes). */
  failedResponseHandler: ResponseHandler<APICallError>;
}

/**
 * The video object returned by `POST /videos` and `GET /videos/{id}`. Only the
 * fields this model reads are declared; everything else is passed through.
 */
const deapiVideoObjectSchema = z.object({
  id: z.string(),
  status: z.string(),
  error: z
    .object({
      message: z.string().nullish(),
      code: z.string().nullish(),
    })
    .nullish(),
});

/** Opaque operation reference handed from `doStart` to `doStatus`. */
const deapiVideoOperationSchema = z.object({ id: z.string().min(1) });

/** Default media type when the content response carries none. */
const DEFAULT_VIDEO_MEDIA_TYPE = 'video/mp4';

/**
 * deAPI video model — an AI SDK `VideoModelV4` over the OpenAI-compatible
 * video endpoints:
 *
 * - `POST {baseURL}/videos` creates the job and returns its id immediately;
 * - `GET {baseURL}/videos/{id}` reports `queued` / `in_progress` /
 *   `completed` / `failed`;
 * - `GET {baseURL}/videos/{id}/content` downloads the finished file.
 *
 * The model implements the asynchronous `doStart` / `doStatus` pair, so
 * `experimental_generateVideo` from `ai` drives the polling (configurable with
 * its `poll` option). deAPI has no completion webhooks on this surface, so
 * `handleWebhookOption` is intentionally not implemented and the SDK falls back
 * to polling.
 *
 * Mapping of the AI SDK call options:
 * - `prompt` -> `prompt` (required by deAPI, also for image-to-video);
 * - `duration` -> `seconds`; `resolution` -> `size` (each model validates
 *   both against its own list; omitted values use the model's defaults);
 * - `image`, or a `frameImages` entry with `frameType: 'first_frame'` ->
 *   `input_reference.image_url` (a URL, or a base64 `data:` URL for bytes);
 * - `aspectRatio`, `fps`, `seed`, `generateAudio`, `inputReferences` and
 *   `last_frame` images have no counterpart and produce `unsupported` warnings;
 * - `providerOptions.deapi` is merged into the JSON body as-is.
 */
export class DeAPIVideoModel implements VideoModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly modelId: string;
  /** deAPI renders one video per job. The SDK fans out `n > 1` itself. */
  readonly maxVideosPerCall = 1;

  private readonly config: DeAPIVideoModelConfig;

  constructor(modelId: DeAPIVideoModelId, config: DeAPIVideoModelConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  async doStart(
    options: VideoModelV4CallOptions & { webhookUrl?: string },
  ): Promise<VideoModelV4OperationStartResult> {
    const currentDate = new Date();
    const { body, warnings } = this.getArgs(options);

    const { value: video, responseHeaders } = await postJsonToApi({
      url: this.config.url({ modelId: this.modelId, path: '/videos' }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: this.config.failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        deapiVideoObjectSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    return {
      operation: { id: video.id },
      warnings,
      providerMetadata: { deapi: { videoId: video.id } },
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: responseHeaders,
      },
    };
  }

  async doStatus(options: {
    operation: JSONValue;
    abortSignal?: AbortSignal;
    headers?: Record<string, string | undefined>;
  }): Promise<VideoModelV4OperationStatusResult> {
    const currentDate = new Date();
    const parsed = deapiVideoOperationSchema.safeParse(options.operation);
    if (!parsed.success) {
      throw new InvalidArgumentError({
        argument: 'operation',
        message:
          'deAPI video: expected the operation returned by doStart ({ id: string }).',
      });
    }
    const { id } = parsed.data;
    const videoPath = `/videos/${encodeURIComponent(id)}`;
    const headers = combineHeaders(this.config.headers(), options.headers);

    const { value: video, responseHeaders } = await getFromApi({
      url: this.config.url({ modelId: this.modelId, path: videoPath }),
      headers,
      failedResponseHandler: this.config.failedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        deapiVideoObjectSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const providerMetadata = {
      deapi: { videoId: video.id, status: video.status },
    };

    if (video.status === 'failed') {
      return {
        status: 'error',
        error:
          video.error?.message ??
          `deAPI video generation failed (id ${video.id}).`,
        providerMetadata,
        response: {
          timestamp: currentDate,
          modelId: this.modelId,
          headers: responseHeaders,
        },
      };
    }

    if (video.status !== 'completed') {
      // `queued`, `in_progress`, and any status this version does not know
      // about keep the SDK polling (the endpoint itself reports unknown backend
      // states as `in_progress`).
      return {
        status: 'pending',
        providerMetadata,
        response: {
          timestamp: currentDate,
          modelId: this.modelId,
          headers: responseHeaders,
        },
      };
    }

    // The content route needs the same Bearer token, so the file is downloaded
    // here (the SDK's own URL download would not authenticate).
    const { value: data, responseHeaders: contentHeaders } = await getFromApi({
      url: this.config.url({
        modelId: this.modelId,
        path: `${videoPath}/content`,
      }),
      headers,
      failedResponseHandler: this.config.failedResponseHandler,
      successfulResponseHandler: createBinaryResponseHandler(),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    return {
      status: 'completed',
      videos: [
        {
          type: 'binary',
          data,
          mediaType: getMediaType(contentHeaders),
        },
      ],
      warnings: [],
      providerMetadata,
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: contentHeaders,
      },
    };
  }

  private getArgs(options: VideoModelV4CallOptions): {
    body: Record<string, unknown>;
    warnings: SharedV4Warning[];
  } {
    const warnings: SharedV4Warning[] = [];

    if (options.prompt == null || options.prompt.trim() === '') {
      throw new InvalidArgumentError({
        argument: 'prompt',
        message:
          'deAPI video generation requires a text prompt, also for image-to-video.',
      });
    }

    const unsupported = (feature: string, details?: string) =>
      warnings.push({ type: 'unsupported', feature, details });

    if (options.aspectRatio != null) {
      unsupported(
        'aspectRatio',
        'deAPI video models take an explicit size. Use `resolution` instead.',
      );
    }
    if (options.fps != null) {
      unsupported('fps', 'Each deAPI video model renders at a fixed frame rate.');
    }
    if (options.seed != null) {
      unsupported('seed');
    }
    if (options.generateAudio === true) {
      unsupported('generateAudio');
    }
    if (options.inputReferences != null && options.inputReferences.length > 0) {
      unsupported(
        'inputReferences',
        'Only a first-frame image is supported. Use `image` (prompt.image).',
      );
    }

    let firstFrame: VideoModelV4File | undefined = options.image;
    for (const frame of options.frameImages ?? []) {
      if (frame.frameType === 'first_frame' && firstFrame == null) {
        firstFrame = frame.image;
      } else {
        unsupported(
          `frameImages.${frame.frameType}`,
          frame.frameType === 'first_frame'
            ? 'Only one first-frame image is supported; the extra one was ignored.'
            : 'deAPI video models do not take a last-frame image.',
        );
      }
    }

    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt: options.prompt,
      ...(options.duration != null ? { seconds: String(options.duration) } : {}),
      ...(options.resolution != null ? { size: options.resolution } : {}),
      ...(firstFrame != null
        ? { input_reference: { image_url: toImageUrl(firstFrame) } }
        : {}),
      ...(options.providerOptions?.deapi ?? {}),
    };

    return { body, warnings };
  }
}

/** Turns an AI SDK file into the `image_url` deAPI accepts (URL or data URL). */
function toImageUrl(file: VideoModelV4File): string {
  if (file.type === 'url') {
    return file.url;
  }
  const base64 =
    typeof file.data === 'string'
      ? file.data
      : convertUint8ArrayToBase64(file.data);
  return `data:${file.mediaType};base64,${base64}`;
}

function getMediaType(headers: Record<string, string> | undefined): string {
  const contentType = headers?.['content-type']?.split(';')[0]?.trim();
  return contentType != null && contentType.startsWith('video/')
    ? contentType
    : DEFAULT_VIDEO_MEDIA_TYPE;
}
