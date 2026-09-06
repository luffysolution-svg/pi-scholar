import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAIAdapter } from '../src/media/adapters/openai.js';
import { XAIAdapter } from '../src/media/adapters/xai.js';
import { GoogleMediaAdapter } from '../src/media/adapters/google.js';
import { DashScopeAdapter } from '../src/media/adapters/dashscope.js';
import { FalAdapter } from '../src/media/adapters/fal.js';
import { AtlasAdapter } from '../src/media/adapters/atlas.js';
import { CustomOpenAICompatibleAdapter } from '../src/media/adapters/custom.js';
import type { AdapterDependencies } from '../src/media/adapters/base.js';
import type { MediaRequest } from '../src/media/types.js';

function harness() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const dependencies = {
    env: {},
    http: { json: async (url: string, options: { body?: string }) => {
      calls.push({ url, body: JSON.parse(options.body ?? '{}') });
      return { data: [{ url: 'https://example.com/generated.png' }] };
    } },
    input: {
      asDataUri: async (source: string) => source,
      asInlineData: async () => ({ data: 'aGVsbG8=', mimeType: 'image/png' }),
      resolve: async (source: string) => ({ kind: 'url', url: source }),
      asBlob: async (source: string) => ({ blob: new Blob([source], { type: 'image/png' }), fileName: 'input.png', mimeType: 'image/png' }),
    },
  } as unknown as AdapterDependencies;
  return { calls, dependencies };
}
function request(provider: string, model: string, overrides: Partial<MediaRequest> = {}): MediaRequest {
  return { provider, model, capability: 'image.text_to_image', prompt: 'A scientific illustration', providerOptions: { apiKey: 'test-key' }, ...overrides };
}

test('OpenAI references use JSON edits and protect source ordering', async () => {
  const { dependencies, calls } = harness();
  await new OpenAIAdapter(dependencies).execute(request('openai', 'gpt-image-2', { inputImage: 'data:image/png;base64,YQ==', referenceImages: ['data:image/png;base64,Yg=='], resolution: '3840x2160', background: 'transparent', outputFormat: 'png' }), {});
  assert.match(calls[0]!.url, /\/images\/edits$/);
  assert.deepEqual(calls[0]!.body.images, [{ image_url: 'data:image/png;base64,YQ==' }, { image_url: 'data:image/png;base64,Yg==' }]);
  assert.equal(calls[0]!.body.size, '3840x2160');
});

test('OpenAI validates pixel area, model-specific size, count and quality', async () => {
  const { dependencies, calls } = harness();
  const adapter = new OpenAIAdapter(dependencies);
  for (const overrides of [{ resolution: '16x16' }, { resolution: '3840x3840' }, { resolution: '4K' }, { count: 0 }, { count: 1.5 }, { quality: 'standard' }]) {
    await assert.rejects(adapter.execute(request('openai', 'gpt-image-2', overrides), {}));
  }
  assert.equal(calls.length, 0);
});

test('xAI accepts quality and normalizes resolution and single/multi-image payloads', async () => {
  const { dependencies, calls } = harness();
  const adapter = new XAIAdapter(dependencies);
  await adapter.execute(request('xai', 'grok-imagine-image-2.0', { inputImage: 'https://example.com/a.png', resolution: '2K', quality: 'medium' }), {});
  assert.deepEqual(calls[0]!.body.image, { url: 'https://example.com/a.png', type: 'image_url' });
  assert.equal(calls[0]!.body.resolution, '2k');
  assert.equal(calls[0]!.body.quality, 'medium');
  await assert.rejects(adapter.execute(request('xai', 'grok-imagine-image-2.0', { resolution: '4K' }), {}));
  await assert.rejects(adapter.execute(request('xai', 'grok-imagine-image-2.0', { capability: 'image.edit' }), {}));
});

test('Qwen 3 async edits use the async image endpoint and multimodal messages', async () => {
  const { dependencies, calls } = harness();
  const adapter = new DashScopeAdapter('dashscope', 'https://dashscope.aliyuncs.com', dependencies);
  await adapter.execute(request('dashscope', 'qwen-image-3.0-pro', { capability: 'image.edit', inputImage: 'https://example.com/a.png', resolution: '2048x2048', providerOptions: { apiKey: 'test-key', async: true } }), {});
  assert.match(calls[0]!.url, /\/image-generation\/generation$/);
  assert.deepEqual(calls[0]!.body.parameters, { n: 1, size: '2048*2048' });
  assert.ok('messages' in (calls[0]!.body.input as object));
  assert.equal(adapter.supports('image.edit', 'qwen-image-max'), false);
  assert.equal(adapter.supports('speech.tts', 'qwen-audio-3.0-tts-plus'), false);
  await assert.rejects(adapter.execute(request('dashscope', 'qwen-image-3.0', { resolution: '4K' }), {}));
});

