import { checkedDictionaries } from './locales.mjs';

const dictionaries = await checkedDictionaries();
const count = Object.values(dictionaries).reduce((sum, dictionary) => sum + Object.keys(dictionary).length, 0);
console.log(`Validated ${Object.keys(dictionaries).length} namespaces, ${count} keys; all placeholders match.`);
