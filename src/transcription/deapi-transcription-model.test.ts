import { type APICallError } from '@ai-sdk/provider';
import {
  type ResponseHandler,
  createJsonErrorResponseHandler,
} from '@ai-sdk/provider-utils';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import { DeAPITranscriptionModel } from './deapi-transcription-model';
import { DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES } from './deapi-transcription-options';

const BASE_URL = 'https://oai.deapi.ai/v1';

/** Two-envelope error handler matching the real provider wiring. */
const failedResponseHandler: ResponseHandler<APICallError> =
  createJsonErrorResponseHandler({
    errorSchema: z.union([
      z.object({ error: z.object({ message: z.string() }) }),
      z.object({ message: z.string() }),
    ]),
    errorToMessage: (data) =>
      'error' in data ? data.error.message : data.message,
  });

function jsonFetch(status: number, body: unknown): Mock {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function makeModel(fetch: Mock, modelId = 'whisper-1'): DeAPITranscriptionModel {
  return new DeAPITranscriptionModel(modelId, {
    provider: 'deapi.transcription',
    url: ({ path }) => `${BASE_URL}${path}`,
    headers: () => ({}),
    fetch: fetch as unknown as typeof globalThis.fetch,
    failedResponseHandler,
  });
}

function lastFormData(fetch: Mock): FormData {
  const call = fetch.mock.calls.at(-1);
  if (!call) throw new Error('fetch not called');
  const init = (call[1] ?? {}) as { body?: unknown };
  return init.body as FormData;
}

describe('DeAPITranscriptionModel', () => {
  it('exposes the V3 identity', () => {
    const model = makeModel(jsonFetch(200, { text: 'hi' }));
    expect(model.specificationVersion).toBe('v3');
    expect(model.provider).toBe('deapi.transcription');
    expect(model.modelId).toBe('whisper-1');
  });

  it('builds multipart with file + model + response_format and parses { text }', async () => {
    const fetch = jsonFetch(200, { text: 'hello world' });
    const model = makeModel(fetch);

    const result = await model.doGenerate({
      audio: new Uint8Array([1, 2, 3, 4]),
      mediaType: 'audio/mpeg',
    });

    expect(result.text).toBe('hello world');
    expect(result.segments).toEqual([]);
    expect(result.language).toBeUndefined();
    expect(result.durationInSeconds).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.response.modelId).toBe('whisper-1');
    expect(result.response.timestamp).toBeInstanceOf(Date);
    expect(result.response.body).toEqual({ text: 'hello world' });

    const url = String(fetch.mock.calls.at(-1)?.[0]);
    expect(url).toBe(`${BASE_URL}/audio/transcriptions`);

    const form = lastFormData(fetch);
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('audio.mp3');
    expect((file as Blob).type).toBe('audio/mpeg');
    expect(await (file as Blob).arrayBuffer()).toEqual(
      new Uint8Array([1, 2, 3, 4]).buffer,
    );
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('response_format')).toBe('json');
    expect(form.get('language')).toBeNull();
  });

  it('accepts a base64 string audio input', async () => {
    const fetch = jsonFetch(200, { text: 'decoded' });
    const model = makeModel(fetch);

    // base64 of bytes [104,105] => "aGk="
    const result = await model.doGenerate({
      audio: 'aGk=',
      mediaType: 'audio/wav',
    });

    expect(result.text).toBe('decoded');
    const file = lastFormData(fetch).get('file') as File;
    expect(file.name).toBe('audio.wav');
    expect(await file.arrayBuffer()).toEqual(new Uint8Array([104, 105]).buffer);
  });

  it('includes the language field when provided', async () => {
    const fetch = jsonFetch(200, { text: 'bonjour' });
    const model = makeModel(fetch);

    await model.doGenerate({
      audio: new Uint8Array([9]),
      mediaType: 'audio/mpeg',
      providerOptions: { deapi: { language: 'fr' } },
    });

    expect(lastFormData(fetch).get('language')).toBe('fr');
  });

  it('throws a guard error for oversize audio before any request', async () => {
    const fetch = jsonFetch(200, { text: 'unused' });
    const model = makeModel(fetch);

    await expect(
      model.doGenerate({
        audio: new Uint8Array(DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES + 1),
        mediaType: 'audio/mpeg',
      }),
    ).rejects.toThrow(/exceeds the 20 MB per-file limit/);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a typed error from the OpenAI error envelope', async () => {
    const fetch = jsonFetch(400, {
      error: { message: 'bad audio format' },
    });
    const model = makeModel(fetch);

    await expect(
      model.doGenerate({
        audio: new Uint8Array([1]),
        mediaType: 'audio/mpeg',
      }),
    ).rejects.toThrow(/bad audio format/);
  });

  it('surfaces a typed error from the native error envelope', async () => {
    const fetch = jsonFetch(422, { message: 'native failure' });
    const model = makeModel(fetch);

    await expect(
      model.doGenerate({
        audio: new Uint8Array([1]),
        mediaType: 'audio/mpeg',
      }),
    ).rejects.toThrow(/native failure/);
  });
});
