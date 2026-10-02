import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./savedArticles.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { articleUrl, loadSavedArticles, persistSavedArticles, refreshSavedArticle, saveArticle, sortedArticles, titleFromUrl, toggleArticleFavorite } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const storage = new Map();
const storageKey = 'local-summarizer.saved-articles.v1';
const deviceStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.localStorage = deviceStorage;
const result = () => ({ summary: 'The reader stays in control. বাংলা', key_points: ['Local summaries stay on this device.'], model: 'local-model', mode: 'local', provider: 'llama_cpp' });
const saved = () => saveArticle([], 'https://example.com/an-article', 'An article', result());

test('article summaries survive reload without persisting extracted text or credentials', () => {
  storage.clear();
  const summary = { ...result(), inputText: 'PRIVATE EXTRACTED TEXT', api_key: 'secret-key', settings: { api_key: 'nested-secret' } };
  const articles = saveArticle([], 'https://example.com/an-article', ' An article ', summary);
  // Also protect against accidental extra fields being attached to saved records.
  persistSavedArticles(articles.map((article) => ({ ...article, text: 'PRIVATE EXTRACTED TEXT', api_key: 'record-secret' })));
  const stored = storage.get(storageKey);
  for (const secret of ['PRIVATE EXTRACTED TEXT', 'secret-key', 'nested-secret', 'record-secret', 'inputText', 'api_key']) {
    assert.equal(stored.includes(secret), false);
  }
  assert.deepEqual(loadSavedArticles(), articles);
  assert.equal(articles[0].title, 'An article');
  assert.equal(summary.inputText, 'PRIVATE EXTRACTED TEXT');
});

test('saving the same article updates it without losing its identity, original date, or other articles', () => {
  const original = saved();
  original[0].savedAt = '2020-01-01T00:00:00.000Z';
  const articles = saveArticle(original, 'https://example.com/another', 'Another', result());
  const updated = saveArticle(articles, 'https://EXAMPLE.com/an-article#section', 'Updated title', { ...result(), summary: 'Updated summary.' });
  assert.equal(updated.length, 2);
  assert.equal(updated[0].id, original[0].id);
  assert.equal(updated[0].savedAt, original[0].savedAt);
  assert.equal(updated[0].url, original[0].url);
  assert.equal(updated[0].title, 'Updated title');
  assert.equal(updated[0].summary.summary, 'Updated summary.');
  assert.equal(updated[1].title, 'Another');
  assert.equal(original[0].summary.summary, result().summary);
});

test('fresh storage is empty, while unreadable data is surfaced without overwriting it', () => {
  storage.clear();
  assert.deepEqual(loadSavedArticles(), []);
  for (const raw of ['not json', 'null', '{}', '[{}]']) {
    storage.set(storageKey, raw);
    assert.throws(loadSavedArticles);
    assert.equal(storage.get(storageKey), raw);
  }
});

test('unsafe links, invalid summary records, and duplicate identities cannot enter the saved view', () => {
  const articles = saved();
  for (const mutate of [
    (entry) => { entry.url = 'javascript:alert(1)'; },
    (entry) => { entry.summary.key_points = [42]; },
    (entry) => { entry.updatedAt = 'invalid'; },
    (entry) => { entry.summary.mode = 'invalid'; },
    (entry) => { entry.summary.summary = '  '; },
  ]) {
    const invalid = structuredClone(articles);
    mutate(invalid[0]);
    storage.set(storageKey, JSON.stringify(invalid));
    assert.throws(loadSavedArticles);
  }
  storage.set(storageKey, JSON.stringify([articles[0], articles[0]]));
  assert.throws(loadSavedArticles, /Invalid saved article/);
  storage.set(storageKey, JSON.stringify([articles[0], { ...articles[0], id: 'different-id' }]));
  assert.throws(loadSavedArticles, /Duplicate saved article/);
});

test('a failed device storage write preserves previously saved data', () => {
  const articles = saved();
  persistSavedArticles(articles);
  const previous = storage.get(storageKey);
  globalThis.localStorage = { ...deviceStorage, setItem: () => { throw new Error('Quota exceeded'); } };
  try {
    assert.throws(() => persistSavedArticles([]), /Quota exceeded/);
    assert.equal(storage.get(storageKey), previous);
    assert.deepEqual(loadSavedArticles(), articles);
  } finally {
    globalThis.localStorage = deviceStorage;
  }
});

test('removing one article persists the remaining summaries across reload', () => {
  storage.clear();
  const articles = saveArticle(saved(), 'https://example.com/another', 'Another', result());
  persistSavedArticles(articles.filter((article) => article.id !== articles[0].id));
  assert.deepEqual(loadSavedArticles(), [articles[1]]);
});

