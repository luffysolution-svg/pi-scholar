import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpClient } from '../src/media/http.js';
import { InputResolver } from '../src/media/input.js';

test('media JSON responses enforce a bounded body before parsing', async () => {
  const http = new HttpClient(async () => new Response('{}', {
    status: 200,
    headers: { 'content-length': String(128 * 1024 * 1024 + 1) },
  }));
  await assert.rejects(http.json('https://provider.example/models', { retries: 0, provider: 'test' }), /128 MB limit/);
});

test('reference image files larger than 50 MiB are rejected before reading', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scholar-media-input-'));
  const file = path.join(dir, 'oversized.png');
  try {
    const handle = await open(file, 'w');
    await handle.truncate(50 * 1024 * 1024 + 1);
    await handle.close();
    const resolver = new InputResolver(new HttpClient(async () => { throw new Error('network must not be used'); }), dir);
    await assert.rejects(resolver.resolve(file), /Cannot read media input/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
