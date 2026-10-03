import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./llmSettings.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { defaultPreferences, loadPreferences, persistPreferences, settingsError } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const storage = new Map();
const storageKey = 'local-summarizer.llm-settings.v1';
const deviceStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.localStorage = deviceStorage;

const configured = () => ({ ...structuredClone(defaultPreferences), local: { ...defaultPreferences.local, model: 'local-model' } });

test('saved cloud settings and both API keys survive reload without plaintext credentials in storage', async () => {
  storage.clear();
  const preferences = configured();
  preferences.local.api_key = 'local-secret';
  preferences.cloud.api_key = 'cloud-secret';
  preferences.mode = 'cloud';
  preferences.cloud.model = 'cloud-model';
  await persistPreferences(preferences);
  const stored = [...storage.values()][0];
  assert.equal(stored.includes('local-secret'), false);
  assert.equal(stored.includes('cloud-secret'), false);
  assert.deepEqual(await loadPreferences(), preferences);
  assert.equal(settingsError(await loadPreferences()), null);
  assert.equal(JSON.parse(stored).cloud.api_key, undefined);
});

test('corrupt storage falls back to usable defaults', async () => {
  storage.clear();
  storage.set(storageKey, 'not json');
  assert.deepEqual(await loadPreferences(), defaultPreferences);
});

test('preferences saved by older versions still load without credentials', async () => {
  storage.clear();
  const preferences = configured();
  preferences.mode = 'cloud';
  preferences.cloud = { ...preferences.cloud, provider: 'azure', model: 'deployment', base_url: 'https://resource.example', api_version: 'test-version' };
  const { api_key: localKey, ...local } = preferences.local;
  const { api_key: cloudKey, ...cloud } = preferences.cloud;
  storage.set(storageKey, JSON.stringify({ mode: preferences.mode, local, cloud }));
  assert.deepEqual(await loadPreferences(), preferences);
});

test('replacing and clearing a saved API key works while switching modes', async () => {
  storage.clear();
  const preferences = configured();
  preferences.cloud.api_key = 'first-secret';
  await persistPreferences(preferences);
  const updated = await loadPreferences();
  updated.cloud.api_key = 'replacement-secret';
  updated.mode = 'cloud';
  await persistPreferences(updated);
  assert.deepEqual(await loadPreferences(), updated);
  assert.equal(storage.get(storageKey).includes('replacement-secret'), false);
  updated.mode = 'local';
  updated.cloud.api_key = '';
  await persistPreferences(updated);
  assert.deepEqual(await loadPreferences(), updated);
  assert.equal(JSON.parse(storage.get(storageKey)).api_keys, null);
});

test('encrypted credentials preserve Unicode and use fresh randomness on each save', async () => {
  storage.clear();
  const preferences = configured();
  preferences.cloud.api_key = 'key-🔑-বাংলা';
  await persistPreferences(preferences);
  const first = storage.get(storageKey);
  await persistPreferences(preferences);
  assert.notEqual(storage.get(storageKey), first);
  assert.deepEqual(await loadPreferences(), preferences);
});

test('damaged encrypted credentials do not discard connection details or overwrite storage', async () => {
  storage.clear();
  const preferences = configured();
  preferences.mode = 'cloud';
  preferences.cloud.model = 'cloud-model';
  preferences.cloud.api_key = 'cloud-secret';
  await persistPreferences(preferences);
  const saved = JSON.parse(storage.get(storageKey));
  const damagedCredentials = [
    { ...saved.api_keys, ciphertext: btoa('tampered ciphertext') },
    { ...saved.api_keys, key: 'not base64!' },
    { ...saved.api_keys, iv: btoa('wrong length') },
    { ...saved.api_keys, version: 2 },
  ];
  for (const api_keys of damagedCredentials) {
    const damaged = JSON.stringify({ ...saved, api_keys });
    storage.set(storageKey, damaged);
    const reloaded = await loadPreferences();
    assert.equal(reloaded.mode, 'cloud');
    assert.equal(reloaded.cloud.model, 'cloud-model');
    assert.equal(reloaded.cloud.api_key, '');
    assert.equal(storage.get(storageKey), damaged);
  }
});

test('failed writes leave previously saved credentials intact', async () => {
  storage.clear();
  const preferences = configured();
  preferences.cloud.api_key = 'original-secret';
  await persistPreferences(preferences);
  const original = storage.get(storageKey);
  globalThis.localStorage = { ...deviceStorage, setItem: () => { throw new Error('Quota exceeded'); } };
  try {
    await assert.rejects(persistPreferences({ ...preferences, cloud: { ...preferences.cloud, api_key: 'new-secret' } }), /Quota exceeded/);
    assert.equal(storage.get(storageKey), original);
    assert.deepEqual(await loadPreferences(), preferences);
  } finally {
    globalThis.localStorage = deviceStorage;
  }
});

test('encryption failures never fall back to storing plaintext credentials', async () => {
  storage.clear();
  const preferences = configured();
  preferences.cloud.api_key = 'cloud-secret';
  await persistPreferences(preferences);
  const original = storage.get(storageKey);
  const generateKey = crypto.subtle.generateKey;
  crypto.subtle.generateKey = async () => { throw new Error('Encryption unavailable'); };
  try {
    await assert.rejects(persistPreferences(preferences), /Encryption unavailable/);
    assert.equal(storage.get(storageKey), original);
    assert.equal(original.includes('cloud-secret'), false);
  } finally {
    crypto.subtle.generateKey = generateKey;
  }
});

test('local ports are accepted and remote addresses cannot be used as local models', () => {
  const preferences = configured();
  preferences.local.base_url = '8080';
  assert.equal(settingsError(preferences), null);
  preferences.local.base_url = 'https://remote.example/v1';
  assert.match(settingsError(preferences), /local model/);
});

test('cloud settings require credentials and provider-specific connection fields', () => {
  const preferences = configured();
  preferences.mode = 'cloud';
  preferences.cloud.model = 'deployment-name';
  assert.match(settingsError(preferences), /API key/);
  preferences.cloud.api_key = 'cloud-secret';
  preferences.cloud.provider = 'azure';
  assert.match(settingsError(preferences), /base URL/);
  preferences.cloud.base_url = 'https://resource.example';
  assert.match(settingsError(preferences), /API version/);
  preferences.cloud.api_version = 'test-version';
  assert.equal(settingsError(preferences), null);
});
