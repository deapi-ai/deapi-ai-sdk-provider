import {
  type TranscriptionModelV4CallOptions,
  type TranscriptionModelV4TimestampGranularity,
  type SharedV4Warning,
} from '@ai-sdk/provider';
import { parseProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';

/**
 * Maximum size of a single audio file accepted by the deAPI transcription
 * surface. The contract caps an individual file at 20 MB (and the whole
 * request at 75 MB). Since this model uploads exactly one file we validate the
 * 20 MB per-file limit here and fail fast with a clear, actionable error rather
 * than leaking an opaque upstream 413.
 */
export const DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/**
 * Provider-specific options for the deAPI transcription model, supplied under
 * `providerOptions.deapi`.
 *
 * - `response_format` selects the upstream response shape:
 *   - `'json'` returns `{ text }` only (the default when no timestamps are
 *     requested);
 *   - `'verbose_json'` additionally returns segments, the detected language
 *     and the duration. It is selected automatically when the call asks for
 *     `timestampGranularities`.
 * - `language` is an optional ISO-639-1 hint passed straight through to the
 *   API to improve accuracy / latency.
 *
 * Unknown keys are not silently dropped: the zod schema strips them, but
 * {@link getTranscriptionArgs} first inspects the raw `providerOptions.deapi`
 * record and surfaces any unrecognised key as an `'unsupported'` warning
 * (mirroring the speech model), so a caller typo is signalled rather than lost.
 */
export const deapiTranscriptionProviderOptionsSchema = z.object({
  response_format: z.enum(['json', 'verbose_json']).optional(),
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
  /** Upstream `response_format` field. */
  response_format: 'json' | 'verbose_json';
  /** Optional ISO-639-1 language hint, omitted when not provided. */
  language: string | undefined;
  /**
   * Upstream `timestamp_granularities[]` values. Only sent together with
   * `verbose_json`; empty when the caller did not ask for timestamps.
   */
  timestampGranularities: TranscriptionModelV4TimestampGranularity[];
  /** Warnings for unsupported settings encountered while mapping. */
  warnings: Array<SharedV4Warning>;
}

/**
 * Parses + validates `providerOptions.deapi` and maps the AI SDK
 * {@link TranscriptionModelV4CallOptions} into deAPI request parameters.
 *
 * Mapping rules:
 * - `timestampGranularities` (AI SDK option) -> `timestamp_granularities[]`
 *   and `response_format=verbose_json` (timestamps are only returned in the
 *   verbose shape).
 * - `response_format` defaults to `'json'`, or `'verbose_json'` when
 *   timestamps are requested. An explicit `'json'` together with
 *   `timestampGranularities` is honoured, but the granularities are dropped
 *   with a warning because the plain shape carries no timings.
 * - `language` is passed through when present.
 */
export async function getTranscriptionArgs(
  options: TranscriptionModelV4CallOptions,
): Promise<DeAPITranscriptionArgs> {
  const warnings: Array<SharedV4Warning> = [];

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

  const requested = [...new Set(options.timestampGranularities ?? [])];
  const response_format =
    deapiOptions?.response_format ??
    (requested.length > 0 ? 'verbose_json' : 'json');

  let timestampGranularities = requested;
  if (response_format === 'json' && requested.length > 0) {
    warnings.push({
      type: 'unsupported',
      feature: 'timestampGranularities',
      details:
        'Timestamps are only returned with response_format "verbose_json"; ' +
        'they were not requested because response_format "json" was set.',
    });
    timestampGranularities = [];
  }

  return {
    response_format,
    language: deapiOptions?.language,
    timestampGranularities,
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
