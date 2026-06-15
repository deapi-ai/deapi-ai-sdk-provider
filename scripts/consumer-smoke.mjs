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

function run(cmd, args, cwd, extraEnv = {}) {
  log(`$ ${cmd} ${args.join(' ')}  (cwd=${cwd})`);
  return execFileSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

try {
  // 1. Build so dist/ is fresh, then pack.
  log('building (npm run build)...');
  run(npmCmd, ['run', 'build'], PKG_ROOT);

  log('packing (npm pack)...');
  // --pack-destination keeps the tarball at the package root deterministically.
  const packOut = run(npmCmd, ['pack', '--json', '--pack-destination', PKG_ROOT], PKG_ROOT);

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

  // 3. Install the tarball + the `ai` peer into the clean project.
  log('installing tarball + ai into consumer project...');
  run(npmCmd, ['install', '--no-audit', '--no-fund', tarballPath, 'ai'], tempDir);

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
  const esmOut = execFileSync(nodeCmd, [esmFile], { cwd: tempDir, encoding: 'utf8', env: cleanEnv });
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
  const cjsOut = execFileSync(nodeCmd, [cjsFile], { cwd: tempDir, encoding: 'utf8', env: cleanEnv });
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
  const noKeyOut = execFileSync(nodeCmd, [noKeyFile], { cwd: tempDir, encoding: 'utf8', env: cleanEnv });
  if (!noKeyOut.includes('NOKEY-OK')) fail(`no-key consumer did not report OK. Output:\n${noKeyOut}`);
  log('no-key consumer OK');

  cleanup();
  log('ALL CHECKS PASSED');
  console.log('\nconsumer-smoke: PASS');
  process.exit(0);
} catch (err) {
  fail('unexpected error during consumer smoke', err);
}
