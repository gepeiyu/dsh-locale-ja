import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractCatalog } from '../scripts/upstream-source.mjs';
import { planUpdate, pendingReviews, reviewTranslation, selectRelease } from '../scripts/upstream-plan.mjs';

function source(files) { return { files: Object.keys(files), read: file => {
  if (!Object.hasOwn(files, file)) throw new Error(`Missing ${file}`);
  return files[file];
} }; }
const prefix = 'packages/client/sample/src/';
const fixture = {
  [`${prefix}client.tsx`]: `import { en as english, NS } from './locales.ts';
    const locale = {};
    locale.register(NS, { en: english });
    function apply(ctx) { const dictionaries = [['zh', {}], ['en', {title: 'Inline'}]];
      for (const [lang, dict] of dictionaries) ctx.locale.register('inline', lang, dict); }
    // ctx.locale.register('fake', {en: bad})
    const jsx = <div>Text</div>;`,
  [`${prefix}locales.ts`]: `export {en} from './en.ts'; export const NS = 'sample';`,
  [`${prefix}en.ts`]: `const base = { count: '{count} items' }; export const en = {...base, title: ['Session export failed', 'Again'].join('\\n')};`,
};

test('AST extraction follows namespaces, import aliases, reexports, spreads, joins, TSX and inline loops', () => {
  const result = extractCatalog(source(fixture));
  assert.deepEqual(JSON.parse(JSON.stringify(result.catalog)), {
    inline: { title: 'Inline' }, sample: { count: '{count} items', title: 'Session export failed\nAgain' },
  });
  assert.deepEqual(result.namespaces.sample, { path: `${prefix}en.ts`, export: 'en' });
});

test('unknown upstream expressions and duplicate namespaces stop extraction', () => {
  assert.throws(() => extractCatalog(source({ [`${prefix}index.ts`]: `ctx.locale.register('sample', { en: buildDictionary() });` })), /unsupported static expression/);
  assert.throws(() => extractCatalog(source({ [`${prefix}index.ts`]: `ctx.locale.register('sample', {en: {a:'A'}}); ctx.locale.register('sample', {en: {b:'B'}});` })), /duplicate namespace/);
  assert.throws(() => extractCatalog(source({ [`${prefix}index.ts`]: `const NS='wrong'; function apply(ctx, NS) { ctx.locale.register(NS, {en: {a:'A'}}); }` })), /non-static binding NS/);
});

test('latest published release includes prereleases and excludes drafts and unrelated tags', () => {
  assert.equal(selectRelease([
    { tag_name: 'dsh-v3.0.0', draft: true, published_at: '2026-10-10' },
    { tag_name: 'other-v5.0.0', published_at: '2026-10-10' },
    { tag_name: 'dsh-v1.0.0', published_at: '2026-10-01' },
    { tag_name: 'dsh-v2.0.0-alpha.1', prerelease: true, published_at: '2026-10-09' },
  ]), 'dsh-v2.0.0-alpha.1');
  assert.throws(() => selectRelease([]), /No published Harness release/);
});

test('merge retains Japanese, archives removals, leaves added keys untranslated, and requires review of English changes', () => {
  const previous = { sample: { changed: 'Hello {name}', gone: 'Old', stable: 'Same' }, removed: { title: 'Removed' } };
  const next = { sample: { changed: 'Welcome {name}', added: 'New', stable: 'Same' }, fresh: { title: 'New namespace' } };
  const translated = { sample: { changed: 'こんにちは {name}', gone: '古い', stable: '同じ' }, removed: { title: '削除' } };
  const { report, dictionaries } = planUpdate(previous, next, translated);
  assert.deepEqual(dictionaries, { sample: { changed: 'こんにちは {name}', stable: '同じ' }, fresh: {} });
  assert.equal(report.added.length, 2);
  assert.deepEqual(report.addedNamespaces, ['fresh']);
  assert.deepEqual(report.removedNamespaces, ['removed']);
  assert.equal(report.removed[0].ja, '古い');
  assert.equal(pendingReviews(report, dictionaries).length, 1);
  dictionaries.sample.changed = 'ようこそ {name}';
  assert.equal(pendingReviews(report, dictionaries).length, 0);
  dictionaries.sample.changed = translated.sample.changed;
  reviewTranslation(report, dictionaries, 'sample', 'changed');
  assert.equal(pendingReviews(report, dictionaries).length, 0);
  const changedPlaceholder = planUpdate(previous, { sample: { changed: 'Hello {user}' } }, translated);
  assert.throws(() => reviewTranslation(changedPlaceholder.report, changedPlaceholder.dictionaries, 'sample', 'changed'), /placeholders changed/);
});

