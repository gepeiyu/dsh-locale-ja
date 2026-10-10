import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

// Exercise the exact pinned upstream LocaleRuntime, not a copy of its behavior.
// The UI-only apply() and imports are omitted; the registry implementation is intact.
const source = readFileSync(new URL('./fixtures/upstream-locale.ts', import.meta.url), 'utf8');
let code = stripTypeScriptTypes(source.slice(0, source.indexOf("export const inject =")), { mode: 'transform' });
code = code.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm, '');
code = code.replace(/^export\s*\{[^}]*\};?\s*$/gm, '').replace(/^export /gm, '');
const constants = `
const LOCALE_ID_PATTERN = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;
const LOCALE_IDS = ['zh', 'en'];
const LOCALE_PREFERENCE_FIELD = 'preference';
`;

export function createRuntime({ languages, preference, host } = {}) {
  const document = { documentElement: { lang: 'en' } };
  const { LocaleRuntime, syncDocumentLanguage } = runInNewContext(
    constants + code + '\n({ LocaleRuntime, syncDocumentLanguage })',
    { console, document },
  );
  const owned = [];
  const events = [];
  const ctx = {
    effect(callback) { const dispose = callback(); owned.push(dispose); return dispose; },
    emit(...args) { events.push(args); },
  };
  const locale = new LocaleRuntime(ctx, host, { languages: languages ?? ['en'], preference });
  ctx.locale = locale;
  const sync = () => syncDocumentLanguage(locale.getSnapshot());
  locale.subscribe(sync);
  sync();
  return {
    ctx, locale, document, events,
    dispose() { for (const callback of owned.splice(0).reverse()) callback(); },
  };
}
