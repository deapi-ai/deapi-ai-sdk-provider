// Live smoke test for @deapi/ai-sdk-provider (image + embeddings + speech +
// transcription).
// Reads DEAPI_API_KEY from the environment — never hardcode the key.
// Run: DEAPI_API_KEY=dpn-sk-... node examples/smoke.mjs
//
// 0.2.0 gate: preflight GET /v1/models, embedding, image generation, the
// image-editing guard, speech synthesis, and transcription. Writes a
// machine-readable result to live-smoke-result.json and exits non-zero if any
// check fails.
import { writeFileSync } from 'node:fs';
import { deapi } from '../dist/index.mjs';
import {
  embed,
  generateImage,
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
} from 'ai';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';

// The OpenAI-compatible default base URL (matches the provider default). Kept
// local to this example so the package's public barrel stays minimal.
const DEAPI_DEFAULT_BASE_URL = 'https://oai.deapi.ai/v1';

const results = [];
function ok(label, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  results.push({ check: label, pass: Boolean(cond), detail: extra });
  if (!cond) process.exitCode = 1;
}

const apiKey = process.env.DEAPI_API_KEY;
if (!apiKey) {
  console.error('DEAPI_API_KEY is not set — cannot run live smoke.');
  process.exit(1);
}

// --- Preflight: GET /v1/models (auth + service reachable) ---
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
    value: 'sunny day at the beach',
  });
  ok('embed returns 1024-dim vector', Array.isArray(embedding) && embedding.length === 1024,
    `dims=${embedding?.length}`);
} catch (e) {
  ok('embed returns 1024-dim vector', false, `threw: ${e?.name}: ${e?.message}`);
}

console.log('\n--- image (Flux1schnell, 512x512) ---');
try {
  const res = await generateImage({
    model: deapi.image('Flux1schnell'),
    prompt: 'a single red apple on a white table, studio light',
    size: '512x512',
  });
  const img = res.image;
  const bytes = img?.uint8Array?.length ?? 0;
  const b64len = img?.base64?.length ?? 0;
  ok('generateImage returns image bytes', bytes > 0 || b64len > 0,
    `uint8Array=${bytes}B base64=${b64len}chars`);
  console.log('   warnings:', JSON.stringify(res.warnings ?? []));
} catch (e) {
  ok('generateImage returns image bytes', false, `threw: ${e?.name}: ${e?.message}`);
}

// Image-editing guard (Audit Sec-4). Throws synchronously BEFORE any network
// call — passing `files`/`mask` must be rejected with UnsupportedFunctionalityError
// in 0.1.0. Network-free; satisfies the section 7 gate text.
console.log('\n--- image-editing guard (files/mask rejected) ---');
try {
  deapi.image('Flux1schnell').doGenerate({
    prompt: 'edit me',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    providerOptions: {},
    files: [{ data: new Uint8Array([0]), mediaType: 'image/png' }],
  });
  ok('files/mask -> UnsupportedFunctionalityError', false, 'did not throw');
} catch (e) {
  ok('files/mask -> UnsupportedFunctionalityError',
    UnsupportedFunctionalityError.isInstance(e), `${e?.name}: ${e?.message}`);
}

// --- speech (Kokoro, voice alloy) ---
// Synchronous OpenAI-shaped POST /audio/speech returning binary mp3 audio.
// We keep the produced bytes to round-trip through transcription below.
console.log('\n--- speech (Kokoro, voice alloy) ---');
let speechAudio;
try {
  const { audio } = await generateSpeech({
    model: deapi.speech('Kokoro'),
    text: 'The quick brown fox jumps over the lazy dog.',
    voice: 'alloy',
  });
  speechAudio = audio?.uint8Array;
  const bytes = speechAudio?.length ?? 0;
  ok('generateSpeech returns audio bytes', bytes > 0, `audio=${bytes}B`);
} catch (e) {
  ok('generateSpeech returns audio bytes', false, `threw: ${e?.name}: ${e?.message}`);
}

// --- transcription (WhisperLargeV3) ---
// Multipart POST /audio/transcriptions with the `file` field, returning { text }.
// Reuses the mp3 produced by the speech step so the smoke is fully self-contained.
console.log('\n--- transcription (WhisperLargeV3) ---');
try {
  if (!speechAudio || speechAudio.length === 0) {
    ok('transcribe returns non-empty text', false, 'no audio from speech step to transcribe');
  } else {
    const { text } = await transcribe({
      model: deapi.transcription('WhisperLargeV3'),
      audio: speechAudio, // mp3 bytes; the AI SDK detects audio/mpeg
    });
    const trimmed = (text ?? '').trim();
    ok('transcribe returns non-empty text', trimmed.length > 0, `text="${trimmed}"`);
  }
} catch (e) {
  ok('transcribe returns non-empty text', false, `threw: ${e?.name}: ${e?.message}`);
}

const passed = results.every((r) => r.pass);
const summary = {
  ok: passed,
  baseURL: DEAPI_DEFAULT_BASE_URL,
  checks: results,
};
writeFileSync('live-smoke-result.json', JSON.stringify(summary, null, 2));
console.log(`\n${passed ? '✅ all checks passed' : '❌ some checks failed'} — wrote live-smoke-result.json`);
