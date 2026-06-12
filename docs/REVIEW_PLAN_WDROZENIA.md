# Review planu wdrożenia `@deapi/ai-sdk-provider`

Data review: 2026-06-12

Analizowany dokument:

- `PLAN_WDROZENIA.md`

Kontekst pomocniczy:

- `ANALIZA_PLANU_VERCEL_AI_SDK.md`
- `IMPLEMENTATION_PLAN.md`
- `VercelAISDK.md`
- `VercelAISDK-JIRA.md`

Do weryfikacji uruchomiono 6 subagentów:

- Vercel AI SDK/API contracts
- TypeScript/package architecture
- deAPI/backend integration
- QA/CI/release
- docs/Vercel PR/community provider positioning
- delivery/security/business risk

4 subagenty oddały pełne raporty. 2 agenty od SDK contracts i docs/Vercel PR utknęły na długim researchu i zostały zamknięte; ich zakres został domknięty ręcznie na bazie oficjalnych źródeł Vercel AI SDK i deAPI.

## Werdykt

`PLAN_WDROZENIA.md` jest znacząco lepszy niż poprzednie dokumenty. Poprawia najważniejsze błędy:

- przejście z nieaktualnego `ProviderV4` na stabilne `ProviderV3`
- lazy auth zamiast eager auth
- brak callable `deapi(id)`
- poprawne rozdzielenie OpenAI-compatible `baseURL` od native REST v2
- poprawiony CJS export na `.cjs`
- użycie stabilnego `generateImage`
- korekta limitu transkrypcji na 20 MB per audio file / 75 MB total request cap
- docs PR dopiero po publikacji paczki npm

Plan nadaje się jako baza implementacyjna, ale nie jest jeszcze wystarczająco twardy jako publiczna wizytówka firmy. Największe braki dotyczą:

- niepotwierdzonego kontraktu audio na OpenAI-compatible surface
- niedookreślonego release governance
- niedookreślonego trusted publishing/provenance
- zbyt ogólnego live smoke gate
- zbyt ambitnego zakresu `0.1.0`
- braku procedur po publikacji: ownership, security, rollback, support

## P0 — blokery przed implementacją/publicznym release

### 1. Audio jest opisane zbyt pewnie

Plan zakłada synchroniczne OpenAI-compatible payloady dla:

- `POST https://oai.deapi.ai/v1/audio/speech`
- `POST https://oai.deapi.ai/v1/audio/transcriptions`

To trzeba potwierdzić live smoke przed implementacją custom klas.

Minimalny spike:

1. `POST /audio/speech`
   - sprawdzić request payload
   - sprawdzić `Content-Type`
   - sprawdzić, czy odpowiedź to realne audio bytes
   - sprawdzić, czy nie jest to JSON z `request_id`, `url`, job status albo innym asynchronicznym kształtem

2. `POST /audio/transcriptions`
   - sprawdzić, czy multipart field to faktycznie OpenAI-compatible `file`
   - sprawdzić, czy nie jest wymagane native v2 `source_file` / `source_url`
   - sprawdzić `response_format=json/text/verbose_json`
   - sprawdzić realny shape błędów

Powód: native v2 deAPI dla audio/transcription jest job-based i ma inne nazwy pól. OpenAI-compatible docs deklarują kompatybilność, ale publiczny provider nie powinien bazować na założeniu bez smoke.

### 2. Error handler musi obsłużyć dwa envelope'y błędów

Plan opisuje głównie shape v2:

```json
{
  "data": null,
  "message": "...",
  "errors": {},
  "statusCode": 422
}
```

OpenAI-compatible surface może zwracać:

```json
{
  "error": {
    "message": "...",
    "type": "...",
    "param": "...",
    "code": "..."
  }
}
```

Implementacja `deapi-error.ts` musi akceptować oba formaty. Testy powinny obejmować oba.

### 3. Nie obiecywać `Retry-After` jako pewnego kontraktu

Plan słusznie mówi o zachowaniu `Retry-After`, ale nie powinien wymagać go jako obowiązkowego nagłówka.

Poprawne podejście:

- zachować wszystkie response headers
- jeśli `Retry-After` istnieje, udostępnić go użytkownikowi
- nie testować `Retry-After` jako gwarantowanego
- nie dodawać agresywnego retry dla kosztownych requestów image/TTS/transcription

### 4. `baseURL` musi być jawnie OpenAI-compatible only

