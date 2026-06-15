import {
  NoSuchModelError,
  UnsupportedFunctionalityError,
  type ImageModelV3CallOptions,
} from '@ai-sdk/provider';
import { embed, generateImage } from 'ai';
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
import { createDeAPI } from './deapi-provider';

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
  it('returns an object exposing image, embedding, imageModel, embeddingModel, languageModel', () => {
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x' });
    expect(typeof deapi.image).toBe('function');
    expect(typeof deapi.embedding).toBe('function');
    expect(typeof deapi.imageModel).toBe('function');
    expect(typeof deapi.embeddingModel).toBe('function');
    expect(typeof deapi.languageModel).toBe('function');
  });

  it('reports specificationVersion v3', () => {
    expect(createDeAPI({ apiKey: 'dpn-sk-x' }).specificationVersion).toBe('v3');
  });

  it('does NOT expose speech/transcription (omitted until 0.2.0)', () => {
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x' }) as unknown as Record<
      string,
      unknown
    >;
    expect(deapi.speechModel).toBeUndefined();
    expect(deapi.transcriptionModel).toBeUndefined();
  });

  it('image and imageModel are the same implementation', () => {
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x' });
    expect(deapi.image).toBe(deapi.imageModel);
  });

  it('embedding and embeddingModel are the same implementation', () => {
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x' });
    expect(deapi.embedding).toBe(deapi.embeddingModel);
  });
});

describe('languageModel', () => {
  it('throws NoSuchModelError (modelType languageModel)', () => {
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x' });
    let thrown: unknown;
    try {
      deapi.languageModel('whatever');
    } catch (e) {
      thrown = e;
    }
    expect(NoSuchModelError.isInstance(thrown)).toBe(true);
    expect((thrown as NoSuchModelError).name).toBe('AI_NoSuchModelError');
    expect((thrown as NoSuchModelError).modelType).toBe('languageModel');
    expect((thrown as NoSuchModelError).modelId).toBe('whatever');
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-explicit', fetch: fetchMock });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    const { init } = lastRequest(fetchMock);
    expect(headerValue(init, 'authorization')).toBe('Bearer dpn-sk-explicit');
  });

  it('explicit apiKey overrides the env var value', async () => {
    process.env[ENV_KEY] = 'dpn-sk-fromenv';
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ apiKey: 'dpn-sk-explicit', fetch: fetchMock });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    const { init } = lastRequest(fetchMock);
    expect(headerValue(init, 'authorization')).toBe('Bearer dpn-sk-explicit');
  });
});

describe('embed() request/response', () => {
  it('hits <baseURL>/embeddings with Authorization and flows the vector back', async () => {
    process.env[ENV_KEY] = 'dpn-sk-envkey';
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ fetch: fetchMock });

    const { embedding } = await embed({
      model: deapi.embedding('Bge_M3_FP16'),
      value: 'hello world',
    });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/embeddings`);
    expect(headerValue(init, 'authorization')).toBe('Bearer dpn-sk-envkey');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('Bge_M3_FP16');
    expect(body.input).toEqual(['hello world']);

    expect(embedding).toHaveLength(1024);
    expect(embedding).toEqual(EMBEDDING_OK.data[0]!.embedding);
  });

  it('respects a custom baseURL for the embeddings endpoint', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({
      apiKey: 'dpn-sk-x',
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
    process.env[ENV_KEY] = 'dpn-sk-envkey';
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const deapi = createDeAPI({ fetch: fetchMock });

    const result = await generateImage({
      model: deapi.image('Flux1schnell'),
      prompt: 'a red cube',
      size: '512x512',
    });

    const { url, init } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/images/generations`);
    expect(headerValue(init, 'authorization')).toBe('Bearer dpn-sk-envkey');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('Flux1schnell');
    expect(body.prompt).toBe('a red cube');
    expect(body.size).toBe('512x512');
    expect(body.response_format).toBe('b64_json');

    expect(result.image.base64).toBe('aGVsbG8=');
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
      apiKey: 'dpn-sk-x',
      headers: { 'X-Org': 'acme' },
      fetch: fetchMock,
    });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    const { init } = lastRequest(fetchMock);
    expect(headerValue(init, 'x-org')).toBe('acme');
    expect(headerValue(init, 'authorization')).toBe('Bearer dpn-sk-x');
  });

  it('drops headers whose resolved value is undefined (defensive guard)', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    // headers is typed Record<string,string>; an undefined value can still flow
    // through combineHeaders, and the fetch wrapper must skip it rather than
    // crash on Headers.set(key, undefined).
    const deapi = createDeAPI({
      apiKey: 'dpn-sk-x',
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
    await embed({ model: deapi.embedding('Bge_M3_FP16'), value: 'hi' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('per-call headers reach the request', async () => {
    const fetchMock = jsonFetch(200, EMBEDDING_OK);
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-bad', fetch: fetchMock });
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
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

describe('image-editing guard (Sec-4)', () => {
  /** A minimal, valid ImageModelV3CallOptions with no files/mask. */
  function baseImageOptions(): ImageModelV3CallOptions {
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

  it('preserves the underlying ImageModelV3 surface (spec/provider/modelId)', () => {
    const model = createDeAPI({ apiKey: 'dpn-sk-x' }).image('Flux1schnell');
    expect(model.specificationVersion).toBe('v3');
    expect(model.provider).toBe('deapi.image');
    expect(model.modelId).toBe('Flux1schnell');
    // maxImagesPerCall is forwarded from the underlying model (a value, not the
    // guard wrapper inventing one).
    expect('maxImagesPerCall' in model).toBe(true);
  });

  it('throws UnsupportedFunctionalityError when files are supplied', async () => {
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const model = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock }).image(
      'Flux1schnell',
    );
    let thrown: unknown;
    try {
      await model.doGenerate({
        ...baseImageOptions(),
        files: [{ type: 'file', data: 'aGk=', mediaType: 'image/png' }],
      });
    } catch (e) {
      thrown = e;
    }
    expect(UnsupportedFunctionalityError.isInstance(thrown)).toBe(true);
    expect((thrown as UnsupportedFunctionalityError).functionality).toBe(
      'image editing (files/mask)',
    );
    // The guard fails BEFORE touching the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws UnsupportedFunctionalityError when a mask is supplied', async () => {
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const model = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock }).image(
      'Flux1schnell',
    );
    let thrown: unknown;
    try {
      await model.doGenerate({
        ...baseImageOptions(),
        mask: { type: 'file', data: 'aGk=', mediaType: 'image/png' },
      });
    } catch (e) {
      thrown = e;
    }
    expect(UnsupportedFunctionalityError.isInstance(thrown)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does NOT throw on an empty files array (delegates to generation)', async () => {
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const model = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock }).image(
      'Flux1schnell',
    );
    const result = await model.doGenerate({
      ...baseImageOptions(),
      files: [],
    });
    expect(result.images.length).toBe(1);
    const { url } = lastRequest(fetchMock);
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/images/generations`);
  });

  it('normal generation still delegates to the underlying model (no guard)', async () => {
    const fetchMock = jsonFetch(200, IMAGE_OK);
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
    const result = await generateImage({
      model: deapi.image('Flux1schnell'),
      prompt: 'a blue sphere',
    });
    expect(result.image.base64).toBe('aGVsbG8=');
    expect(lastRequest(fetchMock).url).toBe(
      `${DEAPI_DEFAULT_BASE_URL}/images/generations`,
    );
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
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
    const deapi = createDeAPI({ apiKey: 'dpn-sk-x', fetch: fetchMock });
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
