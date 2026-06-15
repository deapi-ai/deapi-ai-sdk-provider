# Plan wdrożenia `@deapi/ai-sdk-provider` — v2 (po review)

> Data: 2026-06-12. **Jedyne aktualne źródło prawdy.** Zastępuje `IMPLEMENTATION_PLAN.md`,
> `VercelAISDK.md`, `VercelAISDK-JIRA.md`, `ANALIZA_PLANU_VERCEL_AI_SDK.md` (oznaczone jako
> superseded). v2 integruje `REVIEW_PLAN_WDROZENIA.md` (P0/P1/P2). Fakty techniczne zweryfikowane
> wobec realnie zainstalowanych stabilnych paczek (`/tmp/deapi-spike`) + live docs deAPI + źródeł
> `vercel/ai`. Zasady: SOLID, KISS, pełne pokrycie testami logiki, zero halucynacji,
> jakość produktu publicznego klasy firmowej.

---

## 0. Zweryfikowany fundament (ground truth)

Zainstalowane wersje stabilne (npm `latest`, 2026-06-12):

| Paczka | Wersja | Co wnosi |
|---|---|---|
| `ai` | `6.0.202` | `generateImage` (stable), `embed`/`embedMany`, `experimental_generateSpeech`, `experimental_transcribe` |
| `@ai-sdk/provider` | `3.0.10` | **`ProviderV3`**, `specificationVersion: 'v3'`, `*ModelV3` |
| `@ai-sdk/provider-utils` | `4.0.28` | `loadApiKey`, `postJsonToApi`, `postFormDataToApi`, `createBinaryResponseHandler`, `createJsonResponseHandler`, `createJsonErrorResponseHandler`, `combineHeaders`, `convertToFormData`, `withoutTrailingSlash` |
| `@ai-sdk/openai-compatible` | `2.0.49` | `createOpenAICompatible()` → `imageModel()` + `embeddingModel()`, `specificationVersion="v3"`, opcje `headers`/`fetch` |
| `zod` | `4.4.3` | walidacja provider options + error schema |

### Korekty wobec dokumentów źródłowych (zweryfikowane)

| # | Dokumenty mówią | Rzeczywistość | Źródło |
|---|---|---|---|
| 1 | `ProviderV4` / `'v4'` | **V3** — stabilny pakiet ma tylko `ProviderV2`/`ProviderV3`. V4 jest na canary `4.0.0`. Budujemy na V3. | `@ai-sdk/provider/dist/index.d.ts:3390` |
| 2 | `embeddingModel` | ✅ `ProviderV3.embeddingModel(id)` wymagane; `textEmbeddingModel?` deprecated | jw. |
| 3 | `baseURL` ↔ `api.deapi.ai/api/v2` | **Tylko `oai.deapi.ai/v1`.** Native v2 = async job-polling, inny kontrakt | docs.deapi.ai/api/v2 |
| 4 | upload 80 MB | **audio 20 MB / video 50 MB / request 75 MB cap** | docs.deapi.ai/limits-and-quotas |
| 5 | bare voices nieważne | na OpenAI surface bare aliases (`alloy…shimmer`) ważne dla **Kokoro** | docs.deapi.ai/openai-compatibility |
| 6 | `experimental_generateImage` | image ma stabilny `generateImage`; speech/transcription nadal `experimental_*` | `ai/dist/index.d.ts:5098` |

---

## 1. Architektura (SOLID + KISS) + runtime target

**Zasada nadrzędna:** image + embeddings są realizowane przez modele OpenAI-compatible (zero custom request mappingu).
Custom klasy WYŁĄCZNIE dla speech + transcription. To realizuje KISS.

> **Świadomy wyjątek (Audit Simplify-2):** image + embeddings konstruują klasy
> `OpenAICompatibleImageModel` / `OpenAICompatibleEmbeddingModel` **bezpośrednio** (nie przez fabrykę
> `createOpenAICompatible`). Powód: fabryka nie pozwala wstrzyknąć leniwego (per-request) auth fetch
> ani własnej `errorStructure` deAPI. Bezpośrednia konstrukcja jest bardziej jawna, testowalna i
> umożliwia lazy auth + mapowanie błędów deAPI. Brzmienie „delegacja 1:1 do `createOpenAICompatible`"
> z wcześniejszych wersji planu jest tym samym zastąpione.

