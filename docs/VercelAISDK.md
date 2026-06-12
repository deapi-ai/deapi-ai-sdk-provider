> ⚠️ **SUPERSEDED (2026-06-12)** — dokument historyczny (V4, baseURL native v2, 80 MB). Aktualne źródło prawdy: **`PLAN_WDROZENIA.md`**.

# Vercel AI SDK — Community Providers — Submission Playbook

**Target URL:** https://github.com/vercel/ai (PR względem `content/providers/03-community-providers/`)
**Submission type:** GitHub PR dodający jedną stronę `.mdx`, po opublikowaniu pakietu npm
**Estimated effort:** 2–4 godziny na docs PR (zakładając że pakiet npm już istnieje). Zbudowanie i opublikowanie samego pakietu npm to osobne, większe zadanie — **2–5 dni** na pierwszą wersję pokrywającą image + speech + transcription + embeddings.
**Blockers / caveats:**
- **Dwuetapowy submission**. Strona community-providers w docs tylko linkuje do twojego własnego repo + pakietu npm. Musisz opublikować je *najpierw*, potem zrobić PR docs.
- **Baseline specyfikacji to V4** (stan na 2026-06; instaluj najnowsze stabilne `@ai-sdk/*` i zweryfikuj w kodzie przed implementacją). Interfejsy: `ProviderV4`, `LanguageModelV4`, `EmbeddingModelV4`, `ImageModelV4`, `SpeechModelV4`, `TranscriptionModelV4`. Speech (TTS) i transcription są wołane z pakietu `ai` przez `experimental_generateSpeech` / `experimental_transcribe` (wrappery wciąż oznaczone `experimental_`), ale ich spec providera to pełne V4. Video nie ma first-class interface (`ProviderV4` nie ma `videoModel`). **Soniox** jest precedensem dla community providera transcription-only (`content/providers/03-community-providers/41-soniox.mdx`); **Voyage AI** dla embeddings; OpenRouter jest szablonem docs rekomendowanym przez oficjalny guide.
- Endpointy image, embedding, transcription i TTS deAPI mapują się czysto na interfejsy V4 (`ImageModelV4`, `EmbeddingModelV4`, `TranscriptionModelV4`, `SpeechModelV4`). Video **nie** mapuje się — udokumentuj je na stronie providera, ale nie deklaruj interfejsu Vercel AI SDK.

---

## TL;DR

- Stage 1 (engineering): opublikuj `@deapi/ai-sdk-provider` na npm + GitHub. Minimalny użyteczny zakres: image generation (`ImageModelV4`), embeddings (`EmbeddingModelV4`), transcription (`TranscriptionModelV4`) oraz TTS (`SpeechModelV4`).
- Stage 2 (docs): sforkuj `vercel/ai`, dodaj `content/providers/03-community-providers/XX-deapi.mdx`, PR z tytułem `docs(providers): add deAPI community provider`.
- Użyj pliku **Soniox** jako strukturalnego template (transcription jest modalnością z najbliższym fitem; OpenRouter jest bardziej dopracowany, ale jest chat-only).
- Czekaj 1–2 tygodnie na merge. PR-y docs od community providerów landują dość szybko, gdy pakiet istnieje na npm.

---

## Wymagania wstępne

- [ ] **Pakiet npm `@deapi/ai-sdk-provider` opublikowany** z przynajmniej jednym działającym interfejsem (rekomendowana kolejność: image → embeddings → transcription → speech)
- [ ] Publiczne repo GitHub dla źródeł providera (np. `https://github.com/deapi-ai/deapi-ai-sdk-provider`)
- [ ] README w repo providera z installation + minimalnym przykładem usage
- [ ] Tagged release na GitHubie odpowiadający wersji na npm
- [ ] Ustawiony license (MIT jest standardem dla community providerów Vercel AI SDK)
- [ ] Fork `vercel/ai`

---

## Krok po kroku

### Etap 1 — Zbuduj pakiet npm providera

#### 1.1 Zescafolduj pakiet

```bash
mkdir deapi-ai-sdk-provider && cd deapi-ai-sdk-provider
npm init -y
npm install @ai-sdk/provider @ai-sdk/provider-utils zod
npm install -D typescript tsup vitest @types/node
```

#### 1.2 Zaimplementuj entry point providera

Minimalne exports:

