/**
 * @deapi/ai-sdk-provider — public barrel.
 *
 * 0.4.0 surface (AI SDK 7, specification V4): chat, image generation and
 * editing, video generation, embeddings, speech, and transcription via the
 * deAPI OpenAI-compatible endpoint. Auth is lazy: importing this module never reads
 * `DEAPI_API_KEY`.
 */
export { createDeAPI, deapi, listDeAPIModels } from './deapi-provider';
export type { DeAPIProvider } from './deapi-provider';
export type { DeAPIChatModelId, DeAPIChatOptions } from './chat/deapi-chat';
export type {
  DeAPIListModelsOptions,
  DeAPIModelInfo,
  DeAPIModelPricing,
  DeAPIModelType,
} from './models/deapi-models';

export type {
  DeAPIEmbeddingModelId,
  DeAPIImageModelId,
  DeAPIProviderSettings,
  DeAPISpeechModelId,
  DeAPITranscriptionModelId,
  DeAPIVideoModelId,
} from './deapi-config';
