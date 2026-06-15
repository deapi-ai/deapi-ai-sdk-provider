# Audyt repozytorium `@deapi/ai-sdk-provider`

Data audytu: 2026-06-15  
Zakres: zgodnosc z `docs/PLAN_WDROZENIA.md`, security, uproszczenie kodu, bramka publikacji, sugestie dalszych usprawnien.

## Werdykt

Nie rekomenduje oznaczania repo jako gotowego do publikacji w obecnym stanie.

Kod dla zakresu `0.1.0` (image generation + embeddings) jest zasadniczo spojny i lokalne bramki techniczne przechodza:

- `npm run typecheck` przechodzi.
- `npm run lint` przechodzi.
- `npm run test:coverage` przechodzi: 63 testy, 100% coverage w aktualnym raporcie.
- `npm run build` emituje ESM, CJS oraz typy: `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts`, `dist/index.d.cts`.
- `npm pack --json --dry-run` przechodzi po uzyciu izolowanego cache npm w `/tmp`.
- `npm audit --omit=dev` pokazuje `0 vulnerabilities`.

Problem nie lezy glownie w request mappingu image/embeddings. Problemem jest rozjazd miedzy deklarowanym statusem "gotowe do bramki publikacji" a faktycznym stanem gate'ow release, packaging, live smoke i supply-chain.

## Blokery publikacji

### 1. Finalny gate z planu nie pasuje do zakresu `0.1.0`

`docs/PLAN_WDROZENIA.md` wymaga finalnego live smoke dla 4 modalnosci: image, embedding, speech, transcription.

Obecny kod i README jawnie ograniczaja `0.1.0` do image generation + embeddings. Speech i transcription sa odlozone do `0.2.0`.

Ryzyko:

- formalnie sekcja 7 planu nie jest spelniona;
- status "paczka kompletna" jest mylacy, jesli rozumiemy go jako kompletna wobec pelnego gate'u z planu;
- release reviewer moze zatwierdzic publish na podstawie nieprawdziwego kryterium.

Rozwiazanie:

- zmienic sekcje 7 na scope-aware gate:
  - `0.1.0`: image + embeddings only;
  - `0.2.0`: speech + transcription po osobnym audio spike;
- albo nie publikowac `0.1.0`, dopoki audio nie zostanie zaimplementowane i zweryfikowane live smoke.

Rekomendacja: zmienic plan i checklisty na scope-aware gate dla `0.1.0`.

### 2. Coverage nie jest egzekwowany jako bramka

`vitest.config.ts` wlacza raport coverage, ale nie ustawia `thresholds`.

Aktualnie jest 100%, ale CI nie zatrzyma regresji coverage. To znaczy, ze "100% coverage" jest stanem z ostatniego uruchomienia, nie twardym wymaganiem.

Rozwiazanie:

