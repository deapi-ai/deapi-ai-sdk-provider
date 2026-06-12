> ⚠️ **SUPERSEDED (2026-06-12)** — dokument historyczny (rekomendował V4). Aktualne źródło prawdy: **`PLAN_WDROZENIA.md`**.

# Analiza planu wdrożenia deAPI jako community provider Vercel AI SDK

Data analizy: 2026-06-12

Analizowane pliki:

- `IMPLEMENTATION_PLAN.md`
- `VercelAISDK.md`
- `VercelAISDK-JIRA.md`

W analizie uczestniczyło 5 niezależnych subagentów:

- specjalista Vercel AI SDK API i zgodności providerów
- specjalista TypeScript/package architecture
- specjalista backend/API integration
- specjalista QA/testów/CI/release
- specjalista delivery/project planning

## Werdykt

Plan jest kierunkowo poprawny, ale wymaga korekt przed implementacją. Dwustopniowy proces jest właściwy:

1. Najpierw zbudować i opublikować pakiet npm `@deapi/ai-sdk-provider`.
2. Dopiero potem wysłać PR z dokumentacją do `vercel/ai`.

To założenie jest realne i zgodne z aktualnym modelem community providerów Vercel AI SDK: Vercel nie hostuje kodu providera, tylko linkuje do istniejącego repo i paczki npm.

Największy problem planu: miesza poprawne założenia z kilkoma informacjami, które są już nieaktualne albo zbyt kategoryczne. Implementacji nie należy zaczynać od kopiowania szkiców z dokumentów. Pierwszym krokiem musi być spike aktualnych typów z realnie zainstalowanych paczek `@ai-sdk/*`.

Aktualnie zweryfikowane wersje npm:

- `ai`: `6.0.202`
- `@ai-sdk/provider`: `3.0.10`
- `@ai-sdk/openai-compatible`: `2.0.49`

## Co jest realne

Zakres `image + embeddings + speech + transcription` jest technicznie wykonalny.

Najbardziej realne i najmniej ryzykowne są:

- `image` przez OpenAI-compatible endpoint `POST /v1/images/generations`
- `embeddings` przez OpenAI-compatible endpoint `POST /v1/embeddings`

Te dwie modalności powinny być podstawą MVP, ponieważ mogą w dużej mierze delegować do `@ai-sdk/openai-compatible`.

Speech i transcription są możliwe, ale wymagają pełnej custom implementacji:

- `SpeechModelV4`
- `TranscriptionModelV4`
- własny transport HTTP
- multipart/form-data
- mapowanie opcji AI SDK na payload deAPI
- parsowanie odpowiedzi
- error handling
- testy kontraktowe

`languageModel()` powinien istnieć i rzucać `NoSuchModelError`, ponieważ deAPI nie serwuje LLM/chat, ale `ProviderV4` wymaga tej metody.

## Krytyczne problemy do poprawy

### 1. Brakuje `specificationVersion: 'v4'` na providerze

Plan mówi o `ProviderV4`, ale szkic w dokumentach nie pokazuje ustawienia:

```ts
specificationVersion: 'v4'
```

To jest wymagane przez aktualny `ProviderV4`. Bez tego implementacja nie będzie poprawnym providerem AI SDK.

### 2. Nie wolno eager-loadować API key przy imporcie

Ryzykowny wzorzec:

```ts
export const deapi = createDeAPI();
```

jeśli `createDeAPI()` od razu wywołuje `loadApiKey()`.

Skutek: sam import paczki może rzucać błąd, gdy nie ma `DEAPI_API_KEY`, szczególnie w testach, browser/edge albo narzędziach typu bundler/typecheck.

Rekomendacja:

- `createDeAPI()` buduje provider bez odczytu sekretu
- API key jest rozwiązywany leniwie w `headers()` albo tuż przed requestem
- użytkownik może przekazać `apiKey` jawnie
- `DEAPI_API_KEY` jest fallbackiem server-side

### 3. Nie robić callable `deapi(modelId)` jako aliasu do image

Callable provider w ekosystemie AI SDK sugeruje zwykle model językowy. Dla deAPI byłoby to mylące.

Rekomendowane API:

```ts
deapi.image('Flux1schnell')
deapi.embedding('Bge_M3_FP16')
deapi.speech('Kokoro')
deapi.transcription('WhisperLargeV3')
deapi.languageModel('...') // rzuca NoSuchModelError
```

### 4. Poprawić importy przykładów AI SDK

Plan używa `experimental_generateImage`, ale aktualne docs AI SDK v6 pokazują stabilne:

```ts
import { generateImage } from 'ai';
```

Speech i transcription są nadal opisane jako experimental feature, a przykłady docs używają:

```ts
import { experimental_generateSpeech as generateSpeech } from 'ai';
import { experimental_transcribe as transcribe } from 'ai';
```

Video pozostaje eksperymentalne:

```ts
import { experimental_generateVideo as generateVideo } from 'ai';
```

### 5. Video wymaga zmiany uzasadnienia

