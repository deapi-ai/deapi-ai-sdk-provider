# @deapi/ai-sdk-provider

OpenAI-compatible inference for open-source models — a community [Vercel AI SDK](https://ai-sdk.dev) provider for [deAPI](https://deapi.ai). This `0.1.0` release covers **image generation** and **embeddings**.

[![npm version](https://img.shields.io/npm/v/@deapi/ai-sdk-provider.svg)](https://www.npmjs.com/package/@deapi/ai-sdk-provider)
[![license](https://img.shields.io/npm/l/@deapi/ai-sdk-provider.svg)](./LICENSE)

## Installation

```bash
# pnpm
pnpm add @deapi/ai-sdk-provider ai

# npm
npm install @deapi/ai-sdk-provider ai

# yarn
yarn add @deapi/ai-sdk-provider ai

# bun
bun add @deapi/ai-sdk-provider ai
```

`ai` (the Vercel AI SDK) is a peer dependency — install it alongside this package. Supported range: `ai` `>=6 <7`.

## Authentication

Set your deAPI API key (keys start with the `dpn-sk-` prefix) in the `DEAPI_API_KEY` environment variable:

```bash
export DEAPI_API_KEY="dpn-sk-..."
```

Or pass it explicitly when creating the provider (see below). An explicit `apiKey` takes precedence over the environment variable.

Authentication is **lazy**: importing the package or calling `createDeAPI()` never reads the key. The key is resolved per request, so a missing key only throws when you actually invoke a model — not at import or construction time.

## Provider instance

Use the default, environment-configured instance:

```ts
import { deapi } from '@deapi/ai-sdk-provider';
```

Or build a custom instance with `createDeAPI`:

```ts
import { createDeAPI } from '@deapi/ai-sdk-provider';

const deapi = createDeAPI({
  apiKey: process.env.DEAPI_API_KEY, // optional; falls back to DEAPI_API_KEY
  baseURL: 'https://oai.deapi.ai/v1', // optional; this is the default
});
```

`createDeAPI(settings?)` accepts `apiKey`, `baseURL`, `headers` (extra headers merged into every request), and `fetch` (a custom fetch implementation).

## Image generation

Use the stable `generateImage` from `ai`:

```ts
import { generateImage } from 'ai';
import { deapi } from '@deapi/ai-sdk-provider';

const { image } = await generateImage({
  model: deapi.image('Flux1schnell'),
  prompt: 'a single red apple on a white table, studio light',
  size: '512x512',
});

// `image.uint8Array` holds the decoded image bytes; `image.base64` the base64 string.
console.log(image.uint8Array.length);
```

deAPI returns images as `b64_json`, which the AI SDK decodes to a `Uint8Array` for you.

## Embeddings

Use `embed` from `ai`:

```ts
import { embed } from 'ai';
import { deapi } from '@deapi/ai-sdk-provider';

const { embedding } = await embed({
  model: deapi.embedding('Bge_M3_FP16'),
  value: 'sunny day at the beach',
});

console.log(embedding.length); // 1024
```

`Bge_M3_FP16` produces 1024-dimensional vectors.

## Model IDs

Model identifiers are plain slug strings passed through to deAPI. New deAPI models work **without a package update** — the id type stays open (`string & {}`), so any current slug is accepted.

Do not hardcode model lists in your application logic. Discover the available models live via the OpenAI-compatible models endpoint:

```bash
curl https://oai.deapi.ai/v1/models \
  -H "Authorization: Bearer $DEAPI_API_KEY"
```

The slugs shown in this README — `Flux1schnell`, `ZImageTurbo_INT8` (image), and `Bge_M3_FP16` (embeddings) — are illustrative examples only, not an exhaustive or guaranteed list. Always check `/v1/models` for what is currently offered.

## Limitations

This release is deliberately scoped. Be aware that:

- **No language / chat / completion models.** deAPI is a non-LLM inference surface. `deapi.languageModel(...)` (and therefore chat/completion usage) throws `NoSuchModelError`.
- **No tool-calling or structured output.** These depend on language models, which are not provided.
- **No speech or transcription in `0.1.0`.** These modalities are planned for `0.2.0` and are not available yet — do not rely on them from this package.
- **Video is not exposed through the AI SDK.** deAPI video generation is available only via the deAPI native REST API; the AI SDK provider interface (`ProviderV3`) has no video model, so there is no AI SDK surface for it here.

## Using `@ai-sdk/openai-compatible` directly

deAPI exposes a standard OpenAI-compatible surface, so you can also skip this package and use [`@ai-sdk/openai-compatible`](https://www.npmjs.com/package/@ai-sdk/openai-compatible) directly:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const deapi = createOpenAICompatible({
  name: 'deapi',
  baseURL: 'https://oai.deapi.ai/v1',
  apiKey: process.env.DEAPI_API_KEY,
});
```

This package adds deAPI-specific defaults, lazy auth, base-URL validation, and deAPI error mapping on top of that surface.

## Base URL

`baseURL` must point at the **OpenAI-compatible** endpoint (`https://oai.deapi.ai/v1`, the default). It is validated at construction:

- It must be an absolute `https` URL (`http` is allowed only for loopback hosts such as `localhost`).
- It must not contain embedded credentials.
- The deAPI **native** surface (`/api/v2`) is async/job-based and is **rejected** — it is not OpenAI-compatible and cannot be used as the provider's base URL.

## Security

Errors thrown by this provider are AI SDK `APICallError` instances. These carry `responseBody` and `requestBodyValues` (which includes your prompt / input). Do **not** blindly log full error objects in production — they may contain user input. The Bearer API key is never included in error objects or logs.

## Compatibility

- Vercel AI SDK: `ai` `>=6 <7`.
- New deAPI models are picked up automatically — model IDs are passed through as strings, so no package update is required when deAPI adds a model.

## Disclaimer

This is a community-maintained provider. It is not an official product of, nor affiliated with or endorsed by, Vercel or OpenAI. "deAPI" and other names are the property of their respective owners.

## Links

- GitHub: https://github.com/deapi-ai/deapi-ai-sdk-provider
- deAPI docs: https://docs.deapi.ai
- deAPI OpenAI-compatibility reference: https://docs.deapi.ai/openai-compatibility
- deAPI dashboard: https://deapi.ai

## License

[MIT](./LICENSE)