- **SRP** — jeden plik = jedna odpowiedzialność.
- **DIP** — custom modele zależą od abstrakcji transportu (`postJsonToApi`/`postFormDataToApi`), nie od gołego `fetch`; `fetch` wstrzykiwalny.
- **OCP** — model IDs `'slug' | (string & {})`; zero hardkodowanych list modeli w runtime.
- **ISP** — `speechModel`/`transcriptionModel` to opcjonalne metody `ProviderV3`, implementowane realnie; `languageModel` rzuca `NoSuchModelError`.

### Runtime target (edge-safe) — P1.7
- `engines.node`: `>=18`. CI matrix: Node 20 + 22.
- **Tylko Web APIs:** `fetch`, `Blob`, `File`, `FormData`, `Uint8Array`. **Bez** `Buffer`, `fs`, Node streams, `form-data` (npm). Dzięki temu paczka działa też na edge.

### Struktura plików
```
src/
├── index.ts                              # barrel: createDeAPI, deapi, typy publiczne
├── deapi-provider.ts                     # createDeAPI() → ProviderV3
├── deapi-config.ts                       # DeAPIProviderSettings, model-id types, resolveHeaders (lazy), baseURL normalize+guard
├── deapi-error.ts                        # dwa envelope'y błędów → failedResponseHandler
├── speech/
│   ├── deapi-speech-model.ts             # implements SpeechModelV3
│   └── deapi-speech-options.ts           # zod: kontrakt opcji speech
└── transcription/
    ├── deapi-transcription-model.ts      # implements TranscriptionModelV3
    └── deapi-transcription-options.ts    # zod: kontrakt opcji transcription
```

Pliki repo (governance — sekcja 9): `.github/workflows/{ci,release,live-smoke}.yml`,
`.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`, `SECURITY.md`,
`SUPPORT.md`, `LICENSE`, `eslint.config.js`, `package-lock.json` (commitowany), `examples/`.

---

## 2. Stage 1 — pakiet npm

### Faza P0 — fundament (zero zależności od audio)
1. Scaffold: `npm init`, `git init`, instalacja zależności (wersje przypięte przez npm, **nigdy `latest`**), `tsconfig` (strict), `tsup.config.ts` (`format:['esm','cjs']`, `dts`, `sourcemap`, `clean`), ESLint (P1.10 — realne narzędzie, nie pusty gate), `.gitignore`/`.npmignore`, `.env.example`.
2. **`deapi-config.ts`** — lazy auth + baseURL guard (P0.4, P0.6):
   - `DeAPIProviderSettings`: `apiKey?`, `baseURL?` (default `https://oai.deapi.ai/v1`), `headers?`, `fetch?`.
   - `resolveHeaders()` wołane **per request**: `loadApiKey({ apiKey, environmentVariableName:'DEAPI_API_KEY', description:'deAPI API key' })` + `combineHeaders`. Klucz nigdy przy konstrukcji.
   - `normalizeBaseURL()` przez `withoutTrailingSlash`; **ostrzeżenie/guard gdy `baseURL` zawiera `/api/v2`** (to native, nie OpenAI surface).
   - typy model-id: `'<slug>' | (string & {})` dla 4 modalności.
3. **`deapi-error.ts`** — DWA envelope'y (P0.2):
   - OpenAI: `{ error: { message, type?, param?, code? } }`
   - native/v2: `{ data: null, message, errors?, statusCode? }`
   - `deAPIErrorSchema = z.union([...])`; `createJsonErrorResponseHandler({ errorSchema, errorToMessage })`. Zachować status + wszystkie response headers + surowe body (z limitem). `Retry-After` tylko przepuszczany, **nie** wymagany ani testowany jako gwarantowany (P0.3). Brak agresywnego retry.
4. **`deapi-provider.ts`** — `createDeAPI()`:
   - `imageModel(id)`/`embeddingModel(id)` → konstrukcja `OpenAICompatibleImageModel` / `OpenAICompatibleEmbeddingModel` **bezpośrednio** (nie przez `createOpenAICompatible`), z wstrzykniętym leniwym auth `fetch` (rozwiązuje klucz per-request) + własną `errorStructure` deAPI — **lazy `headers`/auth, NIE eager `apiKey`** (P0.6). Patrz świadomy wyjątek w sekcji 1 (Audit Simplify-2).
   - `speechModel(id)`/`transcriptionModel(id)` → custom klasy (Faza P2).
   - aliasy `image`/`embedding`/`speech`/`transcription`.
   - `languageModel(id)` → `throw new NoSuchModelError(...)`. Bez callable, bez `videoModel`.
   - `export const deapi = createDeAPI()` — bezpieczne dzięki lazy auth.
