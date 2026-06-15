/**
 * @ai-sdk/deapi-provider — public barrel.
 *
 * 0.1.0 surface: image generation + embeddings via the deAPI OpenAI-compatible
 * endpoint. Auth is lazy: importing this module never reads `DEAPI_API_KEY`.
 */
export { createDeAPI, deapi } from './deapi-provider';
export type { DeAPIProvider } from './deapi-provider';

export type {
  DeAPIEmbeddingModelId,
  DeAPIImageModelId,
  DeAPIProviderSettings,
} from './deapi-config';
