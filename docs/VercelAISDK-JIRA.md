> ⚠️ **SUPERSEDED (2026-06-12)** — ticket historyczny (V4, 80 MB, baseURL native v2). Aktualne źródło prawdy: **`PLAN_WDROZENIA.md`**.

# [TASK] Dodanie deAPI jako community provider w Vercel AI SDK

**Typ:** Story | **Priorytet:** High | **Story Points:** 8 | **Estymacja:** 3–5 dni

---

## Opis

Zbudować, opublikować i zalistować pakiet `@deapi/ai-sdk-provider` jako community provider w Vercel AI SDK. Pakiet integruje deAPI (image generation, embeddings, TTS, transcription) z ekosystemem AI SDK.

Zadanie ma dwa etapy:
1. **Stage 1 (engineering):** Zbuduj i opublikuj pakiet npm `@deapi/ai-sdk-provider`
2. **Stage 2 (docs):** PR do `vercel/ai` dodający stronę community provider w dokumentacji

Stage 2 nie może wystartować bez Stage 1 — docs PR wymaga działającego pakietu na npm.

## Kontekst

- **Repo AI SDK:** https://github.com/vercel/ai
- **Docs:** https://ai-sdk.dev/providers/community-providers/custom-providers
- **Base URL deAPI:** `https://oai.deapi.ai/v1` (OpenAI-compatible)
- **Auth:** `Authorization: Bearer dpn-sk-...`, env var `DEAPI_API_KEY`
- **Wzorcowe community providers:** ElevenLabs (speech/transcription), Black Forest Labs (image), KlingAI (video), Soniox (transcription-only) — wszystkie non-chat, najbliższy fit do deAPI
- **Interfejsy AI SDK:** Baseline to **V4** (`ProviderV4`, `ImageModelV4`, `EmbeddingModelV4`, `SpeechModelV4`, `TranscriptionModelV4`) — stan na 2026-06. W V4 metoda embeddingów na providerze nazywa się `embeddingModel` (w starszych V2/V3 było `textEmbeddingModel`). **Zawsze instaluj najnowszą stabilną wersję `@ai-sdk/*` i zweryfikuj aktualne nazwy/sygnatury interfejsów w kodzie `@ai-sdk/provider` przed implementacją** — docs bywają opóźnione względem kodu.

### Strategia implementacji

| Modalność deAPI | Bazowa klasa | Implementacja |
|---|---|---|
| Image generation | `OpenAICompatibleImageModel` z `@ai-sdk/openai-compatible` | Wrap/extend — deAPI używa standardowego `/v1/images/generations` |
| Embeddings | `OpenAICompatibleEmbeddingModel` z `@ai-sdk/openai-compatible` | Wrap/extend — standardowy `/v1/embeddings` |
| TTS (speech) | Brak w `openai-compatible` | Custom class implementująca `SpeechModelV4` z `@ai-sdk/provider` |
| Transcription | Brak w `openai-compatible` | Custom class implementująca `TranscriptionModelV4` z `@ai-sdk/provider` |
| Chat/LLM | N/A | `languageModel()` jest wymagany w `ProviderV4` — implementuj tak, by rzucał `NoSuchModelError` |
| Video | Nie | Brak first-class interface w AI SDK — `ProviderV4` nie ma metody `videoModel` ani typu `VideoModelV4`. Udokumentuj video jako dostępne przez native REST API, **nie** implementuj adaptera |

---

## Stage 1 — Zbuduj i opublikuj pakiet npm

### 1.1 — Zescafolduj projekt

```bash
mkdir deapi-ai-sdk-provider && cd deapi-ai-sdk-provider
npm init -y
npm install @ai-sdk/provider @ai-sdk/provider-utils @ai-sdk/openai-compatible zod
npm install -D typescript tsup vitest @types/node
```

### 1.2 — Struktura pakietu

```
src/
├── index.ts                         # barrel exports
├── deapi-provider.ts                # createDeAPI() factory + default `deapi` instance
├── deapi-config.ts                  # shared config types (DeAPIProviderSettings)
├── deapi-error.ts                   # error handling
├── image/
│   └── deapi-image-model.ts         # wrap OpenAICompatibleImageModel
├── embedding/
│   └── deapi-embedding-model.ts     # wrap OpenAICompatibleEmbeddingModel
├── speech/
│   ├── deapi-speech-model.ts        # custom, implements SpeechModelV4
│   └── deapi-speech-model-options.ts
└── transcription/
    ├── deapi-transcription-model.ts  # custom, implements TranscriptionModelV4
    └── deapi-transcription-model-options.ts
```

