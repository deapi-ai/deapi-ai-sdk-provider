import {
  UnsupportedFunctionalityError,
  type ImageModelV4CallOptions,
} from '@ai-sdk/provider';
import {
  embed,
  experimental_generateVideo as generateVideo,
  generateImage,
  generateSpeech,
  transcribe,
} from 'ai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { DEAPI_API_KEY_ENV_VAR, DEAPI_DEFAULT_BASE_URL } from './deapi-config';
import { createAuthInjectingFetch, createDeAPI } from './deapi-provider';

const ENV_KEY = DEAPI_API_KEY_ENV_VAR;
const ORIGINAL = process.env[ENV_KEY];

function restoreEnv() {
  if (ORIGINAL === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL;
  }
}

/** Builds a fetch mock returning a JSON Response, recording calls. */
function jsonFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Mock {
  return vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );
}

const EMBEDDING_OK = {
  data: [{ embedding: Array.from({ length: 1024 }, (_, i) => i / 1024) }],
  usage: { prompt_tokens: 3 },
};

const IMAGE_OK = {
  data: [{ b64_json: 'aGVsbG8=' }],
};

function lastRequest(fetchMock: Mock): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function headerValue(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe('createDeAPI: provider shape', () => {
  it('returns an object exposing image, embedding, speech, transcription + canonical methods + languageModel', () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-x' });
    expect(typeof deapi.image).toBe('function');
    expect(typeof deapi.embedding).toBe('function');
    expect(typeof deapi.speech).toBe('function');
    expect(typeof deapi.transcription).toBe('function');
    expect(typeof deapi.imageModel).toBe('function');
    expect(typeof deapi.embeddingModel).toBe('function');
    expect(typeof deapi.speechModel).toBe('function');
    expect(typeof deapi.transcriptionModel).toBe('function');
    expect(typeof deapi.video).toBe('function');
    expect(typeof deapi.videoModel).toBe('function');
    expect(typeof deapi.languageModel).toBe('function');
  });

  it('video and videoModel are the same implementation and report v4', () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-x' });
    expect(deapi.video).toBe(deapi.videoModel);
    const video = deapi.video('Ltxv_13B_0_9_8_Distilled_FP8');
    expect(video.specificationVersion).toBe('v4');
    expect(video.provider).toBe('deapi.video');
    expect(video.modelId).toBe('Ltxv_13B_0_9_8_Distilled_FP8');
  });

  it('reports specificationVersion v4', () => {
    expect(createDeAPI({ apiKey: 'sk-dp-x' }).specificationVersion).toBe('v4');
  });

  it('image and imageModel are the same implementation', () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-x' });
    expect(deapi.image).toBe(deapi.imageModel);
  });

  it('embedding and embeddingModel are the same implementation', () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-x' });
    expect(deapi.embedding).toBe(deapi.embeddingModel);
  });

  it('speech and speechModel are the same implementation', () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-x' });
    expect(deapi.speech).toBe(deapi.speechModel);
  });

  it('transcription and transcriptionModel are the same implementation', () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-x' });
    expect(deapi.transcription).toBe(deapi.transcriptionModel);
  });

  it('speech/transcription models report v4 spec + provider + modelId', () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-x' });
    const speech = deapi.speech('Kokoro');
    expect(speech.specificationVersion).toBe('v4');
    expect(speech.provider).toBe('deapi.speech');
    expect(speech.modelId).toBe('Kokoro');

    const transcription = deapi.transcription('WhisperLargeV3Ct2');
    expect(transcription.specificationVersion).toBe('v4');
    expect(transcription.provider).toBe('deapi.transcription');
    expect(transcription.modelId).toBe('WhisperLargeV3Ct2');
  });
});

describe('languageModel', () => {
  it('deapi(id), languageModel(id) and chatModel(id) return the same chat model', () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-x' });
    for (const model of [
      deapi('deepseek-v4.1-flash'),
      deapi.languageModel('deepseek-v4.1-flash'),
      deapi.chatModel('deepseek-v4.1-flash'),
    ]) {
      expect(model.specificationVersion).toBe('v4');
      expect(model.provider).toBe('deapi.chat');
      expect(model.modelId).toBe('deepseek-v4.1-flash');
    }
  });
});

