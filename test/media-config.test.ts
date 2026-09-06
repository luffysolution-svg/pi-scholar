import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, validateMediaConfig } from '../src/config.js';
import { loadMediaConfig, resolveVertexProjectOptions } from '../src/media/config.js';

test('media uses scholar config, config keys win, and Vertex credentials stay lazy', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scholar-media-'));
  try {
    await mkdir(path.join(dir, '.pi'));
    await writeFile(path.join(dir, '.pi/media-models.json'), 'INVALID LEGACY CONFIG');
    await writeFile(path.join(dir, 'credentials.json'), JSON.stringify({ project_id: 'test-project', private_key: 'never-print' }));
    const configPath = path.join(dir, 'pi-scholar.config.json');
    await writeFile(configPath, JSON.stringify({ media: { outputDir: './pictures', providerOptions: { openai: { apiKey: 'configured' }, gemini: { apiKeyEnv: 'MY_GEMINI' }, vertex: { credentialsFile: './credentials.json', location: 'global' } }, defaultModels: { openai: { 'image.edit': 'pinned' } } } }));
    const config = await loadMediaConfig(dir, false, { PI_SCHOLAR_CONFIG: configPath, OPENAI_API_KEY: 'env-key', MY_GEMINI: 'fallback' });
    assert.equal(config.providerOptions?.openai?.apiKey, 'configured');
    assert.equal(config.providerOptions?.gemini?.apiKey, 'fallback');
    assert.equal(config.providerOptions?.vertex?.project, undefined);
    assert.equal(config.providerOptions?.vertex?.credentialsFile, path.join(dir, 'credentials.json'));
    assert.equal((await resolveVertexProjectOptions(config.providerOptions?.vertex ?? {})).project, 'test-project');
    assert.equal(config.outputDir, path.join(dir, 'pictures'));
    assert.equal(config.defaultModels?.openai?.['image.edit'], 'pinned');
    assert.equal(config.maxArtifactBytes, 50 * 1024 * 1024);
    assert.equal(config.artifactTimeoutMs, 120_000);
    const isolated = await loadMediaConfig(dir, true, {});
    assert.equal(isolated.providerOptions?.openai?.apiKey, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('media accepts direct API keys for built-in providers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scholar-media-direct-key-'));
  try {
    const ids = ['gemini', 'openai', 'xai', 'fal', 'dashscope', 'qwencloud', 'atlas'];
    const file = path.join(dir, 'pi-scholar.config.json');
    await writeFile(file, JSON.stringify({ media: { providerOptions: Object.fromEntries(ids.map(id => [id, { apiKey: `${id}-direct-key` }])) } }));
    const config = await loadMediaConfig(dir, false, { PI_SCHOLAR_CONFIG: file });
    for (const id of ids) assert.equal(config.providerOptions?.[id]?.apiKey, `${id}-direct-key`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('media is optional and strict validation does not weaken scholar validation', () => {
  assert.equal(loadConfig({}).media, undefined);
  for (const media of [{ typo: true }, { artifactTimeoutMs: '1000' }, { maxArtifactBytes: -1 }, { providerOptions: { openai: { typo: 'x' } } }, { providerOptions: { openai: { apiKey: '' } } }, { providerOptions: { openai: { baseUrl: 'https://user:password@example.com' } } }, { providerOptions: { vertex: { apiKey: 'ignored' } } }, { providerOptions: { vertex: { location: 'evil.example/path' } } }, { providerOptions: { fal: { baseUrl: 'https://ignored.example' } } }, { providerOptions: { gemini: { workspace: 'ignored' } } }, { defaultModels: { openai: { 'video.text_to_video': 'x' } } }, { customProviders: [{ id: 'openai' }] }]) assert.throws(() => validateMediaConfig(media));
  assert.throws(() => loadConfig({ ZOTERO_BASE_URL: 'https://example.com' }));
});

test('invalid Vertex JSON is checked lazily and errors never echo credentials', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scholar-media-'));
  try {
    await writeFile(path.join(dir, 'bad.json'), 'private-secret');
    const file = path.join(dir, 'config.json');
    await writeFile(file, JSON.stringify({ media: { providerOptions: { vertex: { credentialsFile: 'bad.json' } } } }));
    const config = await loadMediaConfig(dir, false, { PI_SCHOLAR_CONFIG: file });
    await assert.rejects(resolveVertexProjectOptions(config.providerOptions?.vertex ?? {}), error => error instanceof Error && !error.message.includes('private-secret'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