5. Testy P0: factory, `specificationVersion==='v3'`, `NoSuchModelError`, **import bez env nie rzuca**, request bez env rzuca dopiero przy wywołaniu, jawny `apiKey` nadpisuje env, custom `headers`/`fetch`, per-call headers, `abortSignal`, baseURL join (z/bez trailing slash), guard `/api/v2`, oba envelope'y błędów.

### Faza P1 — image + embeddings (bezpośrednie klasy OpenAI-compatible, niskie ryzyko)
- Konstrukcja `OpenAICompatibleImageModel` / `OpenAICompatibleEmbeddingModel` bezpośrednio w `deapi-provider.ts` (lazy auth fetch + custom `errorStructure`; Audit Simplify-2). Testy: `generateImage({ model: deapi.image('Flux1schnell') })` → URL `oai.deapi.ai/v1/images/generations` + body; `embed({ model: deapi.embedding('Bge_M3_FP16') })` → 1024-dim. + live smoke obu.
- **Image editing guard (Audit Sec-4):** `OpenAICompatibleImageModel` routuje na `POST /images/edits`, gdy wywołanie zawiera `files`/`mask`. deAPI zwraca tu 400. W `0.1.0` ta ścieżka jest nieobsługiwana — provider odrzuca `files`/`mask` z `UnsupportedFunctionalityError`. Edits są planowane na `0.2.0` (wymagają live smoke).

### Faza P2 — speech + transcription (custom; główne ryzyko)
> **GATE P0.1 — audio live spike PRZED pisaniem klas.** Realnym kluczem potwierdzić:
> - `POST /v1/audio/speech`: request `{model,input,voice,response_format}`; odpowiedź to **realne audio bytes** (nie JSON z `request_id`/job); `Content-Type`.
> - `POST /v1/audio/transcriptions`: multipart pole to **`file`** (nie native `source_file`/`source_url`); `response_format=json|text|verbose_json`; realny shape błędu.
> Jeśli surface okaże się async/native-only → przeprojektować (poll lub odłożyć modalność). Bez tego smoke NIE implementujemy klas.

- **Speech (`SpeechModelV3`)** — wzór `packages/elevenlabs/.../elevenlabs-speech-model.ts`. `postJsonToApi` → `createBinaryResponseHandler` → `{ audio, warnings, request, response:{timestamp,modelId,headers} }`.
  - **Kontrakt opcji (P1.3)** — jawne mapowanie: `voice` (default bare alias, np. `alloy`), `outputFormat`→`response_format` (default `mp3`), `speed`, `language`, `instructions`, `providerOptions.deapi` (pass-through), `headers`, `abortSignal`. Niewspierane → `warnings`.
- **Transcription (`TranscriptionModelV3`)** — wzór `packages/elevenlabs/.../elevenlabs-transcription-model.ts` (multipart). `convertToFormData`/`postFormDataToApi`; pole `file` (Blob z `audio`+`mediaType`), `model`, `response_format`, opcjonalnie `language`.
  - **Kontrakt opcji (P1.3):** `audio`, `mediaType`, `filename`, `language`, `response_format`, `providerOptions.deapi`, `headers`, `abortSignal`. Niewspierane → `warnings`.
  - **Limity (P1.4):** audio-only, **20 MB/plik, 75 MB cap requestu**. Walidować rozmiar po stronie providera z czytelnym błędem.
  - **URL ingest (P1.6):** NIE obietnica AI SDK. `experimental_transcribe` pobiera URL→bytes po stronie SDK. Native `source_url` tylko jako opcjonalne `providerOptions.deapi.sourceUrl` + własny test, albo opisane jako native-REST poza providerem.
- Testy P2 + live smoke obu modalności.