describe('lazy auth contract', () => {
  it('createDeAPI() with NO env var and NO apiKey does not throw (construction)', () => {
    expect(process.env[ENV_KEY]).toBeUndefined();
    expect(() => createDeAPI()).not.toThrow();
  });

  it('building a model with no key does not throw (still lazy)', () => {
    expect(() => createDeAPI().embedding('Bge_M3_FP16')).not.toThrow();
    expect(() => createDeAPI().image('Flux1schnell')).not.toThrow();
    expect(() => createDeAPI().speech('Kokoro')).not.toThrow();
    expect(() => createDeAPI().transcription('WhisperLargeV3Ct2')).not.toThrow();
  });

  it('the missing-key error surfaces only at invocation time (embed)', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ fetch: fetchMock });
    await expect(
      embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' }),
    ).rejects.toThrow(/API key is missing/);
    // Auth fails before any network call is made.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explicit apiKey overrides a missing env var at invocation', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ apiKey: 'sk-dp-explicit', fetch: fetchMock });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    const { init } = lastRequest(fetchMock);
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-explicit');
  });

  it('explicit apiKey overrides the env var value', async () => {
    process.env[ENV_KEY] = 'sk-dp-fromenv';
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ apiKey: 'sk-dp-explicit', fetch: fetchMock });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    const { init } = lastRequest(fetchMock);
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-explicit');
  });
});

describe('embed() request/response', () => {
  it('hits <baseURL>/embeddings with Authorization and flows the vector back', async () => {
    process.env[ENV_KEY] = 'sk-dp-envkey';
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ fetch: fetchMock });

    const { embedding } = await embed({
      model: deapi.embedding('Bge_M3_FP16'),
      value: 'hello world',
    });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/embeddings`);
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-envkey');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('Bge_M3_FP16');
    expect(body.input).toEqual(['hello world']);

    expect(embedding).toHaveLength(1024);
    expect(embedding).toEqual(EMBEDDING_OK.data[0]!.embedding);
  });

  it('respects a custom baseURL for the embeddings endpoint', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({
      apiKey: 'sk-dp-x',
      baseURL: 'https://proxy.internal/v1',
      fetch: fetchMock,
    });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    expect(lastRequest(fetchMock).url).toBe(
      'https://proxy.internal/v1/embeddings',
    );
  });
});

describe('generateImage() request/response', () => {
  it('hits <baseURL>/images/generations with body fields', async () => {
    process.env[ENV_KEY] = 'sk-dp-envkey';
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const deapi = createDeAPI({ fetch: fetchMock });

    const result = await generateImage({
      model: deapi.image('Flux1schnell'),
      prompt: 'a red cube',
      size: '512x512',
    });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/images/generations`);
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-envkey');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('Flux1schnell');
    expect(body.prompt).toBe('a red cube');
    expect(body.size).toBe('512x512');
    expect(body.response_format).toBe('b64_json');

    expect(result.image.base64).toBe('aGVsbG8=');
  });
});

