#!/usr/bin/env node
// Deterministic consumer smoke test for @deapi/ai-sdk-provider.
//
// Proves the published tarball is consumable end-to-end WITHOUT any secret:
//   1. build (tsup) so dist/ is fresh, then `npm pack` to produce the tarball
//   2. create a throwaway project in a temp dir, npm-init it
//   3. `npm install <tarball> ai` into that clean project
//   4. (a) ESM:  import { createDeAPI, deapi } from '@deapi/ai-sdk-provider'
//                assert createDeAPI is a function AND deapi.image is a function
//      (b) CJS:  const { createDeAPI } = require('@deapi/ai-sdk-provider')
//                assert createDeAPI is a function and is callable
//      (c) importing WITHOUT DEAPI_API_KEY must NOT throw (lazy auth)
//      (d) TYPECHECK: a .ts consumer importing { createDeAPI } must `tsc
//                     --noEmit` clean against the shipped .d.ts
//      (e) MOCK REQUEST: with a fake fetch, drive embed()/generateImage()/
//                        generateSpeech()/transcribe() from 'ai' through the
//                        tarball and assert URL/headers/body (incl. multipart
//                        FormData for transcription) + lazy auth (no key at
//                        construct, key resolved per call)
//
// Determinism (Audit Blocker-3/4):
//   - every child process has an explicit timeout (cannot hang CI);
//   - the installed `ai` version is PINNED (see AI_PIN) rather than floating.
//
// Exits non-zero with a clear message on any failure. Always cleans up the temp dir.
//
// Usage: node scripts/consumer-smoke.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const PKG_NAME = '@deapi/ai-sdk-provider';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;

// PIN the `ai` peer for a deterministic install. We pin to the major (the
// supported peer range is `>=6 <7`); use the exact installed version to match
// what the rest of the repo is tested against.
const AI_PIN = 'ai@6.0.202';

// Timeouts (ms) so no child process can hang CI (Audit Blocker-4).
const INSTALL_TIMEOUT_MS = 300_000; // npm install of tarball + ai
const BUILD_TIMEOUT_MS = 180_000; // npm run build
const PACK_TIMEOUT_MS = 120_000; // npm pack
const TSC_TIMEOUT_MS = 180_000; // tsc --noEmit in the consumer project
const NODE_TIMEOUT_MS = 60_000; // running a small consumer script

let tempDir;
let tarballToRemove;

function log(msg) {
  console.log(`[consumer-smoke] ${msg}`);
}

function fail(msg, err) {
  console.error(`\n[consumer-smoke] FAIL: ${msg}`);
  if (err) console.error(err.stack || String(err));
  cleanup();
  process.exit(1);
}

function cleanup() {
  if (tempDir && existsSync(tempDir)) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
      log(`cleaned up temp dir ${tempDir}`);
    } catch (e) {
      console.error(`[consumer-smoke] WARN: failed to remove temp dir ${tempDir}: ${e.message}`);
    }
  }
  if (tarballToRemove && existsSync(tarballToRemove)) {
    try {
      rmSync(tarballToRemove, { force: true });
      log(`removed tarball ${tarballToRemove}`);
    } catch (e) {
      console.error(`[consumer-smoke] WARN: failed to remove tarball ${tarballToRemove}: ${e.message}`);
    }
  }
}

function run(cmd, args, cwd, { extraEnv = {}, timeout } = {}) {
  log(`$ ${cmd} ${args.join(' ')}  (cwd=${cwd}, timeout=${timeout ?? 'none'}ms)`);
  return execFileSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout,
  });
}

// Runs a Node script in the consumer project with a bounded timeout and a
// scrubbed env (DEAPI_API_KEY removed) so lazy-auth assertions are honest.
function runNode(file, cwd, cleanEnv) {
  return execFileSync(nodeCmd, [file], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv,
    timeout: NODE_TIMEOUT_MS,
  });
}

