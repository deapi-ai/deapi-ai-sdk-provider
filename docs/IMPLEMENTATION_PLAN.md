> ⚠️ **SUPERSEDED (2026-06-12)** — dokument historyczny. Zawiera nieaktualne `ProviderV4`.
> Aktualne źródło prawdy: **`PLAN_WDROZENIA.md`**.

# Plan wdrożenia: deAPI jako community provider w Vercel AI SDK

## Context

Celem jest dostarczenie deAPI (OpenAI-kompatybilne API inferencyjne dla modeli open-source: obrazy,
embeddingi, TTS, transkrypcja) do ekosystemu Vercel AI SDK. Wymaga to **dwóch etapów**:
zbudowania i opublikowania pakietu npm `@deapi/ai-sdk-provider` (Stage 1), a następnie PR-a z
dokumentacją do `vercel/ai` (Stage 2). Stage 2 nie może ruszyć bez Stage 1 — strona community-provider
w docs tylko linkuje do istniejącego pakietu npm i repo GitHub; maintainerzy odrzucą PR bez działającego
pakietu.

Plan oparty jest na dwóch plikach specyfikacji w `~/Downloads/`: `VercelAISDK.md`
(playbook) i `VercelAISDK-JIRA.md` (ticket techniczny). Reconnaissance
lokalnych repo deAPI (`deapi-integration-reports`, `deapi-idea-forge`) potwierdziło: base URL
`https://oai.deapi.ai/v1`, auth `Authorization: Bearer dpn-sk-...`, env `DEAPI_API_KEY`, endpoint
embeddingów `/v1/embeddings` (model `Bge_M3_FP16`). Szczegóły payloadów speech/transcription nie są w
lokalnych repo — pochodzą z `docs.deapi.ai/openai-compatibility`.

**Decyzje użytkownika:** zakres = oba etapy; lokalizacja pakietu = `/Users/adampacz/projects`;
weryfikacja = testy mock (Vitest) **oraz** smoke-testy na żywo (dostępny realny `DEAPI_API_KEY`).
Środowisko: Node v22, npm v10.

> ⚠️ **Krytyczne założenie do weryfikacji przed kodowaniem.** Specyfikacja podaje baseline **V4**
> (`ProviderV4`, `ImageModelV4`, `EmbeddingModelV4`, `SpeechModelV4`, `TranscriptionModelV4`, embeddingi
> jako `embeddingModel` nie `textEmbeddingModel`). Nazwy/sygnatury interfejsów MUSZĄ być zweryfikowane
> w faktycznie zainstalowanej, najnowszej stabilnej wersji `@ai-sdk/provider` — docs bywają opóźnione
> względem kodu. Szkielety w plikach .md są ilustracyjne, nie gwarantowane do kompilacji 1:1.

---

## Stage 1 — Pakiet npm `@deapi/ai-sdk-provider`

Lokalizacja: `/Users/adampacz/projects/deapi-ai-sdk-provider`

### 1.1 Scaffold i zależności
```bash
cd /Users/adampacz/projects/deapi-ai-sdk-provider
npm init -y
npm install @ai-sdk/provider @ai-sdk/provider-utils @ai-sdk/openai-compatible zod
npm install -D typescript tsup vitest @types/node
```
Po instalacji: **odczytać realne wersje** zapisane w `package.json` i sprawdzić w
`node_modules/@ai-sdk/provider/dist/*.d.ts` aktualne nazwy interfejsów (`ProviderV4`, `*ModelV4`,
`specificationVersion`) oraz sygnaturę `createOpenAICompatible` i `loadApiKey`. To gate dla reszty etapu.

### 1.2 Struktura plików
```
src/
├── index.ts                                   # barrel exports
├── deapi-provider.ts                          # createDeAPI() + default `deapi`
├── deapi-config.ts                            # DeAPIProviderSettings (apiKey, baseURL, headers, fetch)
├── deapi-error.ts                             # mapowanie błędów deAPI
├── image/deapi-image-model.ts                 # wrap OpenAICompatibleImageModel
├── embedding/deapi-embedding-model.ts         # wrap OpenAICompatibleEmbeddingModel
├── speech/deapi-speech-model.ts               # custom SpeechModelV4
├── speech/deapi-speech-model-options.ts
├── transcription/deapi-transcription-model.ts # custom TranscriptionModelV4
└── transcription/deapi-transcription-model-options.ts
```

