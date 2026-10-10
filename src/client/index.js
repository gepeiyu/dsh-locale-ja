import { dictionaries } from '../locales/index.js';

export const name = 'dsh-locale-ja';
export const inject = ['locale'];
export const language = Object.freeze({ id: 'ja', label: '日本語', fallback: 'en' });

/** Register owned dictionaries before making Japanese selectable. */
export function apply(ctx) {
  if (typeof ctx.locale.addLanguage !== 'function') {
    throw new Error('dsh-locale-ja requires the Harness language-pack API: ctx.locale.addLanguage(). Please upgrade Harness.');
  }
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(
      () => ctx.locale.register(namespace, language.id, dictionary),
      `${name}: ${namespace} dictionary`,
    );
  }
  ctx.effect(() => ctx.locale.addLanguage(language), `${name}: language`);
}
