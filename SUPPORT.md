# Support

Thanks for using `@deapi/ai-sdk-provider`. This document explains where to get help and
what to expect.

## Where to Ask

- **Bugs and feature requests for this package:**
  [open a GitHub issue](https://github.com/deapi-ai/deapi-ai-sdk-provider/issues) using the
  appropriate template.
- **Questions about the deAPI platform, models, billing, or quotas:**
  see the [deAPI documentation](https://docs.deapi.ai)
  or ask in the [deAPI Discord](https://discord.com/invite/UFfK5YRBsr).
- **Security vulnerabilities:** do **not** use the channels above. Follow
  [SECURITY.md](./SECURITY.md) instead.

Before opening an issue, please search existing issues to avoid duplicates.

## In Scope

This repository supports the `@deapi/ai-sdk-provider` package itself:

- Provider setup: `createDeAPI()`, the default `deapi` instance, configuration, and auth.
- **Image generation and editing** (`deapi.image(...)` with `generateImage` from `ai`).
- **Video generation** (`deapi.video(...)` with `experimental_generateVideo` from `ai`).
- **Embeddings** (`deapi.embedding(...)` with `embed` from `ai`).
- **Speech / text-to-speech** (`deapi.speech(...)` with `generateSpeech` from `ai`).
- **Transcription / speech-to-text** (`deapi.transcription(...)` with `transcribe` from `ai`).
- Error handling, types, and packaging (ESM/CJS, type defs).

## Out of Scope

- **Inpainting (masks).** deAPI has no inpainting model; passing a `mask` throws
  `UnsupportedFunctionalityError`. Instruction-based editing with input images is supported.
- **LLM / chat / completion / tool-calling / structured output.** Not provided by
  this package; `languageModel()` intentionally throws `NoSuchModelError`.
- The deAPI service, its models, account, billing, or quota issues — these belong to the
  [deAPI documentation](https://docs.deapi.ai) and [Discord](https://discord.com/invite/UFfK5YRBsr).
- General Vercel AI SDK usage unrelated to this provider — see the
  [AI SDK docs](https://ai-sdk.dev).

## Response Expectations

This is an open-source project. Response times are targets, not guarantees.

| Type                            | Target                |
| ------------------------------- | --------------------- |
| Security (P0) triage            | 1 business day (see [SECURITY.md](./SECURITY.md)) |
| Regression (P1) triage          | 2 business days       |
| Other bugs, features, questions | Best effort           |

Well-scoped reports with a minimal reproduction are triaged fastest.
