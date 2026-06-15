# Podsumowanie weryfikacji poprawek po audycie

Data weryfikacji: 2026-06-15  
Repozytorium: `@deapi/ai-sdk-provider`  
Zakres: sprawdzenie poprawek naniesionych po raporcie `docs/AUDYT_REPOZYTORIUM_2026-06-15.md`.

## Werdykt

Poprawki sa realne i w wiekszosci zamykaja punkty z audytu. Repozytorium jest w znacznie lepszym stanie niz podczas pierwotnego przegladu.

Nie oznaczalbym jednak jeszcze calosci jako w pelni domknietej do publish gate, dopoki nie zostana poprawione ostatnie elementy operacyjne:

- live smoke workflow nie robi jeszcze wymaganego preflightu `GET /v1/models`;
- live smoke nie zapisuje wyniku jako artefaktu;
- `docs/OPERATIONS.md` nadal wymaga wskazania realnego backup ownera.

## Co zostalo zamkniete

### Scope-aware release gate

`docs/PLAN_WDROZENIA.md` zostal poprawiony tak, aby finalny gate byl zalezy od zakresu wersji.

Dla `0.1.0` gate obejmuje tylko:

- image generation;
- embeddings;
- guard image editing.

Speech i transcription sa jawnie przesuniete do `0.2.0` i nie blokuja publikacji `0.1.0`.

Ocena: zamkniete.

### Coverage jako twarda bramka

`vitest.config.ts` zawiera thresholdy:

- statements: 100;
- branches: 100;
- functions: 100;
- lines: 100.

Aktualne testy przechodza z 100% coverage.

Ocena: zamkniete.

### Security: `Authorization` override

`settings.headers.Authorization` / `settings.headers.authorization` jest odrzucane z czytelnym bledem.

Provider sam zarzadza Bearer tokenem z:

- `apiKey`;
- `DEAPI_API_KEY`.

Dodatkowo `Authorization` jest nakladany jako provider-managed header.

Ocena: zamkniete.

### Security: `baseURL` query/hash i trailing slashes

`normalizeBaseURL()`:

- odrzuca query string;
- odrzuca hash fragment;
- normalizuje wielokrotne trailing slashe;
- nadal blokuje `/api/v2`;
- nadal wymaga absolute URL;
- nadal odrzuca embedded credentials;
- nadal wymaga HTTPS poza loopback.

Ocena: zamkniete.

### Image editing guard

Provider blokuje `files` i `mask` dla image modelu przez `UnsupportedFunctionalityError`.

To domyka problem, w ktorym upstream `OpenAICompatibleImageModel` mogl przejsc na `/images/edits`, mimo ze `0.1.0` dokumentuje tylko image generation.

Ocena: zamkniete.

### Public API cleanup

Z publicznego barrel `src/index.ts` usunieto eksporty wewnetrznych elementow error handlingu:

- `deapiErrorDataSchema`;
- `failedResponseHandler`;
- `DeAPIErrorData`.

Publiczny surface jest teraz mniejszy i bezpieczniejszy semverowo.

Ocena: zamkniete.

### Release workflow

`.github/workflows/release.yml` zostal utwardzony:

- publish wykonuje sie tylko dla tagow `refs/tags/v*`;
- manual `workflow_dispatch` jest tylko preflight/dry-run;
- tag jest walidowany przeciwko `package.json.version`;
- `npm@latest` zostalo zastapione pinem `npm@11.6.2`;
- release nadal korzysta z OIDC / trusted publishing.

Ocena: zamkniete.

### Consumer smoke

`scripts/consumer-smoke.mjs` zostal rozbudowany:

- ma timeouty dla procesow potomnych;
- instaluje pinowane `ai@6.0.202`;
- sprawdza ESM import;
- sprawdza CJS require;
- sprawdza import/construct bez `DEAPI_API_KEY`;
- typecheckuje konsumenta TypeScript przez `tsc --noEmit`;
- wykonuje mock requesty przez `embed()` i `generateImage()` z tarballa;
- sprawdza lazy auth, URL, headers i body.

Weryfikacja poza sandboxem przeszla:

```text
consumer-smoke: PASS
```

Ocena: zamkniete funkcjonalnie.

### Pack allowlist audit

Dodano `scripts/pack-audit.mjs`, a CI i release workflow uruchamiaja go przed publikacja.

Sprawdza dokladna allowliste plikow z `npm pack --json --dry-run`.

Weryfikacja z cache w `/tmp` przeszla.

Ocena: zamkniete dla CI/release.

Uwaga: lokalnie `node scripts/pack-audit.mjs` moze pasc, jesli domowy `~/.npm` ma root-owned cache. To problem lokalnego srodowiska, nie logiki allowlisty. Dla lepszego DX mozna rozwazyc dokumentacje `NPM_CONFIG_CACHE=/tmp/deapi-npm-cache`.

