# Changelog

All notable changes to `@deapi/ai-sdk-provider` are documented here. The project
follows [semantic versioning](https://semver.org/) (while in `0.x`, a minor
version may contain breaking changes).

## 0.4.0

### Added

- **Chat.** `deapi(modelId)`, `deapi.languageModel(modelId)` and
  `deapi.chatModel(modelId)` return chat models for `generateText` and
  `streamText` on deAPI's `/chat/completions`: 13 open models
  (`deepseek-v4.1-flash`, `qwen3.8-flash`, `kimi-k3`, `glm-5.3`,
  `seed-2.1-turbo` and more) with tools, structured output and reasoning.
  Until now `languageModel` threw `NoSuchModelError`.
- **Cost of every chat call** as `providerMetadata.deapi.cost` (USD, the amount
  deAPI charged), also when streaming: streams always ask for the final usage
  chunk.
- **Reasoning effort** from the AI SDK `reasoning` option or
  `providerOptions.deapi.reasoningEffort`, sent as `reasoning_effort`;
  reasoning text comes back as `reasoningText`.
- Structured output on `glm-5.3`, which rejects `json_schema`: the provider
  asks for `json_object` and puts the schema in a system message (also for
  `:` variants of the id).
- `DeAPIChatOptions` type for `providerOptions.deapi` (`reasoningEffort`,
  `user`, `textVerbosity`, `strictJsonSchema`).
- **Model listing.** `deapi.listModels({ type })` and `listDeAPIModels()`
  return the models a key can call from `GET /models`: chat models by default,
  with context window, output limit, input modalities, supported parameters
  and prices in USD per token. A malformed entry is skipped instead of failing
  the whole list, and an unreadable price drops only the prices.
- `examples/smoke.mjs` checks chat (`generateText` and `streamText` with cost).

## 0.3.1

### Documentation

- The README links to the API key page (https://app.deapi.ai/settings/api-keys)
  and uses `Ltx2_5_22B_Dist_INT8` in the video example.

## 0.3.0

### Breaking changes

- **AI SDK 7.** The provider now implements the V4 provider specification
  (`ProviderV4`, `ImageModelV4`, `EmbeddingModelV4`, `SpeechModelV4`,
  `TranscriptionModelV4`). The peer dependency is `ai` `^7.0.0`; AI SDK 6
  users should stay on `0.2.x`.
- **Node.js 22 or newer**, matching AI SDK 7.
- Dependencies: `@ai-sdk/provider` 4, `@ai-sdk/provider-utils` 5,
  `@ai-sdk/openai-compatible` 3.
- Passing input images (`files`) to an image model no longer throws: it is now
  image editing (see below). Only a `mask` (inpainting) is rejected with
  `UnsupportedFunctionalityError`.

### Added

- **Video generation**: `deapi.video(id)` / `deapi.videoModel(id)` return a
  `VideoModelV4` for `experimental_generateVideo`. It uses the asynchronous
  start/status flow over `POST /videos`, `GET /videos/{id}` and
  `GET /videos/{id}/content`: `duration` maps to `seconds`, `resolution` to
  `size`, and the first-frame image (`prompt.image` or a `first_frame` frame
  image) to `input_reference`. Unsupported options produce warnings.
- **Image editing**: input images in `generateImage({ prompt: { images, text } })`
  are sent to `POST /images/edits` (multipart).
- **Transcription timestamps**: `timestampGranularities` requests
  `verbose_json` and maps segments, word timings, the detected language
  (as ISO-639-1) and the duration. `providerOptions.deapi.response_format`
  accepts `verbose_json`.
- Model ID autocompletion for the current image, speech, transcription and
  video models (any other slug is still accepted).
- `embedMany` splits inputs at 100 values per request (the endpoint limit).

### Changed

- Images are requested as `b64_json` by default, so the bytes arrive in the
  generation response. `providerOptions.deapi.response_format` overrides it.
- The API key and custom `headers` are only attached to requests for the
  configured `baseURL` origin. Other requests that go through the provider's
  fetch (for example downloading an input image URL or a result URL) are sent
  without them.
- Per-call `headers` now also reach transcription requests.
- Documentation uses the current key format `sk-dp-<id>-<secret>`. Keys are
  passed through unchanged, so keys in older formats keep working.
- The default transcription example model is `WhisperLargeV3Ct2`.
- `generateSpeech` and `transcribe` examples use the stable AI SDK 7 names.
- The live smoke test (`examples/smoke.mjs`) covers video and keeps every
  billed call as small as the API allows.

## 0.2.0

- Added speech (`SpeechModelV3`) and transcription (`TranscriptionModelV3`)
  models.

## 0.1.0

- Initial release: image generation and embeddings over the deAPI
  OpenAI-compatible endpoint, with lazy authentication.