describe('generateSpeech() request/response', () => {
  /** Builds a fetch mock returning binary audio, recording calls. */
  function audioFetch(bytes: Uint8Array): Mock {
    return vi.fn(async () =>
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );
  }

  it('hits <baseURL>/audio/speech with Authorization and returns audio bytes', async () => {
    process.env[ENV_KEY] = 'sk-dp-envkey';
    const audioBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchMock = audioFetch(audioBytes);
    const deapi = createDeAPI({ fetch: fetchMock });

    const { audio } = await generateSpeech({
      model: deapi.speech('Kokoro'),
      text: 'hello world',
      voice: 'alloy',
    });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/audio/speech`);
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-envkey');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('Kokoro');
    expect(body.input).toBe('hello world');
    expect(body.voice).toBe('alloy');
    expect(body.response_format).toBe('mp3');

    expect(audio.uint8Array).toEqual(audioBytes);
  });

  it('a native-shaped error surfaces its message end-to-end (speech)', async () => {
    const fetchMock = jsonFetch(422, {
      data: null,
      message: 'Native speech error',
      statusCode: 422,
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    let thrown: unknown;
    try {
      await generateSpeech({
        model: deapi.speech('Kokoro'),
        text: 'x',
        maxRetries: 0,
      });
    } catch (e) {
      thrown = e;
    }
    const err = thrown as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(422);
    expect(String(err.message)).toContain('Native speech error');
  });
});

describe('transcribe() request/response', () => {
  it('hits <baseURL>/audio/transcriptions with Authorization and returns text', async () => {
    process.env[ENV_KEY] = 'sk-dp-envkey';
    const fetchMock = jsonFetch(200, { text: 'transcribed words' });
    const deapi = createDeAPI({ fetch: fetchMock });

    // Lead with mp3 magic bytes (0xFF 0xFB) so the AI SDK detects audio/mpeg.
    const { text } = await transcribe({
      model: deapi.transcription('WhisperLargeV3Ct2'),
      audio: new Uint8Array([0xff, 0xfb, 10, 20, 30]),
    });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/audio/transcriptions`);
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-envkey');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as unknown as FormData;
    expect(form.get('model')).toBe('WhisperLargeV3Ct2');
    expect(form.get('response_format')).toBe('json');
    expect(form.get('file')).toBeInstanceOf(Blob);

    expect(text).toBe('transcribed words');
  });

  it('a native-shaped error surfaces its message end-to-end (transcription)', async () => {
    const fetchMock = jsonFetch(422, {
      data: null,
      message: 'Native transcription error',
      statusCode: 422,
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    let thrown: unknown;
    try {
      await transcribe({
        model: deapi.transcription('WhisperLargeV3Ct2'),
        audio: new Uint8Array([0xff, 0xfb, 1, 2, 3]),
        maxRetries: 0,
      });
    } catch (e) {
      thrown = e;
    }
    const err = thrown as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(422);
    expect(String(err.message)).toContain('Native transcription error');
  });
});

describe('experimental_generateVideo() start/status flow', () => {
  it('creates the job, polls until completed, downloads the content with auth', async () => {
    const VIDEO_ID = 'vid-123';
    const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const statuses = ['queued', 'in_progress', 'completed'];
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/videos') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: VIDEO_ID, status: 'queued' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith(`/videos/${VIDEO_ID}/content`)) {
        return new Response(mp4, {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        });
      }
      if (url.endsWith(`/videos/${VIDEO_ID}`)) {
        return new Response(
          JSON.stringify({ id: VIDEO_ID, status: statuses.shift() }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error('unexpected URL ' + url);
    });
    process.env[ENV_KEY] = 'sk-dp-envkey';
    const deapi = createDeAPI({ fetch: fetchMock });

    const { video, warnings } = await generateVideo({
      model: deapi.video('Ltxv_13B_0_9_8_Distilled_FP8'),
      prompt: 'a paper boat on a river',
      duration: 1,
      resolution: '512x512',
      poll: { intervalMs: 1, timeoutMs: 5_000 },
    });

    expect(video.uint8Array).toEqual(mp4);
    expect(video.mediaType).toBe('video/mp4');
    expect(warnings).toEqual([]);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe(`${DEAPI_DEFAULT_BASE_URL}/videos`);
    expect(urls.filter((u) => u === `${DEAPI_DEFAULT_BASE_URL}/videos/${VIDEO_ID}`)).toHaveLength(3);
    expect(urls.at(-1)).toBe(`${DEAPI_DEFAULT_BASE_URL}/videos/${VIDEO_ID}/content`);
    for (const call of fetchMock.mock.calls) {
      expect(headerValue((call[1] ?? {}) as RequestInit, 'authorization')).toBe(
        'Bearer sk-dp-envkey',
      );
    }
    const start = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(start.body))).toEqual({
      model: 'Ltxv_13B_0_9_8_Distilled_FP8',
      prompt: 'a paper boat on a river',
      seconds: '1',
      size: '512x512',
    });
    // The SDK adds an idempotency key to the billable start request.
    expect(headerValue(start, 'idempotency-key')).toMatch(/^aisdk_vid_/);
  });

  it('a failed job surfaces as an error from generateVideo', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? { id: 'v1', status: 'queued' }
            : {
                id: 'v1',
                status: 'failed',
                error: { code: 'job_failed', message: 'Job failed during rendering.' },
              },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    await expect(
      generateVideo({
        model: deapi.video('Ltx2_3_22B_Dist_INT8'),
        prompt: 'x',
        poll: { intervalMs: 1, timeoutMs: 5_000 },
      }),
    ).rejects.toThrow(/Job failed during rendering/);
  });
});