`baseURL` w `DeAPIProviderSettings` powinien znaczyć wyłącznie:

```txt
https://oai.deapi.ai/v1
```

Nie wolno sugerować, że:

```txt
https://api.deapi.ai/api/v2
```

jest zamienne. Native v2 ma inny kontrakt.

Rekomendacja:

- w README napisać wprost: `baseURL` must point to the OpenAI-compatible deAPI endpoint
- dodać test URL joining dla baseURL bez trailing slash
- rozważyć walidację/ostrzeżenie, jeśli `baseURL` zawiera `/api/v2`

### 5. Dual package musi być udowodniony, nie tylko zadeklarowany

Plan poprawił `require` na `.cjs`, ale trzeba dopisać szczegóły:

- `tsup` ma jawnie emitować:
  - `dist/index.mjs`
  - `dist/index.cjs`
  - `dist/index.d.ts`
- `package.json` powinien mieć:
  - `main`
  - `module`
  - `types`
  - `exports`

Minimalny `package.json`:

```json
{
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  }
}
```

Consumer smoke musi sprawdzić tarball:

```bash
node -e "import('@deapi/ai-sdk-provider')"
node -e "require('@deapi/ai-sdk-provider')"
```

oraz import bez `DEAPI_API_KEY`.

### 6. Lazy auth musi obejmować `createOpenAICompatible`

Nie wystarczy mieć `resolveHeaders()` w custom speech/transcription.

Krytyczne:

- nie przekazywać do `createOpenAICompatible()` gotowego `apiKey`, jeśli wymusza to eager read
- użyć lazy `headers`/hooka zgodnego z realną sygnaturą `@ai-sdk/openai-compatible@2.0.49`
- przetestować import paczki bez env var
- przetestować request bez env var, który powinien rzucić dopiero przy wywołaniu
- przetestować jawne `apiKey`, które nadpisuje env

### 7. Live smoke lokalnie to za słaby gate

Plan mówi o live smoke poza CI. To jest dobre jako uzupełnienie, ale za słabe jako release evidence.

Rekomendacja:

- dodać manualny GitHub Actions workflow `workflow_dispatch`
- sekret `DEAPI_API_KEY`
- sekwencyjne wywołania z limitami rate limit
- zapisany wynik jako artefakt/log
- ostrzeżenie kosztowe
- brak live smoke w default CI

### 8. Provenance wymaga trusted publishing

`publishConfig: { "provenance": true }` nie wystarczy jako release control.

Rekomendowany release flow:

1. GitHub Actions release workflow.
2. OIDC / npm trusted publishing.
3. Protected environment.
4. Manual approval.
5. `npm publish --provenance`.
6. Git tag.
7. GitHub Release.
8. `npm view @deapi/ai-sdk-provider version` po publikacji.

Nie publikować publicznej paczki z laptopa, jeśli ma to być firmowa wizytówka.

### 9. Brakuje release governance i operations

Przed publicznym `npm publish` powinny istnieć:

- `CODEOWNERS`
- `SECURITY.md`
- `SUPPORT.md`
- issue templates
- pull request template
- triage labels
- owner i backup owner
- procedura security disclosure
- procedura emergency patch
- procedura `npm deprecate`
- zasady, kiedy nie używać `unpublish`
- komunikacja regresji

Minimalne SLA do rozważenia:

- security P0: triage w 1 dzień roboczy
- regression P1: triage w 2 dni robocze
- docs/support: best effort

### 10. Zakres `0.1.0` z 4 modalnościami jest reputacyjnie ryzykowny

Plan zakłada `0.1.0 = image + embeddings + speech + transcription`.

Technicznie jest to możliwe, ale reputacyjnie zwiększa blast radius. Najbezpieczniejszy pierwszy publiczny release:

- `0.1.0`: image + embeddings
- `0.2.0`: speech + transcription po osobnym hardeningu

Jeśli biznesowo musi być release z 4 modalnościami, to dodać gate:

- osobny live audio spike przed implementacją
- pełny live smoke 4 modalności
- error matrix dla speech/transcription
- 2 niezależne review przed publish
- README z ograniczeniami
- rollback/deprecate plan

## P1 — ważne poprawki jakościowe

### 1. Coverage 100% jako globalny gate jest przesadzone

100% coverage brzmi profesjonalnie, ale może prowadzić do testów pisanych pod licznik.

Lepszy gate:

