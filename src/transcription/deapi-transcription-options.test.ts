import { describe, expect, it } from 'vitest';
import {
  DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES,
  assertAudioWithinLimit,
  deapiTranscriptionProviderOptionsSchema,
  getTranscriptionArgs,
} from './deapi-transcription-options';

const baseCall = {
  audio: new Uint8Array([1, 2, 3]),
  mediaType: 'audio/mpeg',
} as const;

describe('deapiTranscriptionProviderOptionsSchema', () => {
  it('accepts response_format json and language', () => {
    const parsed = deapiTranscriptionProviderOptionsSchema.parse({
      response_format: 'json',
      language: 'en',
    });
    expect(parsed).toEqual({ response_format: 'json', language: 'en' });
  });

  it('strips unknown keys', () => {
    const parsed = deapiTranscriptionProviderOptionsSchema.parse({
      response_format: 'json',
      unexpected: true,
    });
    expect(parsed).toEqual({ response_format: 'json' });
  });

  it('rejects an unsupported response_format', () => {
    expect(() =>
      deapiTranscriptionProviderOptionsSchema.parse({
        response_format: 'srt',
      }),
    ).toThrow();
  });
});

describe('getTranscriptionArgs', () => {
  it('defaults response_format to json with no provider options', async () => {
    const args = await getTranscriptionArgs({ ...baseCall });
    expect(args).toEqual({
      response_format: 'json',
      language: undefined,
      warnings: [],
    });
  });

  it('maps provider response_format and language', async () => {
    const args = await getTranscriptionArgs({
      ...baseCall,
      providerOptions: { deapi: { response_format: 'json', language: 'de' } },
    });
    expect(args.response_format).toBe('json');
    expect(args.language).toBe('de');
    expect(args.warnings).toEqual([]);
  });

  it('passes through provider options for a different provider as undefined', async () => {
    const args = await getTranscriptionArgs({
      ...baseCall,
      providerOptions: { openai: { language: 'fr' } },
    });
    expect(args.language).toBeUndefined();
    expect(args.response_format).toBe('json');
  });

  it('surfaces an unknown deapi provider option as an unsupported warning', async () => {
    const args = await getTranscriptionArgs({
      ...baseCall,
      providerOptions: { deapi: { language: 'fr', langauge: 'fr' } },
    });
    expect(args.language).toBe('fr');
    expect(args.warnings).toEqual([
      {
        type: 'unsupported',
        feature: 'providerOptions.deapi.langauge',
        details:
          'The deAPI transcription model does not support the "langauge" ' +
          'provider option; it was ignored.',
      },
    ]);
  });
});

describe('assertAudioWithinLimit', () => {
  it('allows audio at exactly the limit', () => {
    expect(() =>
      assertAudioWithinLimit(DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES),
    ).not.toThrow();
  });

  it('throws a clear error above the limit', () => {
    expect(() =>
      assertAudioWithinLimit(DEAPI_TRANSCRIPTION_MAX_AUDIO_BYTES + 1),
    ).toThrow(/exceeds the 20 MB per-file limit/);
  });
});