test('CLI dry-run, sync, review gate, same-commit repeat, and offline operation work together', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'dsh-ja-upstream-test-'));
  try {
    const root = path.join(temp, 'plugin'), repo = path.join(temp, 'official');
    for (const dir of ['scripts', 'reference', 'src/locales/ja', 'tests/fixtures']) mkdirSync(path.join(root, dir), { recursive: true });
    const project = fileURLToPath(new URL('../', import.meta.url));
    for (const file of ['upstream.mjs', 'upstream-source.mjs', 'upstream-plan.mjs', 'locales.mjs']) cpSync(path.join(project, 'scripts', file), path.join(root, 'scripts', file));
    symlinkSync(path.join(project, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    mkdirSync(repo);
    const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
    } }).trim();
    git(['init']);
    mkdirSync(path.join(repo, prefix), { recursive: true });
    mkdirSync(path.join(repo, 'packages/client/locale/src/client'), { recursive: true });
    const runtime = 'export class LocaleRuntime {}\n';
    writeFileSync(path.join(repo, 'packages/client/locale/src/client/index.ts'), runtime);
    writeFileSync(path.join(repo, 'LICENSE'), 'Test license\n');
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    writeFileSync(path.join(repo, prefix, 'index.ts'), `ctx.locale.register('sample', { en: {title: 'Old', removed: 'Removed'} });`);
    git(['add', '.']); git(['commit', '-m', 'old']);
    const before = git(['rev-parse', 'HEAD']);
    writeFileSync(path.join(root, 'reference/upstream.json'), JSON.stringify({ commit: before, version: '1.0.0' }));
    writeFileSync(path.join(root, 'reference/en.json'), JSON.stringify({ sample: { title: 'Old', removed: 'Removed' } }));
    writeFileSync(path.join(root, 'src/locales/ja/sample.json'), JSON.stringify({ title: '旧', removed: '削除' }));
    writeFileSync(path.join(root, 'tests/fixtures/upstream-locale.ts'), runtime);
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '2.0.0-alpha.1' }));
    writeFileSync(path.join(repo, prefix, 'index.ts'), `ctx.locale.register('sample', {en: {title: 'Changed', added: 'New {name}'}});ctx.locale.register('new', {en: {title: 'New'}});`);
    git(['add', '.']); git(['commit', '-m', 'new']);
    const after = git(['rev-parse', 'HEAD']);
    const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/upstream.mjs'), ...args], { encoding: 'utf8' });
    const check = cli('check', '--repo', repo, '--ref', after);
    assert.equal(check.status, 1, check.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'reference/upstream.json'))).commit, before);
    const sync = cli('sync', '--repo', repo, '--ref', after);
    assert.equal(sync.status, 0, sync.stderr);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'src/locales/ja/sample.json'))), { title: '旧' });
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'src/locales/ja/new.json'))), {});
    const reportPath = path.join(root, 'reference/update-report.json');
    const reportText = readFileSync(reportPath, 'utf8');
    const blocked = cli('sync', '--repo', repo, '--ref', after);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /missing key|translation review/);
    assert.equal(readFileSync(reportPath, 'utf8'), reportText);
    writeFileSync(path.join(root, 'src/locales/ja/sample.json'), JSON.stringify({ title: '旧', added: '新規 {name}' }));
    writeFileSync(path.join(root, 'src/locales/ja/new.json'), JSON.stringify({ title: '新規' }));
    assert.equal(cli('review', '--namespace', 'sample', '--key', 'title').status, 0);
    const reviewedText = readFileSync(reportPath, 'utf8');
    assert.equal(cli('sync', '--repo', repo, '--ref', after).status, 0);
    assert.equal(readFileSync(reportPath, 'utf8'), reviewedText);
    assert.equal(cli('check', '--repo', repo, '--ref', after).status, 0);
    // Unsupported future source must leave the tracked baseline untouched.
    writeFileSync(path.join(repo, prefix, 'index.ts'), `ctx.locale.register('sample', {en: loadRemote()});`);
    git(['add', '.']); git(['commit', '-m', 'unsupported']);
    const failed = cli('sync', '--repo', repo, '--ref', git(['rev-parse', 'HEAD']));
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /unsupported static expression/);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'reference/upstream.json'))).commit, after);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