test('refresh fetches the saved link first and summarizes only the freshly extracted text', async () => {
  const article = saved()[0];
  article.updatedAt = '2020-01-01T00:00:00.000Z';
  const previous = structuredClone(article);
  const calls = [];
  const refreshed = await refreshSavedArticle(article, {
    extract: async (url) => { calls.push(['fetch', url]); return { text: 'Fresh article text.' }; },
    summarize: async (text) => { calls.push(['summarize', text]); return { ...result(), summary: 'Fresh summary.', mode: 'cloud', provider: 'openai', model: 'current-cloud-model', inputText: text }; },
  });
  assert.deepEqual(calls, [['fetch', article.url], ['summarize', 'Fresh article text.']]);
  assert.equal(refreshed.summary.summary, 'Fresh summary.');
  assert.equal(refreshed.summary.model, 'current-cloud-model');
  assert.equal(refreshed.summary.mode, 'cloud');
  assert.equal(refreshed.id, article.id);
  assert.equal(refreshed.title, article.title);
  assert.equal(refreshed.savedAt, article.savedAt);
  assert.notEqual(refreshed.updatedAt, article.updatedAt);
  assert.equal('inputText' in refreshed.summary, false);
  assert.deepEqual(article, previous);
});

test('failed extraction or empty text stops refresh before calling the model', async () => {
  const article = saved()[0];
  const previous = structuredClone(article);
  for (const extract of [
    async () => { throw new Error('Download failed'); },
    async () => ({ text: '   ' }),
  ]) {
    let summarized = false;
    await assert.rejects(refreshSavedArticle(article, {
      extract,
      summarize: async () => { summarized = true; return result(); },
    }));
    assert.equal(summarized, false);
    assert.deepEqual(article, previous);
  }
});

test('a model failure during refresh preserves the previous saved summary', async () => {
  const article = saved()[0];
  const previous = structuredClone(article);
  await assert.rejects(refreshSavedArticle(article, {
    extract: async () => ({ text: 'Fresh article text.' }),
    summarize: async () => { throw new Error('Model unavailable'); },
  }), /Model unavailable/);
  assert.deepEqual(article, previous);
});

test('article URLs keep meaningful query parameters and titles have a usable fallback', () => {
  assert.equal(articleUrl(' https://EXAMPLE.com/story?edition=2#part '), 'https://example.com/story?edition=2');
  assert.throws(() => articleUrl('file:///article'));
  assert.equal(titleFromUrl('https://example.com/'), 'example.com');
  assert.equal(titleFromUrl('https://example.com/a-story_about-caf%C3%A9'), 'a story about café');
  assert.equal(titleFromUrl('https://example.com/%ZZ'), 'example.com');
});

test('existing archives load without favorites and invalid favorite values are rejected', () => {
  storage.clear();
  const records = saved().map(({ isFavorite, ...article }) => article);
  storage.set(storageKey, JSON.stringify(records));
  assert.equal(loadSavedArticles()[0].isFavorite, false);
  assert.equal(storage.get(storageKey), JSON.stringify(records));
  storage.set(storageKey, JSON.stringify([{ ...records[0], isFavorite: 'true' }]));
  assert.throws(loadSavedArticles, /Invalid saved article/);
});

test('favorites persist, toggle independently, and survive saving or refreshing a summary', async () => {
  storage.clear();
  const original = saveArticle(saved(), 'https://example.com/another', 'Another', result());
  const favorite = toggleArticleFavorite(original, original[1].id);
  assert.equal(original[1].isFavorite, false);
  assert.equal(favorite[0].isFavorite, false);
  assert.equal(favorite[1].isFavorite, true);
  persistSavedArticles(favorite);
  assert.deepEqual(loadSavedArticles(), favorite);
  const updated = saveArticle(favorite, favorite[1].url, 'New title', result());
  assert.equal(updated[0].isFavorite, true);
  const refreshed = await refreshSavedArticle(updated[0], {
    extract: async () => ({ text: 'Fresh source.' }), summarize: async () => result(),
  });
  assert.equal(refreshed.isFavorite, true);
  const unfavorited = toggleArticleFavorite(updated, updated[0].id);
  assert.equal(unfavorited[0].isFavorite, false);
  assert.equal(unfavorited.length, 2);
});

test('the archive puts favorites first and sorts each group by update date without mutating storage order', () => {
  const articles = [
    { ...saved()[0], id: 'recent', updatedAt: '2026-10-01T00:00:00Z', isFavorite: false },
    { ...saved()[0], id: 'favorite-old', updatedAt: '2020-01-01T00:00:00Z', isFavorite: true },
    { ...saved()[0], id: 'favorite-new', updatedAt: '2025-01-01T00:00:00Z', isFavorite: true },
    { ...saved()[0], id: 'older', updatedAt: '2024-01-01T00:00:00Z', isFavorite: false },
  ];
  const previous = structuredClone(articles);
  assert.deepEqual(sortedArticles(articles).map((article) => article.id), ['favorite-new', 'favorite-old', 'recent', 'older']);
  assert.deepEqual(articles, previous);
});
