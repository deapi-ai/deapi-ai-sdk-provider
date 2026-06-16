---
name: Bug report
about: Report a problem with @deapi/ai-sdk-provider
title: "[bug] "
labels: bug, needs-triage
assignees: ''
---

<!--
Before filing: please search existing issues first.
Do NOT include your deAPI API key, full request/response bodies, or any secrets.
For security vulnerabilities, follow SECURITY.md instead of opening an issue.
-->

## Scope check

This provider covers **image generation, embeddings, speech (text-to-speech), and
transcription (speech-to-text)**. LLM/chat/tool-calling, image editing (inpainting),
and video are out of scope.

- [ ] My issue is about image generation, embeddings, speech, or transcription.

## Describe the bug

A clear and concise description of what the bug is.

## Reproduction

Minimal code that reproduces the problem (redact your API key):

```ts
import { deapi } from '@deapi/ai-sdk-provider';
// ...
```

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include error messages or warnings.
Redact `responseBody` / `requestBodyValues` if they contain sensitive prompts or inputs.

## Environment

- `@deapi/ai-sdk-provider` version:
- `ai` version:
- Node.js version:
- OS / runtime (e.g. Node, edge):
- `baseURL` (if customized):

## Additional context

Anything else that might help.