### 1.3 Provider factory — kontrakt (`src/deapi-provider.ts`)
`createDeAPI(options)` zwraca obiekt `ProviderV4`:
- `baseURL` ← `options.baseURL ?? 'https://oai.deapi.ai/v1'`
- klucz ← `loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'DEAPI_API_KEY', description: 'deAPI API key' })`
- `imageModel(id)` / `embeddingModel(id)` → delegacja do `createOpenAICompatible({ name: 'deapi', baseURL, apiKey })`
  (endpointy `/v1/images/generations`, `/v1/embeddings`). **`embeddingModel`**, nie `textEmbeddingModel`.
- `speechModel(id)` / `transcriptionModel(id)` → własne klasy (POST `/v1/audio/speech`, `/v1/audio/transcriptions`).
- skrócone aliasy `image` / `embedding` / `speech` / `transcription` obok metod interfejsu.
- `languageModel(id)` → **musi istnieć** (wymóg `ProviderV4`), ale rzuca `NoSuchModelError({ modelId, modelType: 'languageModel' })`. Brak `.chat()` / `.completion()`.
- **bez** `videoModel` — `ProviderV4` nie ma takiego interfejsu.

### 1.4 Custom klasy speech + transcription
Każda implementuje (baseline V4 — zweryfikować): `specificationVersion: 'v4'`, `provider: 'deapi'`,
`modelId`, `doGenerate(options)`.
- **Speech (`SpeechModelV4`):** POST `/v1/audio/speech`, body `{ model, input, voice, response_format }`, zwraca audio bytes. Domyślny głos `af_alloy`, domyślny format `mp3`.
- **Transcription (`TranscriptionModelV4`):** POST `/v1/audio/transcriptions` jako multipart form-data (file upload do 80 MB + URL ingest: YouTube/TikTok/Twitch/Kick/X), zwraca text/JSON.
- **Wzorce do naśladowania:** `packages/elevenlabs/` (speech) i `packages/deepgram/` (transcription) w repo `vercel/ai`. Pobrać te pakiety jako referencję przed pisaniem własnych klas.

### 1.5 package.json
- `name: "@deapi/ai-sdk-provider"`, `version: "0.1.0"`, `license: "MIT"`, `type: "module"`.
- `exports` z `types` / `import` / `require` → `./dist/`.
- `dependencies`: realne wersje przypięte przez npm (NIE hardcodować). `peerDependencies.ai`: bieżąca major (spec wskazuje `>=6` na 2026-06 — zweryfikować `npm view ai version`).
- `tsconfig.json` + `tsup.config.ts` (format esm,cjs, dts).

### 1.6 Testy — dwa poziomy
- **Mock (Vitest, w repo, CI):** `createDeAPI()` zwraca `.imageModel/.embeddingModel/.speechModel/.transcriptionModel`; `languageModel()` rzuca `NoSuchModelError`; image/embedding delegują do openai-compatible z poprawnym baseURL; speech/transcription strzelają w poprawne endpointy (mock fetch, asercja URL + body/multipart).
- **Live smoke (lokalnie, `DEAPI_API_KEY`, poza CI — np. `examples/`):**
  - `generateImage({ model: deapi.image('Flux1schnell'), prompt, size: '1024x1024' })`
  - `embed({ model: deapi.embedding('Bge_M3_FP16'), value })`
  - `experimental_generateSpeech({ model: deapi.speech('Kokoro'), text, voice: 'af_alloy' })`
  - `experimental_transcribe({ model: deapi.transcription('WhisperLargeV3'), audio })`

### 1.7 README + build + publish
- README: installation (pnpm/npm/yarn/bun) + minimalny przykład każdej modalności + fallback note (`@ai-sdk/openai-compatible` z `baseURL: 'https://oai.deapi.ai/v1'`).
- `npx tsup src/index.ts --format esm,cjs --dts`
- `npm publish --access public` **(akcja outward-facing — wykonać dopiero po akceptacji użytkownika)**
- Repo GitHub `deapi-ai/deapi-ai-sdk-provider` + tagged release `v0.1.0` zgodny z npm.

---

## Stage 2 — docs PR do `vercel/ai` (dopiero po publikacji npm)

### 2.1 Fork + branch
```bash
git clone https://github.com/<your-user>/ai.git vercel-ai && cd vercel-ai
git checkout -b docs-add-deapi
```