describe('baseURL normalization end-to-end', () => {
  it('trailing slash and no trailing slash produce the same endpoint', async () => {
    const f1 = jsonFetch(200, EMBEDDING_OK);
    const f2 = jsonFetch(200, EMBEDDING_OK);
    const withSlash = createDeAPI({
      apiKey: 'k',
      baseURL: 'https://oai.deapi.ai/v1/',
      fetch: f1,
    });
    const withoutSlash = createDeAPI({
      apiKey: 'k',
      baseURL: 'https://oai.deapi.ai/v1',
      fetch: f2,
    });
    await embed({ model: withSlash.embedding('Bge_M3_FP16'), value: 'a' });
    await embed({ model: withoutSlash.embedding('Bge_M3_FP16'), value: 'a' });
    expect(lastRequest(f1).url).toBe(lastRequest(f2).url);
    expect(lastRequest(f1).url).toBe(`${DEAPI_DEFAULT_BASE_URL}/embeddings`);
  });

  it('a baseURL containing /api/v2 triggers the guard at construction', () => {
    expect(() =>
      createDeAPI({ apiKey: 'k', baseURL: 'https://api.deapi.ai/api/v2' }),
    ).toThrow(/api\/v2/);
  });
});

describe('headers, custom fetch, abortSignal', () => {
  it('custom static headers are merged into the request', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({
      apiKey: 'sk-dp-x',
      headers: { 'X-Org': 'acme' },
      fetch: fetchMock,
    });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    const { init } = lastRequest(fetchMock);
    expect(headerValue(init, 'x-org')).toBe('acme');
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-x');
  });

  it('drops headers whose resolved value is undefined (defensive guard)', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    // headers is typed Record<string,string>; an undefined value can still flow
    // through combineHeaders, and the fetch wrapper must skip it rather than
    // crash on Headers.set(key, undefined).
    const deapi = createDeAPI({
      apiKey: 'sk-dp-x',
      headers: { 'X-Present': 'yes', 'X-Absent': undefined as unknown as string },
      fetch: fetchMock,
    });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    const { init } = lastRequest(fetchMock);
    expect(headerValue(init, 'x-present')).toBe('yes');
    expect(headerValue(init, 'x-absent')).toBeNull();
  });

  it('the custom fetch is actually used', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('per-call headers reach the request', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    await embed({
      model: deapi.embedding('Bge_M3_FP16'),
      value: 'hi',
      headers: { 'X-Request-Id': 'req-123' },
    });
    expect(headerValue(lastRequest(fetchMock).init, 'x-request-id')).toBe(
      'req-123',
    );
  });

  it('an already-aborted signal aborts the call', async () => {
    const fetchMock = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const onAbort = () =>
            reject(new DOMException('Aborted', 'AbortError'));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener('abort', onAbort);
        }),
    );
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    const controller = new AbortController();
    controller.abort();
    await expect(
      embed({
        model: deapi.embedding('Bge_M3_FP16'),
        value: 'hi',
        abortSignal: controller.signal,
        maxRetries: 0,
      }),
    ).rejects.toThrow();
  });
});

