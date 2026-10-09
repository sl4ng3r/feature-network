import { Ajv2020 } from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
export async function packageFiles(root) {
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('package_symlink');
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('package_symlink');
      if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/');
      else if (entry.isFile()) files.push(path);
      else throw new Error('package_nonregular_file');
    }
  }
  await walk(root); return files.sort();
}
export async function verifyPackage(root = process.cwd()) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('node_24_required');
  const plugin = join(root, 'plugin'); const ajv = new Ajv2020({ strict: true });
  for (const name of ['plugin', 'mcp']) {
    const validate = ajv.compile(await json(join(root, `tests/package/schemas/${name}.schema.json`)));
    if (!validate(await json(join(plugin, name + '.json')))) throw new Error('invalid_' + name + '_schema');
  }
  const manifest = await json(join(plugin, 'plugin.json')); const metadata = await json(join(root, 'package.json'));
  if (manifest.version !== metadata.version || manifest.license !== 'MIT' || metadata.license !== 'MIT') throw new Error('package_metadata_mismatch');
  if (Object.keys((await json(join(plugin, 'mcp.json'))).mcpServers).length !== 0) throw new Error('project_setup_required');
  if (manifest.extensions?.['com.openai']?.hooks !== './hooks/hooks.json') throw new Error('invalid_hook_path');
  const files = await packageFiles(plugin);
  const skills = ['feature-network', ...['init', 'status', 'show', 'impact', 'check', 'sync'].map(name => 'feature-network-' + name)];
  const allowed = new Set(['plugin.json', 'mcp.json', 'LICENSE', 'hooks/hooks.json', 'com.github.copilot/hooks/hooks.json', ...['cli.mjs', 'hook.mjs', 'build-info.json', 'third-party-notices.json'].map(name => 'dist/' + name), ...skills.flatMap(name => [`skills/${name}/SKILL.md`, `skills/${name}/agents/openai.yaml`])]);
  if (files.some(path => !allowed.has(path)) || [...allowed].filter(path => path !== 'LICENSE').some(path => !files.includes(path))) throw new Error('unexpected_or_missing_package_file');
  for (const path of files) {
    const text = await readFile(join(plugin, path), 'utf8');
    if (/\/Users\/|\/home\/[^/]+\/|[A-Z]:\\Users\\/.test(text)) throw new Error('developer_path_in_package');
  }
  const hooks = await json(join(plugin, 'hooks/hooks.json'));
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    if (hooks.hooks[event]?.[0]?.hooks?.[0]?.command !== 'node "$PLUGIN_ROOT/dist/hook.mjs" --host codex') throw new Error('invalid_hook_command');
  }
  if (Object.keys((await json(join(plugin, 'com.github.copilot/hooks/hooks.json'))).hooks).length) throw new Error('copilot_hook_not_portable');
  const codex = await json(join(root, '.agents/plugins/marketplace.json'));
  const copilot = await json(join(root, '.github/plugin/marketplace.json'));
  if (JSON.stringify(codex.plugins?.[0]?.source) !== JSON.stringify({ source: 'local', path: './codex-plugin' }) || copilot.plugins?.[0]?.source !== './plugin') throw new Error('invalid_marketplace_source');
  // Root plugin.json takes precedence in the tested Codex loader and suppresses
  // hooks. Enforce a separate legacy-only tree, including byte-identical assets.
  const codexRoot = join(root, 'codex-plugin');
  const codexFiles = await packageFiles(codexRoot);
  const codexAllowed = new Set(['.codex-plugin/plugin.json', ...[...allowed].filter(path => !['plugin.json', 'mcp.json', 'com.github.copilot/hooks/hooks.json'].includes(path))]);
  if (codexFiles.some(path => !codexAllowed.has(path)) || [...codexAllowed].filter(path => path !== 'LICENSE').some(path => !codexFiles.includes(path))) throw new Error('unexpected_or_missing_package_file');
  for (const path of codexFiles) if (/\/Users\/|\/home\/[^/]+\/|[A-Z]:\\Users\\/.test(await readFile(join(codexRoot, path), 'utf8'))) throw new Error('developer_path_in_package');
  const legacy = await json(join(codexRoot, '.codex-plugin/plugin.json'));
  const template = await readFile(join(root, 'packaging/codex-plugin.json'));
  if (legacy.name !== manifest.name || legacy.version !== manifest.version || legacy.license !== 'MIT' || legacy.hooks !== './hooks/hooks.json' || legacy.skills !== './skills' || hash(template) !== hash(await readFile(join(codexRoot, '.codex-plugin/plugin.json')))) throw new Error('distribution_mismatch');
  for (const path of codexFiles.filter(path => path !== '.codex-plugin/plugin.json')) {
    if (hash(await readFile(join(plugin, path))) !== hash(await readFile(join(codexRoot, path)))) throw new Error('distribution_mismatch');
  }
  const info = await json(join(plugin, 'dist/build-info.json'));
  for (const required of ['src/cli.ts', 'src/adapters/hook-main.ts', 'scripts/build-plugin.mjs', 'package.json', 'package-lock.json', 'packaging/codex-plugin.json', 'plugin/plugin.json', 'plugin/mcp.json', 'plugin/hooks/hooks.json', 'plugin/com.github.copilot/hooks/hooks.json', ...skills.flatMap(name => [`plugin/skills/${name}/SKILL.md`, `plugin/skills/${name}/agents/openai.yaml`])]) if (!Object.hasOwn(info.sources, required)) throw new Error('missing_build_source');
  if (info.target !== 'node24' || info.version !== manifest.version) throw new Error('invalid_build_info');
  // Read names from our build only after enforcing project-relative containment.
  for (const [path, expected] of Object.entries(info.sources)) {
    if (!(path.startsWith('plugin/') ? allowed.has(path.slice(7)) && !path.startsWith('plugin/dist/') && path !== 'plugin/LICENSE' : /^(src\/|node_modules\/|scripts\/build-plugin\.mjs$|package(?:-lock)?\.json$|packaging\/codex-plugin\.json$|LICENSE$)/.test(path)) || path.split('/').includes('..') || (await lstat(join(root, path))).isSymbolicLink()) throw new Error('invalid_build_source');
    if (hash(await readFile(join(root, path))) !== expected) throw new Error('stale_build_source');
  }
  if (JSON.stringify(Object.keys(info.artifacts).sort()) !== JSON.stringify(['cli.mjs', 'hook.mjs', 'third-party-notices.json'].sort())) throw new Error('invalid_artifacts');
  for (const [path, expected] of Object.entries(info.artifacts)) if (hash(await readFile(join(plugin, 'dist', path))) !== expected) throw new Error('artifact_hash_mismatch');
  const notices = await json(join(plugin, 'dist/third-party-notices.json'));
  if (notices.format !== 1 || notices.packages.length < 4 || notices.packages.some(item => !item.name || !item.version || !item.license || item.text?.length < 100)) throw new Error('missing_dependency_notices');
  let rootLicense;
  try { rootLicense = await readFile(join(root, 'LICENSE')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; } // local builds remain possible before a license choice.
  if (rootLicense && hash(rootLicense) !== hash(await readFile(join(plugin, 'LICENSE')))) throw new Error('license_mismatch');
  return { status: 'verified', version: manifest.version, files: files.length, distributions: { portable: { status: 'verified', files: files.length }, codex: { status: 'verified', files: codexFiles.length } }, bundledPackages: notices.packages.map(({ name, version, license }) => ({ name, version, license })) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await verifyPackage(), null, 2) + '\n'); }
  catch (error) { process.stderr.write(`FeatureNetwork package: ${error.message}\n`); process.exitCode = 1; }
}
