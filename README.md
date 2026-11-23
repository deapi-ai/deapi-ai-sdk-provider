# @deapi/ai-sdk-provider

OpenAI-compatible inference for open-source models — a community [Vercel AI SDK](https://ai-sdk.dev) provider for [deAPI](https://deapi.ai). Version `0.4.0` targets **AI SDK 7** (specification V4) and covers **chat** (13 open models, with streaming, tools, structured output, reasoning and the cost of every call), **image generation and editing**, **video generation**, **embeddings**, **speech** (text-to-speech), and **transcription** (speech-to-text).

[![npm version](https://img.shields.io/npm/v/@deapi/ai-sdk-provider.svg)](https://www.npmjs.com/package/@deapi/ai-sdk-provider)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

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

`ai` (the Vercel AI SDK) is a peer dependency — install it alongside this package. Supported range: `ai` `^7.0.0` (Node.js 22 or newer, like AI SDK 7 itself). For AI SDK 6 use `@deapi/ai-sdk-provider@0.2`.

## Authentication

Create an API key in the [deAPI dashboard](https://app.deapi.ai/settings/api-keys). Keys look like `sk-dp-<id>-<secret>`. Set it in the `DEAPI_API_KEY` environment variable:

```bash
export DEAPI_API_KEY="sk-dp-..."
```

Or pass it explicitly when creating the provider (see below). An explicit `apiKey` takes precedence over the environment variable. The key is sent unchanged as a `Bearer` token; keys issued in older formats keep working.

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

`createDeAPI(settings?)` accepts `apiKey`, `baseURL`, `headers` (extra headers merged into every request to deAPI), and `fetch` (a custom fetch implementation).

> Do **not** pass an `Authorization` header in `settings.headers`. The provider manages
> authentication itself (it sets the `Bearer` token from `apiKey` / `DEAPI_API_KEY`). An
> `Authorization` header in `settings.headers` is rejected so it cannot silently override the
> real key.

### Canonical API

The provider exposes both canonical methods and short aliases — all are public and supported:

| Canonical | Alias | Returns | Use with (`ai`) |
|---|---|---|---|
| `deapi.languageModel(id)` | `deapi(id)`, `deapi.chatModel(id)` | chat model | `generateText`, `streamText` |
| `deapi.imageModel(id)` | `deapi.image(id)` | image model | `generateImage` |
| `deapi.videoModel(id)` | `deapi.video(id)` | video model | `experimental_generateVideo` |
| `deapi.embeddingModel(id)` | `deapi.embedding(id)` | embedding model | `embed`, `embedMany` |
| `deapi.speechModel(id)` | `deapi.speech(id)` | speech model | `generateSpeech` |
| `deapi.transcriptionModel(id)` | `deapi.transcription(id)` | transcription model | `transcribe` |

The examples below use the short aliases.

## Chat

```ts
import { generateText } from 'ai';
import { deapi } from '@deapi/ai-sdk-provider';

const { text, providerMetadata } = await generateText({
  model: deapi('deepseek-v4.1-flash'),
  prompt: 'Write a haiku about open-source models.',
});

console.log(text);
console.log(providerMetadata?.deapi?.cost); // USD charged for this call, e.g. 0.00000473
```

Chat models: `deepseek-v4.1-flash`, `deepseek-v4.1-flash:economy`, `glm-5.3`, `glm-5.3-flash`, `gpt-6-luna`, `hy3`, `kimi-k3`, `qwen3.8-flash`, `qwen3.8-max`, `seed-2.0-lite`, `seed-2.0-mini`, `seed-2.0-pro`, `seed-2.1-turbo`. Limits, prices and supported parameters per model are in [deAPI's chat reference](https://docs.deapi.ai/openai-compatibility#chat-completions-llms) and in [`listModels()`](#listing-models).

### Cost of every call

deAPI reports what it charged for each call, in USD, and the provider returns it as `providerMetadata.deapi.cost`, for `generateText` and `streamText` alike. When streaming, the provider always asks for the final usage chunk (`stream_options.include_usage`), which carries the amount:

```ts
import { streamText } from 'ai';

const result = streamText({
  model: deapi('qwen3.8-flash'),
  prompt: 'Explain vector embeddings in two sentences.',
});

for await (const delta of result.textStream) process.stdout.write(delta);
console.log((await result.providerMetadata)?.deapi?.cost);
```

### Tools and structured output

```ts
import { generateText, Output, tool } from 'ai';
import { z } from 'zod';

const { toolCalls } = await generateText({
  model: deapi('deepseek-v4.1-flash'),
  prompt: 'What is the weather in Warsaw?',
  tools: {
    weather: tool({
      description: 'Current weather for a city',
      inputSchema: z.object({ city: z.string() }),
    }),
  },
});

const { output } = await generateText({
  model: deapi('deepseek-v4.1-flash'),
  prompt: 'A train leaves at 09:47 and arrives at 13:15. How long is the trip?',
  output: Output.object({ schema: z.object({ minutes: z.number() }) }),
});
// output: { minutes: 208 }
```

Structured output uses `response_format: json_schema`. `glm-5.3` does not accept it, so for that model the provider asks for `json_object` and adds the schema to the prompt as a system message.

### Reasoning

Most chat models think before they answer. Set the effort with the AI SDK `reasoning` option, or with `providerOptions.deapi.reasoningEffort`; both are sent as `reasoning_effort`:

```ts
const { text, reasoningText } = await generateText({
  model: deapi('qwen3.8-flash'),
  prompt: 'How many minutes from 09:47 to 13:15?',
  reasoning: 'low', // none, minimal, low, medium, high, xhigh, max
});
```

The same through provider options, typed with `DeAPIChatOptions`:

```ts
import type { DeAPIChatOptions } from '@deapi/ai-sdk-provider';

const result = await generateText({
  model: deapi('glm-5.3'),
  prompt: 'How many minutes from 09:47 to 13:15?',
  providerOptions: {
    deapi: { reasoningEffort: 'high' } satisfies DeAPIChatOptions,
  },
});
```

The reasoning comes back as `reasoningText` (and as reasoning parts in `streamText`), and reasoning tokens count as output and are billed. Models differ in the levels they accept: `glm-5.3` takes only `low`, `high` and `max` and cannot turn thinking off, and `gpt-6-luna` has no `minimal`. An unsupported level is rejected with a 400 that lists the accepted values. With reasoning on, leave room in `maxOutputTokens`: a low limit can end the answer before any text arrives.

## Listing models

`deapi.listModels()` calls `GET /models` with your key and returns the chat models it can use, typed. `listDeAPIModels({ apiKey })` does the same without a provider instance. Pass `{ type: 'media' }` or `{ type: 'all' }` for the image, video, audio and embedding models.

```ts
import { deapi } from '@deapi/ai-sdk-provider';

const models = await deapi.listModels();

// A model picker: id, context window and price per million tokens.
const options = models.map((m) => ({
  value: m.id,
  label: `${m.id} (${(m.contextLength ?? 0) / 1000}k context, $${((m.pricing?.prompt ?? 0) * 1e6).toFixed(3)} / $${((m.pricing?.completion ?? 0) * 1e6).toFixed(3)} per 1M tokens)`,
  vision: m.inputModalities?.includes('image') ?? false,
}));
```

Each chat model has `contextLength`, `maxOutputTokens`, `inputModalities`, `supportedParameters` and `pricing`. Prices are numbers in **USD per token** (`prompt`, `completion`, and `inputCacheRead` / `inputCacheWrite` where the model bills them separately); multiply by 1,000,000 for the price per million tokens. The list and the prices depend on the key: they are what that account can call and pays.

## Image generation

```ts
import { generateImage } from 'ai';
import { deapi } from '@deapi/ai-sdk-provider';

const { image } = await generateImage({
  model: deapi.image('Flux1schnell'),
  prompt: 'a single red apple on a white table, studio light',
  size: '512x512',
});

// `image.uint8Array` holds the decoded PNG bytes; `image.base64` the base64 string.
console.log(image.uint8Array.length);
```

Each model accepts its own list of sizes (for example `Flux1schnell`: `512x512` to `1536x1024`) and a maximum `n`. The provider requests `b64_json` so the image arrives in the same response; deAPI-specific fields such as `quality` (`low`, `medium`, `high`, …) can be passed through `providerOptions.deapi`:

```ts
const { image } = await generateImage({
  model: deapi.image('Flux1schnell'),
  prompt: 'an isometric city block at golden hour',
  size: '1024x1024',
  providerOptions: { deapi: { quality: 'high' } },
});
```

`aspectRatio` and `seed` are not supported by this endpoint and produce warnings.

## Image editing

Pass input images in the prompt to edit them. The request goes to deAPI's `/images/edits` endpoint with instruction-following edit models (`QwenImageEdit_Plus_NF4` takes one image, `Flux_2_Klein_4B_BF16` up to three; 10 MB per image):

```ts
import { generateImage } from 'ai';
import { readFile } from 'node:fs/promises';
import { deapi } from '@deapi/ai-sdk-provider';

const { image } = await generateImage({
  model: deapi.image('QwenImageEdit_Plus_NF4'),
  prompt: {
    images: [await readFile('./source.png')],
    text: 'make the sky stormy',
  },
});
```

Input images can also be URLs; the provider downloads them without sending your deAPI key to that host. Inpainting is not available: passing a `mask` throws `UnsupportedFunctionalityError`.

## Video generation

Video generation is asynchronous. The model implements the AI SDK start/status flow: `experimental_generateVideo` creates the job (`POST /videos`), polls its status (`GET /videos/{id}`) and downloads the finished file (`GET /videos/{id}/content`):

```ts
import { experimental_generateVideo as generateVideo } from 'ai';
import { writeFile } from 'node:fs/promises';
import { deapi } from '@deapi/ai-sdk-provider';

const { video } = await generateVideo({
  model: deapi.video('Ltx2_5_22B_Dist_INT8'),
  prompt: 'a paper boat drifting down a rain-soaked street',
  duration: 5,
  resolution: '768x768',
  poll: { intervalMs: 5_000, timeoutMs: 600_000 }, // optional; these are the defaults
});

await writeFile('./clip.mp4', video.uint8Array);
```

For image-to-video pass the first frame in the prompt (bytes or a public URL):

```ts
const { video } = await generateVideo({
  model: deapi.video('Ltxv_13B_0_9_8_Distilled_FP8'),
  prompt: { image: await readFile('./first-frame.png'), text: 'the camera pushes in slowly' },
  duration: 3,
  resolution: '512x512',
});
```

| Model | Durations (s) | Resolutions | fps |
|---|---|---|---|
| `Ltxv_13B_0_9_8_Distilled_FP8` | 1, 2, 3, 4 | `512x512`, `512x768`, `768x512`, `768x768` | 30 |
| `Ltx2_5_22B_Dist_INT8` | 3, 4, 5, 6, 8, 10 | `768x768`, `1344x768`, `768x1344`, `1024x768`, `768x1024` | 24 |
| `Ltx2_3_22B_Dist_INT8` | 3, 4, 5, 6, 8, 10 | `768x768`, `768x1024`, `1024x768`, `1024x1024` | 24 |
| `MiniMaxH3_33B_Turbo_INT8` | 8 | `1344x768`, `768x1344`, `1024x768`, `768x1024`, `768x768` | 24 |

All four accept a first-frame image. `duration` maps to `seconds` and `resolution` to `size`; omitted values use the model's defaults, and each model rejects values outside its own list. A prompt is required, also for image-to-video. `aspectRatio`, `fps`, `seed`, `generateAudio`, `inputReferences`, and last-frame images have no counterpart and produce warnings. Each call renders one video (`n > 1` is split into separate jobs by the AI SDK). The start request carries the AI SDK's `Idempotency-Key`, so a retried start does not create a second job. deAPI sends no completion webhooks on this endpoint, so the AI SDK polls.

## Embeddings

```ts
import { embed } from 'ai';
import { deapi } from '@deapi/ai-sdk-provider';

const { embedding } = await embed({
  model: deapi.embedding('Bge_M3_FP16'),
  value: 'sunny day at the beach',
});

console.log(embedding.length); // 1024
```

`Bge_M3_FP16` returns 1024-dimensional vectors; the `dimensions` option does not resize them. `embedMany` sends at most 100 values per request (the endpoint's limit) and splits larger inputs automatically.

## Speech (text-to-speech)

```ts
import { generateSpeech } from 'ai';
import { deapi } from '@deapi/ai-sdk-provider';

const { audio } = await generateSpeech({
  model: deapi.speech('Kokoro'),
  text: 'Hello from deAPI.',
  voice: 'af_nova', // optional; defaults to 'alloy' (mapped to a Kokoro voice)
});

// `audio.uint8Array` holds the mp3 bytes.
console.log(audio.uint8Array.length);
```

Output is `mp3`. `voice`, `speed`, `language`, and `instructions` are forwarded and validated per model (for example, `instructions` only on `Qwen3_TTS_12Hz_1_7B_VoiceDesign`, `speed` only on `Kokoro`). The same options can also be supplied via `providerOptions.deapi`.

## Transcription (speech-to-text)

```ts
import { transcribe } from 'ai';
import { readFile } from 'node:fs/promises';
import { deapi } from '@deapi/ai-sdk-provider';

const { text } = await transcribe({
  model: deapi.transcription('WhisperLargeV3Ct2'),
  audio: await readFile('./speech.mp3'),
});

console.log(text);
```

The audio is uploaded as multipart `file` form data. A single audio file must be **20 MB or smaller** — a larger file is rejected with a clear error before any request is made.

Request timestamps to get segments (and word timings), the detected language, and the duration:

```ts
const result = await transcribe({
  model: deapi.transcription('WhisperLargeV3Ct2'),
  audio: await readFile('./speech.mp3'),
  timestampGranularities: ['segment', 'word'],
  providerOptions: { deapi: { language: 'en' } }, // optional hint
});

console.log(result.segments, result.words, result.language, result.durationInSeconds);
```

With `timestampGranularities` the provider asks for `response_format: 'verbose_json'`; without it, the plain `json` response returns text only.

## Model IDs

Model identifiers are plain slug strings passed through to deAPI. New deAPI models work **without a package update** — the id types stay open (`string & {}`), so any current slug is accepted while common ones get editor autocompletion.

The catalog depends on your account. List the models available to your key with the OpenAI-compatible models endpoint:

```bash
curl https://oai.deapi.ai/v1/models \
  -H "Authorization: Bearer $DEAPI_API_KEY"
```

The slugs in this README (`Flux1schnell`, `Flux_2_Klein_4B_BF16`, `ZImageTurbo_INT8`, `QwenImageEdit_Plus_NF4`, `Ltx2_5_22B_Dist_INT8`, `Ltxv_13B_0_9_8_Distilled_FP8`, `Bge_M3_FP16`, `Kokoro`, `WhisperLargeV3Ct2`, …) are examples, not an exhaustive or guaranteed list. See the [deAPI OpenAI-compatibility reference](https://docs.deapi.ai/openai-compatibility) for per-model limits.

## Limitations

- **Chat:** no text completions (`/completions`) and no Responses API; `glm-5.3` gets structured output through `json_object` and a schema in the prompt (see above). Seed models return an encrypted reasoning state (`reasoning_details`) that this provider does not send back on the next turn; multi-turn conversations work, without that continuity.
- **No inpainting.** Image editing takes input images and an instruction; a `mask` throws `UnsupportedFunctionalityError`.
- **No streaming outside chat.** Image, video, audio and embedding calls return one complete result.
- **Video:** one first-frame image at most; no last-frame, reference, audio, fps, or seed controls (see above).

## Using `@ai-sdk/openai-compatible` directly

deAPI exposes a standard OpenAI-compatible surface, so for images and embeddings you can also use [`@ai-sdk/openai-compatible`](https://www.npmjs.com/package/@ai-sdk/openai-compatible) directly:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const deapi = createOpenAICompatible({
  name: 'deapi',
  baseURL: 'https://oai.deapi.ai/v1',
  apiKey: process.env.DEAPI_API_KEY,
});
```

This package adds the cost of every chat call in `providerMetadata`, model listing, video, speech, and transcription models, deAPI-specific defaults, lazy auth, base-URL validation, and deAPI error mapping on top of that surface.

## Base URL

`baseURL` must point at the **OpenAI-compatible** endpoint (`https://oai.deapi.ai/v1`, the default). It is validated at construction:

- It must be an absolute `https` URL (`http` is allowed only for loopback hosts such as `localhost`).
- It must not contain embedded credentials, a query string, or a fragment.
- The deAPI **native** surface (`/api/v2`) is **rejected** — it is not OpenAI-compatible and cannot be used as the provider's base URL.

## Security

Errors thrown by this provider are AI SDK `APICallError` instances. These carry `responseBody` and `requestBodyValues` (which includes your prompt / input). Do **not** blindly log full error objects in production — they may contain user input. The Bearer API key is never included in error objects or logs.

**The key only goes to deAPI.** The `Authorization` header and your custom `headers` are added only to requests for the origin of the configured `baseURL`. Other requests made through the provider (for example downloading an input image URL) are sent without them.

**No automatic redirect following.** Requests to deAPI use `redirect: 'manual'`, so the provider does **not** auto-follow HTTP redirects (3xx). This prevents your `Bearer` API key from being silently replayed to a different origin via a redirect. A redirect response surfaces as an error rather than being followed.

**Auth is provider-managed.** Do not set an `Authorization` header via `settings.headers` — the provider derives the `Bearer` token from `apiKey` / `DEAPI_API_KEY` and rejects an `Authorization` header passed in `settings.headers` to prevent it from overriding the real key.

## Compatibility

- Vercel AI SDK: `ai` `^7.0.0` (provider specification V4). AI SDK 6 users: `@deapi/ai-sdk-provider@0.2`.
- Node.js 22 or newer. The package ships ESM and CommonJS builds; the CommonJS build loads the ESM-only AI SDK 7 packages through Node's `require(esm)` support.
- New deAPI models are picked up automatically — model IDs are passed through as strings.

## Live smoke test

`examples/smoke.mjs` makes real, billed calls with the smallest settings the API accepts (two 16-token chat replies, one 512×512 image, one short sentence of speech and its transcription, one embedding, one 1-second video):

```bash
npm ci && npm run build
DEAPI_API_KEY=sk-dp-... node examples/smoke.mjs   # DEAPI_SMOKE_SKIP_VIDEO=1 skips the video
```

## Disclaimer

This is a community-maintained provider. It is not an official product of, nor affiliated with or endorsed by, Vercel or OpenAI. "deAPI" and other names are the property of their respective owners.

## Links

- GitHub: https://github.com/deapi-ai/deapi-ai-sdk-provider
- deAPI docs: https://docs.deapi.ai
- deAPI OpenAI-compatibility reference: https://docs.deapi.ai/openai-compatibility
- deAPI dashboard: https://deapi.ai

## License

[MIT](./LICENSE)