- 100% branch/function dla:
  - auth
  - URL joining
  - error mapping
  - speech request mapping
  - transcription multipart
  - warnings
- 95-100% globalnie
- obowiązkowe contract tests
- obowiązkowy tarball consumer smoke
- obowiązkowy live smoke przed publish

Jeśli zostaje 100%, wyłączyć tylko typy i barrel files, nie logikę.

### 2. Contract tests wymagają dodatkowych przypadków

Dodać:

- `404`
- timeout/network error
- `AbortError`
- request id/header propagation
- błędny `Content-Type` dla audio
- niepoprawny binary response
- zły multipart field name
- `baseURL` z trailing slash i bez trailing slash
- brak env var przy imporcie
- brak env var przy requestcie
- raw body limit w błędach

### 3. Provider options muszą być kontraktem, nie interpretacją

Plan nadal opisuje część opcji zbyt miękko.

Trzeba jawnie zdecydować mapowanie dla speech:

- `voice`
- `outputFormat` / `response_format`
- `speed`
- `language`
- `instructions`
- `providerOptions.deapi`
- `headers`
- `abortSignal`

I dla transcription:

- `audio`
- `mediaType`
- `filename`
- `language`
- `response_format`
- `providerOptions.deapi`
- `headers`
- `abortSignal`

Niewspierane opcje powinny generować `warnings`.

### 4. Transcription limits opisać precyzyjniej

Aktualne docs deAPI mówią:

- audio upload: 20 MB
- video upload: 50 MB
- total request body: 75 MB

Jeśli provider AI SDK wspiera tylko audio, docs powinny mówić: audio only, 20 MB per file, 75 MB total cap.

### 5. Voices opisać tylko w zakresie Kokoro/OpenAI-compatible

Bare aliases:

- `alloy`
- `echo`
- `fable`
- `onyx`
- `nova`
- `shimmer`

są bezpieczne jako OpenAI-compatible aliases dla Kokoro.

Nie dokumentować ich globalnie dla Chatterbox/Qwen3, jeśli nie zostały potwierdzone.

### 6. URL ingest nie powinien być obietnicą AI SDK providera

Native v2 ma `source_url`, ale OpenAI transcription standard używa `file`.

W AI SDK `experimental_transcribe` może pobrać URL po stronie SDK i przekazać bytes do providera. To nie jest to samo, co native URL ingest deAPI.

Rekomendacja:

- nie obiecywać URL ingest w providerze bez osobnego smoke
- ewentualnie opisać jako native REST capability poza AI SDK providerem
- jeśli wspierane przez provider options, dodać jawny `providerOptions.deapi.sourceUrl` i test

### 7. Node/runtime support doprecyzować

Plan mówi o Node v22 jako środowisku dev. Publiczna paczka powinna mieć runtime target:

```json
{
  "engines": {
    "node": ">=18"
  }
}
```

albo inny target zgodny z AI SDK v6 i Web APIs.

Testować minimum:

- Node 20
- Node 22

Jeśli celem jest edge runtime:

- nie używać `Buffer`
- nie używać `fs`
- nie używać Node streams
- nie używać `form-data` npm
- używać Web APIs: `Blob`, `File`, `FormData`, `Uint8Array`, `fetch`

### 8. Supply chain checklist

Dodać:

- commitowany `package-lock.json`
- `npm ci` w CI
- `npm pack --json` allowlist
- audit zawartości paczki przed publish
- Dependabot/Renovate
- GitHub Actions pinowane przynajmniej do major, najlepiej SHA dla release workflow
- brak `.npmrc` z tokenem
- brak sekretów w examples, snapshots i logs

### 9. README i docs claims audit

Każda obietnica w README i Vercel docs powinna mieć:

- unit/contract test
- albo live smoke result
- albo jasne oznaczenie jako native REST capability poza providerem

Docs nie mogą opisywać speech/transcription, jeśli paczka nie przeszła live smoke tych modalności.

### 10. `lint` musi mieć narzędzie

Plan wymienia `lint` w CI, ale scaffold nie dodaje ESLint.

Opcje:

- dodać ESLint i config
- albo usunąć `lint` z gate

Nie zostawiać pustego gate'a.

## P2 — poprawki porządkowe

### 1. Oznaczyć stare dokumenty jako superseded

`ANALIZA_PLANU_VERCEL_AI_SDK.md` i starsze dokumenty zawierają elementy V4 oraz wcześniejsze rekomendacje.