Plan mówi, że AI SDK nie ma video interface. To jest już zbyt kategoryczne.

Aktualny stan:

- `ProviderV4` nadal nie ma `videoModel()`
- AI SDK ma eksperymentalne video generation API
- upstream ma typy video, ale nie należy mieszać tego do v0.1 bez osobnej implementacji i testów

Rekomendowany zapis w docs:

> Video is available through deAPI native/OpenAI-compatible REST APIs. AI SDK provider support for video is not included in this release and may be added as an experimental follow-up.

### 6. Nie mieszać `baseURL` OpenAI-compatible i native REST v2

Dla providera AI SDK `baseURL` powinien oznaczać OpenAI-compatible surface:

```txt
https://oai.deapi.ai/v1
```

Nie należy sugerować, że użytkownik może po prostu ustawić:

```txt
https://api.deapi.ai/api/v2
```

jako zamiennik. Native REST v2 ma inną powierzchnię API, inne endpointy i potencjalnie inne payloady.

Jeśli kiedyś ma być wsparcie native API, powinno to być osobne:

- `nativeBaseURL`
- osobny helper REST
- albo osobny klient, nie ten sam provider path

### 7. Zaktualizować limity i voice docs deAPI

Lokalny plan zawiera rozjazdy względem aktualnych deAPI docs:

- plan mówi o transkrypcji do 80 MB
- aktualne deAPI OpenAI Compatibility docs mówią o 20 MB per file i 75 MB request cap
- plan mówi, że bare voices typu `alloy` nie są valid
- aktualne deAPI docs mówią, że Kokoro wspiera OpenAI voice aliases: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

Przed docs PR trzeba jeszcze raz zweryfikować:

- limity uploadu
- voice aliases
- model slugi
- ceny
- rozmiary embeddingów
- formaty audio

## Braki w planie implementacji

### Transport i błędy

Plan wymienia `deapi-error.ts`, ale nie definiuje realnej strategii.

Potrzebne są testowane zachowania dla:

- `401`
- `403`
- `404`
- `422`
- `429`
- `5xx`
- błędny JSON
- non-JSON response
- binary audio response
- pusty transcript
- timeout
- abort signal

Minimum: zachować status, headers, request id, raw body i provider-specific error code, jeśli istnieje.

### Rate limit i retry

Nie należy dodawać agresywnego retry dla kosztownych requestów image/TTS/transcription bez jasnej polityki.

Rekomendacja:

- respektować `Retry-After`
- nie ukrywać `429`
- retry tylko dla bezpiecznych przypadków i z ograniczeniami
- dokumentować brak automatycznego retry, jeśli zostanie tak zdecydowane

### Provider metadata

Custom modele powinny zwracać sensowne metadata:

- timestamp
- modelId
- response headers
- raw response body tam, gdzie bezpieczne
- warnings
- providerMetadata, jeśli deAPI zwraca użyteczne pola

### Provider options

Speech i transcription wymagają decyzji, jak mapować:

- `voice`
- `outputFormat` / `response_format`
- `speed`
- `language`
- `instructions`
- `providerOptions.deapi`
- per-call headers
- abortSignal

Niewspierane opcje powinny generować warnings, nie być cicho ignorowane.

### Image edits

Plan wspomina modele z image editing / multi-reference editing, ale implementacja opisuje głównie `/v1/images/generations`.

Trzeba zweryfikować, czy `@ai-sdk/openai-compatible` używa `/v1/images/edits` w formacie zgodnym z deAPI oraz czy deAPI obsługuje wymagane pola bez mask/inpainting.

## Architektura pakietu

Proponowana struktura folderów jest sensowna, ale można ją uprościć.

Rekomendowany minimalny układ:

```txt
src/
├── index.ts
├── deapi-provider.ts
├── deapi-config.ts
├── deapi-error.ts
├── speech/
│   └── deapi-speech-model.ts
└── transcription/
    └── deapi-transcription-model.ts
```

Osobne klasy dla image/embedding nie są konieczne, jeśli będą tylko delegować 1:1 do `createOpenAICompatible()`.

Typy model IDs mogą być autocomplete-friendly, ale nie powinny blokować nowych modeli:

```ts
type DeAPIImageModelId = 'Flux1schnell' | (string & {});
type DeAPIEmbeddingModelId = 'Bge_M3_FP16' | (string & {});
```

Runtime nie powinien hardcodować listy modeli.

## Packaging

Plan wymaga poprawy przy ESM/CJS.

Ryzyko: `type: "module"` plus `require: "./dist/index.js"` jest błędne, jeśli `index.js` jest CJS, bo przy `type: "module"` pliki `.js` są ESM.

Opcje:

1. ESM-only, zgodnie z kierunkiem nowoczesnych pakietów AI SDK.
2. Dual package, ale z poprawnym CJS outputem, np. `index.cjs`, i testem `require()`.

Rekomendowane pola:

```json
{
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public",
    "provenance": true
  },
  "peerDependencies": {
    "ai": ">=6 <7"
  }
}
```