describe('error envelopes surfaced through real ai-sdk calls', () => {
  it('a 401 OpenAI-shaped error surfaces as a thrown error with status + message', async () => {
    const fetchMock = jsonFetch(401, {
      error: { message: 'Invalid API key', type: 'invalid_request_error' },
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-bad', fetch: fetchMock });
    let thrown: unknown;
    try {
      await embed({
        model: deapi.embedding('Bge_M3_FP16'),
        value: 'hi',
        maxRetries: 0,
      });
    } catch (e) {
      thrown = e;
    }
    const err = thrown as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(401);
    expect(String(err.message)).toContain('Invalid API key');
  });

  it('a 422 NATIVE-shaped error surfaces its message end-to-end (embed)', async () => {
    const fetchMock = jsonFetch(422, {
      data: null,
      message: 'Validation failed: size invalid',
      errors: [{ field: 'size' }],
      statusCode: 422,
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    let thrown: unknown;
    try {
      await embed({
        model: deapi.embedding('Bge_M3_FP16'),
        value: 'hi',
        maxRetries: 0,
      });
    } catch (e) {
      thrown = e;
    }
    const err = thrown as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(422);
    // The native envelope has no `error.message`; the native handler must lift
    // the top-level `message`. Without it wired in, this would be empty.
    expect(String(err.message)).toContain('Validation failed: size invalid');
  });

  it('a 422 NATIVE-shaped error surfaces its message end-to-end (generateImage)', async () => {
    const fetchMock = jsonFetch(422, {
      data: null,
      message: 'Native image error',
      statusCode: 422,
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    let thrown: unknown;
    try {
      await generateImage({
        model: deapi.image('Flux1schnell'),
        prompt: 'x',
        maxRetries: 0,
      });
    } catch (e) {
      thrown = e;
    }
    const err = thrown as { statusCode?: number; message?: string };
    expect(err.statusCode).toBe(422);
    expect(String(err.message)).toContain('Native image error');
  });

  it('a non-JSON 500 body surfaces as a thrown error preserving status', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('<html>err</html>', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'text/html' },
        }),
    );
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    let thrown: unknown;
    try {
      await embed({
        model: deapi.embedding('Bge_M3_FP16'),
        value: 'hi',
        maxRetries: 0,
      });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { statusCode?: number }).statusCode).toBe(500);
  });
});

describe('image model: editing, mask guard and response format', () => {
  /** A minimal, valid ImageModelV4CallOptions with no files/mask. */
  function baseImageOptions(): ImageModelV4CallOptions {
    return {
      prompt: 'a red cube',
      n: 1,
      size: undefined,
      aspectRatio: undefined,
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: {},
    };
  }

  it('preserves the underlying ImageModelV4 surface and declares file (not mask) support', () => {
    const model = createDeAPI({ apiKey: 'sk-dp-x' }).image('Flux1schnell');
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toBe('deapi.image');
    expect(model.modelId).toBe('Flux1schnell');
    expect(model.maxImagesPerCall).toBe(10);
    expect(model.supportsFileInputs).toBe(true);
    expect(model.supportsMaskInputs).toBe(false);
  });

  it('routes input files to <baseURL>/images/edits as multipart with auth', async () => {
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const model = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock }).image(
      'QwenImageEdit_Plus_NF4',
    );
    const result = await model.doGenerate({
      ...baseImageOptions(),
      prompt: 'make the sky stormy',
      files: [{ type: 'file', data: 'aGk=', mediaType: 'image/png' }],
    });

    expect(result.images).toEqual(['aGVsbG8=']);
    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/images/edits`);
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-x');
    const form = init.body as unknown as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('model')).toBe('QwenImageEdit_Plus_NF4');
    expect(form.get('prompt')).toBe('make the sky stormy');
    expect(form.get('image')).toBeInstanceOf(Blob);
    expect(form.get('response_format')).toBe('b64_json');
    expect(form.get('mask')).toBeNull();
  });

  it('edits via generateImage({ prompt: { images, text } }) from ai', async () => {
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    const result = await generateImage({
      model: deapi.image('Flux_2_Klein_4B_BF16'),
      prompt: {
        images: [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])],
        text: 'combine into a poster',
      },
    });
    expect(result.image.base64).toBe('aGVsbG8=');
    expect(lastRequest(fetchMock).url).toBe(
      `${DEAPI_DEFAULT_BASE_URL}/images/edits`,
    );
  });

  it('downloads a URL input image WITHOUT sending the deAPI key to that host', async () => {
    const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://images.example.com/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response(JSON.stringify(IMAGE_OK), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const model = createDeAPI({
      apiKey: 'sk-dp-secret',
      headers: { 'X-Org': 'acme' },
      fetch: fetchMock,
    }).image('QwenImageEdit_Plus_NF4');

    await model.doGenerate({
      ...baseImageOptions(),
      files: [{ type: 'url', url: 'https://images.example.com/in.png' }],
    });

    const download = fetchMock.mock.calls.find((c) =>
      String(c[0]).startsWith('https://images.example.com/'),
    );
    expect(download).toBeDefined();
    const downloadInit = (download?.[1] ?? {}) as RequestInit;
    expect(headerValue(downloadInit, 'authorization')).toBeNull();
    expect(headerValue(downloadInit, 'x-org')).toBeNull();

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/images/edits`);
    expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-secret');
  });

  it('throws UnsupportedFunctionalityError when a mask is supplied (no inpainting)', async () => {
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const model = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock }).image(
      'Flux1schnell',
    );
    let thrown: unknown;
    try {
      await model.doGenerate({
        ...baseImageOptions(),
        files: [{ type: 'file', data: 'aGk=', mediaType: 'image/png' }],
        mask: { type: 'file', data: 'aGk=', mediaType: 'image/png' },
      });
    } catch (e) {
      thrown = e;
    }
    expect(UnsupportedFunctionalityError.isInstance(thrown)).toBe(true);
    expect((thrown as UnsupportedFunctionalityError).functionality).toBe(
      'image inpainting (mask)',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an empty files array is plain generation', async () => {
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const model = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock }).image(
      'Flux1schnell',
    );
    const result = await model.doGenerate({
      ...baseImageOptions(),
      files: [],
    });
    expect(result.images.length).toBe(1);
    expect(lastRequest(fetchMock).url).toBe(
      `${DEAPI_DEFAULT_BASE_URL}/images/generations`,
    );
  });

  it('forwards deAPI provider options and lets the caller choose response_format', async () => {
    const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://results.example.com/')) {
        return new Response(new Uint8Array([7, 7, 7]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response(
        JSON.stringify({ data: [{ url: 'https://results.example.com/a.png' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    const result = await generateImage({
      model: deapi.image('Flux1schnell'),
      prompt: 'a blue sphere',
      providerOptions: { deapi: { response_format: 'url', quality: 'low' } },
    });

    const generation = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith('/images/generations'),
    );
    const body = JSON.parse(String((generation?.[1] ?? {}).body));
    expect(body.response_format).toBe('url');
    expect(body.quality).toBe('low');

    const download = fetchMock.mock.calls.find((c) =>
      String(c[0]).startsWith('https://results.example.com/'),
    );
    expect(
      headerValue((download?.[1] ?? {}) as RequestInit, 'authorization'),
    ).toBeNull();
    expect(result.image.uint8Array).toEqual(new Uint8Array([7, 7, 7]));
  });
});

describe('createAuthInjectingFetch (origin scoping)', () => {
  const BASE = 'https://oai.deapi.ai/v1';
  const resolve = () => ({ Authorization: 'Bearer sk-dp-x', 'X-Org': 'acme' });

  function okFetch(): Mock {
    return vi.fn(async () => new Response('{}', { status: 200 }));
  }

  it('adds auth + user headers + redirect:manual for the baseURL origin (string, URL, Request)', async () => {
    const base = okFetch();
    const wrapped = createAuthInjectingFetch(BASE, resolve, base);
    await wrapped(`${BASE}/models`);
    await wrapped(new URL(`${BASE}/models`));
    await wrapped(new Request(`${BASE}/models`));
    expect(base).toHaveBeenCalledTimes(3);
    for (const call of base.mock.calls) {
      const init = call[1] as RequestInit;
      expect(headerValue(init, 'authorization')).toBe('Bearer sk-dp-x');
      expect(headerValue(init, 'x-org')).toBe('acme');
      expect(init.redirect).toBe('manual');
    }
  });

  it('passes other origins through untouched and never resolves the key for them', async () => {
    const base = okFetch();
    const resolver = vi.fn(resolve);
    const wrapped = createAuthInjectingFetch(BASE, resolver, base);
    const init = { headers: { accept: 'image/*' } };
    await wrapped('https://results.example.com/a.png', init);
    await wrapped(new URL('https://evil.example/v1/models'));
    expect(resolver).not.toHaveBeenCalled();
    expect(base.mock.calls[0]?.[1]).toBe(init);
    expect(base.mock.calls[1]?.[1]).toBeUndefined();
  });

  it('falls back to globalThis.fetch when no custom fetch is given', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const wrapped = createAuthInjectingFetch(BASE, resolve, undefined);
    await wrapped(`${BASE}/models`);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('custom fetch sets redirect:manual (Sec-5)', () => {
  it('passes redirect:"manual" through to the underlying fetch', async () => {
    let capturedRedirect: RequestInit['redirect'];
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      capturedRedirect = init?.redirect;
      return new Response(JSON.stringify(EMBEDDING_OK), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    expect(capturedRedirect).toBe('manual');
  });

  it('a 307 is NOT followed (surfaces as a non-2xx, Bearer not replayed)', async () => {
    // With redirect:'manual' the underlying fetch returns the 3xx directly
    // instead of following it to another origin with the Authorization header.
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      return new Response('', {
        status: 307,
        headers: { location: 'https://evil.example/v1/embeddings' },
      });
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-x', fetch: fetchMock });
    await expect(
      embed({
        model: deapi.embedding('Bge_M3_FP16'),
        value: 'hi',
        maxRetries: 0,
      }),
    ).rejects.toThrow();
    // Only the single original call was made; the redirect target was never hit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
