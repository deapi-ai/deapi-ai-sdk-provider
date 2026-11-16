import type { SharedV4Warning, SpeechModelV4CallOptions } from '@ai-sdk/provider';
import { z } from 'zod';

/**
 * deAPI-specific provider options for speech synthesis.
 *
 * Supplied via `providerOptions.deapi` on a `generateSpeech` call. Every field
 * is optional and passed through verbatim into the `POST /audio/speech` JSON
 * body, layered on top of the mapped standard options (so the standard mapping
 * stays the source of truth for `voice` / `response_format`, while these cover
 * anything deAPI accepts that the AI SDK surface does not model).
 */
export const deapiSpeechProviderOptionsSchema = z.object({
  /**
   * Sampling speed multiplier accepted by the deAPI speech endpoint, passed
   * through as-is. Mirrors the standard `speed` call option for callers who
   * prefer the provider-scoped form.
   */
  speed: z.number().optional(),
  /**
   * ISO 639-1 language hint passed through as-is.
   */
  language: z.string().optional(),
  /**
   * Free-form style/voice-direction instructions passed through as-is.
   */
  instructions: z.string().optional(),
});

/** Parsed `providerOptions.deapi` for a speech call. */
export type DeAPISpeechProviderOptions = z.infer<
  typeof deapiSpeechProviderOptionsSchema
>;

/** Known deAPI speech model slugs (defined once in `deapi-config.ts`). */
export type { DeAPISpeechModelId } from '../deapi-config';

/** Default voice used when the caller does not supply one. */
export const DEFAULT_SPEECH_VOICE = 'alloy';

/**
 * Default audio container/format requested from the deAPI speech endpoint.
 * `mp3` is currently the only format the endpoint produces.
 */
export const DEFAULT_SPEECH_RESPONSE_FORMAT = 'mp3';

/**
 * The JSON body posted to `POST {baseURL}/audio/speech`.
 *
 * `model` and `input` are always present. `voice` and `response_format` carry
 * the resolved defaults. `speed`, `language`, and `instructions` are included
 * only when supplied (by either the standard call option or the deAPI-scoped
 * provider option). Provider-scoped options win on conflict because they are
 * the explicit, provider-targeted form.
 */
export interface DeAPISpeechRequestBody {
  model: string;
  input: string;
  voice: string;
  response_format: string;
  speed?: number;
  language?: string;
  instructions?: string;
}

/**
 * Result of mapping AI SDK speech call options + deAPI provider options to the
 * request body, together with any warnings for options that could not be
 * honoured.
 */
export interface MappedSpeechRequest {
  body: DeAPISpeechRequestBody;
  warnings: SharedV4Warning[];
}

/** Recognised keys under `providerOptions.deapi` for a speech call. */
const KNOWN_DEAPI_SPEECH_OPTION_KEYS: ReadonlySet<string> = new Set([
  'speed',
  'language',
  'instructions',
]);

/**
 * Maps {@link SpeechModelV4CallOptions} (plus already-parsed deAPI provider
 * options) onto the deAPI speech request body.
 *
 * Mapping rules:
 * - `voice` -> `voice` (default {@link DEFAULT_SPEECH_VOICE}).
 * - `outputFormat` -> `response_format` (default
 *   {@link DEFAULT_SPEECH_RESPONSE_FORMAT}).
 * - `speed`, `language`, `instructions` -> same-named body fields. The
 *   provider-scoped option (`providerOptions.deapi.*`) takes precedence over
 *   the standard call option when both are present.
 *
 * Nothing is silently dropped: any key supplied under `providerOptions.deapi`
 * that this provider does not recognise (and therefore will not forward)
 * produces an `'unsupported'` warning. `rawProviderOptions` is the unparsed
 * `providerOptions.deapi` record used solely to detect those unknown keys (the
 * zod schema strips them, so they are otherwise invisible).
 */
export function mapSpeechCallOptions(
  options: SpeechModelV4CallOptions,
  providerOptions: DeAPISpeechProviderOptions | undefined,
  rawProviderOptions?: Record<string, unknown>,
): MappedSpeechRequest {
  const warnings: SharedV4Warning[] = [];

  for (const key of Object.keys(rawProviderOptions ?? {})) {
    if (!KNOWN_DEAPI_SPEECH_OPTION_KEYS.has(key)) {
      warnings.push({
        type: 'unsupported',
        feature: `providerOptions.deapi.${key}`,
        details:
          `The deAPI speech model does not support the ` +
          `"${key}" provider option; it was ignored.`,
      });
    }
  }

  const speed = providerOptions?.speed ?? options.speed;
  const language = providerOptions?.language ?? options.language;
  const instructions = providerOptions?.instructions ?? options.instructions;

  const body: DeAPISpeechRequestBody = {
    model: '',
    input: options.text,
    voice: options.voice ?? DEFAULT_SPEECH_VOICE,
    response_format: options.outputFormat ?? DEFAULT_SPEECH_RESPONSE_FORMAT,
    ...(speed !== undefined ? { speed } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
  };

  return { body, warnings };
}