### README

README zostal zsynchronizowany z implementacja:

- opisuje `Authorization` jako provider-managed;
- opisuje canonical API i aliasy;
- komunikuje brak image editing w `0.1.0`;
- komunikuje brak speech/transcription w `0.1.0`;
- dokumentuje `redirect: 'manual'`;
- lagodzi claim o wymiarze embeddingu jako stan "at the time of writing".

Ocena: zamkniete.

### Operations

Dodano `docs/OPERATIONS.md`, ktory opisuje:

- release flow;
- emergency patch;
- `npm deprecate`;
- no-unpublish policy;
- rollback jako roll-forward;
- komunikacje regresji;
- supply-chain risk acceptance dla dev/build chain.

Ocena: prawie zamkniete.

Pozostaje wskazac konkretnego backup ownera.

## Pozostale ryzyka / rzeczy do domkniecia

### 1. Live smoke workflow nadal nie spelnia pelnego gate'u

Plan wymaga dla `0.1.0`:

- manual live smoke workflow;
- preflight `GET /v1/models`;
- image smoke;
- embedding smoke;
- guard image editing;
- wynik jako artefakt.

Aktualny workflow `.github/workflows/live-smoke.yml` nadal tylko uruchamia:

```bash
node examples/smoke.mjs
```

`examples/smoke.mjs` sprawdza image, embeddings i guard image editing, ale nie robi preflightu `GET /v1/models` i nie zapisuje wyniku jako artefaktu.

Status: do poprawy.

Rekomendacja:

- dodac preflight `GET https://oai.deapi.ai/v1/models`;
- zapisywac wynik smoke do pliku JSON/Markdown, np. `live-smoke-result.json`;
- dodac `actions/upload-artifact`;
- upewnic sie, ze workflow failuje, gdy preflight albo jedna z modalnosci nie przejdzie.

### 2. Backup owner nie jest wskazany

`docs/OPERATIONS.md` nadal zawiera `Action required`: backup owner nie jest wskazany.

Status: do poprawy.

Rekomendacja:

- wpisac primary ownera;
- wpisac backup ownera;
- upewnic sie, ze `@deapi-ai/maintainers` realnie istnieje i ma write access.

### 3. `pack-audit` nie jest w `package.json` scripts / `prepublishOnly`

CI i release workflow uruchamiaja `node scripts/pack-audit.mjs`, wiec trusted publishing jest zabezpieczony.

Natomiast lokalny `prepublishOnly` nadal nie uruchamia `pack-audit`.

Status: nie jest blockerem dla CI release, ale warto poprawic dla spojnosci lokalnych bramek.

Rekomendacja:

- dodac script:

```json
"pack:audit": "node scripts/pack-audit.mjs"
```

- wlaczyc go do `prepublishOnly`.

### 4. Pelny `npm audit` nadal pokazuje dev-only advisories

Wyniki:

- `npm audit --omit=dev`: `0 vulnerabilities`;
- pelny `npm audit`: 2 high severity advisories przez `tsup -> esbuild`.

Ryzyko jest opisane i zaakceptowane w `docs/OPERATIONS.md` jako dev/build-chain risk acceptance.

Status: zaakceptowane ryzyko, nie runtime blocker.

Rekomendacja:

- trzymac jako jawny release risk acceptance;
- podbic `tsup`/`esbuild`, gdy bedzie dostepna bezpieczna wersja bez regresji.

## Uruchomione bramki

Przeszly:

```text
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm --cache /tmp/deapi-npm-cache pack --json --dry-run
NPM_CONFIG_CACHE=/tmp/deapi-npm-cache node scripts/consumer-smoke.mjs
npm --cache /tmp/deapi-npm-cache audit --omit=dev
```

Coverage:

```text
Test Files  3 passed
Tests       76 passed
Statements 100%
Branches   100%
Functions  100%
Lines      100%
```

Pelny audit:

```text
2 high severity vulnerabilities
source: dev/build chain `tsup -> esbuild`
runtime audit: clean
```

## Konkluzja

Poprawki po audycie sa dobrze zaadresowane. Implementacja `0.1.0` dla image generation + embeddings wyglada teraz technicznie solidnie.

Do pelnej gotowosci publish gate zostaly glownie rzeczy operacyjne:

1. live smoke preflight + artifact;
2. wskazanie backup ownera;
3. opcjonalnie dodanie `pack-audit` do lokalnego `prepublishOnly`;
4. utrzymanie jawnej akceptacji dev-only audit risk.

Po domknieciu punktow 1 i 2 mozna sensownie mowic, ze repo jest gotowe do finalnej bramki publikacji dla zakresu `0.1.0`.
