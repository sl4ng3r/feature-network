import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('node_24_required');
const staging = await mkdtemp('.feature-network-build-'); let nextFile = 0;
try {
await mkdir('plugin/dist', { recursive: true });
const result = await build({ entryPoints: { cli: 'src/cli.ts', hook: 'src/adapters/hook-main.ts' }, outdir: 'plugin/dist', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: false, legalComments: 'eof', metafile: true, write: false, banner: { js: "import { createRequire as __fnCreateRequire } from 'node:module'; const require = __fnCreateRequire(import.meta.url);" } });
// The metafile identifies actually bundled packages, including transitive libraries.
const packageRoots = new Set();
for (const input of Object.keys(result.metafile.inputs).filter(path => path.startsWith('node_modules/'))) {
  let directory = dirname(input);
  while (directory.startsWith('node_modules')) {
    try { const metadata = await json(join(directory, 'package.json')); if (metadata.name && metadata.version) { packageRoots.add(directory); break; } directory = dirname(directory); }
    catch (error) { if (error.code !== 'ENOENT') throw error; directory = dirname(directory); }
  }
}
const packages = [];
for (const directory of [...packageRoots].sort()) {
  const metadata = await json(join(directory, 'package.json'));
  const names = await readdir(directory);
  const licenseFile = names.find(name => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name));
  if (!licenseFile || !metadata.license) throw new Error(`missing_dependency_license: ${metadata.name}`);
  packages.push({ name: metadata.name, version: metadata.version, license: metadata.license, text: await readFile(join(directory, licenseFile), 'utf8') });
}
packages.sort((a, b) => a.name.localeCompare(b.name, 'en'));
async function publish(path, data) {
  const temp = join(staging, String(nextFile++)); await writeFile(temp, data); await mkdir(dirname(path), { recursive: true }); await rename(temp, path);
}
// One build supplies both formats; temporary writes remain outside either package.
const outputs = new Map(result.outputFiles.map(output => [output.path.endsWith('cli.mjs') ? 'cli.mjs' : 'hook.mjs', output.contents]));
outputs.set('third-party-notices.json', Buffer.from(JSON.stringify({ format: 1, packages }, null, 2) + '\n'));
const shared = new Map();
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) shared.set(path, await readFile(path));
    else throw new Error('invalid_package_source');
  }
}
await collect('plugin/skills');
shared.set('plugin/hooks/hooks.json', await readFile('plugin/hooks/hooks.json'));
const codexManifest = await readFile('packaging/codex-plugin.json');
let license;
try { license = await readFile('LICENSE'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const sourcePaths = [...new Set([...Object.keys(result.metafile.inputs), 'scripts/build-plugin.mjs', 'package.json', 'package-lock.json', 'packaging/codex-plugin.json', 'plugin/plugin.json', 'plugin/mcp.json', 'plugin/com.github.copilot/hooks/hooks.json', ...shared.keys(), ...(license ? ['LICENSE'] : [])])].sort();
const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(shared.get(path) ?? (path === 'packaging/codex-plugin.json' ? codexManifest : path === 'LICENSE' ? license : await readFile(path)))])));
const artifacts = Object.fromEntries([...outputs].map(([name, bytes]) => [name, hash(bytes)]));
outputs.set('build-info.json', Buffer.from(JSON.stringify({ format: 1, version: (await json('package.json')).version, target: 'node24', esbuild: (await json('node_modules/esbuild/package.json')).version, sources, artifacts }, null, 2) + '\n'));
for (const distribution of ['plugin', 'codex-plugin']) {
  for (const [name, bytes] of outputs) await publish(join(distribution, 'dist', name), bytes);
  if (license) await publish(join(distribution, 'LICENSE'), license);
  else await unlink(join(distribution, 'LICENSE')).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
for (const [path, bytes] of shared) await publish(join('codex-plugin', path.slice('plugin/'.length)), bytes);
await publish('codex-plugin/.codex-plugin/plugin.json', codexManifest);
} finally { await rm(staging, { recursive: true, force: true }); }
