import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  SharedV4ProviderMetadata,
} from '@ai-sdk/provider';
import type { MetadataExtractor } from '@ai-sdk/openai-compatible';

/**
 * Known chat model ids on deAPI's OpenAI-compatible surface. The id type stays
 * open (`string & {}`): the live list for a key is `GET /v1/models`, and new
 * models work without a release.
 */
export type DeAPIChatModelId =
  | 'deepseek-v4.1-flash'
  | 'deepseek-v4.1-flash:economy'
  | 'glm-5.3'
  | 'glm-5.3-flash'
  | 'gpt-6-luna'
  | 'hy3'
  | 'kimi-k3'
  | 'qwen3.8-flash'
  | 'qwen3.8-max'
  | 'seed-2.0-lite'
  | 'seed-2.0-mini'
  | 'seed-2.0-pro'
  | 'seed-2.1-turbo'
  | (string & {});

/**
 * Options accepted under `providerOptions.deapi` for chat models. Any other
 * key is forwarded to the request body unchanged.
 */
export interface DeAPIChatOptions {
  /**
   * `reasoning_effort` sent as is: `none`, `minimal`, `low`, `medium`, `high`,
   * `xhigh` or `max`. Models differ in which levels they accept (`glm-5.3`:
   * `low`, `high`, `max`); a level a model does not take is answered with a
   * 400 that lists the supported values. The top-level `reasoning` call option
   * maps to the same field.
   */
  reasoningEffort?: string | null;
  /** End-user identifier, sent as `user`. */
  user?: string;
  /** Sent as `verbosity`. */
  textVerbosity?: string;
  /** `strict` flag of the `json_schema` response format (structured output). */
  strictJsonSchema?: boolean;
}

/**
 * Chat models that reject `response_format: json_schema`, matched on the id
 * before any `:` variant suffix. For these the model asks for `json_object`
 * and the schema goes into a system message instead (see
 * {@link withJsonSchemaInstruction}).
 */
const MODELS_WITHOUT_JSON_SCHEMA: ReadonlySet<string> = new Set(['glm-5.3']);

export function supportsJsonSchema(modelId: string): boolean {
  return !MODELS_WITHOUT_JSON_SCHEMA.has(modelId.replace(/:.*/s, ''));
}

/**
 * Moves the JSON schema of a structured-output call into a leading system
 * message, for models that only take `response_format: json_object`. The
 * schema is removed from `responseFormat`, so the request asks for
 * `json_object` and the model still sees the shape it has to return.
 */
function schemaToPrompt(
  options: LanguageModelV4CallOptions,
): LanguageModelV4CallOptions {
  const format = options.responseFormat;
  if (format?.type !== 'json' || format.schema == null) return options;
  const about = [format.name, format.description].filter(Boolean).join(': ');
  const instruction =
    'Respond only with a JSON value matching this JSON schema' +
    (about ? ` (${about})` : '') +
    `:\n${JSON.stringify(format.schema)}`;
  return {
    ...options,
    responseFormat: { type: 'json' },
    prompt: [{ role: 'system', content: instruction }, ...options.prompt],
  };
}

/**
 * Wraps a chat model that has no `json_schema` support so structured output
 * still carries the schema (as a system message). All other members are
 * forwarded unchanged.
 */
export function withJsonSchemaInstruction(
  model: LanguageModelV4,
): LanguageModelV4 {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    get supportedUrls() {
      return model.supportedUrls;
    },
    doGenerate: (options) => model.doGenerate(schemaToPrompt(options)),
    doStream: (options) => model.doStream(schemaToPrompt(options)),
  };
}

/** Reads deAPI's `usage.cost` (USD) from a response body or stream chunk. */
function costOf(value: unknown): number | undefined {
  if (value == null || typeof value !== 'object') return undefined;
  const usage = (value as { usage?: unknown }).usage;
  if (usage == null || typeof usage !== 'object') return undefined;
  const cost = (usage as { cost?: unknown }).cost;
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined;
}

function metadata(
  cost: number | undefined,
): SharedV4ProviderMetadata | undefined {
  return cost === undefined ? undefined : { deapi: { cost } };
}

/**
 * Surfaces the amount deAPI charged for a chat call as
 * `providerMetadata.deapi.cost` (USD). deAPI reports it as `usage.cost` in the
 * response body and, when streaming, in the final usage chunk (the model always
 * asks for that chunk with `stream_options.include_usage`).
 */
export const deapiChatMetadataExtractor: MetadataExtractor = {
  async extractMetadata({ parsedBody }) {
    return metadata(costOf(parsedBody));
  },
  createStreamExtractor() {
    let cost: number | undefined;
    return {
      processChunk(parsedChunk: unknown) {
        cost = costOf(parsedChunk) ?? cost;
      },
      buildMetadata() {
        return metadata(cost);
      },
    };
  },
};
