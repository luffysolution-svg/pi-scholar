import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mediaToolResult, registerMediaTools, selectImageModel } from '../src/media/tools.js';
import { imageService } from '../src/media/services.js';
import { CapabilityRouter } from '../src/media/router.js';
import type { MediaConfig } from '../src/media/config.js';

const config: MediaConfig = { customProviders: [], providerOptions: { openai: { apiKey: 'super-secret-value' } } };
test('only four scholar image tools are registered and scientific warnings are explicit', () => {
  const tools: Array<{ name: string; description: string }> = [];
  registerMediaTools({ registerTool: (tool: { name: string; description: string }) => { tools.push(tool); } } as unknown as ExtensionAPI);
  assert.deepEqual(tools.map(t => t.name).sort(), ['pi_scholar_image_edit', 'pi_scholar_image_generate', 'pi_scholar_image_models', 'pi_scholar_image_service']);
  for (const tool of tools.filter(t => /_(edit|generate)$/.test(t.name))) {
    assert.match(tool.description, /not fabricated measurement plots/);
    assert.match(tool.description, /transmitted/);
    assert.match(tool.description, /billed/);
  }
});
test('explicit models then configured pins override curated ordering', () => {
  const pinned = { ...config, defaultModels: { openai: { 'image.edit': 'pin' } } };
  assert.equal(selectImageModel(pinned, 'openai', 'image.edit', [], 'explicit'), 'explicit');
  assert.equal(selectImageModel(pinned, 'openai', 'image.edit', []), 'pin');
  assert.equal(selectImageModel(config, 'openai', 'image.edit', [{ provider: 'openai', vendor: 'openai', id: 'newest', capabilities: ['image.edit'] }]), 'newest');
  assert.throws(() => selectImageModel(config, 'openai', 'image.edit', []));
});
test('catalog defaults preserve curated variants while allowing newer versions', async () => {
  const discover = async (ids: string[]) => {
    const router = new CapabilityRouter({
      cwd: process.cwd(), config: { ...config, providerOptions: { ...config.providerOptions, gemini: { apiKey: 'gemini-test-key' } } },
      fetch: async () => new Response(JSON.stringify({ models: ids.map(id => ({ name: `models/${id}` })) }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    return (await router.discover('gemini', 'image.text_to_image', { probe: false })).find(model => model.isDefault)?.id;
  };
  assert.equal(await discover(['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image']), 'gemini-3.1-flash-image');
  assert.equal(await discover(['gemini-3.1-flash-image', 'gemini-3.2-flash-image']), 'gemini-3.2-flash-image');
});

test('trusted no-auth custom providers are reported as configured', () => {
  const router = new CapabilityRouter({
    cwd: process.cwd(),
    config: { customProviders: [{ id: 'local', baseUrl: 'http://127.0.0.1:8080/v1', auth: 'none', models: [{ id: 'local-image', vendor: 'local', capabilities: ['image.text_to_image'], endpoints: { 'image.text_to_image': '/images/generations' } }] }] },
  });
  assert.equal(router.list('local', 'image.text_to_image')[0]?.configured, true);
});

test('tool text is bounded and secrets and remote URLs never enter details', () => {
  const result = mediaToolResult('super-secret-value https://example.com/signed?key=secret\n' + 'line\n'.repeat(100000), config);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value|https:\/\/example/);
  assert.ok(Buffer.byteLength(result.content[0]!.text) <= 50 * 1024);
  assert.equal(result.details.truncated, true);
});
test('connection checks are GET only, no redirects, no response body exposure', async () => {
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.body, undefined);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer super-secret-value');
    return new Response('super-secret-value', { status: 200 });
  }) as typeof fetch;
  const result = await imageService(config, 'openai', 'test_connection', undefined, fetcher);
  assert.equal(result.status, 'ok');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);
});
test('balance, unknown providers, overridden endpoints and missing credentials never fetch', async () => {
  const noFetch = (async () => { throw new Error('must not fetch'); }) as typeof fetch;
  for (const provider of ['fal', 'dashscope', 'qwencloud', 'atlas', 'custom']) assert.equal((await imageService(config, provider, 'test_connection', undefined, noFetch)).status, 'unsupported');
  assert.equal((await imageService(config, 'openai', 'balance', undefined, noFetch)).status, 'unsupported');
  assert.equal((await imageService({ customProviders: [] }, 'openai', 'test_connection', undefined, noFetch)).status, 'not_configured');
  assert.equal((await imageService({ ...config, providerOptions: { openai: { apiKey: 'key', baseUrl: 'https://example.com' } } }, 'openai', 'test_connection', undefined, noFetch)).status, 'unsupported');
});
test('Vertex connection uses ADC against the regional read-only catalog', async () => {
  const vertex: MediaConfig = { customProviders: [], providerOptions: { vertex: { credentialsFile: 'C:/keys/vertex.json', location: 'global' } } };
  const result = await imageService(vertex, 'vertex', 'test_connection', undefined, (async (url, init) => {
    assert.equal(url, 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=1');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer adc-token');
    return new Response(null, { status: 200 });
  }) as typeof fetch, async keyFilename => {
    assert.equal(keyFilename, 'C:/keys/vertex.json');
    return { getRequestHeaders: async () => new Headers({ Authorization: 'Bearer adc-token' }) };
  });
  assert.equal(result.status, 'ok');
  assert.doesNotMatch(JSON.stringify(result), /adc-token|vertex\.json/);
});

test('invalid Vertex locations cannot redirect ADC credentials', async () => {
  let called = false;
  const result = await imageService(
    { customProviders: [], providerOptions: { vertex: { location: 'evil.example/path' } } },
    'vertex', 'test_connection', undefined,
    (async () => { called = true; throw new Error('must not fetch'); }) as typeof fetch,
    async () => { throw new Error('must not create auth'); },
  );
  assert.equal(result.status, 'failed');
  assert.equal(called, false);
});

test('custom OpenAI-compatible services use their declared read-only model catalog', async () => {
  const custom: MediaConfig = {
    customProviders: [{ id: 'internal', baseUrl: 'https://images.example.com/v1', apiKey: 'custom-secret', auth: 'bearer', models: [] }],
    providerOptions: { internal: { apiKey: 'custom-secret' } },
  };
  const result = await imageService(custom, 'internal', 'test_connection', undefined, (async (url, init) => {
    assert.equal(url, 'https://images.example.com/v1/models');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer custom-secret');
    assert.equal(init?.method, 'GET');
    return new Response(null, { status: 200 });
  }) as typeof fetch);
  assert.equal(result.status, 'ok');
  assert.doesNotMatch(JSON.stringify(result), /custom-secret/);
});

test('service failure messages do not expose provider errors or keys', async () => {
  const result = await imageService(config, 'openai', 'test_connection', undefined, (async () => { throw new Error('super-secret-value'); }) as typeof fetch);
  assert.equal(result.status, 'failed');
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);
});
