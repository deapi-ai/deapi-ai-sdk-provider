import { createJsonErrorResponseHandler } from '@ai-sdk/provider-utils';
import { z } from 'zod';

/**
 * OpenAI-compatible error envelope.
 *
 * Returned by the OpenAI-compatible surface at `https://oai.deapi.ai/v1`
 * (e.g. `POST /images/generations`, `POST /embeddings`).
 *
 * Example: `{ "error": { "message": "...", "type": "invalid_request_error", "param": null, "code": null } }`
 */
const deapiOpenAIErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().nullish(),
    param: z.string().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
  }),
});

/**
 * Native deAPI error envelope.
 *
 * Used by the native async/job-based surface. Not the configured baseURL for
 * 0.1.0, but parsed defensively so misrouted responses still produce a typed,
 * readable error instead of an opaque parse failure.
 *
 * Example: `{ "data": null, "message": "...", "errors": [...], "statusCode": 422 }`
 */
const deapiNativeErrorSchema = z.object({
  data: z.unknown().nullable(),
  message: z.string(),
  errors: z.unknown().optional(),
  statusCode: z.number().optional(),
});

/**
 * Union of both error envelopes deAPI can emit.
 *
 * The OpenAI shape is checked first; the native shape is the fallback. Both
 * branches always carry a string message, which `errorToMessage` extracts.
 */
export const deapiErrorDataSchema = z.union([
  deapiOpenAIErrorSchema,
  deapiNativeErrorSchema,
]);

/** Parsed deAPI error body, narrowed to whichever envelope matched. */
export type DeAPIErrorData = z.infer<typeof deapiErrorDataSchema>;

/**
 * Extracts a human-readable message from whichever envelope was parsed.
 *
 * - OpenAI shape: the nested `error.message`.
 * - Native shape: the top-level `message`.
 */
export function deapiErrorToMessage(data: DeAPIErrorData): string {
  return 'error' in data ? data.error.message : data.message;
}

/**
 * Failed-response handler for deAPI HTTP calls.
 *
 * Built with `createJsonErrorResponseHandler`, which parses the JSON body with
 * `deapiErrorDataSchema` and produces an `APICallError` preserving the HTTP
 * status code, response headers, and raw response body. Retry semantics are
 * left to the SDK's defaults; `Retry-After` is passed through but never
 * required or asserted here.
 */
export const failedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: deapiErrorDataSchema,
  errorToMessage: deapiErrorToMessage,
});
