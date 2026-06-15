// Live smoke test for @deapi/ai-sdk-provider (image + embeddings).
// Reads DEAPI_API_KEY from the environment — never hardcode the key.
// Run: DEAPI_API_KEY=dpn-sk-... node examples/smoke.mjs
import { deapi } from '../dist/index.mjs';
import { embed, generateImage } from 'ai';
import { UnsupportedFunctionalityError } from '@ai-sdk/provider';

function ok(label, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

console.log('--- embedding (Bge_M3_FP16) ---');
const { embedding } = await embed({
  model: deapi.embedding('Bge_M3_FP16'),
  value: 'sunny day at the beach',
});
ok('embed returns 1024-dim vector', Array.isArray(embedding) && embedding.length === 1024,
  `dims=${embedding?.length}`);

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
  ok('generateImage', false, `threw: ${e?.name}: ${e?.message}`);
}

// Image-editing guard (Audit Sec-4). This throws synchronously BEFORE any
// network call — passing `files`/`mask` to an image model must be rejected with
// UnsupportedFunctionalityError in 0.1.0. No live request is made (or meaningful)
// here; this satisfies the section 7 gate text network-free.
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
console.log('\ndone.');