### 1.3 — Główny provider factory

> ⚠️ **Do samodzielnej weryfikacji przy implementacji.** Poniżej opisany jest *kontrakt* (zweryfikowany względem baseline V4 `@ai-sdk/provider`, stan 2026-06) oraz **ilustracyjny szkielet** — **nie jest to kod gwarantowany do kompilacji 1:1**. Dokładne sygnatury (`createOpenAICompatible`, kształt `loadApiKey`, konstruktory custom klas, opcje `headers`/`fetch`, nazwy typów) sprawdź w **najnowszej stabilnej** wersji SDK przed napisaniem właściwej implementacji.

`createDeAPI(options)` zwraca obiekt implementujący `ProviderV4`. Kontrakt:

- **`imageModel(id)` / `embeddingModel(id)`** — deleguj do `createOpenAICompatible({ name: 'deapi', baseURL, apiKey })` (`@ai-sdk/openai-compatible`); standardowe `/v1/images/generations` i `/v1/embeddings`. W `ProviderV4` metoda embeddingów to **`embeddingModel`** (zwraca `EmbeddingModelV4`), **nie** `textEmbeddingModel`.
- **`speechModel(id)` / `transcriptionModel(id)`** — własne klasy (brak w `openai-compatible`); POST na `/v1/audio/speech` i `/v1/audio/transcriptions`. Wzór: `@ai-sdk/elevenlabs` i `@ai-sdk/deepgram` w repo `vercel/ai`.
- **Skrócone aliasy `image`/`embedding`/`speech`/`transcription`** — dodaj obok metod interfejsu (konwencja providerów AI SDK; przykłady w docs ich używają).
- **`languageModel(id)`** — **wymagany** w `ProviderV4`, ale deAPI nie serwuje LLM → implementuj tak, by rzucał `NoSuchModelError`.
- **Klucz API** — `loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'DEAPI_API_KEY' })` z `@ai-sdk/provider-utils`.

Ilustracyjny szkielet (sprawdź sygnatury przed użyciem):

```typescript
// src/deapi-provider.ts — SZKIELET, do weryfikacji względem aktualnego SDK
import { NoSuchModelError } from '@ai-sdk/provider';
import { loadApiKey } from '@ai-sdk/provider-utils';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
// + import typów V4 (ImageModelV4, EmbeddingModelV4, SpeechModelV4, TranscriptionModelV4),
//   DeAPIProviderSettings oraz custom klas DeAPISpeechModel / DeAPITranscriptionModel

export function createDeAPI(options = {}) {
  const baseURL = options.baseURL ?? 'https://oai.deapi.ai/v1';
  const apiKey = loadApiKey({
    apiKey: options.apiKey,
    environmentVariableName: 'DEAPI_API_KEY',
    description: 'deAPI API key',
  });

  // image + embedding → openai-compatible (zweryfikuj nazwy metod w aktualnym pakiecie)
  const oai = createOpenAICompatible({ name: 'deapi', baseURL, apiKey /*, headers */ });
  const imageModel = (id) => oai.imageModel(id);
  const embeddingModel = (id) => oai.embeddingModel(id); // V4: embeddingModel, nie textEmbeddingModel

  // speech + transcription → własne klasy (sygnatury konstruktorów DO WERYFIKACJI)
  const speechModel = (id) => new DeAPISpeechModel(id, { baseURL, apiKey });
  const transcriptionModel = (id) => new DeAPITranscriptionModel(id, { baseURL, apiKey });

  const provider = ((id) => imageModel(id)); // default-callable → image
  Object.assign(provider, {
    imageModel, embeddingModel, speechModel, transcriptionModel,
    image: imageModel, embedding: embeddingModel,            // skrócone aliasy
    speech: speechModel, transcription: transcriptionModel,
    // languageModel wymagany w ProviderV4, ale deAPI nie serwuje LLM:
    languageModel: (id) => { throw new NoSuchModelError({ modelId: id, modelType: 'languageModel' }); },
  });
  return provider;
}

export const deapi = createDeAPI();
export default deapi;
```

