import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { apply, inject } from '../src/client/index.js';
import { dictionaries } from '../src/locales/index.js';
import { createRuntime } from './runtime.mjs';

const reference = JSON.parse(readFileSync(new URL('../reference/en.json', import.meta.url), 'utf8'));

test('bundle imports the manifest package while retaining the stable component id', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(patch, /^\s*- id: dsh-locale-ja$/m);
  assert.match(patch, new RegExp(`^\\s+name: ['"]${manifest.name.replace('/', '\\/')}['"]$`, 'm'));
});

function setup(options) {
  const runtime = createRuntime(options);
  for (const [ns, dict] of Object.entries(reference)) runtime.locale.register(ns, 'en', dict);
  return runtime;
}

test('language catalog exposes 日本語 and every namespace resolves Japanese', () => {
  assert.deepEqual(inject, ['locale']);
  const runtime = setup();
  apply(runtime.ctx);
  assert.equal(runtime.locale.getSnapshot().locales.find(x => x.id === 'ja').label, '日本語');
  runtime.locale.setLocale('ja');
  assert.equal(runtime.document.documentElement.lang, 'ja');
  for (const [ns, dict] of Object.entries(dictionaries)) {
    const t = runtime.locale.bind(ns);
    for (const [key, value] of Object.entries(dict)) assert.equal(t(key), value, `${ns}.${key}`);
  }
  assert.equal(runtime.locale.bind('settings.locale')('language.title'), '言語');
  runtime.dispose();
});

test('interpolates placeholders, switches live, and falls back for future upstream keys', () => {
  const runtime = setup();
  const t = runtime.locale.bind('chat');
  let revisions = 0;
  runtime.locale.subscribe(() => revisions++);
  apply(runtime.ctx);
  runtime.locale.register('future-feature', 'en', { welcome: 'Hello {name}' });
  runtime.locale.setLocale('ja');
  assert.equal(t('message.referenceSummary', { labels: 'A' }), '参照セッション · A');
  assert.equal(runtime.locale.bind('model')('warning.groupLoad', { name: 'Test', message: 'offline' }),
    'Test の読み込みに失敗しました：offline');
  assert.equal(runtime.locale.bind('future-feature')('welcome', { name: 'Ada' }), 'Hello Ada');
  assert.equal(runtime.locale.bind('future-feature')('cancel'), 'キャンセル');
  runtime.locale.setLocale('en');
  assert.equal(t('view.chat'), 'Chat');
  assert.ok(revisions > 0);
  runtime.dispose();
});

test('matches ja-JP and adopts a stored ja preference after plugin activation', () => {
  for (const options of [{ languages: ['ja-JP', 'en'] }, { languages: ['en'], preference: 'ja' }]) {
    const runtime = setup(options);
    apply(runtime.ctx);
    assert.equal(runtime.locale.getSnapshot().active, 'ja');
    assert.equal(runtime.document.documentElement.lang, 'ja');
    runtime.dispose();
  }
});

test('user selection persists through the host preference service', () => {
  const writes = [];
  const host = {
    getSnapshot: () => ({ value: { preference: 'en' } }),
    subscribe: () => () => {},
    set: (key, value) => { writes.push([key, value]); },
  };
  const runtime = setup({ host });
  apply(runtime.ctx);
  runtime.locale.setLocale('ja');
  assert.deepEqual(writes, [['preference', 'ja']]);
  runtime.dispose();
});

test('unloading removes Japanese, restores English, and permits reactivation', () => {
  const runtime = setup();
  apply(runtime.ctx);
  runtime.locale.setLocale('ja');
  runtime.dispose();
  assert.equal(runtime.locale.getSnapshot().active, 'en');
  assert.equal(runtime.document.documentElement.lang, 'en');
  assert.equal(runtime.locale.getSnapshot().locales.some(x => x.id === 'ja'), false);
  // A rival dictionary proves that unloading actually freed every registration.
  for (const [ns, dict] of Object.entries(dictionaries)) {
    const dispose = runtime.locale.register(ns, 'ja', dict);
    dispose();
  }
  apply(runtime.ctx);
  assert.equal(runtime.locale.getSnapshot().active, 'ja');
  runtime.dispose();
});

test('built classic script registers a lazy factory and runs against the upstream registry', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  let entry;
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { entry = value; } } },
  });
  assert.equal(entry.id, manifest.name);
  const plugin = entry.factory(() => { throw new Error('Client must not request runtime dependencies'); });
  const runtime = setup();
  plugin.apply(runtime.ctx);
  runtime.locale.setLocale('ja');
  assert.equal(runtime.locale.bind('settings.locale')('language.title'), '言語');
  assert.equal(runtime.locale.bind('chat')('view.chat'), 'チャット');
  assert.equal(runtime.locale.bind('sidebar')('session.new'), dictionaries.sidebar['session.new']);
  runtime.dispose();
});
