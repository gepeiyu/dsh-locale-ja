import { validateDictionaries } from './locales.mjs';

export function planUpdate(previous, next, translated) {
  const report = {
    addedNamespaces: Object.keys(next).filter(namespace => !Object.hasOwn(previous, namespace)),
    removedNamespaces: Object.keys(previous).filter(namespace => !Object.hasOwn(next, namespace)),
    added: [], changed: [], removed: [],
  };
  for (const namespace of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const before = previous[namespace] ?? {}, after = next[namespace] ?? {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!Object.hasOwn(after, key)) report.removed.push({ namespace, key, en: before[key], ja: translated[namespace]?.[key] ?? null });
      else if (!Object.hasOwn(before, key)) report.added.push({ namespace, key, en: after[key] });
      else if (before[key] !== after[key]) report.changed.push({ namespace, key, before: before[key], en: after[key], jaBefore: translated[namespace]?.[key] ?? null, reviewed: false });
    }
  }
  // New keys remain missing until translated; removed translations are archived in the report.
  const dictionaries = Object.fromEntries(Object.entries(next).map(([namespace, dictionary]) => [namespace,
    Object.fromEntries(Object.keys(dictionary).filter(key => Object.hasOwn(translated[namespace] ?? {}, key))
      .map(key => [key, translated[namespace][key]])),
  ]));
  return { report, dictionaries };
}

export function pendingReviews(report, dictionaries) {
  return (report?.changed ?? []).filter(item => !item.reviewed
    && (dictionaries[item.namespace]?.[item.key] ?? null) === item.jaBefore);
}

export function reviewTranslation(report, dictionaries, namespace, key) {
  const item = report.changed.find(item => item.namespace === namespace && item.key === key);
  if (!item) throw new Error(`No changed English entry for ${namespace}.${key}`);
  const errors = validateDictionaries({ [namespace]: { [key]: item.en } },
    { [namespace]: { [key]: dictionaries[namespace]?.[key] } });
  if (errors.length) throw new Error(errors.join('\n'));
  item.reviewed = true;
}

export function selectRelease(releases) {
  const release = releases.filter(item => !item.draft && /^dsh-v\d/.test(item.tag_name) && item.published_at)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  if (!release) throw new Error('No published Harness release found (including prereleases).');
  return release.tag_name;
}
