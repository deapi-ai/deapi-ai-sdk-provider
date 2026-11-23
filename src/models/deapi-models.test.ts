import { APICallError } from '@ai-sdk/provider';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { DEAPI_DEFAULT_BASE_URL } from '../deapi-config';
import { createDeAPI, listDeAPIModels } from '../deapi-provider';

const MODELS = {
  object: 'list',
  data: [
    {
      id: 'deepseek-v4.1-flash',
      object: 'model',
      owned_by: 'deapi',
      context_length: 1000000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      top_provider: { context_length: 1000000, max_completion_tokens: 393216 },
      supported_parameters: ['max_tokens', 'tools', 'reasoning_effort'],
      pricing: { prompt: '0.000000315', completion: '0.00000126', input_cache_read: '0.0000000063' },
    },
    {
      id: 'gpt-6-luna',
      object: 'model',
      owned_by: 'deapi',
      context_length: 1050000,
      top_provider: { max_completion_tokens: 128000 },
      pricing: {
        prompt: '0.000000105',
        completion: '0.000000525',
        input_cache_read: '0.0000000105',
        input_cache_write: '0.00000013125',
      },
    },
    { id: 'bare-chat', object: 'model', context_length: 8192, pricing: { prompt: 0.000001, completion: 0.000002 } },
    { id: 'Flux_2_Klein_4B_BF16', object: 'model', owned_by: 'deapi' },
    { id: 'Kokoro', object: 'model', owned_by: 'deapi' },
  ],
};

function jsonFetch(status: number, body: unknown): Mock {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('listModels', () => {
  it('GETs <baseURL>/models with the key and returns chat models by default', async () => {
    const fetchMock = jsonFetch(200, MODELS);
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const models = await deapi.listModels();

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${DEAPI_DEFAULT_BASE_URL}/models`);
    expect(init.method ?? 'GET').toBe('GET');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-dp-test');
    expect(models.map((m) => m.id)).toEqual(['deepseek-v4.1-flash', 'gpt-6-luna', 'bare-chat']);
    expect(models[2]).toEqual({ id: 'bare-chat', type: 'chat', contextLength: 8192, pricing: { prompt: 0.000001, completion: 0.000002 } });
    expect(models[0]).toEqual({
      id: 'deepseek-v4.1-flash',
      type: 'chat',
      ownedBy: 'deapi',
      contextLength: 1000000,
      maxOutputTokens: 393216,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportedParameters: ['max_tokens', 'tools', 'reasoning_effort'],
      pricing: { prompt: 0.000000315, completion: 0.00000126, inputCacheRead: 0.0000000063 },
    });
    expect(models[1]?.pricing?.inputCacheWrite).toBe(0.00000013125);
  });

  it('returns media models or everything on request', async () => {
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: jsonFetch(200, MODELS) });

    expect((await deapi.listModels({ type: 'media' })).map((m) => [m.id, m.type])).toEqual([
      ['Flux_2_Klein_4B_BF16', 'media'],
      ['Kokoro', 'media'],
    ]);
    expect(await deapi.listModels({ type: 'all' })).toHaveLength(5);
  });

  it('skips malformed entries and drops unreadable prices instead of failing the list', async () => {
    const fetchMock = jsonFetch(200, {
      data: [
        { id: 42 },
        'not a model',
        { id: 'empty-price', context_length: 4096, pricing: { prompt: '', completion: '0.000001' } },
        { id: 'tts', architecture: { input_modalities: ['text'], output_modalities: ['audio'] } },
        {
          id: 'text-model',
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          supported_parameters: ['max_tokens'],
        },
        { id: 'text-no-params', architecture: { output_modalities: ['text'] } },
      ],
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const models = await deapi.listModels({ type: 'all' });
    expect(models.map((m) => [m.id, m.type])).toEqual([
      ['empty-price', 'chat'],
      ['tts', 'media'],
      ['text-model', 'chat'],
      ['text-no-params', 'media'],
    ]);
    expect(models[0]?.pricing).toBeUndefined();
  });

  it('listDeAPIModels works without building a provider', async () => {
    const fetchMock = jsonFetch(200, MODELS);
    const models = await listDeAPIModels({ apiKey: 'sk-dp-test', fetch: fetchMock, type: 'media' });
    expect(models).toHaveLength(2);
  });

  it('a rejected key surfaces as an APICallError with deAPI message', async () => {
    const deapi = createDeAPI({
      apiKey: 'sk-dp-bad',
      fetch: jsonFetch(401, { error: { message: 'Invalid API key.', type: 'authentication_error', code: 'invalid_api_key' } }),
    });

    const error = await deapi.listModels().catch((e: unknown) => e);
    expect(APICallError.isInstance(error)).toBe(true);
    expect((error as APICallError).statusCode).toBe(401);
    expect((error as APICallError).message).toContain('Invalid API key.');
  });
});
