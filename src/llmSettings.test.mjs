import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./llmSettings.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { defaultPreferences, loadPreferences, persistPreferences, settingsError } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

const configured = () => ({ ...structuredClone(defaultPreferences), local: { ...defaultPreferences.local, model: 'local-model' } });

test('saved settings survive reload while API keys do not enter storage', () => {
  storage.clear();
  const preferences = configured();
  preferences.local.api_key = 'local-secret';
  preferences.cloud.api_key = 'cloud-secret';
  persistPreferences(preferences);
  const stored = [...storage.values()][0];
  assert.equal(stored.includes('local-secret'), false);
  assert.equal(stored.includes('cloud-secret'), false);
  const reloaded = loadPreferences();
  assert.equal(reloaded.local.model, 'local-model');
  assert.equal(reloaded.local.api_key, '');
  assert.equal(reloaded.cloud.api_key, '');
  assert.equal(preferences.cloud.api_key, 'cloud-secret');
});

test('corrupt storage falls back to usable defaults', () => {
  storage.clear();
  storage.set('local-summarizer.llm-settings.v1', 'not json');
  assert.deepEqual(loadPreferences(), defaultPreferences);
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
