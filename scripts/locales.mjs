import { readdir, readFile } from 'node:fs/promises';

export const project = new URL('../', import.meta.url);
export async function readDictionaries() {
  const directory = new URL('src/locales/ja/', project);
  const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
  return Object.fromEntries(await Promise.all(files.map(async file => [
    file.slice(0, -5), JSON.parse(await readFile(new URL(file, directory), 'utf8')),
  ])));
}

export function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
}

export function validateDictionaries(reference, translated) {
  const errors = [];
  for (const namespace of new Set([...Object.keys(reference), ...Object.keys(translated)])) {
    const original = reference[namespace];
    const dictionary = translated[namespace];
    if (!original || !dictionary) {
      errors.push(`${namespace}: ${original ? 'missing' : 'unexpected'} namespace`);
      continue;
    }
    for (const key of new Set([...Object.keys(original), ...Object.keys(dictionary)])) {
      if (!Object.hasOwn(original, key)) {
        errors.push(`${namespace}.${key}: unexpected key`);
      } else if (!Object.hasOwn(dictionary, key)) {
        errors.push(`${namespace}.${key}: missing key`);
      } else if (typeof dictionary[key] !== 'string') {
        errors.push(`${namespace}.${key}: translation must be a string`);
      } else if (dictionary[key].length === 0 && original[key].length !== 0) {
        errors.push(`${namespace}.${key}: empty translation`);
      } else if (JSON.stringify(placeholders(original[key])) !== JSON.stringify(placeholders(dictionary[key]))) {
        errors.push(`${namespace}.${key}: placeholders changed`);
      }
    }
  }
  return errors;
}

export async function checkedDictionaries() {
  const [dictionaries, text] = await Promise.all([
    readDictionaries(), readFile(new URL('reference/en.json', project), 'utf8'),
  ]);
  const errors = validateDictionaries(JSON.parse(text), dictionaries);
  let report;
  try { report = JSON.parse(await readFile(new URL('reference/update-report.json', project), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const item of report?.changed ?? []) {
    if (!item.reviewed && (dictionaries[item.namespace]?.[item.key] ?? null) === item.jaBefore) {
      errors.push(`${item.namespace}.${item.key}: changed English needs translation review (npm run upstream:review)`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return dictionaries;
}