Nie publikować `latest` w `package.json`. Zależności mają mieć realne zakresy wersji wynikające z instalacji i testów.

## Testy i CI

Obecne testy mock-only są za słabe jako gate dla publicznej paczki providera.

Minimalny zestaw testów:

- factory: `createDeAPI()`, aliasy, `specificationVersion`
- `languageModel()` rzuca `NoSuchModelError`
- brak env var nie psuje importu
- lazy API key działa
- custom `headers`
- custom `fetch`
- per-call headers
- `abortSignal`
- image przez realne `generateImage` na mockowanym fetchu
- embeddings przez realne `embed` na mockowanym fetchu
- speech przez realne `experimental_generateSpeech`
- transcription przez realne `experimental_transcribe`
- error paths: `401`, `429`, `5xx`, invalid JSON
- multipart body dla transcription
- binary response dla speech
- typecheck przykładów README
- `npm pack`
- instalacja tarballa w czystym projekcie
- ESM import
- ewentualny CJS require, jeśli CJS jest wspierane

Rekomendowany CI:

```txt
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
consumer smoke test z tarballa
```

Live smoke testy:

- poza default CI
- manual workflow albo lokalny skrypt
- z sekretem `DEAPI_API_KEY`
- małe prompty i małe pliki audio
- jawny koszt testów

## Realna estymacja

Ocena z planu jest zbyt optymistyczna dla pełnych 4 modalności.

Realistycznie:

- `image + embeddings` MVP: 2-3 dni
- `speech + transcription`: dodatkowe 2-4 dni
- packaging, README, CI, smoke, release hygiene: 1-2 dni
- docs PR: 0.5-1 dzień po publikacji
- review Vercel: 1-2 tygodnie oczekiwania

Pełny zakres `image + embeddings + speech + transcription` to raczej 5-8 dni engineering, jeśli paczka ma być solidna.

## Rekomendowany plan po poprawkach

### P0

1. Zrobić spike aktualnych typów AI SDK z realnie zainstalowanych paczek.
2. Zablokować target: AI SDK v6 stable.
3. Poprawić kontrakt providera: `specificationVersion: 'v4'`, lazy auth, brak callable provider aliasu.
4. Rozdzielić OpenAI-compatible `baseURL` od native REST v2.
5. Zaktualizować przykłady importów.
6. Zweryfikować aktualne limity i slugi w deAPI docs/API.

### P1

1. Zaimplementować MVP `image + embeddings`.
2. Dodać contract tests przez realne funkcje AI SDK.
3. Dodać `npm pack` + clean consumer smoke.
4. Dodać README z jasnymi ograniczeniami: brak LLM/chat/completion, brak structured output/tool calling, video poza zakresem providera v0.1.
5. Zdecydować, czy publikować wąskie MVP, czy przed publikacją rozszerzać o speech/transcription.

### P2

1. Dodać speech.
2. Dodać transcription.
3. Dodać release checklist: npm 2FA/provenance/trusted publishing, tag, changelog, GitHub release.
4. Dodać operational ownership: kto obsługuje issues, kompatybilność z nowymi majorami AI SDK, follow-up dla video.

## Rekomendowany zakres pierwszego publicznego release

Najbezpieczniejszy wariant:

1. `image`
2. `embeddings`
3. dobry README
4. mock/contract tests
5. live smoke
6. `npm pack` consumer smoke
7. publikacja
8. docs PR tylko dla realnie działającego zakresu

Jeśli docs PR ma obiecywać speech i transcription, te modalności muszą być w paczce przed publikacją i przejść live smoke. Nie należy obiecywać funkcji, które są tylko planowane.

## Konsensus subagentów

Wszyscy subagenci zgodzili się w głównych punktach:

- plan jest realny, ale za optymistyczny
- Stage 1 przed Stage 2 jest poprawny
- `image + embeddings` to najlepsze MVP
- `speech + transcription` są największym źródłem ryzyka
- lazy auth jest konieczny
- `baseURL` native v2 nie powinien być mieszany z OpenAI-compatible providerem
- video trzeba opisać ostrożniej
- testy i release hygiene są niedoszacowane
- docs muszą być zgodne z faktycznie opublikowaną paczką, nie z ambicją produktową

## Źródła zewnętrzne użyte do weryfikacji

- Vercel AI SDK custom providers docs: https://ai-sdk.dev/providers/community-providers/custom-providers
- Vercel AI SDK image generation docs: https://ai-sdk.dev/docs/ai-sdk-core/image-generation
- Vercel AI SDK speech docs: https://ai-sdk.dev/docs/ai-sdk-core/speech
- Vercel AI SDK transcription docs: https://ai-sdk.dev/docs/ai-sdk-core/transcription
- Vercel AI SDK video generation docs: https://ai-sdk.dev/docs/ai-sdk-core/video-generation
- `ProviderV4` upstream: https://raw.githubusercontent.com/vercel/ai/main/packages/provider/src/provider/v4/provider-v4.ts
- deAPI OpenAI Compatibility docs: https://docs.deapi.ai/openai-compatibility

