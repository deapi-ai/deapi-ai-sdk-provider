#!/usr/bin/env node
// Pack allowlist audit for @deapi/ai-sdk-provider (Audit Blocker-3).
//
// Runs `npm pack --json --dry-run`, parses the JSON, and asserts that the EXACT
// set of files npm would ship equals a hard-coded allowlist. Any extra or
// missing file fails the audit with a diff. This prevents accidentally shipping
// source, test fixtures, secrets, or dropping a build artifact.
//
// Usage: node scripts/pack-audit.mjs

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Timeout (ms) for the child npm process so the audit can never hang CI.
const CHILD_TIMEOUT_MS = 120_000;

// The EXACT files the published tarball must contain — nothing more, nothing
// less. Keep in sync with package.json "files" + the tsup build output.
const EXPECTED_FILES = [
  'LICENSE',
  'README.md',
  'dist/index.cjs',
  'dist/index.cjs.map',
  'dist/index.d.cts',
  'dist/index.d.ts',
  'dist/index.mjs',
  'dist/index.mjs.map',
  'package.json',
].sort();

function log(msg) {
  console.log(`[pack-audit] ${msg}`);
}

function diffLists(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((f) => !actualSet.has(f));
  const unexpected = actual.filter((f) => !expectedSet.has(f));
  return { missing, unexpected };
}

try {
  log('running `npm pack --json --dry-run`...');
  const out = execFileSync(
    npmCmd,
    ['pack', '--json', '--dry-run'],
    {
      cwd: PKG_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: CHILD_TIMEOUT_MS,
    },
  );

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    console.error('[pack-audit] FAIL: could not parse `npm pack --json` output:');
    console.error(out);
    console.error(e.stack || String(e));
    process.exit(1);
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || !Array.isArray(entry.files)) {
    console.error('[pack-audit] FAIL: unexpected `npm pack --json` shape (no files[]):');
    console.error(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  // Normalize path separators (npm uses POSIX, but be defensive on Windows).
  const actualFiles = entry.files
    .map((f) => String(f.path).replace(/\\/g, '/'))
    .sort();

  const { missing, unexpected } = diffLists(EXPECTED_FILES, actualFiles);

  if (missing.length > 0 || unexpected.length > 0) {
    console.error('\n[pack-audit] FAIL: shipped file list does not match the allowlist.\n');
    console.error('Expected (allowlist):');
    for (const f of EXPECTED_FILES) console.error(`    ${f}`);
    console.error('\nActual (npm pack):');
    for (const f of actualFiles) console.error(`    ${f}`);
    if (missing.length > 0) {
      console.error('\n  MISSING (expected but not packed):');
      for (const f of missing) console.error(`    - ${f}`);
    }
    if (unexpected.length > 0) {
      console.error('\n  UNEXPECTED (packed but not on allowlist):');
      for (const f of unexpected) console.error(`    + ${f}`);
    }
    console.error('');
    process.exit(1);
  }

  log(`OK: tarball ships exactly ${actualFiles.length} files, all on the allowlist:`);
  for (const f of actualFiles) log(`    ${f}`);
  console.log('\npack-audit: PASS');
  process.exit(0);
} catch (err) {
  console.error('\n[pack-audit] FAIL: unexpected error running pack audit');
  console.error(err.stack || String(err));
  process.exit(1);
}