### 1.4 — Custom model classes (speech + transcription)

> ⚠️ **Wymagane property zweryfikuj** względem `SpeechModelV4` / `TranscriptionModelV4` w aktualnym `@ai-sdk/provider` — poniższa lista to baseline V4 (2026-06), może się różnić w nowszych wydaniach.

Każda custom class musi (baseline V4) implementować:
- `specificationVersion: 'v4'`
- `provider: 'deapi'`
- `modelId: string`
- `doGenerate(options)` — główna metoda

**Speech (`SpeechModelV4`):** POST do `/v1/audio/speech` z `{ model, input, voice, response_format }`. Zwraca audio bytes.

**Transcription (`TranscriptionModelV4`):** POST do `/v1/audio/transcriptions` z multipart form (file upload). Zwraca text/JSON.

Wzorce implementacji: sprawdź `@ai-sdk/elevenlabs` (speech) i `@ai-sdk/deepgram` (transcription) w repo `vercel/ai` — packages/elevenlabs/ i packages/deepgram/.

### 1.5 — package.json

> ⚠️ **Nie hardcoduj numerów wersji.** Zainstaluj **najnowsze stabilne** wersje — `npm install @ai-sdk/provider @ai-sdk/provider-utils @ai-sdk/openai-compatible` zapisze aktualne wersje w `dependencies` (zamień placeholdery `latest` poniżej na to, co npm przypnie). Peer `ai` ustaw na **bieżącą major** (na 2026-06 to v6 — zweryfikuj aktualną przed publikacją).

```json
{
  "name": "@deapi/ai-sdk-provider",
  "version": "0.1.0",
  "license": "MIT",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "dependencies": {
    "@ai-sdk/provider": "latest",
    "@ai-sdk/provider-utils": "latest",
    "@ai-sdk/openai-compatible": "latest"
  },
  "peerDependencies": {
    "ai": ">=6"
  }
}
```

### 1.6 — Testy

Vitest, mock-only. Sprawdź że:
- `createDeAPI()` zwraca obiekt z `.imageModel()`, `.embeddingModel()`, `.speechModel()`, `.transcriptionModel()`
- `languageModel()` rzuca `NoSuchModelError`
- Image/embedding deleguje do `openai-compatible` z poprawnym baseURL
- Speech/transcription wysyła request na poprawne endpointy

### 1.7 — Build i publish

```bash
npx tsup src/index.ts --format esm,cjs --dts
npm publish --access public
```

Stwórz tagged release na GitHubie. README musi zawierać installation + minimal usage example.

---

## Stage 2 — PR do vercel/ai (docs)

### 2.1 — Fork i branch

```bash
git clone https://github.com/<your-user>/ai.git vercel-ai
cd vercel-ai
git checkout -b docs-add-deapi
```

### 2.2 — Nowy plik MDX (NOWY)

**Plik:** `content/providers/03-community-providers/52-deapi.mdx`

Sprawdź aktualnie najwyższy numer prefiksu w katalogu i użyj następnego (na 2026-05-13 najwyższy zweryfikowany: `51-zeroentropy.mdx` → użyj `52-deapi.mdx`). Wszystkie slugi modeli, voices i ceny poniżej są zweryfikowane względem `GET /api/v2/models` deAPI i cennika (2026-06). **Pełna, gotowa treść pliku MDX:**

````mdx
---
title: 'deAPI'
description: 'Learn how to use the deAPI provider for the AI SDK.'
---

# deAPI Provider

