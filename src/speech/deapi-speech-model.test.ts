import { APICallError } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { failedResponseHandler } from '../deapi-error';
import { DeAPISpeechModel } from './deapi-speech-model';
import type { DeAPISpeechModelConfig } from './deapi-speech-model';

const BASE_URL = 'https://oai.deapi.ai/v1';
const AUDIO_BYTES = new Uint8Array([0xff, 0xf3, 0x44, 0x00, 0x01, 0x02]);

interface Capture {
  url?: string;
  init?: RequestInit;
}

/**
 * Builds a mock fetch returning a 200 binary audio response and records the
 * request. The provider normally wraps fetch to inject auth; here we just
 * capture what the model sends.
 */
function binaryFetch(capture: Capture): FetchFunction {
  return async (input, init) => {
    capture.url = input.toString();
    capture.init = init;
    return new Response(AUDIO_BYTES, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'x-request-id': 'req-123',
      },
    });
  };
}

function errorFetch(): FetchFunction {
  return async () =>
    new Response(
      JSON.stringify({
        error: { message: 'Unknown voice', type: 'invalid_request_error' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
}

function makeConfig(fetch: FetchFunction): DeAPISpeechModelConfig {
  return {
    url: ({ path }) => `${BASE_URL}${path}`,
    headers: () => ({ authorization: 'Bearer test-key' }),
    fetch,
    failedResponseHandler,
  };
}

function readBody(capture: Capture): Record<string, unknown> {
  return JSON.parse(capture.init?.body as string) as Record<string, unknown>;
}

describe('DeAPISpeechModel', () => {
  let capture: Capture;

  beforeEach(() => {
    capture = {};
  });

  it('exposes the V4 identity', () => {
    const model = new DeAPISpeechModel('Kokoro', makeConfig(binaryFetch(capture)));
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toBe('deapi.speech');
    expect(model.modelId).toBe('Kokoro');
  });

  it('posts to /audio/speech with the mapped body and merged headers', async () => {
    const model = new DeAPISpeechModel('Kokoro', makeConfig(binaryFetch(capture)));
    await model.doGenerate({
      text: 'hello there',
      headers: { 'x-extra': 'yes' },
    });

    expect(capture.url).toBe(`${BASE_URL}/audio/speech`);
    expect(capture.init?.method).toBe('POST');
    expect(readBody(capture)).toEqual({
      model: 'Kokoro',
      input: 'hello there',
      voice: 'alloy',
      response_format: 'mp3',
    });

    const headers = new Headers(capture.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(headers.get('x-extra')).toBe('yes');
    expect(headers.get('content-type')).toContain('application/json');
  });

  it('returns binary audio plus request/response metadata', async () => {
    const model = new DeAPISpeechModel('Kokoro', makeConfig(binaryFetch(capture)));
    const before = Date.now();
    const result = await model.doGenerate({ text: 'hi' });
    const after = Date.now();

    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.audio).toEqual(AUDIO_BYTES);
    expect(result.warnings).toEqual([]);
    expect(result.request).toEqual({
      body: { model: 'Kokoro', input: 'hi', voice: 'alloy', response_format: 'mp3' },
    });
    expect(result.response.modelId).toBe('Kokoro');
    expect(result.response.headers?.['x-request-id']).toBe('req-123');
    const ts = result.response.timestamp.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('forwards parsed deAPI provider options into the body', async () => {
    const model = new DeAPISpeechModel('Kokoro', makeConfig(binaryFetch(capture)));
    await model.doGenerate({
      text: 'hi',
      voice: 'nova',
      outputFormat: 'wav',
      providerOptions: {
        deapi: { speed: 1.5, language: 'en', instructions: 'be calm' },
      },
    });

    expect(readBody(capture)).toEqual({
      model: 'Kokoro',
      input: 'hi',
      voice: 'nova',
      response_format: 'wav',
      speed: 1.5,
      language: 'en',
      instructions: 'be calm',
    });
  });

  it('emits a warning for an unsupported providerOptions.deapi key', async () => {
    const model = new DeAPISpeechModel('Kokoro', makeConfig(binaryFetch(capture)));
    const result = await model.doGenerate({
      text: 'hi',
      providerOptions: { deapi: { somethingElse: 7 } },
    });

    expect(result.warnings).toEqual([
      {
        type: 'unsupported',
        feature: 'providerOptions.deapi.somethingElse',
        details: expect.stringContaining('somethingElse'),
      },
    ]);
    // Unknown key is not forwarded to the API.
    expect('somethingElse' in readBody(capture)).toBe(false);
  });

  it('passes the abort signal through to fetch', async () => {
    const spy = vi.fn(binaryFetch(capture));
    const model = new DeAPISpeechModel('Kokoro', makeConfig(spy));
    const controller = new AbortController();
    await model.doGenerate({ text: 'hi', abortSignal: controller.signal });
    expect(spy.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('maps a 4xx deAPI error envelope to an APICallError', async () => {
    const model = new DeAPISpeechModel('Kokoro', makeConfig(errorFetch()));
    await expect(model.doGenerate({ text: 'hi' })).rejects.toSatisfy(
      (error: unknown) =>
        APICallError.isInstance(error) &&
        error.statusCode === 400 &&
        error.message === 'Unknown voice',
    );
  });
});
