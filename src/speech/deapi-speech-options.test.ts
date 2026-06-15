import type { SpeechModelV3CallOptions } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEECH_RESPONSE_FORMAT,
  DEFAULT_SPEECH_VOICE,
  deapiSpeechProviderOptionsSchema,
  mapSpeechCallOptions,
} from './deapi-speech-options';

function callOptions(
  overrides: Partial<SpeechModelV3CallOptions> = {},
): SpeechModelV3CallOptions {
  return { text: 'hello world', ...overrides };
}

describe('deapiSpeechProviderOptionsSchema', () => {
  it('accepts an empty object', () => {
    expect(deapiSpeechProviderOptionsSchema.parse({})).toEqual({});
  });

  it('parses the supported provider options', () => {
    expect(
      deapiSpeechProviderOptionsSchema.parse({
        speed: 1.25,
        language: 'en',
        instructions: 'Speak slowly',
      }),
    ).toEqual({ speed: 1.25, language: 'en', instructions: 'Speak slowly' });
  });

  it('rejects a wrongly-typed field', () => {
    expect(() =>
      deapiSpeechProviderOptionsSchema.parse({ speed: 'fast' }),
    ).toThrow();
  });
});

describe('mapSpeechCallOptions', () => {
  it('applies defaults for voice and response_format', () => {
    const { body, warnings } = mapSpeechCallOptions(callOptions(), undefined);
    expect(body).toEqual({
      model: '',
      input: 'hello world',
      voice: DEFAULT_SPEECH_VOICE,
      response_format: DEFAULT_SPEECH_RESPONSE_FORMAT,
    });
    expect(warnings).toEqual([]);
  });

  it('maps voice and outputFormat -> response_format', () => {
    const { body } = mapSpeechCallOptions(
      callOptions({ voice: 'nova', outputFormat: 'wav' }),
      undefined,
    );
    expect(body.voice).toBe('nova');
    expect(body.response_format).toBe('wav');
  });

  it('maps the standard speed/language/instructions options', () => {
    const { body } = mapSpeechCallOptions(
      callOptions({ speed: 0.9, language: 'es', instructions: 'whisper' }),
      undefined,
    );
    expect(body).toMatchObject({
      speed: 0.9,
      language: 'es',
      instructions: 'whisper',
    });
  });

  it('omits optional fields when neither source supplies them', () => {
    const { body } = mapSpeechCallOptions(callOptions(), undefined);
    expect('speed' in body).toBe(false);
    expect('language' in body).toBe(false);
    expect('instructions' in body).toBe(false);
  });

  it('lets provider options override the standard call options', () => {
    const { body } = mapSpeechCallOptions(
      callOptions({ speed: 1, language: 'en', instructions: 'a' }),
      { speed: 2, language: 'fr', instructions: 'b' },
    );
    expect(body).toMatchObject({ speed: 2, language: 'fr', instructions: 'b' });
  });

  it('takes provider option values when standard ones are absent', () => {
    const { body } = mapSpeechCallOptions(callOptions(), {
      speed: 1.5,
      language: 'de',
      instructions: 'calm',
    });
    expect(body).toMatchObject({
      speed: 1.5,
      language: 'de',
      instructions: 'calm',
    });
  });

  it('warns (does not drop silently) for unknown providerOptions.deapi keys', () => {
    const { warnings } = mapSpeechCallOptions(callOptions(), undefined, {
      bogus: true,
    });
    expect(warnings).toEqual([
      {
        type: 'unsupported',
        feature: 'providerOptions.deapi.bogus',
        details: expect.stringContaining('bogus'),
      },
    ]);
  });

  it('does not warn for recognised raw provider option keys', () => {
    const { warnings } = mapSpeechCallOptions(callOptions(), { speed: 1 }, {
      speed: 1,
    });
    expect(warnings).toEqual([]);
  });
});
