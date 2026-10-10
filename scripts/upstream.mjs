import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { project, readDictionaries, checkedDictionaries } from './locales.mjs';
import { repository, runtimePath, gitSource, extractCatalog } from './upstream-source.mjs';
import { planUpdate, reviewTranslation, selectRelease } from './upstream-plan.mjs';

const root = fileURLToPath(project);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const readJSON = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const write = (file, text) => writeFile(path.join(root, file), text);
const writeJSON = (file, value) => write(file, json(value));

async function latestRelease() {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const response = await fetch('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-locale-ja-updater', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub release lookup failed: HTTP ${response.status}. Use --repo and --ref for offline updates.`);
  return selectRelease(await response.json());
}

async function run() {
  const [command = 'check', ...args] = process.argv.slice(2);
  if (!['check', 'sync', 'review'].includes(command)) throw new Error('Usage: upstream.mjs check|sync [--ref TAG_OR_COMMIT] [--repo DIRECTORY] | review --namespace NS --key KEY');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--ref', '--repo', '--namespace', '--key'].includes(flag) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid option: ${flag}`);
    if (Object.hasOwn(options, flag)) throw new Error(`Duplicate option: ${flag}`);
    options[flag] = args[index + 1];
  }
  if (command === 'review') {
    if (!options['--namespace'] || !options['--key'] || options['--ref'] || options['--repo']) throw new Error('review requires --namespace and --key');
    const report = await readJSON('reference/update-report.json');
    reviewTranslation(report, await readDictionaries(), options['--namespace'], options['--key']);
    await writeJSON('reference/update-report.json', report);
    console.log(`Reviewed ${options['--namespace']}.${options['--key']}`);
    return;
  }
  if (options['--namespace'] || options['--key']) throw new Error('Use --namespace and --key with review only.');
  const baseline = await readJSON('reference/upstream.json');
  if (command === 'sync') await checkedDictionaries(); // Do not overwrite unfinished review work.
  const ref = options['--ref'] ?? await latestRelease();
  if (!/^[\w][\w./-]*$/.test(ref)) throw new Error('Invalid upstream ref. Use a tag, branch, or commit.');
  let directory = options['--repo'] && path.resolve(options['--repo']);
  if (!directory) {
    directory = path.join(root, '.cache/upstream.git');
    await mkdir(directory, { recursive: true });
    try { await access(path.join(directory, 'HEAD')); }
    catch { execFileSync('git', ['init', '--bare', directory], { stdio: 'pipe' }); }
    console.log(`Fetching official ${ref}…`);
    try {
      execFileSync('git', ['-c', 'http.version=HTTP/1.1', '-C', directory, 'fetch', '--depth=1', '--no-tags', `${repository}.git`, ref], { stdio: 'inherit', timeout: 300000 });
    } catch {
      throw new Error(`Could not fetch official ${ref}. Check your GitHub connection or use --repo DIRECTORY --ref TAG_OR_COMMIT with an existing checkout.`);
    }
  }
  const source = gitSource(directory, options['--repo'] ? ref : 'FETCH_HEAD');
  console.log(`Reading registrations at ${source.commit}…`);
  const { catalog, namespaces } = extractCatalog(source);
  const version = JSON.parse(source.read('package.json')).version;
  const runtime = source.read(runtimePath);
  const license = source.read('LICENSE');
  const oldRuntime = await readFile(path.join(root, 'tests/fixtures/upstream-locale.ts'), 'utf8');
  const previous = await readJSON('reference/en.json');
  const translated = await readDictionaries();
  const plan = planUpdate(previous, catalog, translated);
  const report = { from: { commit: baseline.commit, version: baseline.version }, to: { commit: source.commit, version, ref },
    ...plan.report, runtimeChanged: runtime !== oldRuntime };
  await mkdir(path.join(root, '.cache'), { recursive: true });
  await writeJSON('.cache/upstream-report.json', report);
  console.log(`${baseline.version} → ${version}: ${Object.keys(catalog).length} namespaces; +${report.added.length} added, ~${report.changed.length} changed, -${report.removed.length} removed; runtime ${report.runtimeChanged ? 'changed' : 'unchanged'}.`);
  if (source.commit === baseline.commit) {
    // Same commit must be reproducible. Never erase pending review state on a repeated sync.
    if (report.addedNamespaces.length || report.removedNamespaces.length || report.added.length || report.changed.length || report.removed.length || report.runtimeChanged) throw new Error('Pinned reference differs from its commit. Inspect .cache/upstream-report.json before proceeding.');
    console.log('Already at this official version.');
    return;
  }
  if (command === 'check') {
    console.log('Update available. Inspect .cache/upstream-report.json, then run npm run upstream:sync.');
    process.exitCode = 1;
    return;
  }
  // All extraction completes before modifying tracked files.
  for (const namespace of Object.keys(translated)) if (!Object.hasOwn(catalog, namespace)) await unlink(path.join(root, 'src/locales/ja', `${namespace}.json`));
  for (const [namespace, dictionary] of Object.entries(plan.dictionaries)) await writeJSON(`src/locales/ja/${namespace}.json`, dictionary);
  await writeJSON('reference/en.json', catalog);
  await writeJSON('reference/upstream.json', { repository, commit: source.commit, version, ref, namespaces });
  await writeJSON('reference/update-report.json', report);
  await write('tests/fixtures/upstream-locale.ts', runtime);
  await write('reference/UPSTREAM-LICENSE', license);
  await write('THIRD_PARTY_NOTICES.md', `# Third-party notices\n\nThe English reference dictionaries, the LocaleRuntime test fixture, and the key\nstructure used by this Japanese translation are derived from DeepSeek Harness:\n${repository}\nCommit: ${source.commit}\n\n${license}`);
  console.log('Synced. Translate added keys and review changed English in reference/update-report.json; then run npm run check and npm test.');
}

try { await run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
