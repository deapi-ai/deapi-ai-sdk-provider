import { APICallError } from '@ai-sdk/provider';
import { generateText, jsonSchema, Output, streamText, tool } from 'ai';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { DEAPI_DEFAULT_BASE_URL } from '../deapi-config';
import { createDeAPI } from '../deapi-provider';
import { deapiChatMetadataExtractor } from './deapi-chat';

const CHAT_URL = `${DEAPI_DEFAULT_BASE_URL}/chat/completions`;

function completion(overrides: Record<string, unknown> = {}, cost: number | null = 0.0000099) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-v4.1-flash',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hi there!' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 7,
      completion_tokens: 12,
      total_tokens: 19,
      ...(cost === null ? {} : { cost }),
    },
    ...overrides,
  };
}

function jsonFetch(status: number, body: unknown): Mock {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function sseFetch(chunks: unknown[]): Mock {
  const text =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
    'data: [DONE]\n\n';
  return vi.fn(async () =>
    new Response(text, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
  );
}

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return {
    id: 'chatcmpl-2',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'deepseek-v4.1-flash',
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

const USAGE_CHUNK = {
  id: 'chatcmpl-2',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'deepseek-v4.1-flash',
  choices: [],
  usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18, cost: 0.00000918 },
};

function sentBody(fetchMock: Mock): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

describe('generateText', () => {
  it('posts to <baseURL>/chat/completions with the key and returns text, usage and cost', async () => {
    const fetchMock = jsonFetch(200, completion());
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const result = await generateText({
      model: deapi('deepseek-v4.1-flash'),
      prompt: 'Say hi.',
      maxOutputTokens: 16,
    });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(CHAT_URL);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-dp-test');
    expect(sentBody(fetchMock)).toMatchObject({ model: 'deepseek-v4.1-flash', max_tokens: 16 });
    expect(result.text).toBe('Hi there!');
    expect(result.usage.inputTokens).toBe(7);
    expect(result.usage.outputTokens).toBe(12);
    expect(result.providerMetadata?.deapi?.cost).toBe(0.0000099);
  });

  it('leaves cost out when deAPI does not report one', async () => {
    const fetchMock = jsonFetch(200, completion({}, null));
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const result = await generateText({ model: deapi('deepseek-v4.1-flash'), prompt: 'Say hi.' });

    expect(result.providerMetadata?.deapi?.cost).toBeUndefined();
  });

  it('sends reasoning_effort from the top-level reasoning option and from provider options', async () => {
    const fetchMock = jsonFetch(200, completion());
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    await generateText({ model: deapi('qwen3.8-flash'), prompt: 'x', reasoning: 'low' });
    expect(sentBody(fetchMock).reasoning_effort).toBe('low');

    await generateText({
      model: deapi('glm-5.3'),
      prompt: 'x',
      providerOptions: { deapi: { reasoningEffort: 'max' } },
    });
    expect(sentBody(fetchMock).reasoning_effort).toBe('max');
  });

  it('returns reasoning_content as reasoning', async () => {
    const fetchMock = jsonFetch(
      200,
      completion({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '208', reasoning_content: '13:15 - 09:47 = 3h28m' },
            finish_reason: 'stop',
          },
        ],
      }),
    );
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const result = await generateText({ model: deapi('deepseek-v4.1-flash'), prompt: 'x' });

    expect(result.text).toBe('208');
    expect(result.reasoningText).toBe('13:15 - 09:47 = 3h28m');
  });

  it('returns tool calls', async () => {
    const fetchMock = jsonFetch(
      200,
      completion({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'weather', arguments: '{"city":"Warsaw"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const result = await generateText({
      model: deapi('deepseek-v4.1-flash'),
      prompt: 'Weather in Warsaw?',
      tools: {
        weather: tool({
          description: 'Current weather',
          inputSchema: jsonSchema<{ city: string }>({
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          }),
        }),
      },
    });

    expect(sentBody(fetchMock).tools).toHaveLength(1);
    expect(result.toolCalls[0]?.toolName).toBe('weather');
    expect(result.toolCalls[0]?.input).toEqual({ city: 'Warsaw' });
  });

  it('asks for json_schema, except on glm-5.3 which only takes json_object', async () => {
    const schema = jsonSchema<{ answer: number }>({
      type: 'object',
      properties: { answer: { type: 'number' } },
      required: ['answer'],
    });
    const fetchMock = jsonFetch(
      200,
      completion({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"answer":208}' }, finish_reason: 'stop' }],
      }),
    );
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const result = await generateText({
      model: deapi('deepseek-v4.1-flash'),
      prompt: 'x',
      output: Output.object({ schema }),
    });
    expect((sentBody(fetchMock).response_format as { type: string }).type).toBe('json_schema');
    expect(result.output).toEqual({ answer: 208 });

    const glm = await generateText({ model: deapi('glm-5.3'), prompt: 'x', output: Output.object({ schema }) });
    const body = sentBody(fetchMock);
    expect(body.response_format).toEqual({ type: 'json_object' });
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('"answer"');
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'x' });
    expect(glm.warnings ?? []).toEqual([]);
    expect(glm.output).toEqual({ answer: 208 });
  });

  it('keeps the schema in the prompt for a :variant of a model without json_schema, and its name/description', async () => {
    const fetchMock = jsonFetch(
      200,
      completion({ choices: [{ index: 0, message: { role: 'assistant', content: '{"a":1}' }, finish_reason: 'stop' }] }),
    );
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });
    const model = deapi('glm-5.3:economy');

    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      responseFormat: { type: 'json', schema: { type: 'object' }, name: 'result', description: 'the answer' },
    });
    const system = (sentBody(fetchMock).messages as Array<{ content: string }>)[0]?.content;
    expect(system).toContain('(result: the answer)');

    await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'plain' }] }] });
    expect(sentBody(fetchMock).messages).toEqual([{ role: 'user', content: 'plain' }]);
    expect(model.supportedUrls).toBeDefined();
  });

  it('streams structured output on glm-5.3 with the schema as a system message', async () => {
    const fetchMock = sseFetch([chunk({ content: '{"a":1}' }, 'stop'), USAGE_CHUNK]);
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const result = streamText({
      model: deapi('glm-5.3'),
      prompt: 'x',
      output: Output.object({ schema: jsonSchema<{ a: number }>({ type: 'object', properties: { a: { type: 'number' } } }) }),
    });
    await result.consumeStream();
    const body = sentBody(fetchMock);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect((body.messages as Array<{ role: string }>)[0]?.role).toBe('system');
  });

  it('uses a custom baseURL for chat', async () => {
    const fetchMock = jsonFetch(200, completion());
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', baseURL: 'https://proxy.example/v1/', fetch: fetchMock });

    await generateText({ model: deapi('deepseek-v4.1-flash'), prompt: 'x' });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://proxy.example/v1/chat/completions');
  });

  it('surfaces a 400 from deAPI as an APICallError with its message', async () => {
    const fetchMock = jsonFetch(400, {
      error: {
        message: "Unsupported value: 'turbo' for 'reasoning_effort'.",
        type: 'invalid_request_error',
        param: 'reasoning_effort',
        code: 'invalid_value',
      },
    });
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const error = await generateText({
      model: deapi('deepseek-v4.1-flash'),
      prompt: 'x',
      providerOptions: { deapi: { reasoningEffort: 'turbo' } },
      maxRetries: 0,
    }).catch((e: unknown) => e);

    expect(APICallError.isInstance(error)).toBe(true);
    expect((error as APICallError).statusCode).toBe(400);
    expect((error as APICallError).message).toContain("Unsupported value: 'turbo'");
  });
});