- dodac thresholdy w `vitest.config.ts`, np.:

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts', 'src/index.ts'],
  thresholds: {
    statements: 100,
    branches: 100,
    functions: 100,
    lines: 100,
  },
}
```

Jesli zespol nie chce globalnego 100%, ustawic jawny prog zgodny z planem, np. 95 globalnie i 100 dla logiki krytycznej.

### 3. Packaging smoke jest niepelny

`scripts/consumer-smoke.mjs` sprawdza:

- ESM import;
- CJS require;
- import/construct bez `DEAPI_API_KEY`.

Nie sprawdza natomiast:

- TypeScript consumer typecheck;
- mock requestu z zainstalowanego tarballa;
- allowlisty plikow z `npm pack --json`.

Workflow release nazywa `npm pack --dry-run` "Pack allowlist audit", ale faktycznie nie parsuje i nie waliduje listy plikow.

Ryzyko:

- mozna opublikowac paczke z poprawnym runtime importem, ale popsutymi typami w consumerze;
- mozna przypadkowo dorzucic niechciane pliki do tarballa;
- mock requesty moga dzialac w repo, ale nie z paczki po spakowaniu.

Rozwiazanie:

- dodac `scripts/pack-audit.mjs`, ktory wykonuje `npm pack --json --dry-run` i porownuje dokladna allowliste;
- rozszerzyc consumer smoke o:
  - `tsconfig.json` w clean projekcie;
  - `tsc --noEmit`;
  - mock `fetch`;
  - wywolanie `embed()` i `generateImage()` z tarballa;
  - asercje URL, headers, body i lazy auth.

### 4. Consumer smoke moze wisiec bez timeoutu

Podczas audytu `node scripts/consumer-smoke.mjs` zawisl na etapie `npm install <tarball> ai` w clean projekcie. Przerwano recznie po ponad minucie.

To nie dowodzi bledu kodu providera, ale ujawnia slaby gate: skrypt nie ma timeoutu dla procesow potomnych.

Rozwiazanie:

- dodac timeout do `execFileSync`;
- pinowac wersje `ai` instalowana w smoke, np. `ai@6.x`;
- rozwazyc fixture consumer z lockfile, zeby test byl deterministyczny.

### 5. Release workflow moze publikowac bez taga

`.github/workflows/release.yml` ma dwa triggery:

- tag `v*.*.*`;
- `workflow_dispatch`.

Job `publish` wykonuje `npm publish` rowniez dla manual dispatch. GitHub Release powstaje tylko gdy ref jest tagiem.

Ryzyko:

- mozliwy publish bez tagu;
- mozliwy publish bez GitHub Release;
- rozjazd miedzy npm version, git tagiem i release notes.

Rozwiazanie:

- publish tylko gdy `github.ref` zaczyna sie od `refs/tags/v`;
- dodac walidacje, ze tag `vX.Y.Z` odpowiada `package.json.version`;
- manual dispatch ograniczyc do dry-run/preflight.

### 6. Release workflow instaluje `npm@latest`

`.github/workflows/release.yml` wykonuje:

```bash
npm install -g npm@latest
```

To stoi w konflikcie z zasada "nigdy latest" i supply-chain hardeningiem.

Rozwiazanie:

- pinowac wersje npm;
- albo uzyc wersji dostarczonej przez `actions/setup-node` po sprawdzeniu minimalnej wersji wspierajacej trusted publishing.

### 7. Dev dependency audit pokazuje high vulnerabilities przez `tsup -> esbuild`

`npm audit --omit=dev`: `0 vulnerabilities`.

Pelny `npm audit` pokazuje high severity advisories w lancuchu dev/build:

- `esbuild`;
- zaleznosc przez `tsup`.

To nie trafia do runtime dependencies paczki, ale jest realnym ryzykiem build/supply-chain.

Rozwiazanie:

- zaktualizowac `tsup`/`esbuild`, jesli dostepna jest bezpieczna wersja;
- jesli nie, dodac jawny risk acceptance w release checklist i pilnowac Dependabota.

## Security i correctness

### 1. `settings.headers.Authorization` moze nadpisac prawdziwy API key

W `src/deapi-config.ts` auth header jest laczony przed `settings.headers`.

Efekt: uzytkownik moze przekazac `headers.Authorization` albo `headers.authorization` i nadpisac Bearer token wyliczony z `apiKey`/`DEAPI_API_KEY`.

Ryzyko:

- przypadkowe wysylanie requestow z niewlasciwym tokenem;
- trudne do debugowania 401;
- `headers` w README sa opisane jako "extra headers", nie jako mechanizm sterowania auth.

Rozwiazanie:

- odrzucac `authorization` w `settings.headers` z czytelnym bledem;
- albo zawsze nakladac provider auth po user headers, tak aby API key wygrywal.

Rekomendacja: odrzucac `authorization` w `settings.headers`. To jest czytelniejsze i mniej magiczne.

### 2. `baseURL` z query albo hash buduje bledny endpoint

`normalizeBaseURL()` akceptuje URL z query/hash, a `deapi-provider.ts` dokleja path przez string concat.

Przyklad:

```ts
createDeAPI({ baseURL: 'https://proxy.example/v1?foo=1' })
```

moze dac endpoint:

```text
https://proxy.example/v1?foo=1/embeddings
```

Rozwiazanie:

- w `normalizeBaseURL()` odrzucac `url.search` i `url.hash`;
- jesli query params sa potrzebne, zaprojektowac osobna opcje, np. `queryParams`.

### 3. Wielokrotne trailing slash powinny byc normalizowane

Obecne podejscie opiera sie na `withoutTrailingSlash`. Nalezy potwierdzic testem zachowanie dla:

```text
https://proxy.example/v1//
```

Rozwiazanie:

- normalizowac `URL.pathname` przez `replace(/\/+$/, '')`;
- dodac test dla wielokrotnych slashy.

### 4. Provider prawdopodobnie wystawia image edits mimo deklaracji "image generation only"

`OpenAICompatibleImageModel` uzywa `/images/edits`, gdy wywolanie zawiera `files` albo `mask`.

Obecny provider zwraca `OpenAICompatibleImageModel` bez wrappera, wiec faktyczny surface area jest szerszy niz README.

Ryzyko:

- uzytkownik moze uzyc image edits mimo braku dokumentacji i smoke testu;
- jesli deAPI nie wspiera edits na tym surface, bedzie to niekontrolowany failure path;
- claim audit jest niepelny.

Rozwiazanie:

- albo dodac dokumentacje, testy i live smoke dla edits;
- albo owinac image model i jawnie odrzucac `files`/`mask` do czasu wsparcia.

Rekomendacja dla `0.1.0`: blokowac edits, jesli nie ma live smoke.

### 5. `redirect: 'manual'` jest dobrym security defaultem, ale nie ma testu i dokumentacji

Provider ustawia `redirect: 'manual'`, zeby Bearer token nie zostal automatycznie replayowany na inny origin.

To jest sensowne, ale zmienia semantyke fetch/proxy.

Rozwiazanie:

- dodac test dla 301/307;
- dodac krotka note w README, ze provider nie podaza automatycznie za redirectami API.

## Simplify / API surface

### 1. Publiczny barrel eksportuje internale error handlingu

`src/index.ts` eksportuje:

- `deapiErrorDataSchema`;
- `failedResponseHandler`;
- `DeAPIErrorData`.

To wyglada jak publiczne API i zamraza wewnetrzny ksztalt Zod/error handlingu w semver.

Rozwiazanie:

- usunac te eksporty z public barrel przed stabilizacja;
- albo swiadomie oznaczyc jako advanced API i przyjac koszt kompatybilnosci.

Rekomendacja: usunac z public API, jesli nie ma konkretnego use case dla konsumentow.

### 2. Plan mowi o delegacji przez `createOpenAICompatible`, kod uzywa klas bezposrednio

Plan mowi: image + embeddings deleguja 1:1 do `createOpenAICompatible`.

Kod tworzy bezposrednio:

- `OpenAICompatibleEmbeddingModel`;
- `OpenAICompatibleImageModel`.

To moze byc uzasadnione przez lazy auth i custom error schema, ale plan powinien to odzwierciedlac.

Rozwiazanie:

- zaktualizowac plan: bezposrednie klasy sa swiadomym wyjatkiem;
- albo wrocic do fabryki, jesli da sie utrzymac lazy auth i error mapping.

Rekomendacja: zostawic kod, ale poprawic plan. Kod jest bardziej jawny i testowalny.

### 3. Typ `headers` jest wezszy niz realne zachowanie

`DeAPIProviderSettings.headers` ma typ:

```ts
Record<string, string>
```

Testy i kod defensywny obsluguja tez `undefined`.

Rozwiazanie:

- zmienic typ na `Record<string, string | undefined>`;
- albo walidowac runtime i odrzucac `undefined`.

Rekomendacja: `Record<string, string | undefined>`, bo jest zgodne z praktyka `combineHeaders`.

### 4. Alias surface jest szerszy niz konieczne

Provider wystawia:

- `imageModel`;
- `embeddingModel`;
- `image`;
- `embedding`.

To jest ergonomiczne, ale trzeba traktowac jako public contract.

Rozwiazanie:

- w README jasno wskazac kanoniczne API;
- jesli celem jest minimal surface, usunac aliasy przed 1.0.

Rekomendacja: zostawic aliasy, ale uznac je za publiczne i testowac.

## Governance i operacje

Repo ma podstawowe pliki governance:

- `.github/workflows/ci.yml`;
- `.github/workflows/release.yml`;
- `.github/workflows/live-smoke.yml`;
- `.github/CODEOWNERS`;
- issue templates;
- PR template;
- Dependabot;
- `SECURITY.md`;
- `SUPPORT.md`;
- `LICENSE`.

Braki wzgledem planu:

- brak jawnej procedury emergency patch;
- brak opisanej procedury `npm deprecate`;
- brak zasady "nie unpublish";
- brak opisanej komunikacji regresji;
- CODEOWNERS wskazuje tylko `@deapi-ai/maintainers`, bez widocznego backup ownera albo potwierdzenia, ze team istnieje.

Rozwiazanie:

- dodac `docs/OPERATIONS.md` albo `docs/RELEASE.md`;
- opisac:
  - release flow;
  - emergency patch;
  - deprecate policy;
  - no-unpublish policy;
  - rollback/communication;
  - owner + backup owner.

## Rekomendowany plan naprawczy

### Przed `npm publish`

1. Uscislic `docs/PLAN_WDROZENIA.md`: finalny gate dla `0.1.0` obejmuje tylko image + embeddings.
2. Dodac coverage thresholds w `vitest.config.ts`.
3. Dodac pack allowlist audit.
4. Rozszerzyc consumer smoke o TS typecheck i mock request z tarballa.
5. Dodac timeouty do consumer smoke.
6. Zablokowac albo udokumentowac image edits.
7. Naprawic `headers.Authorization` override.
8. Odrzucac `baseURL` z query/hash.
9. Utwardzic release workflow: publish tylko z tagow, walidacja tag == package version.
10. Usunac `npm@latest` z release workflow.
11. Podjac decyzje co do dev audit `tsup -> esbuild`.
12. Dodac `docs/OPERATIONS.md`.

### Po `0.1.0`

1. Audio spike dla speech/transcription.
2. Live smoke audio przed implementacja public API.
3. Dopiero potem `0.2.0` z `speechModel` i `transcriptionModel`.
4. Docs PR do `vercel/ai` dopiero po publicznym npm release i live smoke kazdej opisanej modalnosci.

## Pozytywne ustalenia

- Lazy auth jest dobrze pomyslany: import i `createDeAPI()` bez env nie rzucaja.
- Base URL guard przeciw `/api/v2` istnieje i jest testowany.
- Runtime dependencies audit jest czysty.
- ESM/CJS/DTS build faktycznie powstaje.
- README uczciwie komunikuje brak speech/transcription w `0.1.0`.
- `.github` governance istnieje; problemem jest jego niedomkniecie, nie calkowity brak.

## Konkluzja

Repo jest blisko sensownego `0.1.0`, ale nie jest jeszcze gotowe do publish gate w rozumieniu planu.

Najpierw trzeba zamknac rozjazd plan vs zakres release, utwardzic packaging/release gates i poprawic kilka edge case'ow security/correctness. Po tych poprawkach `0.1.0` jako provider image + embeddings bedzie mial znacznie bardziej defensywny i audytowalny stan.
