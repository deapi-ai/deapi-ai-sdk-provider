import {
  type Experimental_VideoModelV4CallOptions as VideoModelV4CallOptions,
  InvalidArgumentError,
} from '@ai-sdk/provider';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { failedResponseHandler } from '../deapi-error';
import { DeAPIVideoModel } from './deapi-video-model';

const BASE_URL = 'https://oai.deapi.ai/v1';
const VIDEO_ID = 'c08a339c-73e5-4d67-a4d5-231302fbff9a';

type FetchArgs = [input: unknown, init?: RequestInit];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch mock answering from a queue of responses, recording calls. */
function queueFetch(...responses: Response[]): Mock<(...args: FetchArgs) => Promise<Response>> {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch call');
    return next;
  });
}

function makeModel(fetch: Mock, modelId = 'Ltx2_3_22B_Dist_INT8'): DeAPIVideoModel {
  return new DeAPIVideoModel(modelId, {
    provider: 'deapi.video',
    url: ({ path }) => `${BASE_URL}${path}`,
    headers: () => ({ 'x-static': 'yes' }),
    fetch: fetch as unknown as typeof globalThis.fetch,
    failedResponseHandler,
  });
}

function callOptions(
  overrides: Partial<VideoModelV4CallOptions> = {},
): VideoModelV4CallOptions {
  return {
    prompt: 'a paper boat drifting down a rain-soaked street',
    n: 1,
    aspectRatio: undefined,
    resolution: undefined,
    duration: undefined,
    fps: undefined,
    seed: undefined,
    image: undefined,
    frameImages: undefined,
    inputReferences: undefined,
    generateAudio: undefined,
    providerOptions: {},
    ...overrides,
  };
}

function requestBody(fetch: Mock, index = -1): Record<string, unknown> {
  const call = fetch.mock.calls.at(index) as FetchArgs | undefined;
  return JSON.parse(String(call?.[1]?.body));
}

const QUEUED = { id: VIDEO_ID, object: 'video', status: 'queued', progress: 0 };

describe('DeAPIVideoModel identity', () => {
  it('exposes the V4 identity and one video per call', () => {
    const model = makeModel(queueFetch());
    expect(model.specificationVersion).toBe('v4');
    expect(model.provider).toBe('deapi.video');
    expect(model.modelId).toBe('Ltx2_3_22B_Dist_INT8');
    expect(model.maxVideosPerCall).toBe(1);
    // No native webhooks: the SDK must fall back to polling.
    expect('handleWebhookOption' in model).toBe(false);
    expect('doGenerate' in model).toBe(false);
  });
});