Rekomendacja:

- dodać na górze `ANALIZA_PLANU_VERCEL_AI_SDK.md` informację, że dokument jest historyczny
- wskazać `PLAN_WDROZENIA.md` jako aktualne źródło prawdy

### 2. Docs ordinal `52-deapi.mdx` traktować jako tymczasowy

Przed PR do Vercel:

- pobrać najnowszy `vercel/ai`
- sprawdzić aktualny najwyższy ordinal
- dopiero wtedy wybrać finalną nazwę pliku

### 3. Dodać compatibility policy

Opisać:

- obsługiwany zakres `ai`: `>=6 <7`
- kiedy zmiana jest breaking
- co robić przy `ai@7`
- czy nowe modele deAPI wymagają release paczki
- które runtime'y są wspierane

### 4. Dodać legal/trademark note

README powinien mieć neutralne sformułowanie:

> This package is a community provider for the AI SDK. It is not affiliated with Vercel or OpenAI unless explicitly stated.

Oraz:

- `LICENSE`
- `repository`
- `homepage`
- `bugs`
- copyright

### 5. Monitoring po publikacji

Dodać lightweight monitoring:

- GitHub issues
- npm downloads
- failed release workflows
- upstream `ai` releases
- deAPI docs/API changes
- Vercel docs PR feedback

## Co plan robi dobrze

- Poprawnie traktuje `PLAN_WDROZENIA.md` jako zastępstwo dla starszych dokumentów.
- Bazuje na stabilnym `ProviderV3`, nie canary.
- Rozdziela OpenAI-compatible od native REST v2.
- Przewiduje lazy auth.
- Usuwa callable provider alias.
- Dobrze dobiera `image + embeddings` do `@ai-sdk/openai-compatible`.
- Słusznie traktuje speech/transcription jako custom classes.
- Poprawia `generateImage` na stabilny import.
- Poprawia limity transkrypcji względem starszych dokumentów.
- Zakłada `npm pack` i consumer smoke.
- Zakłada docs PR dopiero po publikacji npm.

## Najważniejsza rekomendowana zmiana w planie

Dodać sekcję:

```md
## 9. Release governance & operations
```

Powinna zawierać:

- trusted publishing / provenance
- protected release environment
- live smoke workflow
- CODEOWNERS
- SECURITY.md
- SUPPORT.md
- issue templates
- triage labels
- owner i backup owner
- emergency patch/deprecate policy
- secret handling
- claims audit dla README i Vercel docs
- compatibility policy
- supply chain checklist

Bez tej sekcji plan jest dobrym planem technicznym, ale jeszcze nie planem publicznego produktu klasy firmowej.

## Minimalny finalny gate przed `npm publish`

Przed publikacją:

1. Clean `npm ci`.
2. Typecheck.
3. Lint albo jawnie brak lint.
4. Unit/contract tests.
5. Coverage threshold.
6. Build.
7. `npm pack --json` allowlist.
8. Tarball consumer smoke:
   - ESM import
   - CJS require
   - typy
   - import bez env
   - mockowany request
9. Manual live smoke workflow:
   - `GET /v1/models` preflight
   - image
   - embeddings
   - speech
   - transcription
10. README snippet typecheck.
11. License/repository metadata.
12. Security/support docs.
13. Trusted publishing ready.
14. Jawna zgoda użytkownika na outward-facing publish.

## Minimalny finalny gate przed docs PR do Vercel

1. Paczka publiczna na npm.
2. Publiczne repo GitHub.
3. README zgodny z realną paczką.
4. Tagged release.
5. Live smoke dla każdej opisanej modalności.
6. Ponowny check ordinala MDX.
7. Lokalny docs build `vercel/ai`.
8. Link check.
9. Claims audit: brak obietnic bez testu/smoke.

## Źródła użyte do weryfikacji

- Vercel custom providers: https://ai-sdk.dev/providers/community-providers/custom-providers
- AI SDK image generation: https://ai-sdk.dev/docs/ai-sdk-core/image-generation
- AI SDK speech: https://ai-sdk.dev/docs/ai-sdk-core/speech
- AI SDK transcription: https://ai-sdk.dev/docs/ai-sdk-core/transcription
- AI SDK video generation: https://ai-sdk.dev/docs/ai-sdk-core/video-generation
- deAPI OpenAI compatibility: https://docs.deapi.ai/openai-compatibility

