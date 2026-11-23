import {
  createJsonResponseHandler,
  type FetchFunction,
  getFromApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { failedResponseHandler } from '../deapi-error';

/** Which models {@link DeAPIProvider.listModels} returns. */
export type DeAPIModelType = 'chat' | 'media' | 'all';

/** Options for {@link DeAPIProvider.listModels}. */
export interface DeAPIListModelsOptions {
  /** `chat` (default), `media` or `all`. */
  type?: DeAPIModelType;
  /** Aborts the request. */
  abortSignal?: AbortSignal;
}

/**
 * Prices of a chat model in USD **per token** (multiply by 1,000,000 for the
 * price per million tokens), after the margin of the key that listed them.
 */
export interface DeAPIModelPricing {
  prompt: number;
  completion: number;
  /** Cached input tokens, when the model bills them differently. */
  inputCacheRead?: number;
  /** Writing input to the cache, when the model bills it. */
  inputCacheWrite?: number;
}

/** One model from `GET /v1/models`. */
export interface DeAPIModelInfo {
  id: string;
  /** `chat` for chat completion models, `media` for everything else. */
  type: 'chat' | 'media';
  ownedBy?: string;
  /** Context window in tokens (chat models). */
  contextLength?: number;
  /** Maximum output tokens per call (chat models). */
  maxOutputTokens?: number;
  /** For example `['text', 'image']` (chat models). */
  inputModalities?: string[];
  outputModalities?: string[];
  /** OpenAI request fields the model accepts, e.g. `tools`, `reasoning_effort`. */
  supportedParameters?: string[];
  pricing?: DeAPIModelPricing;
}

// A price is a decimal string (or number) in USD per token. An empty string
// is rejected rather than read as 0.
const priceSchema = z
  .union([z.string().trim().min(1), z.number()])
  .transform((value) => Number(value))
  .pipe(z.number().finite());

const modelSchema = z.object({
  id: z.string(),
  owned_by: z.string().nullish(),
  context_length: z.number().nullish(),
  top_provider: z
    .object({ max_completion_tokens: z.number().nullish() })
    .loose()
    .nullish(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).nullish(),
      output_modalities: z.array(z.string()).nullish(),
    })
    .loose()
    .nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  pricing: z
    .object({
      prompt: priceSchema,
      completion: priceSchema,
      input_cache_read: priceSchema.nullish(),
      input_cache_write: priceSchema.nullish(),
    })
    .loose()
    .nullish()
    // Unreadable prices drop the prices, not the model.
    .catch(null),
});

// Entries are validated one by one, so one malformed model does not hide the
// rest of the list.
const modelListSchema = z.object({ data: z.array(z.unknown()) }).loose();

type RawModel = z.infer<typeof modelSchema>;

function isChatModel(model: RawModel): boolean {
  const outputs = model.architecture?.output_modalities;
  if (outputs != null) {
    return outputs.includes('text') && model.supported_parameters != null;
  }
  return model.pricing != null || model.context_length != null;
}

function toModelInfo(model: RawModel): DeAPIModelInfo {
  const info: DeAPIModelInfo = {
    id: model.id,
    type: isChatModel(model) ? 'chat' : 'media',
  };
  if (model.owned_by != null) info.ownedBy = model.owned_by;
  if (model.context_length != null) info.contextLength = model.context_length;
  const maxOutput = model.top_provider?.max_completion_tokens;
  if (maxOutput != null) info.maxOutputTokens = maxOutput;
  const inputs = model.architecture?.input_modalities;
  if (inputs != null) info.inputModalities = inputs;
  const outputs = model.architecture?.output_modalities;
  if (outputs != null) info.outputModalities = outputs;
  if (model.supported_parameters != null) {
    info.supportedParameters = model.supported_parameters;
  }
  if (model.pricing != null) {
    const { prompt, completion, input_cache_read, input_cache_write } =
      model.pricing;
    info.pricing = { prompt, completion };
    if (input_cache_read != null) info.pricing.inputCacheRead = input_cache_read;
    if (input_cache_write != null) {
      info.pricing.inputCacheWrite = input_cache_write;
    }
  }
  return info;
}

/**
 * Lists the models the key can call (`GET /models`). Internal: the public
 * entry points are `deapi.listModels()` and `listDeAPIModels()`.
 */
export async function fetchDeAPIModels(
  config: {
    url: (options: { modelId: string; path: string }) => string;
    fetch: FetchFunction;
  },
  options: DeAPIListModelsOptions = {},
): Promise<DeAPIModelInfo[]> {
  const type = options.type ?? 'chat';
  const { value } = await getFromApi({
    url: config.url({ modelId: '', path: '/models' }),
    headers: {},
    successfulResponseHandler: createJsonResponseHandler(modelListSchema),
    failedResponseHandler,
    abortSignal: options.abortSignal,
    fetch: config.fetch,
  });
  const models = value.data.flatMap((entry) => {
    const parsed = modelSchema.safeParse(entry);
    return parsed.success ? [toModelInfo(parsed.data)] : [];
  });
  return type === 'all' ? models : models.filter((m) => m.type === type);
}
