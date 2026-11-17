/**
 * @deapi/ai-sdk-provider — public barrel.
 *
 * 0.3.0 surface (AI SDK 7, specification V4): image generation and editing,
 * video generation, embeddings, speech, and transcription via the deAPI
 * OpenAI-compatible endpoint. Auth is lazy: importing this module never reads
 * `DEAPI_API_KEY`.
 */
export { createDeAPI, deapi } from './deapi-provider';
export type { DeAPIProvider } from './deapi-provider';

export type {
  DeAPIEmbeddingModelId,
  DeAPIImageModelId,
  DeAPIProviderSettings,
  DeAPISpeechModelId,
  DeAPITranscriptionModelId,
  DeAPIVideoModelId,
} from './deapi-config';