try {
  // 1. Build so dist/ is fresh, then pack.
  log('building (npm run build)...');
  run(npmCmd, ['run', 'build'], PKG_ROOT, { timeout: BUILD_TIMEOUT_MS });

  log('packing (npm pack)...');
  // --pack-destination keeps the tarball at the package root deterministically.
  const packOut = run(npmCmd, ['pack', '--json', '--pack-destination', PKG_ROOT], PKG_ROOT, {
    timeout: PACK_TIMEOUT_MS,
  });

  let tarballName;
  try {
    const parsed = JSON.parse(packOut);
    tarballName = parsed?.[0]?.filename;
  } catch {
    // Fall back to the last non-empty line if --json output is noisy.
    const lines = packOut.split('\n').map((l) => l.trim()).filter(Boolean);
    tarballName = lines[lines.length - 1];
  }
  if (!tarballName) fail('could not determine tarball filename from `npm pack` output');

  // npm sometimes returns the basename, sometimes a path; normalize to an absolute path.
  // Scoped packages produce names like `deapi-ai-sdk-provider-0.1.0.tgz`.
  let tarballPath = resolve(PKG_ROOT, tarballName);
  if (!existsSync(tarballPath)) {
    // Robust fallback: find the most recent *.tgz in PKG_ROOT.
    const tgz = readdirSync(PKG_ROOT).filter((f) => f.endsWith('.tgz'));
    if (tgz.length === 0) fail(`tarball ${tarballName} not found and no *.tgz present in ${PKG_ROOT}`);
    tarballPath = resolve(PKG_ROOT, tgz.sort().pop());
  }
  tarballToRemove = tarballPath;
  log(`tarball: ${tarballPath}`);

  // 2. Temp consumer project.
  tempDir = mkdtempSync(join(tmpdir(), 'deapi-consumer-smoke-'));
  log(`temp consumer project: ${tempDir}`);

  // Minimal ESM package.json for the consumer.
  writeFileSync(
    join(tempDir, 'package.json'),
    JSON.stringify({ name: 'deapi-consumer-smoke', version: '1.0.0', private: true, type: 'module' }, null, 2),
  );

  // 3. Install the tarball + the PINNED `ai` peer + typescript into the clean
  // project. Pinning `ai` keeps the smoke deterministic across runs.
  log(`installing tarball + ${AI_PIN} + typescript into consumer project...`);
  run(
    npmCmd,
    ['install', '--no-audit', '--no-fund', tarballPath, AI_PIN, 'typescript'],
    tempDir,
    { timeout: INSTALL_TIMEOUT_MS },
  );

  // Ensure DEAPI_API_KEY is absent for the import-without-key assertions.
  const cleanEnv = { ...process.env };
  delete cleanEnv.DEAPI_API_KEY;

  // 4a. ESM consumer.
  const esmFile = join(tempDir, 'esm-consumer.mjs');
  writeFileSync(
    esmFile,
    [
      `import { createDeAPI, deapi } from '${PKG_NAME}';`,
      `if (typeof createDeAPI !== 'function') { console.error('createDeAPI is not a function'); process.exit(3); }`,
      `if (!deapi || typeof deapi.image !== 'function') { console.error('deapi.image is not a function'); process.exit(4); }`,
      `const inst = createDeAPI();`,
      `if (typeof inst.image !== 'function') { console.error('createDeAPI().image is not a function'); process.exit(5); }`,
      `console.log('ESM-OK');`,
    ].join('\n'),
  );
  log('running ESM consumer (import, no DEAPI_API_KEY)...');
  const esmOut = runNode(esmFile, tempDir, cleanEnv);
  if (!esmOut.includes('ESM-OK')) fail(`ESM consumer did not report OK. Output:\n${esmOut}`);
  log('ESM consumer OK');

  // 4b. CJS consumer.
  const cjsFile = join(tempDir, 'cjs-consumer.cjs');
  writeFileSync(
    cjsFile,
    [
      `const { createDeAPI, deapi } = require('${PKG_NAME}');`,
      `if (typeof createDeAPI !== 'function') { console.error('createDeAPI is not a function (CJS)'); process.exit(6); }`,
      `const inst = createDeAPI();`,
      `if (typeof inst.image !== 'function') { console.error('createDeAPI().image is not a function (CJS)'); process.exit(7); }`,
      `if (!deapi || typeof deapi.embedding !== 'function') { console.error('deapi.embedding is not a function (CJS)'); process.exit(8); }`,
      `console.log('CJS-OK');`,
    ].join('\n'),
  );
  log('running CJS consumer (require, no DEAPI_API_KEY)...');
  const cjsOut = runNode(cjsFile, tempDir, cleanEnv);
  if (!cjsOut.includes('CJS-OK')) fail(`CJS consumer did not report OK. Output:\n${cjsOut}`);
  log('CJS consumer OK');

  // 4c. Explicit "import without key must not throw" assertion (separate process, no key).
  const noKeyFile = join(tempDir, 'no-key-consumer.mjs');
  writeFileSync(
    noKeyFile,
    [
      `if (process.env.DEAPI_API_KEY) { console.error('DEAPI_API_KEY unexpectedly set'); process.exit(9); }`,
      `try {`,
      `  const mod = await import('${PKG_NAME}');`,
      `  void mod.createDeAPI();`,
      `  void mod.deapi.image('Flux1schnell');`,
      `  void mod.deapi.embedding('Bge_M3_FP16');`,
      `  console.log('NOKEY-OK');`,
      `} catch (e) {`,
      `  console.error('import/construct threw without DEAPI_API_KEY: ' + (e && e.message));`,
      `  process.exit(10);`,
      `}`,
    ].join('\n'),
  );
  log('verifying import + construct without DEAPI_API_KEY does not throw...');
  const noKeyOut = runNode(noKeyFile, tempDir, cleanEnv);
  if (!noKeyOut.includes('NOKEY-OK')) fail(`no-key consumer did not report OK. Output:\n${noKeyOut}`);
  log('no-key consumer OK');

  // 4d. TypeScript consumer typecheck against the shipped .d.ts.
  // A clean tsconfig + a .ts file importing { createDeAPI } must `tsc --noEmit`
  // with no errors — catches broken/missing published types.
  writeFileSync(
    join(tempDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        files: ['ts-consumer.ts'],
      },
      null,
      2,
    ),
  );
  const tsFile = join(tempDir, 'ts-consumer.ts');
  writeFileSync(
    tsFile,
    [
      `import { createDeAPI, deapi } from '${PKG_NAME}';`,
      `import type { DeAPIProvider, DeAPIProviderSettings } from '${PKG_NAME}';`,
      ``,
      `const settings: DeAPIProviderSettings = { apiKey: 'dpn-sk-test', baseURL: 'https://oai.deapi.ai/v1' };`,
      `const provider: DeAPIProvider = createDeAPI(settings);`,
      `// exercise the public surface so the types are actually used`,
      `const img = provider.image('Flux1schnell');`,
      `const emb = provider.embedding('Bge_M3_FP16');`,
      `const img2 = deapi.imageModel('Flux1schnell');`,
      `const emb2 = deapi.embeddingModel('Bge_M3_FP16');`,
      `void img; void emb; void img2; void emb2; void provider.specificationVersion;`,
    ].join('\n'),
  );
  log('typechecking TypeScript consumer (tsc --noEmit)...');
  // Use the consumer project's local typescript (installed above) for a
  // hermetic check; fall back to npx if the bin lookup ever changes.
  const tscBin = join(tempDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  let tscOut = '';
  try {
    tscOut = execFileSync(tscBin, ['--noEmit', '--project', 'tsconfig.json'], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: TSC_TIMEOUT_MS,
    });
  } catch (e) {
    fail(`TypeScript consumer typecheck FAILED:\n${e.stdout || ''}\n${e.stderr || ''}`);
  }
  log(`TypeScript consumer typecheck OK${tscOut.trim() ? ` (${tscOut.trim()})` : ''}`);

  // 4e. MOCK-REQUEST check from the installed tarball.
  // Construct deapi with a FAKE fetch, drive embed()/generateImage() from 'ai',
  // and assert the request URL/headers/body + that lazy auth works (no key read
  // at construct time; the Bearer token is resolved per request from the env).
  const mockFile = join(tempDir, 'mock-request.mjs');
  writeFileSync(
    mockFile,
    [
      `import { createDeAPI } from '${PKG_NAME}';`,
      `import { embed, generateImage, experimental_generateSpeech as generateSpeech, experimental_transcribe as transcribe } from 'ai';`,
      ``,
      `const calls = [];`,
      `function isFormData(b) { return typeof FormData !== 'undefined' && b instanceof FormData; }`,
      `function fakeFetch(input, init) {`,
      `  const url = typeof input === 'string' ? input : input.url;`,
      `  const headers = Object.fromEntries(new Headers(init?.headers));`,
      `  const rawBody = init?.body;`,
      `  const body = isFormData(rawBody) ? undefined : (rawBody ? JSON.parse(rawBody) : undefined);`,
      `  const formData = isFormData(rawBody) ? rawBody : undefined;`,
      `  calls.push({ url, headers, body, formData });`,
      `  if (url.endsWith('/embeddings')) {`,
      `    return Promise.resolve(new Response(JSON.stringify({`,
      `      data: [{ embedding: [0.1, 0.2, 0.3] }],`,
      `      usage: { prompt_tokens: 1, total_tokens: 1 },`,
      `    }), { status: 200, headers: { 'content-type': 'application/json' } }));`,
      `  }`,
      `  if (url.endsWith('/images/generations')) {`,
      `    return Promise.resolve(new Response(JSON.stringify({`,
      `      data: [{ b64_json: Buffer.from('fake-image-bytes').toString('base64') }],`,
      `    }), { status: 200, headers: { 'content-type': 'application/json' } }));`,
      `  }`,
      `  if (url.endsWith('/audio/speech')) {`,
      `    return Promise.resolve(new Response(Buffer.from('fake-mp3-audio-bytes'), {`,
      `      status: 200, headers: { 'content-type': 'audio/mpeg' },`,
      `    }));`,
      `  }`,
      `  if (url.endsWith('/audio/transcriptions')) {`,
      `    return Promise.resolve(new Response(JSON.stringify({ text: 'hello from deapi' }), {`,
      `      status: 200, headers: { 'content-type': 'application/json' },`,
      `    }));`,
      `  }`,
      `  throw new Error('unexpected URL in mock fetch: ' + url);`,
      `}`,
      ``,
      `// Lazy auth: construct with NO apiKey option. The key must come from the`,
      `// env at REQUEST time only. Set it now (after construct) to prove laziness.`,
      `if (process.env.DEAPI_API_KEY) { console.error('precondition: DEAPI_API_KEY must be unset'); process.exit(20); }`,
      `const provider = createDeAPI({ fetch: fakeFetch });`,
      `process.env.DEAPI_API_KEY = 'dpn-sk-mock-key';`,
      ``,
      `// --- embed() ---`,
      `const { embedding } = await embed({ model: provider.embedding('Bge_M3_FP16'), value: 'hello world' });`,
      `if (!Array.isArray(embedding) || embedding.length !== 3) { console.error('bad embedding result'); process.exit(21); }`,
      `const embCall = calls.find((c) => c.url.endsWith('/embeddings'));`,
      `if (!embCall) { console.error('no /embeddings request captured'); process.exit(22); }`,
      `if (embCall.url !== 'https://oai.deapi.ai/v1/embeddings') { console.error('bad embeddings URL: ' + embCall.url); process.exit(23); }`,
      `if (embCall.headers['authorization'] !== 'Bearer dpn-sk-mock-key') { console.error('bad/missing Authorization header: ' + embCall.headers['authorization']); process.exit(24); }`,
      `if (embCall.body?.model !== 'Bge_M3_FP16') { console.error('bad embeddings model in body: ' + JSON.stringify(embCall.body)); process.exit(25); }`,
      `if (JSON.stringify(embCall.body?.input) !== JSON.stringify(['hello world'])) { console.error('bad embeddings input in body: ' + JSON.stringify(embCall.body)); process.exit(26); }`,
      ``,
      `// --- generateImage() ---`,
      `const imgRes = await generateImage({ model: provider.image('Flux1schnell'), prompt: 'a red cube' });`,
      `if (!imgRes.image) { console.error('no image returned'); process.exit(27); }`,
      `const imgCall = calls.find((c) => c.url.endsWith('/images/generations'));`,
      `if (!imgCall) { console.error('no /images/generations request captured'); process.exit(28); }`,
      `if (imgCall.url !== 'https://oai.deapi.ai/v1/images/generations') { console.error('bad images URL: ' + imgCall.url); process.exit(29); }`,
      `if (imgCall.headers['authorization'] !== 'Bearer dpn-sk-mock-key') { console.error('bad/missing Authorization header (image): ' + imgCall.headers['authorization']); process.exit(30); }`,
      `if (imgCall.body?.model !== 'Flux1schnell') { console.error('bad image model in body: ' + JSON.stringify(imgCall.body)); process.exit(31); }`,
      `if (imgCall.body?.prompt !== 'a red cube') { console.error('bad image prompt in body: ' + JSON.stringify(imgCall.body)); process.exit(32); }`,
      ``,
      `// --- generateSpeech() ---`,
      `const speechRes = await generateSpeech({ model: provider.speech('Kokoro'), text: 'Hello from deAPI.', voice: 'alloy' });`,
      `if (!speechRes.audio || !speechRes.audio.uint8Array || speechRes.audio.uint8Array.length === 0) { console.error('no audio returned'); process.exit(33); }`,
      `const speechCall = calls.find((c) => c.url.endsWith('/audio/speech'));`,
      `if (!speechCall) { console.error('no /audio/speech request captured'); process.exit(34); }`,
      `if (speechCall.url !== 'https://oai.deapi.ai/v1/audio/speech') { console.error('bad speech URL: ' + speechCall.url); process.exit(35); }`,
      `if (speechCall.headers['authorization'] !== 'Bearer dpn-sk-mock-key') { console.error('bad/missing Authorization header (speech): ' + speechCall.headers['authorization']); process.exit(36); }`,
      `if (speechCall.body?.model !== 'Kokoro') { console.error('bad speech model in body: ' + JSON.stringify(speechCall.body)); process.exit(37); }`,
      `if (speechCall.body?.input !== 'Hello from deAPI.') { console.error('bad speech input in body: ' + JSON.stringify(speechCall.body)); process.exit(38); }`,
      `if (speechCall.body?.voice !== 'alloy') { console.error('bad speech voice in body: ' + JSON.stringify(speechCall.body)); process.exit(39); }`,
      ``,
      `// --- transcribe() ---`,
      `const transcribeRes = await transcribe({ model: provider.transcription('WhisperLargeV3'), audio: new Uint8Array([1, 2, 3, 4]) });`,
      `if (transcribeRes.text !== 'hello from deapi') { console.error('bad transcription text: ' + JSON.stringify(transcribeRes.text)); process.exit(40); }`,
      `const transcribeCall = calls.find((c) => c.url.endsWith('/audio/transcriptions'));`,
      `if (!transcribeCall) { console.error('no /audio/transcriptions request captured'); process.exit(41); }`,
      `if (transcribeCall.url !== 'https://oai.deapi.ai/v1/audio/transcriptions') { console.error('bad transcription URL: ' + transcribeCall.url); process.exit(42); }`,
      `if (transcribeCall.headers['authorization'] !== 'Bearer dpn-sk-mock-key') { console.error('bad/missing Authorization header (transcription): ' + transcribeCall.headers['authorization']); process.exit(43); }`,
      `if (!transcribeCall.formData) { console.error('transcription body was not FormData'); process.exit(44); }`,
      `if (transcribeCall.formData.get('model') !== 'WhisperLargeV3') { console.error('bad transcription model field: ' + transcribeCall.formData.get('model')); process.exit(45); }`,
      `if (!transcribeCall.formData.get('file')) { console.error('transcription FormData missing file field'); process.exit(46); }`,
      ``,
      `console.log('MOCK-OK');`,
    ].join('\n'),
  );
  log('running mock-request consumer (embed + generateImage via fake fetch, lazy auth)...');
  // This script sets DEAPI_API_KEY itself AFTER construct; start without it.
  const mockOut = runNode(mockFile, tempDir, cleanEnv);
  if (!mockOut.includes('MOCK-OK')) fail(`mock-request consumer did not report OK. Output:\n${mockOut}`);
  log('mock-request consumer OK');

  cleanup();
  log('ALL CHECKS PASSED');
  console.log('\nconsumer-smoke: PASS');
  process.exit(0);
} catch (err) {
  fail('unexpected error during consumer smoke', err);
}