test('fal uses explicit endpoint capabilities, image_urls and resolution', async () => {
  const { dependencies, calls } = harness();
  const adapter = new FalAdapter(dependencies);
  await adapter.execute(request('fal', 'fal-ai/nano-banana-2/edit', { capability: 'image.multi_reference', inputImage: 'https://example.com/a.png', referenceImages: ['https://example.com/b.png'], resolution: '4k' }), {});
  assert.deepEqual(calls[0]!.body.image_urls, ['https://example.com/a.png', 'https://example.com/b.png']);
  assert.equal(calls[0]!.body.resolution, '4K');
  assert.equal(calls[0]!.body.image_size, undefined);
  assert.equal(adapter.supports('image.edit', 'fal-ai/nano-banana-2'), false);
  assert.equal(adapter.supports('image.edit', 'unknown/model'), false);
});

test('Google rejects unsupported size/count and text-only image results', async () => {
  const { dependencies } = harness();
  const adapter = new GoogleMediaAdapter('gemini', dependencies);
  await assert.rejects(adapter.execute(request('gemini', 'gemini-2.5-flash-image', { resolution: '4K' }), {}));
  await assert.rejects(adapter.execute(request('gemini', 'gemini-3.1-flash-image', { count: 2 }), {}));
  dependencies.http.json = (async () => ({ candidates: [{ content: { parts: [{ text: 'Cannot generate this image' }] } }] })) as typeof dependencies.http.json;
  await assert.rejects(adapter.execute(request('gemini', 'gemini-3.1-flash-image'), {}), /no image/);
});

test('custom model discovery verifies only explicitly declared models', async () => {
  const { dependencies } = harness();
  dependencies.http.json = (async () => ({ data: [{ id: 'declared-image' }, { id: 'unknown-image' }] })) as typeof dependencies.http.json;
  const adapter = new CustomOpenAICompatibleAdapter({
    id: 'custom', baseUrl: 'https://custom.example/v1', apiKey: 'test-key', auth: 'bearer',
    models: [{ id: 'declared-image', vendor: 'custom', capabilities: ['image.text_to_image'], endpoints: { 'image.text_to_image': '/images/generations' } }],
  }, dependencies);
  const models = await adapter.discoverModels({ providerOptions: { apiKey: 'test-key' } });
  assert.deepEqual(models.map(model => model.id), ['declared-image']);
  assert.equal(models[0]?.availability, 'available');
});

test('custom OpenAI-compatible edits include source images and masks', async () => {
  const { dependencies, calls } = harness();
  const adapter = new CustomOpenAICompatibleAdapter({
    id: 'custom', baseUrl: 'https://custom.example/v1', apiKey: 'test-key', auth: 'bearer',
    models: [{ id: 'custom-image', vendor: 'custom', capabilities: ['image.edit'], endpoints: { 'image.edit': { path: '/images/edits', format: 'multipart' } } }],
  }, dependencies);
  dependencies.http.json = (async (url: string, options: { body?: FormData }) => {
    assert.equal(url, 'https://custom.example/v1/images/edits');
    assert.ok(options.body instanceof FormData);
    assert.equal((options.body.get('image') as File).name, 'input.png');
    assert.equal((options.body.get('mask') as File).name, 'input.png');
    return { data: [{ url: 'https://example.com/generated.png' }] };
  }) as typeof dependencies.http.json;
  await adapter.execute(request('custom', 'custom-image', { capability: 'image.edit', inputImage: 'source', mask: 'mask' }), {});
  assert.equal(calls.length, 0);
});

test('Atlas does not promise pixel sizes or unsupported multi-reference editing', async () => {
  const { dependencies, calls } = harness();
  const adapter = new AtlasAdapter(dependencies);
  await assert.rejects(adapter.execute(request('atlas', 'gpt-image-2-1k', { resolution: '1K' }), {}), /aspect ratio/);
  assert.equal(adapter.supports('image.multi_reference', 'gpt-image-2-1k'), false);
  assert.equal(calls.length, 0);
});
