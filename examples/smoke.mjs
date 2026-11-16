// Live smoke test for @deapi/ai-sdk-provider.
//
// WARNING: makes REAL, BILLED calls to the deAPI API. Every request is kept as
// small as the API allows:
//   - preflight GET /v1/models (free)
//   - 1 embedding of a short string (Bge_M3_FP16)
//   - 1 image, 512x512, quality "low" (Flux1schnell — the fewest steps)
//   - 1 short sentence of speech (Kokoro)
//   - 1 transcription of that same short clip (WhisperLargeV3Ct2)
//   - 1 video, 1 second, 512x512 (Ltxv_13B_0_9_8_Distilled_FP8 — the cheapest)
// plus the network-free mask guard. Set DEAPI_SMOKE_SKIP_VIDEO=1 to skip the
// video step.
//
// Reads DEAPI_API_KEY from the environment — never hardcode the key.
// Build first, then run:
//   npm run build && DEAPI_API_KEY=sk-dp-... node examples/smoke.mjs
//
// Writes a machine-readable result to live-smoke-result.json (no key, no
// response bodies) and exits non-zero if any check fails.
import { writeFileSync } from 'node:fs';
import { deapi } from '../dist/index.mjs';
import {
  embed,
  experimental_generateVideo as generateVideo,
  generateImage,
  generateSpeech,
  transcribe,
} from 'ai';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';

// The OpenAI-compatible default base URL (matches the provider default). Kept
// local to this example so the package's public barrel stays minimal.
const DEAPI_DEFAULT_BASE_URL = 'https://oai.deapi.ai/v1';

const results = [];
function ok(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  results.push({ check: label, pass: Boolean(cond), detail: extra });
  if (!cond) process.exitCode = 1;
}

const apiKey = process.env.DEAPI_API_KEY;
if (!apiKey) {
  console.error('DEAPI_API_KEY is not set — cannot run live smoke.');
  process.exit(1);
}

// --- Preflight: GET /v1/models (auth + service reachable, not billed) ---
console.log('--- preflight: GET /v1/models ---');
try {
  const res = await fetch(`${DEAPI_DEFAULT_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = res.ok ? await res.json() : null;
  const models = Array.isArray(body?.data) ? body.data.length : 0;
  ok('GET /v1/models returns 200 with models', res.ok && models > 0,
    `HTTP ${res.status}, models=${models}`);
} catch (e) {
  ok('GET /v1/models returns 200 with models', false, `threw: ${e?.name}: ${e?.message}`);
}

console.log('\n--- embedding (Bge_M3_FP16) ---');
try {
  const { embedding } = await embed({
    model: deapi.embedding('Bge_M3_FP16'),
    value: 'hello',
  });
  ok('embed returns 1024-dim vector', Array.isArray(embedding) && embedding.length === 1024,
    `dims=${embedding?.length}`);
} catch (e) {
  ok('embed returns 1024-dim vector', false, `threw: ${e?.name}: ${e?.message}`);
}

console.log('\n--- image (Flux1schnell, 512x512, quality low) ---');
try {
  const res = await generateImage({
    model: deapi.image('Flux1schnell'),
    prompt: 'a red apple',
    size: '512x512',
    providerOptions: { deapi: { quality: 'low' } },
  });
  const bytes = res.image?.uint8Array?.length ?? 0;
  ok('generateImage returns image bytes', bytes > 0, `uint8Array=${bytes}B`);
  console.log('   warnings:', JSON.stringify(res.warnings ?? []));
} catch (e) {
  ok('generateImage returns image bytes', false, `threw: ${e?.name}: ${e?.message}`);
}

// Mask guard: inpainting has no backend model, so a mask must be rejected
// with UnsupportedFunctionalityError BEFORE any network call (not billed).
console.log('\n--- image mask guard (no request) ---');
try {
  await deapi.image('QwenImageEdit_Plus_NF4').doGenerate({
    prompt: 'edit me',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: {},
    files: [{ type: 'file', data: new Uint8Array([0]), mediaType: 'image/png' }],
    mask: { type: 'file', data: new Uint8Array([0]), mediaType: 'image/png' },
  });
  ok('mask -> UnsupportedFunctionalityError', false, 'did not throw');
} catch (e) {
  ok('mask -> UnsupportedFunctionalityError',
    UnsupportedFunctionalityError.isInstance(e), `${e?.name}: ${e?.message}`);
}

// --- speech (Kokoro) ---
// We keep the produced mp3 to round-trip it through transcription below.
console.log('\n--- speech (Kokoro, voice alloy) ---');
let speechAudio;
try {
  const { audio } = await generateSpeech({
    model: deapi.speech('Kokoro'),
    text: 'Hello from deAPI.',
    voice: 'alloy',
  });
  speechAudio = audio?.uint8Array;
  const bytes = speechAudio?.length ?? 0;
  ok('generateSpeech returns audio bytes', bytes > 0, `audio=${bytes}B`);
} catch (e) {
  ok('generateSpeech returns audio bytes', false, `threw: ${e?.name}: ${e?.message}`);
}

console.log('\n--- transcription (WhisperLargeV3Ct2, segment timestamps) ---');
try {
  if (!speechAudio || speechAudio.length === 0) {
    ok('transcribe returns non-empty text', false, 'no audio from speech step to transcribe');
  } else {
    const result = await transcribe({
      model: deapi.transcription('WhisperLargeV3Ct2'),
      audio: speechAudio, // mp3 bytes; the AI SDK detects audio/mpeg
      timestampGranularities: ['segment'],
    });
    const trimmed = (result.text ?? '').trim();
    ok('transcribe returns non-empty text', trimmed.length > 0,
      `text="${trimmed}", segments=${result.segments.length}, ` +
        `language=${result.language}, duration=${result.durationInSeconds}`);
  }
} catch (e) {
  ok('transcribe returns non-empty text', false, `threw: ${e?.name}: ${e?.message}`);
}

if (process.env.DEAPI_SMOKE_SKIP_VIDEO === '1') {
  console.log('\n--- video skipped (DEAPI_SMOKE_SKIP_VIDEO=1) ---');
} else {
  console.log('\n--- video (Ltxv_13B_0_9_8_Distilled_FP8, 1 s, 512x512) ---');
  try {
    const { video, warnings } = await generateVideo({
      model: deapi.video('Ltxv_13B_0_9_8_Distilled_FP8'),
      prompt: 'a paper boat on a calm lake',
      duration: 1,
      resolution: '512x512',
      poll: { intervalMs: 5_000, timeoutMs: 600_000 },
    });
    const bytes = video?.uint8Array?.length ?? 0;
    ok('generateVideo returns video bytes', bytes > 0,
      `video=${bytes}B, mediaType=${video?.mediaType}`);
    console.log('   warnings:', JSON.stringify(warnings ?? []));
  } catch (e) {
    ok('generateVideo returns video bytes', false, `threw: ${e?.name}: ${e?.message}`);
  }
}

const passed = results.every((r) => r.pass);
const summary = {
  ok: passed,
  baseURL: DEAPI_DEFAULT_BASE_URL,
  checks: results,
};
writeFileSync('live-smoke-result.json', JSON.stringify(summary, null, 2));
console.log(`\n${passed ? 'all checks passed' : 'some checks failed'} — wrote live-smoke-result.json`);