```ts
// src/index.ts
export { createDeAPI, deapi } from './deapi-provider';
export type { DeAPIProvider, DeAPIProviderSettings } from './deapi-provider';
```

Zaimplementuj cztery factory methods na providerze:

| Method (+ alias) | Returns | AI SDK interface | Backed by deAPI endpoint |
|---|---|---|---|
| `imageModel(modelId)` / `image()` | `ImageModelV4` | `@ai-sdk/provider` `ImageModelV4` | `POST /v1/images/generations` |
| `embeddingModel(modelId)` / `embedding()` | `EmbeddingModelV4` | `@ai-sdk/provider` `EmbeddingModelV4` | `POST /v1/embeddings` |
| `transcriptionModel(modelId)` / `transcription()` | `TranscriptionModelV4` | `@ai-sdk/provider` `TranscriptionModelV4` | `POST /v1/audio/transcriptions` |
| `speechModel(modelId)` / `speech()` | `SpeechModelV4` | `@ai-sdk/provider` `SpeechModelV4` | `POST /v1/audio/speech` |

`languageModel()` jest **wymagany** w `ProviderV4` — nie da się go „pominąć". Zaimplementuj go tak, by rzucał `NoSuchModelError` (deAPI jest non-LLM by design). Pomiń `video()` dopóki Vercel nie wyda first-class video interface (`ProviderV4` nie ma `videoModel` na stan 2026-06). Eksponuj zarówno metody interfejsu (`imageModel`…), jak i skrócone aliasy (`image`…) — przykłady docs używają aliasów.

#### 1.3 Build i publish

```bash
npm publish --access public
```

Zatagguj odpowiedni release na GitHubie.

### Etap 2 — Dodaj stronę docs community provider

#### 2.1 Fork i branch

```bash
git clone git@github.com:<your-handle>/ai.git vercel-ai
cd vercel-ai
git checkout -b docs-add-deapi
```

#### 2.2 Wybierz następny ordinal prefix

Wylistuj `content/providers/03-community-providers/` i użyj następnego wolnego prefiksu `NN-` (aktualnie najwyższy zweryfikowany 2026-05-13: `51-zeroentropy.mdx`). Użyj `52-deapi.mdx`.

#### 2.3 Wrzuć `content/providers/03-community-providers/52-deapi.mdx`

(Pełna treść pliku w sekcji "Form / PR / Email answers" poniżej.)

#### 2.4 Otwórz PR

Tytuł: `docs(providers): add deAPI community provider`
Base: `vercel/ai:main`. CI uruchamia docs build + lint. Napraw jakiekolwiek błędy walidacji MDX.

### Etap 3 — Odpowiedz na review

- Maintainerzy Vercel (typowo @lgrammel, @shaman) sprawdzą: pakiet istnieje na npm, README jest sensowny, link do repo GitHub działa, MDX się renderuje.
- Mogą poprosić o alignment tonu — trzymaj marketing copy poza stroną docs (treść przepisana z COPY-MASTER poniżej jest już tone-neutral).

---

## Form / PR / Email answers (do wklejenia)

> Przepisane z `COPY-MASTER.md` Sekcja 5 (feature bullets) i Sekcja 10 (linki).

### Plik: `content/providers/03-community-providers/52-deapi.mdx`

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

deAPI also serves video generation (text-to-video, image-to-video, audio-to-video, character replacement, upscaling), OCR, image edits, background removal, and music generation. These are reachable through the native REST v2 API at `https://api.deapi.ai` but do not have first-class AI SDK interfaces yet.

## Additional Resources

