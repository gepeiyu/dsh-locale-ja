import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dictionaries } from '../src/locales/index.js';
import { validateDictionaries } from '../scripts/locales.mjs';

const reference = JSON.parse(readFileSync(new URL('../reference/en.json', import.meta.url), 'utf8'));
test('all pinned upstream namespaces, keys, and placeholder occurrences match', () => {
  assert.deepEqual(validateDictionaries(reference, dictionaries), []);
  assert.equal(Object.keys(dictionaries).length, Object.keys(reference).length);
  assert.equal(Object.values(dictionaries).reduce((n, dict) => n + Object.keys(dict).length, 0),
    Object.values(reference).reduce((n, dict) => n + Object.keys(dict).length, 0));
});

test('validation catches missing keys, extra keys, and repeated placeholder loss', () => {
  const original = { sample: { greeting: '{name} {name}', title: 'Title' } };
  const changed = { sample: { greeting: '{name}', extra: '追加' } };
  assert.deepEqual(validateDictionaries(original, changed), [
    'sample.greeting: placeholders changed', 'sample.title: missing key', 'sample.extra: unexpected key',
  ]);
});
