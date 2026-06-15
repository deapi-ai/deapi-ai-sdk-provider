/**
 * @ai-sdk/deapi-provider — public barrel.
 *
 * 0.2.0 surface: image generation, embeddings, speech, and transcription via the
 * deAPI OpenAI-compatible endpoint. Auth is lazy: importing this module never
 * reads `DEAPI_API_KEY`.
 */
export { createDeAPI, deapi } from './deapi-provider';
export type { DeAPIProvider } from './deapi-provider';

export type {
  DeAPIEmbeddingModelId,
  DeAPIImageModelId,
  DeAPIProviderSettings,
  DeAPISpeechModelId,
  DeAPITranscriptionModelId,
} from './deapi-config';