- [deAPI Provider GitHub Repository](https://github.com/deapi-ai/deapi-ai-sdk-provider)
- [deAPI Documentation](https://docs.deapi.ai)
- [OpenAI Compatibility Reference](https://docs.deapi.ai/openai-compatibility)
- [deAPI Dashboard](https://app.deapi.ai/dashboard)
- [deAPI Status Page](https://status.deapi.ai)
- [deAPI Discord Community](https://discord.com/invite/UFfK5YRBsr)
````

### PR title

```
docs(providers): add deAPI community provider
```

### PR body

```markdown
## Summary

Adds **deAPI** to the Community Providers section. deAPI is an OpenAI-compatible inference API for open-source AI models covering image generation, image edits, text-to-speech, transcription, embeddings, and video.

The provider implementation is published at:
- npm: https://www.npmjs.com/package/@deapi/ai-sdk-provider
- GitHub: https://github.com/deapi-ai/deapi-ai-sdk-provider

It implements the following AI SDK interfaces:
- `ImageModelV4` — image generation (FLUX family, Z-Image)
- `EmbeddingModelV4` — text embeddings (BGE M3)
- `TranscriptionModelV4` — Whisper Large v3
- `SpeechModelV4` — Kokoro, Chatterbox, Qwen3-TTS

Chat / language models are intentionally out of scope (deAPI is non-LLM by design).

## Documentation page

Added `content/providers/03-community-providers/52-deapi.mdx` modeled after the Soniox community provider page (closest precedent for non-language modalities).

## Test plan

- [ ] MDX renders correctly on the docs preview
- [ ] All external links resolve
- [ ] npm install instructions verified
```

| Field | Answer |
|---|---|
| npm package name | `@deapi/ai-sdk-provider` |
| Provider GitHub repo | `https://github.com/deapi-ai/deapi-ai-sdk-provider` |
| MDX file path | `content/providers/03-community-providers/52-deapi.mdx` (use next free ordinal at PR time) |
| Env var | `DEAPI_API_KEY` |
| Base URL (default) | `https://oai.deapi.ai/v1` |
| Interfaces implemented | `ImageModelV4`, `EmbeddingModelV4`, `TranscriptionModelV4`, `SpeechModelV4` |
| Reference docs template used | `41-soniox.mdx` (closest non-LLM modality precedent) |

---

## Po wysłaniu

- Spodziewany czas oczekiwania: **1–2 tygodnie** na pierwsze review docs PR-a. Szybciej, jeśli pakiet npm i source repo wyglądają czysto, a PR jest jednoplikowy.
- Reviewer, którego należy się spodziewać: @lgrammel (Lars Grammel, AI SDK lead) lub inny maintainer `vercel/ai`.
- Jeśli cisza przez 2 tygodnie, skomentuj na PR-ze. Zespół jest responsywny na GitHubie, ale kolejka jest głęboka.
- Po wmergowaniu strona idzie live na `https://ai-sdk.dev/providers/community-providers/deapi`, a lista community na home page SDK uwzględnia deAPI w ciągu ~24 godzin.

---

## Uwagi i pułapki

- **Nie deklaruj wsparcia language model.** `ProviderV4` wymaga metody `languageModel()`, więc musi ona istnieć — ale ma rzucać `NoSuchModelError`, a nie serwować model. Nie eksponuj `.chat()` ani `.completion()` i nie sugeruj w README, że deAPI robi LLM — to całe pozycjonowanie ("komplementarne do twojego providera LLM, nie zastępstwo"). Reviewerzy to wyłapią.
- **Nie obiecuj video generation przez AI SDK interface.** `ProviderV4` nie ma metody `videoModel` ani typu `VideoModelV4` (stan 2026-06). Możesz udokumentować video jako dostępne przez native REST API, ale nie fake'uj adaptera Vercel AI SDK. Gdy Vercel wyda video interface, otwórz follow-up PR.
- **TTS i transcription są wołane przez `experimental_`-owe funkcje pakietu `ai`.** Spec providera to pełne `SpeechModelV4` / `TranscriptionModelV4`, ale wrappery w pakiecie `ai` to wciąż `experimental_generateSpeech` / `experimental_transcribe` — używaj ich w przykładach kodu. Trzymaj pakiet up to date, gdy Vercel zdejmie prefiks `experimental_`.
- **OpenAI-compatible mode oznacza, że możesz również short-circuitować i udokumentować to:** użytkownicy, którzy nie chcą instalować kolejnego pakietu, mogą również użyć `@ai-sdk/openai-compatible` z `baseURL: 'https://oai.deapi.ai/v1'`. Wspomnij to jako fallback w README, ale prowadź z dedykowanym pakietem `@deapi/ai-sdk-provider` — to jest to, co daje ci stronę community-providers.
- **Reuseuj template-style docs OpenRouter** dla struktury strony (docs Vercela jawnie to rekomendują) — krótki intro, installation tabs, authentication, sekcje per-modality, linki na dole. Dostarczony `52-deapi.mdx` podąża za tym layoutem.
- **License**: sam pakiet npm powinien być MIT — lista community providers AI SDK miesza Apache i MIT, ale MIT jest najczęstsza i reviewerzy nie zadają pytań o to.
