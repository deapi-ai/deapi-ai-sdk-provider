import { APICallError } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { deapiErrorDataSchema, failedResponseHandler } from './deapi-error';

const URL = 'https://oai.deapi.ai/v1/embeddings';
const REQUEST_BODY = { model: 'Bge_M3_FP16', input: ['hi'] };

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    },
  );
}

async function handle(response: Response) {
  return failedResponseHandler({
    response,
    url: URL,
    requestBodyValues: REQUEST_BODY,
  });
}

describe('deapiErrorDataSchema (zod union)', () => {
  it('parses the OpenAI error envelope', () => {
    const parsed = deapiErrorDataSchema.parse({
      error: {
        message: 'Invalid API key',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key',
      },
    });
    expect('error' in parsed).toBe(true);
  });

  it('parses the OpenAI envelope with a numeric code', () => {
    const parsed = deapiErrorDataSchema.parse({
      error: { message: 'rate limited', code: 429 },
    });
    expect(parsed).toMatchObject({ error: { message: 'rate limited' } });
  });

  it('parses the native error envelope', () => {
    const parsed = deapiErrorDataSchema.parse({
      data: null,
      message: 'Validation failed',
      errors: [{ field: 'size' }],
      statusCode: 422,
    });
    expect('message' in parsed && !('error' in parsed)).toBe(true);
  });

  it('parses the native envelope with only required fields', () => {
    const parsed = deapiErrorDataSchema.parse({
      data: null,
      message: 'boom',
    });
    expect(parsed).toMatchObject({ message: 'boom' });
  });

  it('rejects a body matching neither envelope', () => {
    expect(() => deapiErrorDataSchema.parse({ nope: true })).toThrow();
  });
});

describe('failedResponseHandler', () => {
  it('parses an OpenAI 401 into an APICallError preserving status + message', async () => {
    const { value } = await handle(
      jsonResponse(401, {
        error: { message: 'Invalid API key', type: 'invalid_request_error' },
      }),
    );
    expect(APICallError.isInstance(value)).toBe(true);
    expect(value.statusCode).toBe(401);
    expect(value.message).toBe('Invalid API key');
    expect(value.url).toBe(URL);
  });

  it('parses a native 422 into an APICallError preserving status + message', async () => {
    const { value } = await handle(
      jsonResponse(422, {
        data: null,
        message: 'Validation failed: size invalid',
        errors: [{ field: 'size' }],
        statusCode: 422,
      }),
    );
    expect(APICallError.isInstance(value)).toBe(true);
    expect(value.statusCode).toBe(422);
    expect(value.message).toBe('Validation failed: size invalid');
  });

  it('preserves response headers (incl. Retry-After passthrough, never required)', async () => {
    const { value, responseHeaders } = await handle(
      jsonResponse(
        429,
        { error: { message: 'slow down' } },
        { 'retry-after': '5' },
      ),
    );
    expect(responseHeaders?.['retry-after']).toBe('5');
    expect(value.responseHeaders?.['retry-after']).toBe('5');
  });

  it('preserves the raw response body', async () => {
    const body = { error: { message: 'nope' } };
    const { value } = await handle(jsonResponse(403, body));
    expect(value.responseBody).toBe(JSON.stringify(body));
  });

  it('handles a non-JSON body without throwing, falling back to statusText', async () => {
    const { value } = await handle(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/html' },
      }),
    );
    expect(APICallError.isInstance(value)).toBe(true);
    expect(value.statusCode).toBe(502);
    expect(value.responseBody).toBe('<html>Bad Gateway</html>');
  });

  it('handles an empty body, falling back to statusText', async () => {
    const { value } = await handle(
      new Response('', { status: 500, statusText: 'Internal Server Error' }),
    );
    expect(APICallError.isInstance(value)).toBe(true);
    expect(value.statusCode).toBe(500);
  });
});
