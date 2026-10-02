import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';

const source = await readFile(new URL('./externalLinks.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const resolved = compiled.outputText
  .replace('"@tauri-apps/api/core"', JSON.stringify(import.meta.resolve('@tauri-apps/api/core')))
  .replace('"@tauri-apps/plugin-opener"', JSON.stringify(import.meta.resolve('@tauri-apps/plugin-opener')));
const { openExternalLink } = await import(`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`);
globalThis.window = globalThis;

test.afterEach(() => {
  clearMocks();
  delete globalThis.isTauri;
});

test('desktop article and repository links use the native opener and prevent webview navigation', async () => {
  globalThis.isTauri = true;
  const calls = [];
  let prevented = 0;
  mockIPC((command, args) => { calls.push({ command, args }); });
  const links = ['https://github.com/shr0mi/local-summarizer', 'https://example.com/article?edition=2#key-points', 'http://example.com/article'];
  for (const url of links) {
    const opening = openExternalLink({ preventDefault: () => { prevented += 1; } }, url);
    assert.equal(prevented, calls.length);
    await opening;
  }
  assert.equal(prevented, links.length);
  assert.deepEqual(calls, links.map((url) => ({ command: 'plugin:opener|open_url', args: { url, with: undefined } })));
});

test('browser previews keep normal link navigation without invoking desktop APIs', async () => {
  mockIPC(() => assert.fail('Browser links must not call the native bridge'));
  await openExternalLink({ preventDefault: () => assert.fail('Browser navigation must remain enabled') }, 'https://github.com/shr0mi/local-summarizer');
});

test('native opening failures are surfaced after webview navigation has been prevented', async () => {
  globalThis.isTauri = true;
  let prevented = false;
  mockIPC(async () => { throw new Error('Browser could not be launched'); });
  await assert.rejects(openExternalLink({ preventDefault: () => { prevented = true; } }, 'https://example.com/article'), /Browser could not be launched/);
  assert.equal(prevented, true);
});

test('non-web links never reach the native opener', async () => {
  globalThis.isTauri = true;
  mockIPC(() => assert.fail('Non-web links must not call the native bridge'));
  for (const url of ['file:///private/tmp/article', 'javascript:alert(1)', 'mailto:reader@example.com', 'not a URL']) {
    let prevented = false;
    await assert.rejects(openExternalLink({ preventDefault: () => { prevented = true; } }, url));
    assert.equal(prevented, true);
  }
});