describe('DeAPIVideoModel.doStart', () => {
  it('POSTs /videos with model, prompt, seconds, size and returns the operation', async () => {
    const fetch = queueFetch(json(200, QUEUED));
    const model = makeModel(fetch);

    const result = await model.doStart({
      ...callOptions({ duration: 5, resolution: '768x768' }),
      headers: { 'idempotency-key': 'aisdk_vid_1' },
    });

    const call = fetch.mock.calls[0] as FetchArgs;
    expect(String(call[0])).toBe(`${BASE_URL}/videos`);
    expect(call[1]?.method).toBe('POST');
    const headers = new Headers(call[1]?.headers);
    expect(headers.get('idempotency-key')).toBe('aisdk_vid_1');
    expect(headers.get('x-static')).toBe('yes');
    expect(requestBody(fetch)).toEqual({
      model: 'Ltx2_3_22B_Dist_INT8',
      prompt: 'a paper boat drifting down a rain-soaked street',
      seconds: '5',
      size: '768x768',
    });

    expect(result.operation).toEqual({ id: VIDEO_ID });
    expect(result.warnings).toEqual([]);
    expect(result.providerMetadata).toEqual({ deapi: { videoId: VIDEO_ID } });
    expect(result.response.modelId).toBe('Ltx2_3_22B_Dist_INT8');
    expect(result.response.timestamp).toBeInstanceOf(Date);
    expect(result.response.headers?.['content-type']).toBe('application/json');
  });

  it('omits seconds/size when not given (model defaults apply)', async () => {
    const fetch = queueFetch(json(200, QUEUED));
    await makeModel(fetch).doStart(callOptions());
    expect(requestBody(fetch)).toEqual({
      model: 'Ltx2_3_22B_Dist_INT8',
      prompt: 'a paper boat drifting down a rain-soaked street',
    });
  });

  it('maps image bytes to input_reference as a data URL', async () => {
    const fetch = queueFetch(json(200, QUEUED));
    await makeModel(fetch).doStart(
      callOptions({
        image: { type: 'file', mediaType: 'image/png', data: new Uint8Array([104, 105]) },
      }),
    );
    expect(requestBody(fetch).input_reference).toEqual({
      image_url: 'data:image/png;base64,aGk=',
    });
  });

  it('maps a base64 image string and an image URL to input_reference', async () => {
    const fetch = queueFetch(json(200, QUEUED), json(200, QUEUED));
    const model = makeModel(fetch);
    await model.doStart(
      callOptions({ image: { type: 'file', mediaType: 'image/jpeg', data: 'aGk=' } }),
    );
    expect(requestBody(fetch, 0).input_reference).toEqual({
      image_url: 'data:image/jpeg;base64,aGk=',
    });
    await model.doStart(
      callOptions({ image: { type: 'url', url: 'https://example.com/first.png' } }),
    );
    expect(requestBody(fetch, 1).input_reference).toEqual({
      image_url: 'https://example.com/first.png',
    });
  });

  it('uses a first_frame frame image and warns about last_frame and extra frames', async () => {
    const fetch = queueFetch(json(200, QUEUED));
    const result = await makeModel(fetch).doStart(
      callOptions({
        frameImages: [
          { frameType: 'first_frame', image: { type: 'url', url: 'https://example.com/a.png' } },
          { frameType: 'first_frame', image: { type: 'url', url: 'https://example.com/b.png' } },
          { frameType: 'last_frame', image: { type: 'url', url: 'https://example.com/z.png' } },
        ],
      }),
    );
    expect(requestBody(fetch).input_reference).toEqual({
      image_url: 'https://example.com/a.png',
    });
    expect(result.warnings.map((w) => 'feature' in w && w.feature)).toEqual([
      'frameImages.first_frame',
      'frameImages.last_frame',
    ]);
  });

  it('prefers `image` over a first_frame frame image', async () => {
    const fetch = queueFetch(json(200, QUEUED));
    const result = await makeModel(fetch).doStart(
      callOptions({
        image: { type: 'url', url: 'https://example.com/image.png' },
        frameImages: [
          { frameType: 'first_frame', image: { type: 'url', url: 'https://example.com/frame.png' } },
        ],
      }),
    );
    expect(requestBody(fetch).input_reference).toEqual({
      image_url: 'https://example.com/image.png',
    });
    expect(result.warnings).toHaveLength(1);
  });

  it('warns for options without a deAPI counterpart', async () => {
    const fetch = queueFetch(json(200, QUEUED));
    const result = await makeModel(fetch).doStart(
      callOptions({
        aspectRatio: '16:9',
        fps: 30,
        seed: 42,
        generateAudio: true,
        inputReferences: [{ type: 'url', url: 'https://example.com/ref.png' }],
      }),
    );
    expect(result.warnings.map((w) => 'feature' in w && w.feature)).toEqual([
      'aspectRatio',
      'fps',
      'seed',
      'generateAudio',
      'inputReferences',
    ]);
    const body = requestBody(fetch);
    expect(body).not.toHaveProperty('aspect_ratio');
    expect(body).not.toHaveProperty('input_reference');
  });

  it('does not warn for generateAudio=false or an empty inputReferences list', async () => {
    const fetch = queueFetch(json(200, QUEUED));
    const result = await makeModel(fetch).doStart(
      callOptions({ generateAudio: false, inputReferences: [] }),
    );
    expect(result.warnings).toEqual([]);
  });

  it('merges providerOptions.deapi into the body', async () => {
    const fetch = queueFetch(json(200, QUEUED));
    await makeModel(fetch).doStart(
      callOptions({ duration: 3, providerOptions: { deapi: { seconds: '4', user: 'u1' } } }),
    );
    const body = requestBody(fetch);
    expect(body.seconds).toBe('4');
    expect(body.user).toBe('u1');
  });

  it('rejects a missing or blank prompt before any request', async () => {
    const fetch = queueFetch();
    const model = makeModel(fetch);
    await expect(model.doStart(callOptions({ prompt: undefined }))).rejects.toSatisfy(
      (e) => InvalidArgumentError.isInstance(e),
    );
    await expect(model.doStart(callOptions({ prompt: '   ' }))).rejects.toThrow(
      /requires a text prompt/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces an API error envelope as an APICallError', async () => {
    const fetch = queueFetch(
      json(400, {
        error: {
          message: 'seconds=7 is not supported by Ltx2_3_22B_Dist_INT8.',
          type: 'invalid_request_error',
          code: 'duration_not_supported',
        },
      }),
    );
    await expect(makeModel(fetch).doStart(callOptions({ duration: 7 }))).rejects.toThrow(
      /seconds=7 is not supported/,
    );
  });
});

describe('DeAPIVideoModel.doStatus', () => {
  it('reports pending for queued / in_progress / unknown states', async () => {
    const fetch = queueFetch(
      json(200, { ...QUEUED, status: 'queued' }),
      json(200, { ...QUEUED, status: 'in_progress', progress: 50 }),
      json(200, { ...QUEUED, status: 'something_new' }),
    );
    const model = makeModel(fetch);
    for (const status of ['queued', 'in_progress', 'something_new']) {
      const result = await model.doStatus({ operation: { id: VIDEO_ID } });
      expect(result.status).toBe('pending');
      expect(result.providerMetadata).toEqual({ deapi: { videoId: VIDEO_ID, status } });
    }
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${BASE_URL}/videos/${VIDEO_ID}`);
  });

  it('downloads the content when completed and returns binary video data', async () => {
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    const fetch = queueFetch(
      json(200, { ...QUEUED, status: 'completed', progress: 100 }),
      new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    );
    const result = await makeModel(fetch).doStatus({
      operation: { id: VIDEO_ID },
      headers: { 'x-call': 'c1' },
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('unreachable');
    expect(result.videos).toEqual([{ type: 'binary', data: bytes, mediaType: 'video/mp4' }]);
    expect(result.warnings).toEqual([]);
    expect(result.response.headers?.['content-type']).toBe('video/mp4');

    const contentCall = fetch.mock.calls[1] as FetchArgs;
    expect(String(contentCall[0])).toBe(`${BASE_URL}/videos/${VIDEO_ID}/content`);
    expect(new Headers(contentCall[1]?.headers).get('x-call')).toBe('c1');
  });

  it('falls back to video/mp4 when the content type is missing or not a video type', async () => {
    const fetch = queueFetch(
      json(200, { ...QUEUED, status: 'completed' }),
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
      json(200, { ...QUEUED, status: 'completed' }),
      new Response(new Uint8Array([1]), { status: 200 }),
      json(200, { ...QUEUED, status: 'completed' }),
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-type': 'video/webm; codecs=vp9' },
      }),
    );
    const model = makeModel(fetch);
    const types: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await model.doStatus({ operation: { id: VIDEO_ID } });
      if (result.status !== 'completed') throw new Error('expected completed');
      types.push(result.videos[0]!.mediaType);
    }
    expect(types).toEqual(['video/mp4', 'video/mp4', 'video/webm']);
  });

  it('reports an error status with the job message when failed', async () => {
    const fetch = queueFetch(
      json(200, {
        ...QUEUED,
        status: 'failed',
        error: { code: 'job_failed', message: 'Job failed during rendering.' },
      }),
      json(200, { ...QUEUED, status: 'failed' }),
    );
    const model = makeModel(fetch);
    const first = await model.doStatus({ operation: { id: VIDEO_ID } });
    expect(first).toMatchObject({ status: 'error', error: 'Job failed during rendering.' });
    const second = await model.doStatus({ operation: { id: VIDEO_ID } });
    expect(second).toMatchObject({
      status: 'error',
      error: `deAPI video generation failed (id ${VIDEO_ID}).`,
    });
    // No content download is attempted for a failed job.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('URL-encodes the video id', async () => {
    const fetch = queueFetch(json(200, { id: 'a/b', status: 'queued' }));
    await makeModel(fetch).doStatus({ operation: { id: 'a/b' } });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${BASE_URL}/videos/a%2Fb`);
  });

  it('rejects an operation that did not come from doStart', async () => {
    const fetch = queueFetch();
    const model = makeModel(fetch);
    for (const operation of [null, 'id', { id: '' }, { other: 1 }]) {
      await expect(model.doStatus({ operation })).rejects.toSatisfy((e) =>
        InvalidArgumentError.isInstance(e),
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a 404 for an unknown video as an APICallError', async () => {
    const fetch = queueFetch(
      json(404, {
        error: { message: 'Video not found.', type: 'not_found_error', code: 'video_not_found' },
      }),
    );
    await expect(
      makeModel(fetch).doStatus({ operation: { id: VIDEO_ID } }),
    ).rejects.toThrow(/Video not found/);
  });
});
