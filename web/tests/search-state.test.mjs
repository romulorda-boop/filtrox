import assert from 'node:assert/strict';
import test from 'node:test';
import { clearSearchState, readSearchState, saveSearchState } from '../lib/search-state.mjs';

const criteria = {
  query: 'cinema',
  requiredText: 'luz, câmera',
  optionalText: 'drama\ncomédia',
  excludedText: 'spoiler',
  exactText: 'frase exata',
  includedEquivalentsText: 'termo escolhido',
  excludedEquivalentsText: 'termo excluído',
  includeTags: ['tag-um', 'tag-dois'],
  includeTagsMode: 'or',
  excludeTags: ['tag-bloqueada'],
  language: 'pt',
  country: 'BR',
  hideWatched: true,
  sort: 'most_viewed',
  sortSecondary: 'recent',
};

function withSessionStorage(run, initial = new Map()) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = initial;
  const sessionStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage },
  });
  try {
    return run(values);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete globalThis.window;
  }
}

test('restores exact search criteria and the current results page from the tab session', () => {
  withSessionStorage(() => {
    saveSearchState(criteria, 4);
    assert.deepEqual(readSearchState(), { criteria, page: 4 });
  });
});

test('ignores malformed or unsupported snapshots instead of applying them', () => {
  withSessionStorage((values) => {
    const key = 'filtrox.search-state.v1';
    values.set(key, '{not-json');
    assert.equal(readSearchState(), null);
    values.set(key, JSON.stringify({ version: 2, criteria, page: 2 }));
    assert.equal(readSearchState(), null);
    values.set(key, JSON.stringify({ version: 1, criteria: { ...criteria, sort: 'random' }, page: 2 }));
    assert.equal(readSearchState(), null);
    values.set(key, JSON.stringify({ version: 1, criteria, page: 0 }));
    assert.equal(readSearchState(), null);
  });
});

test('logout cleanup removes the search snapshot from this tab', () => {
  withSessionStorage(() => {
    saveSearchState(criteria, 3);
    clearSearchState();
    assert.equal(readSearchState(), null);
  });
});

test('storage access errors do not break search or logout', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { get sessionStorage() { throw new Error('storage disabled'); } },
  });
  try {
    assert.equal(readSearchState(), null);
    assert.doesNotThrow(() => saveSearchState(criteria, 1));
    assert.doesNotThrow(() => clearSearchState());
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete globalThis.window;
  }
});
