# Support

Thanks for using `@deapi/ai-sdk-provider`. This document explains where to get help and
what to expect.

## Where to Ask

- **Bugs and feature requests for this package:**
  [open a GitHub issue](https://github.com/deapi-ai/deapi-ai-sdk-provider/issues) using the
  appropriate template.
- **Questions about the deAPI platform, models, billing, or quotas:**
  see the [deAPI documentation](https://docs.deapi.ai)
  <!-- PLACEHOLDER: confirm the canonical deAPI docs URL before publish. -->
  or ask in the [deAPI Discord](https://discord.gg/deapi).
  <!-- PLACEHOLDER: replace with the real deAPI Discord invite link before publish. -->
- **Security vulnerabilities:** do **not** use the channels above. Follow
  [SECURITY.md](./SECURITY.md) instead.

Before opening an issue, please search existing issues to avoid duplicates.

## In Scope

This repository supports the `@deapi/ai-sdk-provider` package itself:

- Provider setup: `createDeAPI()`, the default `deapi` instance, configuration, and auth.
- **Image generation** (`deapi.image(...)` with `generateImage` from `ai`).
- **Embeddings** (`deapi.embedding(...)` with `embed` from `ai`).
- Error handling, types, and packaging (ESM/CJS, type defs).

## Out of Scope

- **Speech and transcription.** Not part of the `0.1.x` release line; planned for `0.2.0`.
- **Video.** deAPI video is a native REST capability and has no AI SDK interface in this
  provider.
- **LLM / chat / completion / tool-calling / structured output.** deAPI is a non-LLM
  provider; `languageModel()` intentionally throws `NoSuchModelError`.
- The deAPI service, its models, account, billing, or quota issues — these belong to the
  [deAPI documentation](https://docs.deapi.ai) and [Discord](https://discord.gg/deapi).
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
