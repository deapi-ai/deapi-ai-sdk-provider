<!--
Thanks for contributing to @deapi/ai-sdk-provider!
Please complete the checklist below. PRs that change behavior without tests or
that fall outside the current release scope are unlikely to be merged.
-->

## Summary

<!-- What does this PR do and why? -->

## Related issues

<!-- e.g. Closes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Build / tooling / CI
- [ ] Other

## Checklist

- [ ] **Tests added/updated** for the change (logic is covered; coverage gate stays green).
- [ ] **Gates are green locally:** `tsc` (0 errors), `eslint` (0 errors), `vitest` (all
      passing), and `build` emits `dist/index.{mjs,cjs,d.ts,d.cts}`.
- [ ] **No secrets** committed or logged — no API keys (`dpn-sk-…`), tokens, or real
      `responseBody`/`requestBodyValues` in code, tests, fixtures, examples, or snapshots.
- [ ] **Docs updated** where relevant (README / examples / inline docs), and any new claim
      is backed by a test or smoke (no unverified promises).
- [ ] **Scope respected:** change fits `0.1.0` = **image + embeddings only**. No
      speech/transcription (those land in `0.2.0`), no LLM/chat/tool-calling, no
      video-via-AI-SDK, no `/api/v2` native surface.
- [ ] No hard-coded model slugs or `latest` versions; dependencies remain pinned.

## Notes for reviewers

<!-- Anything reviewers should pay special attention to. -->
