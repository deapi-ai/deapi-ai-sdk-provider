# Operations & Release Governance — `@deapi/ai-sdk-provider`

Operational runbook for maintainers. Companion to `docs/PLAN_WDROZENIA.md` (source of truth),
`SECURITY.md`, `SUPPORT.md`, and `.github/CODEOWNERS`. This document covers how releases happen,
how to respond to incidents, and the policies that govern published versions.

## Ownership

- **Owner team:** `@deapi-ai/deapi-core-team` (the GitHub team referenced by `.github/CODEOWNERS`).
  Ownership is team-based: this team must have write access to the repo, or CODEOWNERS is silently
  ignored by GitHub.
- **Releases & incident response** are owned collectively by the members of
  `@deapi-ai/deapi-core-team`. To avoid a single point of failure, the team must have **at least two
  members** so releases and security response are never blocked by one person being unavailable.
- **Security contact:** GitHub Private Security Advisory (preferred) or `security@deapi.ai`
  (see `SECURITY.md`).

## Release flow (normal)

Releases are published from CI only — **never from a laptop**. Provenance requires publishing from a
trusted CI environment.

1. **Pre-publish gate.** Run the scope-aware final gate in `docs/PLAN_WDROZENIA.md` section 7. For
   `0.1.0` the live smoke covers **image + embeddings only** (speech/transcription belong to the
   `0.2.0` gate). Get explicit user/owner sign-off (outward-facing release).
2. **Version bump.** Set `package.json` `version` to `X.Y.Z`. Commit on a branch and merge via PR
   (CODEOWNERS review required).
3. **Tag.** Create and push an annotated git tag `vX.Y.Z` that matches `package.json.version`. The
   tag push triggers `.github/workflows/release.yml`.
4. **OIDC trusted publishing.** The release workflow's `publish` job runs in a protected GitHub
   `environment: release`. It uses npm **trusted publishing via OIDC** (`id-token: write`) — there is
   **no** `NODE_AUTH_TOKEN` or `.npmrc` secret.
5. **Manual approval.** The protected `release` environment is configured with required reviewers, so
   a maintainer must explicitly approve the run before `npm publish` executes.
6. **Provenance.** Publish runs `npm publish --provenance --access public`
   (`publishConfig.provenance = true`). This attaches a signed provenance attestation linking the
   tarball to the source commit and CI run.
7. **GitHub Release.** A GitHub Release is created for the `vX.Y.Z` tag with release notes
   (changelog, scope, known limitations).
8. **Verify.** After publish, confirm `npm view @deapi/ai-sdk-provider version` matches the tag, and
   that the npm page shows the provenance badge.

`workflow_dispatch` runs are for re-runs / dry checks only; production publishing is driven by the
`vX.Y.Z` tag.

## Emergency patch procedure

For a critical bug or security fix that cannot wait for the normal cadence:

1. Branch from the latest released tag (e.g. `v0.1.0` → `hotfix/0.1.1`). Keep the change **minimal and
   targeted** — fix only the issue.
2. Add a regression test that fails before the fix and passes after.
3. Bump the patch version (`0.1.0` → `0.1.1`).
4. Run the full scope-aware pre-publish gate. Expedited review is acceptable, but the gate is **not**
   skipped — at minimum: typecheck, lint, unit/contract, build, packaging consumer smoke, and the
   scope-appropriate live smoke.
5. Tag `v0.1.1`, let the release workflow publish via OIDC + provenance, approve the protected
   environment, cut the GitHub Release.
6. If the fix is security-related, follow the coordinated-disclosure timing in `SECURITY.md` and
   publish/credit the advisory once the fix is live.

## npm `deprecate` policy

- Use `npm deprecate @deapi/ai-sdk-provider@<range> "<reason + upgrade guidance>"` to warn consumers
  about versions with serious bugs, security issues, or that are end-of-life. Deprecation shows a
  warning on install but **keeps the version installable** — it does not remove it.
- Always point to the version users should move to (e.g. "deprecated due to <issue>; upgrade to
  `>=0.1.1`").
- Deprecation is the **preferred** remediation for a bad published version; do not unpublish (see
  below).
- Un-deprecate by passing an empty message if a deprecation was issued in error.

## No-unpublish policy

- **Do not `npm unpublish`.** Unpublishing breaks downstream consumers and lockfiles, and npm
  restricts/forbids re-publishing the same version. The community ecosystem treats unpublish as
  hostile.
- The correct response to a bad version is: publish a fixed patch version **and** `npm deprecate` the
  bad one with upgrade guidance.
- The only conceivable exception is a published artifact containing leaked secrets or unlawful
  content — and even then, rotate the secret first, then coordinate with npm support; treat unpublish
  as a last resort, not a routine tool.

## Regression rollback & user communication

There is no "rollback" of a published npm version (versions are immutable; see no-unpublish). Recovery
is **roll forward**:

1. **Confirm & scope.** Reproduce the regression, identify the first bad version and affected
   surface (image / embeddings).
2. **Roll forward.** Ship a fixed patch release via the emergency patch procedure.
3. **Deprecate** the regressed version(s) with a message pointing at the fixed version.
4. **Communicate:**
   - Update or open the relevant GitHub issue and the GitHub Release notes for the fixed version.
   - If security-relevant, publish a GitHub Security Advisory.
   - Note the regression and the fixed version in the changelog.
   - Respond on the originating issue/discussion so reporters and watchers are notified.
5. **Post-incident.** Add a regression test (already required by the patch procedure) and, if the gate
   missed it, file a follow-up to strengthen the gate.

SLA (from `SECURITY.md` / governance): security P0 triage 1 business day; regression P1 2 business
days; docs best-effort.

## Supply-chain risk acceptance — dev/build chain (Audit Blocker-7)

- **Runtime is clean.** `npm audit --omit=dev` reports **0 vulnerabilities**. None of the advisories
  below affect what ships in the published tarball (`files: ["dist", "README.md", "LICENSE"]`).
- **Dev-only advisories.** The dev/build chain `tsup` → `esbuild` currently surfaces **two
  high-severity advisories**:
  - `GHSA-gv7w-rqvm-qjhr`
  - `GHSA-g7r4-m6w7-qqqr`
- **Accepted as dev-only.** These are in build-time devDependencies only. They are **not** part of the
  published package and cannot affect consumers of the released tarball. The full `npm audit` will show
  them; `npm audit --omit=dev` (the published surface) is `0`.
- **Tracking & remediation.** Tracked via Dependabot. Bump `tsup` / `esbuild` to a fixed version as
  soon as one is available, then re-confirm `npm audit` and re-run the build/packaging gate. Re-review
  this acceptance at each release; do not let it become permanent.

## Compatibility & supported versions

- Peer dependency: `ai` `>=6 <7`.
- Security fixes target the latest published minor line only (`0.1.x`); see `SECURITY.md`.
- New deAPI models do not require a release — model IDs are passed through as open strings.

## Supply-chain hardening (reference)

- Committed `package-lock.json`; CI uses `npm ci`.
- `npm pack --json` allowlist audit before publish.
- Dependabot enabled; GitHub Actions pinned for the release workflow.
- No `.npmrc` token / no `NODE_AUTH_TOKEN` — publishing is OIDC trusted publishing only.
- No secrets in `examples/`, snapshots, or logs.