describe('streamText', () => {
  it('asks for the usage chunk and returns its cost in providerMetadata', async () => {
    const fetchMock = sseFetch([
      chunk({ role: 'assistant', content: 'Hi' }),
      chunk({ content: ' there!' }),
      chunk({}, 'stop'),
      USAGE_CHUNK,
    ]);
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const result = streamText({ model: deapi('deepseek-v4.1-flash'), prompt: 'Say hi.' });

    expect(await result.text).toBe('Hi there!');
    expect(sentBody(fetchMock)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect((await result.usage).outputTokens).toBe(11);
    expect((await result.providerMetadata)?.deapi?.cost).toBe(0.00000918);
  });

  it('keeps include_usage even when provider options try to turn it off', async () => {
    const fetchMock = sseFetch([chunk({ content: 'ok' }, 'stop'), USAGE_CHUNK]);
    const deapi = createDeAPI({ apiKey: 'sk-dp-test', fetch: fetchMock });

    const result = streamText({
      model: deapi('deepseek-v4.1-flash'),
      prompt: 'x',
      providerOptions: { deapi: { stream_options: { include_usage: false } } },
    });

    await result.consumeStream();
    expect(sentBody(fetchMock).stream_options).toEqual({ include_usage: true });
    expect((await result.providerMetadata)?.deapi?.cost).toBe(0.00000918);
  });
});

describe('deapiChatMetadataExtractor', () => {
  it('ignores bodies and chunks without a numeric usage.cost', async () => {
    for (const parsedBody of [null, 'text', { usage: null }, { usage: 'x' }, { usage: { cost: 'free' } }, { usage: { cost: Number.NaN } }]) {
      expect(await deapiChatMetadataExtractor.extractMetadata({ parsedBody })).toBeUndefined();
    }
    const stream = deapiChatMetadataExtractor.createStreamExtractor();
    stream.processChunk({ usage: { cost: 0.5 } });
    stream.processChunk({ choices: [] });
    expect(stream.buildMetadata()).toEqual({ deapi: { cost: 0.5 } });
  });
});