### Faza P3 — packaging, README, CI
- **package.json (dual ESM/CJS udowodniony, P0.5):**
```json
{
  "name": "@deapi/ai-sdk-provider",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=18" },
  "files": ["dist", "README.md", "LICENSE"],
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.mjs", "require": "./dist/index.cjs" } },
  "publishConfig": { "access": "public", "provenance": true },
  "peerDependencies": { "ai": ">=6 <7" },
  "repository": "...", "homepage": "...", "bugs": "..."
}
```
  `dependencies` = realnie przypięte wersje. `tsup` emituje `index.mjs`/`index.cjs`/`index.d.ts`.
- **README** — installation, przykład per-modalność, fallback (`@ai-sdk/openai-compatible` z `baseURL`), **claims audit (P1.9):** każda obietnica ma test/smoke albo oznaczenie jako native-REST. Ograniczenia: brak LLM/chat/tool-calling, video poza zakresem. Nota legal/trademark (P2.4).

---

## 3. Testy — pełne pokrycie logiki (gate)

**Coverage (P1.1):** 100% branch/function dla logiki krytycznej — auth, URL joining, error mapping
(oba envelope'y), speech request mapping, transcription multipart, warnings. Globalnie 95–100%.
Z coverage wyłączone tylko typy i barrel, **nie** logika.

**Mock/contract (Vitest, CI)** przez realne funkcje AI SDK na mock `fetch` — przypadki:
- factory/aliasy/`specificationVersion`; `languageModel`→`NoSuchModelError`
- import bez env nie rzuca; request bez env rzuca; jawny `apiKey` > env; custom `headers`/`fetch`; per-call headers; `abortSignal`
- image (URL+body), embedding (1024-dim)
- speech: binary response, body mapping, niewspierana opcja→warning, błędny `Content-Type` audio, niepoprawny binary
- transcription: multipart `file`, parsowanie `json`/`text`/`verbose_json`, zły field name, pusty transcript
- error matrix: `401/403/404/422/429/5xx`, invalid JSON, non-JSON, **oba envelope'y**, timeout/network, `AbortError`, header/request-id propagation, raw body limit
- baseURL z/bez trailing slash; guard `/api/v2`
- typecheck snippetów README

**Packaging smoke (CI, P0.5):** `build` → `npm pack --json` (allowlist) → instalacja tarballa w czystym projekcie → `import()` (ESM) + `require()` (CJS) + typy + import bez env.

**Live smoke (manualny workflow, P0.7):** `workflow_dispatch`, sekret `DEAPI_API_KEY`, preflight `GET /v1/models`, sekwencyjnie image/embedding/speech/transcription z respektem rate-limit, wynik jako artefakt, ostrzeżenie kosztowe. **Poza** default CI.

**CI:** `npm ci → typecheck → lint → test(coverage) → build → pack --dry-run → consumer smoke` (Node 20+22).

---

## 9. Release governance & operations (NOWE — wymóg produktu publicznego)

- **Trusted publishing (P0.8):** GitHub Actions release workflow, OIDC / npm trusted publishing, protected environment, manual approval, `npm publish --provenance`, git tag, GitHub Release, `npm view @deapi/ai-sdk-provider version` po publikacji. **Nie publikować z laptopa.**
- **Governance (P0.9):** `CODEOWNERS`, `SECURITY.md`, `SUPPORT.md`, issue/PR templates, triage labels, owner + backup owner, procedura security disclosure, emergency patch, `npm deprecate`, zasada „nie `unpublish`", komunikacja regresji. SLA: security P0 triage 1 dzień roboczy, regression P1 2 dni, docs best-effort.
- **Supply chain (P1.8):** commitowany `package-lock.json`, `npm ci`, `npm pack --json` allowlist + audit zawartości przed publish, Dependabot/Renovate, pinowane GitHub Actions (SHA dla release), brak `.npmrc` z tokenem, brak sekretów w examples/snapshots/logs.
- **Compatibility policy (P2.3):** `ai` `>=6 <7`; definicja breaking; plan na `ai@7`; nowe modele deAPI nie wymagają release (string passthrough); wspierane runtime'y.
- **Monitoring po publikacji (P2.5):** GitHub issues, npm downloads, failed release workflows, upstream `ai` releases, zmiany docs/API deAPI, feedback PR Vercel.

---

## 4. Stage 2 — docs PR do `vercel/ai` (po publikacji npm)

- **Ordinal (P2.2):** zweryfikowany max `51-` (kolizja `51-nia`+`51-zeroentropy`) → `52-deapi.mdx`, ale **ponownie sprawdzić przy PR** (pobrać świeży `main`).
- `52-deapi.mdx` + 1 linia w `02-providers-and-models.mdx`. Template: `41-soniox.mdx`. Korekty: baseURL OpenAI-only (usunąć `/api/v2`), transkrypcja 20 MB audio-only, image `generateImage` stable, voices tylko Kokoro/OpenAI (P1.5 — nie dokumentować Chatterbox/Qwen3 globalnie bez potwierdzenia), video jako native-REST.
- **Claims audit:** docs nie opisują modalności, która nie przeszła live smoke.

---

## 5. Zakres i sekwencja

**Rekomendacja review (domyślna) — fazowo, mniejszy blast radius:**
- `0.1.0` = **image + embeddings** (+ pełny hardening, packaging, governance, live smoke, docs PR dla realnego zakresu).
- `0.2.0` = **speech + transcription** po osobnym audio spike + hardeningu.

**Alternatywa (jeśli biznes wymaga 4-w-1 w `0.1.0`)** — dodatkowy gate: audio spike przed implementacją, pełny live smoke 4 modalności, error matrix speech/transcription, 2 niezależne review przed publish, README z ograniczeniami, plan rollback/deprecate.

> Decyzja zakresu pozostaje otwarta (Twój pierwotny kierunek „całość" vs rekomendacja review). Domyślnie realizuję fazowo; nadpisywalne.

Estymacja: image+embeddings 2–3 dni, speech+transcription 2–4 dni, packaging/CI/governance/release 2–3 dni, docs PR 0.5–1 dzień.

---

## 6. Czego NIE robić
- `languageModel`/`.chat()`/`.completion()` jako działające — rzuca `NoSuchModelError`.
- Video przez interfejs AI SDK (`ProviderV3` nie ma `videoModel`).
- Native v2 baseURL mieszane z providerem OpenAI-compatible.
- Hardkodowane slugi/wersje (`latest`); eager auth; callable provider.
- PR do Vercel bez opublikowanej paczki; live smoke w default CI; publish z laptopa.
- Obietnice w docs/README bez testu lub live smoke.

## 7. Finalny gate przed `npm publish` (SCOPE-AWARE — Audit Blocker-1)

Gate jest **świadomie zależny od zakresu wersji**. Live smoke pokrywa **tylko modalności faktycznie
wystawione w danej wersji**, nie wszystkie cztery. Speech/transcription nie należą do gate'u `0.1.0`.

**Wspólne kroki (każda wersja):**
clean `npm ci` → typecheck → lint → unit/contract → coverage threshold → build → `npm pack --json`
allowlist → tarball consumer smoke (ESM import + CJS require + typy + import bez env + mock request) →
README snippet typecheck → metadata license/repository → SECURITY/SUPPORT → trusted publishing ready →
**jawna zgoda użytkownika (outward-facing)**.

**Live smoke — zależnie od zakresu:**

- **`0.1.0` (image + embeddings ONLY):** manual live smoke workflow → preflight `GET /v1/models` +
  **image** (`generateImage`) + **embeddings** (`embed`). **NIE** wymaga speech/transcription —
  te modalności nie są w tej wersji wystawione. Dodatkowo: potwierdzić guard image editing
  (`files`/`mask` → `UnsupportedFunctionalityError`, Audit Sec-4).
- **`0.2.0` (speech + transcription):** po osobnym audio spike (GATE P0.1) manual live smoke rozszerzony
  o **speech** (`POST /v1/audio/speech`) + **transcription** (`POST /v1/audio/transcriptions`),
  obok już istniejących image + embeddings.

> Zasada: każda modalność opisana jako wspierana w README danej wersji MUSI przejść live smoke tej
> wersji; modalności odłożone do przyszłej wersji NIE blokują bieżącego gate'u.

## 8. Finalny gate przed docs PR
paczka publiczna na npm → publiczne repo + README zgodny z paczką → tagged release → live smoke każdej opisanej modalności → recheck ordinala → lokalny docs build `vercel/ai` → link check → claims audit.

---

## 10. Housekeeping
Stare dokumenty (`IMPLEMENTATION_PLAN.md`, `VercelAISDK.md`, `VercelAISDK-JIRA.md`,
`ANALIZA_PLANU_VERCEL_AI_SDK.md`) oznaczone bannerem „SUPERSEDED → PLAN_WDROZENIA.md" (P2.1).
