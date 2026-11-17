# Security Policy

`@deapi/ai-sdk-provider` is the community/official AI SDK provider for deAPI. We take
security seriously and appreciate responsible disclosure.

## Supported Versions

This package follows semantic versioning. Security fixes are provided only for the
latest published minor release line.

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3.0 | :x:                |

Scope: **image generation and editing, video generation, embeddings, speech
(text-to-speech), and transcription (speech-to-text).** LLM/chat/tool-calling and
inpainting (masks) are out of scope.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report privately through one of the following channels:

1. **GitHub Private Security Advisory (preferred):**
   Use the "Report a vulnerability" button under the
   [Security tab](https://github.com/deapi-ai/deapi-ai-sdk-provider/security/advisories/new)
   of this repository.
2. **Email:** `security@deapi.ai`

Please include, where possible:

- A description of the vulnerability and its impact.
- Steps to reproduce (a minimal proof-of-concept is ideal).
- Affected version(s) of the package.
- Any suggested remediation.

## Response and SLA

| Stage                                  | Target                |
| -------------------------------------- | --------------------- |
| Acknowledgement of receipt             | Best effort           |
| Security (P0) triage                   | 1 business day        |
| Fix / mitigation / coordinated release | Communicated at triage |

We aim to keep you informed throughout the process and will coordinate a disclosure
timeline with you. We do not operate a paid bug-bounty program.

## Handling of Your deAPI API Key

The deAPI API key (format `sk-dp-<id>-<secret>`) is **your secret**. This package is designed so that:

- The key is read lazily, **per request** — importing or constructing the provider never
  reads it.
- The key is supplied via the `DEAPI_API_KEY` environment variable or `settings.apiKey`,
  and is sent only as a `Bearer` token to the origin of the configured `baseURL`.
  Other requests made through the provider's fetch (for example downloading an
  input image URL for an edit) never carry the key or your custom headers.
- The Bearer key is **never** placed into thrown error objects or logs by this package.

Your responsibilities as a user:

- **Never commit your API key** to source control, and never embed it in client-side or
  public code.
- **Be careful when logging errors.** Errors thrown by this package are `APICallError`
  instances that may carry `responseBody` and `requestBodyValues` (which can include your
  prompt or input). Do not blindly log full error objects in environments where that data
  could leak.
- Rotate any key that may have been exposed, and prefer secret managers / environment
  injection over hard-coded values.

Thank you for helping keep deAPI and its users safe.
