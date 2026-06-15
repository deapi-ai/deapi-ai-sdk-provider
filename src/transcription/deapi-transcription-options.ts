import {
  type TranscriptionModelV3CallOptions,
  type SharedV3Warning,
} from '@ai-sdk/provider';
import { parseProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';

/**
 * Maximum size of a single audio file accepted by the deAPI transcription
 * surface. The LIVE contract caps an individual file at 20 MB (and the whole
 * request at 75 MB). Since this model uploads exactly one file we validate the
 * 20 MB per-file limit here and fail fast with a clear, actionable error rather
 * than leaking an opaque upstream 413.
 */
export const DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/**
 * Provider-specific options for the deAPI transcription model, supplied under
 * `providerOptions.deapi`.
 *
 * - `response_format` selects the upstream response shape. Only `'json'` is
 *   supported by this model (it returns `{ text }`); the default is `'json'`.
 * - `language` is an optional ISO-639-1 hint passed straight through to the
 *   API to improve accuracy / latency.
 *
 * Unknown keys are not silently dropped: the zod schema strips them, but
 * {@link getTranscriptionArgs} first inspects the raw `providerOptions.deapi`
 * record and surfaces any unrecognised key as an `'unsupported'` warning
 * (mirroring the speech model), so a caller typo is signalled rather than lost.
 */
export const deapiTranscriptionProviderOptionsSchema = z.object({
  response_format: z.literal('json').optional(),
  language: z.string().optional(),
});

/** Recognised keys under `providerOptions.deapi` for a transcription call. */
const KNOWN_DEAPI_TRANSCRIPTION_OPTION_KEYS: ReadonlySet<string> = new Set([
  'response_format',
  'language',
]);

export type DeAPITranscriptionProviderOptions = z.infer<
  typeof deapiTranscriptionProviderOptionsSchema
>;

/** Resolved, API-ready transcription request parameters plus warnings. */
export interface DeAPITranscriptionArgs {
  /** Upstream `response_format` field. Always `'json'` for this model. */
  response_format: 'json';
  /** Optional ISO-639-1 language hint, omitted when not provided. */
  language: string | undefined;
  /** Warnings for unsupported settings encountered while mapping. */
  warnings: Array<SharedV3Warning>;
}

/**
 * Parses + validates `providerOptions.deapi` and maps the AI SDK
 * {@link TranscriptionModelV3CallOptions} into deAPI request parameters.
 *
 * Mapping rules:
 * - `response_format` defaults to `'json'` (the only format this model parses).
 * - `language` is passed through when present.
 * - There are no other recognised AI SDK transcription call options on V3 to
 *   map; any future ones would be surfaced via {@link DeAPITranscriptionArgs.warnings}.
 */
export async function getTranscriptionArgs(
  options: TranscriptionModelV3CallOptions,
): Promise<DeAPITranscriptionArgs> {
  const warnings: Array<SharedV3Warning> = [];

  // Detect unrecognised `providerOptions.deapi` keys before the zod schema
  // strips them, so a caller typo is surfaced as a warning instead of silently
  // dropped (parity with the speech model).
  const rawDeapiOptions = options.providerOptions?.deapi;
  if (rawDeapiOptions) {
    for (const key of Object.keys(rawDeapiOptions)) {
      if (!KNOWN_DEAPI_TRANSCRIPTION_OPTION_KEYS.has(key)) {
        warnings.push({
          type: 'unsupported',
          feature: `providerOptions.deapi.${key}`,
          details:
            `The deAPI transcription model does not support the ` +
            `"${key}" provider option; it was ignored.`,
        });
      }
    }
  }

  const deapiOptions = await parseProviderOptions({
    provider: 'deapi',
    providerOptions: options.providerOptions,
    schema: deapiTranscriptionProviderOptionsSchema,
  });

  return {
    response_format: deapiOptions?.response_format ?? 'json',
    language: deapiOptions?.language,
    warnings,
  };
}

/**
 * Guards the per-file audio size limit.
 *
 * @throws Error with a clear, actionable message when the audio exceeds
 *   {@link DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES}.
 */
export function assertAudioWithinLimit(byteLength: number): void {
  if (byteLength > DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES) {
    const limitMb = DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES / (1024 * 1024);
    const actualMb = (byteLength / (1024 * 1024)).toFixed(2);
    throw new Error(
      `deAPI transcription: audio file is ${actualMb} MB, which exceeds the ` +
        `${limitMb} MB per-file limit. Provide a smaller or shorter audio file.`,
    );
  }
}