[deAPI](https://deapi.ai) is an OpenAI-compatible inference API for open-source AI models — image generation, image edits, text-to-speech, transcription, embeddings, and video. The [deAPI provider for the AI SDK](https://github.com/deapi-ai/deapi-ai-sdk-provider) integrates these modalities into the Vercel AI SDK.

For more information, see the [deAPI documentation](https://docs.deapi.ai).

## Installation

<Tabs items={['pnpm', 'npm', 'yarn', 'bun']}>
  <Tab>
    <Snippet text="pnpm add @deapi/ai-sdk-provider" dark />
  </Tab>
  <Tab>
    <Snippet text="npm install @deapi/ai-sdk-provider" dark />
  </Tab>
  <Tab>
    <Snippet text="yarn add @deapi/ai-sdk-provider" dark />
  </Tab>
  <Tab>
    <Snippet text="bun add @deapi/ai-sdk-provider" dark />
  </Tab>
</Tabs>

## Authentication

Set `DEAPI_API_KEY` in your environment, or pass `apiKey` when creating the provider. Get an API key from the [deAPI dashboard](https://app.deapi.ai/dashboard). Keys are prefixed `dpn-sk-`.

## Provider Instance

```ts
import { deapi } from '@deapi/ai-sdk-provider';
```

For custom configuration:

```ts
import { createDeAPI } from '@deapi/ai-sdk-provider';

const deapi = createDeAPI({
  apiKey: process.env.DEAPI_API_KEY,
  baseURL: 'https://oai.deapi.ai/v1', // OpenAI-compatible endpoint (default)
});
```

Options:

- `apiKey`: overrides `DEAPI_API_KEY`.
- `baseURL`: defaults to `https://oai.deapi.ai/v1`. Use `https://api.deapi.ai/api/v2` for the native REST v2 surface.
- `headers`: additional request headers.
- `fetch`: custom fetch implementation.

## Image Models

Generate images with `deapi.image()` and `experimental_generateImage`:

```ts
import { deapi } from '@deapi/ai-sdk-provider';
import { experimental_generateImage as generateImage } from 'ai';

const { image } = await generateImage({
  model: deapi.image('Flux1schnell'),
  prompt: 'A serene mountain landscape at sunrise',
  size: '1024x1024',
});
```

### Available image models

| Model ID | Notes |
|---|---|
| `Flux1schnell` | Fast FLUX.1 Schnell, 1–10 steps (default 4). ~$0.00136 per 512×512 image. |
| `Flux_2_Klein_4B_BF16` | FLUX.2 Klein, generation + multi-reference editing (up to 3 input images), 4 steps. ~$0.00187 per 512×512. |
| `ZImageTurbo_INT8` | Z-Image Turbo, 1–50 steps (default 8). ~$0.00399 per 512×512. |
| `ZAnimeDistill_8Step_INT8` | Anime-style Z-Image distill, 4–16 steps (default 8). |

See the live catalog at [`GET /api/v2/models`](https://docs.deapi.ai) — never hardcode model slugs in production.

## Embedding Models

```ts
import { deapi } from '@deapi/ai-sdk-provider';
import { embed } from 'ai';

const { embedding } = await embed({
  model: deapi.embedding('Bge_M3_FP16'),
  value: 'sunny day at the beach',
});
```

| Model ID | Dimensions | Context |
|---|---|---|
| `Bge_M3_FP16` | 1024 | 8192 tokens |

See the [deAPI pricing page](https://docs.deapi.ai) for current per-token embedding rates.

## Transcription Models

```ts
import { deapi } from '@deapi/ai-sdk-provider';
import { experimental_transcribe as transcribe } from 'ai';

const { text } = await transcribe({
  model: deapi.transcription('WhisperLargeV3'),
  audio: new URL('https://example.com/audio.mp3'),
});
```

deAPI's transcription endpoint supports file upload up to **80 MB** (vs OpenAI's 25 MB) and URL ingest from YouTube, TikTok, Twitch, Kick, and X.

## Speech Models

```ts
import { deapi } from '@deapi/ai-sdk-provider';
import { experimental_generateSpeech as generateSpeech } from 'ai';

const { audio } = await generateSpeech({
  model: deapi.speech('Kokoro'),
  text: 'Hello from deAPI',
  voice: 'af_alloy', // voice slugs are prefixed: af_/am_ (US), bf_/bm_ (GB), ...
});
```

`Kokoro` ships multilingual voices whose slugs are prefixed by language + gender (e.g. `af_alloy`, `af_nova`, `am_echo`, `am_onyx`, `bm_fable`, `bf_emma`); the default voice is `af_alloy`. `Chatterbox` (23 languages, custom voice) and the `Qwen3_TTS_12Hz_1_7B_*` family (`CustomVoice`, `Base` for voice cloning, `VoiceDesign`) are also available with model-specific voice options.

## Additional capabilities not yet covered by AI SDK interfaces

deAPI also serves video generation (text-to-video, image-to-video, audio-to-video, character replacement, upscaling), OCR, image edits, background removal, and music generation. These are reachable through the native REST v2 API at `https://api.deapi.ai` but do not have first-class AI SDK interfaces yet (`ProviderV4` has no `videoModel`).

## Additional Resources

- [deAPI Provider GitHub Repository](https://github.com/deapi-ai/deapi-ai-sdk-provider)
- [deAPI Documentation](https://docs.deapi.ai)
- [OpenAI Compatibility Reference](https://docs.deapi.ai/openai-compatibility)
- [deAPI Dashboard](https://app.deapi.ai/dashboard)
- [deAPI Status Page](https://status.deapi.ai)
- [deAPI Discord Community](https://discord.com/invite/UFfK5YRBsr)
````

### 2.3 — Edycja providers list (EDYCJA)

**Plik:** `content/docs/02-foundations/02-providers-and-models.mdx`

Dodaj jedną linię alfabetycznie w sekcji community providers:

```markdown
- [deAPI Provider](/providers/community-providers/deapi) (`@deapi/ai-sdk-provider`)
```

### 2.4 — Commit i PR

```bash
git add content/providers/03-community-providers/52-deapi.mdx \
        content/docs/02-foundations/02-providers-and-models.mdx
git commit -m "docs(providers): add deAPI community provider"
git push -u origin docs-add-deapi
```

PR do `main`. Tytuł: `docs(providers): add deAPI community provider`

---

## Pliki do dostarczenia — podsumowanie

### Stage 1 — npm package (nowe repo `deapi-ai-sdk-provider`)

| # | Plik | Opis |
|---|---|---|
| 1 | `src/index.ts` | Barrel exports |
| 2 | `src/deapi-provider.ts` | Factory `createDeAPI()` + default `deapi` instance |
| 3 | `src/deapi-config.ts` | Typy konfiguracji (`DeAPIProviderSettings`) |
| 4 | `src/image/deapi-image-model.ts` | Wrap `OpenAICompatibleImageModel` |
| 5 | `src/embedding/deapi-embedding-model.ts` | Wrap `OpenAICompatibleEmbeddingModel` |
| 6 | `src/speech/deapi-speech-model.ts` | Custom `SpeechModelV4` |
| 7 | `src/transcription/deapi-transcription-model.ts` | Custom `TranscriptionModelV4` |
| 8 | `package.json` | Dependencies + exports |
| 9 | `tsconfig.json` + `tsup.config.ts` | Build config |
| 10 | `README.md` | Installation + usage |

### Stage 2 — docs PR do `vercel/ai`

| # | Plik | Akcja |
|---|---|---|
| 1 | `content/providers/03-community-providers/52-deapi.mdx` | NOWY |
| 2 | `content/docs/02-foundations/02-providers-and-models.mdx` | EDYCJA — jedna linia |

---

## Available deAPI models (for the docs tables)

> Treść tej sekcji trafia wprost do strony docs — pozostaje po angielsku.

### Image models

| Model ID (API slug) | Notes | Resolution | Steps |
|---|---|---|---|
| `Flux1schnell` | Fast generation, ~$0.00136 per 512×512 | 256–2048 px (step 128) | 1–10 (default 4) |
| `Flux_2_Klein_4B_BF16` | Generation + multi-reference editing (up to 3 input images), ~$0.00187 per 512×512 | 256–1536 px (step 16) | 4 (fixed) |
| `ZImageTurbo_INT8` | Fastest, ~$0.00399 per 512×512 | 128–2048 px (step 16) | 1–50 (default 8) |
| `ZAnimeDistill_8Step_INT8` | Anime-style images | 128–2048 px (step 16) | 4–16 (default 8) |

### Embedding models

| Model ID | Dimensions | Context |
|---|---|---|
| `Bge_M3_FP16` | 1024 | 8192 tokens |

### Speech models (TTS)

> Voice slugs are prefixed (`af_`/`am_` = US female/male, `bf_`/`bm_` = GB, then `ef_`/`ff_`/`hf_`/`if_`/`pf_`…). Bare `alloy`/`echo`/`shimmer` are **not** valid slugs. Default format: `mp3`.

| Model ID (slug) | Representative voices | Notes |
|---|---|---|
| `Kokoro` | `af_alloy` (default), `af_nova`, `am_echo`, `am_onyx`, `bm_fable`, `bf_emma` | Multilingual: en-us, en-gb, es, fr-fr, hi, it, pt-br. `shimmer` does not exist |
| `Chatterbox` | `default` (per language) | Custom voice, 23 languages. **No** voice cloning (`supports_voice_clone: false`) |
| `Qwen3_TTS_12Hz_1_7B_CustomVoice` | `Vivian`, `Serena`, `Dylan`, `Eric`, `Ono_Anna`… | Multilingual custom-voice TTS |
| `Qwen3_TTS_12Hz_1_7B_Base` | (voice clone from 5–15 s reference audio) | Voice cloning |
| `Qwen3_TTS_12Hz_1_7B_VoiceDesign` | (voice design from a text description) | Voice generation from a prompt |

### Transcription models

| Model ID | Max upload | URL ingest |
|---|---|---|
| `WhisperLargeV3` | 80 MB | YouTube, TikTok, Twitch, Kick, X |

---

## Kryteria akceptacji

### Stage 1 — npm package

- [ ] Pakiet `@deapi/ai-sdk-provider` opublikowany na npm
- [ ] Publiczne repo GitHub (np. `github.com/deapi-ai/deapi-ai-sdk-provider`)
- [ ] Tagged release na GitHub odpowiadający wersji npm
- [ ] `createDeAPI()` zwraca provider z `.imageModel()`, `.embeddingModel()`, `.speechModel()`, `.transcriptionModel()`
- [ ] `languageModel()` rzuca `NoSuchModelError` (deAPI nie serwuje chat)
- [ ] Image generation działa: `generateImage({ model: deapi.image('Flux1schnell'), ... })`
- [ ] Embeddings działają: `embed({ model: deapi.embedding('Bge_M3_FP16'), ... })`
- [ ] Speech działa: `generateSpeech({ model: deapi.speech('Kokoro'), ... })`
- [ ] Transcription działa: `transcribe({ model: deapi.transcription('WhisperLargeV3'), ... })`
- [ ] Testy (Vitest) przechodzą
- [ ] README z installation + usage examples
- [ ] License: MIT

### Stage 2 — docs PR

- [ ] Plik MDX dodany do `content/providers/03-community-providers/`
- [ ] Linia dodana do `content/docs/02-foundations/02-providers-and-models.mdx`
- [ ] Wszystkie code examples w MDX używają poprawnych importów i API slugów
- [ ] Linki do npm + GitHub repo działają
- [ ] PR otwarty do `vercel/ai:main`

## Czego NIE robić

- Nie deklaruj `languageModel()` / `.chat()` / `.completion()` — deAPI nie serwuje LLM, reviewer to wyłapie
- Nie obiecuj video generation przez AI SDK interface — `ProviderV4` nie ma `videoModel`/`VideoModelV4`. Udokumentuj jako "via native REST API" (gdy Vercel kiedyś wyda video interface, otwórz follow-up PR)
- Nie rób PR do `vercel/ai` bez opublikowanego pakietu na npm — maintainerzy odrzucą
- Nie hardcoduj model slugów w package code — pozwól użytkownikowi przekazać dowolny string, deAPI może dodać nowe modele
- Speech/transcription mogą być oznaczone `experimental_` w importach AI SDK — używaj `experimental_generateSpeech`, `experimental_transcribe` w przykładach kodu

## Po wysłaniu

- **Stage 1:** Publish na npm → natychmiastowo dostępny dla userów
- **Stage 2:** PR review 1–2 tygodnie, reviewer prawdopodobnie @lgrammel (AI SDK lead)
- Eskalacja: komentarz po 2 tygodniach bez odpowiedzi
- Po merge: strona live na `https://ai-sdk.dev/providers/community-providers/deapi`

## Linki

- AI SDK repo: https://github.com/vercel/ai
- Custom providers guide: https://ai-sdk.dev/providers/community-providers/custom-providers
- `@ai-sdk/openai-compatible`: https://www.npmjs.com/package/@ai-sdk/openai-compatible
- Wzorcowy provider (ElevenLabs): `packages/elevenlabs/` w repo `vercel/ai`
- Wzorcowy provider (Soniox, community): `content/providers/03-community-providers/41-soniox.mdx`
- deAPI docs: https://docs.deapi.ai
- deAPI OpenAI compat: https://docs.deapi.ai/openai-compatibility
- Pełny playbook: `submissions/VercelAISDK.md`