### 2.2 Nowy plik MDX
`content/providers/03-community-providers/NN-deapi.mdx` — **sprawdzić aktualnie najwyższy prefiks**
w katalogu i użyć następnego (spec: na 2026-05-13 najwyższy `51-zeroentropy.mdx` → `52-deapi.mdx`,
ale zweryfikować przy PR). Treść: gotowa w obu plikach .md (intro, installation tabs, authentication,
provider instance, sekcje per-modality z tabelami modeli/voices/cen, sekcja "not yet covered" dla video,
additional resources). Wszystkie code examples używają `experimental_generateImage` / `embed` /
`experimental_generateSpeech` / `experimental_transcribe` i poprawnych slugów.

### 2.3 Edycja listy providerów
`content/docs/02-foundations/02-providers-and-models.mdx` — dodać alfabetycznie jedną linię:
```markdown
- [deAPI Provider](/providers/community-providers/deapi) (`@deapi/ai-sdk-provider`)
```

### 2.4 Commit + PR
```bash
git add content/providers/03-community-providers/NN-deapi.mdx \
        content/docs/02-foundations/02-providers-and-models.mdx
git commit -m "docs(providers): add deAPI community provider"
git push -u origin docs-add-deapi
```
PR do `vercel/ai:main`, tytuł `docs(providers): add deAPI community provider`, body wg sekcji
"PR body" w VercelAISDK.md. Template strukturalny: `41-soniox.mdx` (najbliższy non-LLM precedens).

---

## Pliki do dostarczenia

**Stage 1 (nowe repo `deapi-ai-sdk-provider`):** `src/index.ts`, `src/deapi-provider.ts`,
`src/deapi-config.ts`, `src/deapi-error.ts`, `src/image/deapi-image-model.ts`,
`src/embedding/deapi-embedding-model.ts`, `src/speech/deapi-speech-model.ts`,
`src/transcription/deapi-transcription-model.ts`, testy Vitest, `package.json`, `tsconfig.json`,
`tsup.config.ts`, `README.md`.

**Stage 2 (PR do `vercel/ai`):** `content/providers/03-community-providers/NN-deapi.mdx` (NOWY),
`content/docs/02-foundations/02-providers-and-models.mdx` (EDYCJA — 1 linia).

---

## Czego NIE robić (pułapki z review)
- Nie deklarować `languageModel()` / `.chat()` / `.completion()` jako działających — deAPI jest non-LLM by design; `languageModel()` ma rzucać `NoSuchModelError`.
- Nie obiecywać video przez interfejs AI SDK — `ProviderV4` nie ma `videoModel`/`VideoModelV4`. Video tylko jako "via native REST API". Gdy Vercel wyda video interface → follow-up PR.
- Nie robić PR do `vercel/ai` bez opublikowanego pakietu na npm.
- Nie hardcodować slugów modeli w kodzie pakietu (deAPI dodaje modele) ani numerów wersji zależności.
- Smoke-testy live trzymać poza CI (sekrety).

---

## Weryfikacja end-to-end
1. **Build:** `npx tsup ...` przechodzi, generuje `dist/` z `.d.ts` (ESM + CJS).
2. **Mock testy:** `npx vitest run` — wszystkie zielone (4 modalności + `NoSuchModelError`).
3. **Live smoke (z `DEAPI_API_KEY`):** uruchomić skrypty `examples/` dla image/embedding/speech/transcription i potwierdzić niepuste, poprawne odpowiedzi (obraz, wektor 1024-dim, audio bytes, tekst transkrypcji).
4. **Konsumpcja jako paczka:** `npm pack` → instalacja tarballa w czystym projekcie testowym → import `deapi` i wywołanie jednej modalności, by potwierdzić eksporty/typy.
5. **Stage 2:** lokalny docs build `vercel/ai` (pnpm) renderuje MDX bez błędów lint/walidacji; wszystkie linki zewnętrzne (npm, GitHub) rozwiązują się.

## Po wysłaniu
- Stage 1: publish → natychmiast dostępny.
- Stage 2: review ~1–2 tyg., reviewer prawdopodobnie @lgrammel. Eskalacja komentarzem po 2 tyg. ciszy. Po merge strona live na `https://ai-sdk.dev/providers/community-providers/deapi`.
