import { afterAll, beforeAll, expect, test } from 'vitest';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { cleanup, exec, repo, tree } from '../project/helpers.js';
let checkout: string;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
beforeAll(async () => {
  checkout = await tree();
  for (const directory of ['src', 'scripts', 'tests', 'demo', 'bench', 'plugin', 'packaging', 'docs', '.github', '.agents', 'node_modules']) await cp(resolve(directory), join(checkout, directory), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', '.gitignore', '.node-version', 'tsconfig.json', 'vitest.config.ts', 'LICENSE', 'README.md', 'CONTRIBUTING.md', 'CHANGELOG.md']) await cp(resolve(name), join(checkout, name));
  await writeFile(join(checkout, 'AGENTS.md'), 'LOCAL ONLY /Users/private/developer');
  await mkdir(join(checkout, 'tests/private-fixtures')); await writeFile(join(checkout, 'tests/private-fixtures/excluded.txt'), 'PRIVATE_FIXTURE');
  await repo(checkout); await exec('git', ['-C', checkout, '-c', 'core.autocrlf=false', 'add', '.']);
  await exec('git', ['-C', checkout, 'commit', '-qm', 'synthetic package fixture']);
  await exec(process.execPath, ['scripts/build-plugin.mjs'], { cwd: checkout });
}, 20000);
afterAll(async () => { if (checkout) await cleanup(checkout); });
const prepare = () => exec(process.execPath, ['scripts/release.mjs', '--version', '0.1.0'], { cwd: checkout, maxBuffer: 1024 * 1024 });
function untar(bytes: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(bytes); const entries = new Map<string, Buffer>(); let offset = 0;
  while (tar[offset] !== 0) {
    const header = tar.subarray(offset, offset + 512);
    const text = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = (text(345, 155) ? text(345, 155) + '/' : '') + text(0, 100);
    const size = Number.parseInt(text(124, 12), 8);
    entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
test('local_release_contains_matching_committed_source_prebuilt_plugin_checksums_and_no_private_inputs', async () => {
  const first = JSON.parse((await prepare()).stdout); expect(first.status).toBe('prepared_locally'); expect(first.published).toBe(false);
  const output = join(checkout, 'releases/feature-network-0.1.0');
  const archive = await readFile(join(output, 'feature-network-0.1.0.tar.gz')); expect(hash(archive)).toBe(first.archiveSha256);
  const listed = (await exec('tar', ['-tzf', join(output, 'feature-network-0.1.0.tar.gz')])).stdout;
  expect(listed).toContain('feature-network-0.1.0/plugin/dist/cli.mjs');
  const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
  expect(manifest.sourceRevision).toBe((await exec('git', ['-C', checkout, 'rev-parse', 'HEAD'])).stdout.trim());
  expect(manifest.sourceTree).toBe((await exec('git', ['-C', checkout, 'rev-parse', 'HEAD^{tree}'])).stdout.trim());
  const entries = untar(archive);
  expect(entries.has('feature-network-0.1.0/source/package-lock.json')).toBe(true);
  expect(entries.has('feature-network-0.1.0/source/bench/core.ts')).toBe(true);
  expect(entries.has('feature-network-0.1.0/source/bench/comparison.ts')).toBe(true);
  expect(entries.has('feature-network-0.1.0/source/docs/validation/benchmark-protocol.md')).toBe(true);
  expect(entries.has('feature-network-0.1.0/plugin/dist/cli.mjs')).toBe(true);
  expect(entries.has('feature-network-0.1.0/codex-plugin/dist/cli.mjs')).toBe(true);
  expect(entries.has('feature-network-0.1.0/codex-plugin/.codex-plugin/plugin.json')).toBe(true);
  expect(entries.has('feature-network-0.1.0/codex-plugin/plugin.json')).toBe(false);
  expect(entries.has('feature-network-0.1.0/source/packaging/codex-plugin.json')).toBe(true);
  for (const path of ['.agents/plugins/marketplace.json', '.github/plugin/marketplace.json']) expect(entries.has('feature-network-0.1.0/' + path)).toBe(true);
  const codexCatalog = JSON.parse(entries.get('feature-network-0.1.0/.agents/plugins/marketplace.json')!.toString());
  expect(codexCatalog.plugins[0].source).toEqual({ source: 'local', path: './codex-plugin' });
  for (const [path, expected] of Object.entries(manifest.checksums)) expect(hash(entries.get('feature-network-0.1.0/' + path)!)).toBe(expected);
  expect([...entries.keys()].some(path => /AGENTS\.md|superpowers|node_modules|private-fixtures|\.feature-network/.test(path))).toBe(false);
  const committed = (await exec('git', ['-C', checkout, 'show', 'HEAD:src/cli.ts'])).stdout;
  expect(entries.get('feature-network-0.1.0/source/src/cli.ts')!.toString()).toBe(committed);
  expect(first.node).toBe(process.version); expect(first.externalCi).toBe('not_established_by_local_preparation');
  await expect(prepare()).rejects.toThrow(/release_target_exists/);
  await rm(output, { recursive: true });
  const second = JSON.parse((await prepare()).stdout); expect(second.archiveSha256).toBe(first.archiveSha256);
  expect(await readFile(join(output, 'feature-network-0.1.0.tar.gz'))).toEqual(archive);
  expect((await exec('git', ['-C', checkout, 'status', '--short'])).stdout).toBe('');
  expect((await exec('git', ['-C', checkout, 'tag', '--list'])).stdout).toBe('');
}, 60000);
// This executes the full benchmark from the real export. Keep its CPU-heavy
// workload separate from archive/copy/reproducibility assertions so each test
// owns and awaits its work before fixture cleanup.
test('exported_source_executes_full_benchmark_without_borrowed_checkout_identity', async () => {
  const output = join(checkout, 'releases/feature-network-0.1.0');
  // Own this export so running this test alone never depends on an earlier test.
  await rm(output, { recursive: true, force: true }); await prepare();
  const exportedSource = join(output, 'source');
  // Full six-case/default-iteration run is CPU-heavy in CI. The inner benchmark
  // child owns a 120s hard timeout; the outer CLI owns 150s and this test 180s,
  // leaving time to await child termination and fixture cleanup.
  // Supply development dependencies explicitly; the source export has no Git checkout.
  await cp(join(checkout, 'node_modules'), join(exportedSource, 'node_modules'), { recursive: true });
  const measured = JSON.parse((await exec(process.execPath, ['scripts/bench-core.mjs'], { cwd: exportedSource, timeout: 150_000, killSignal: 'SIGKILL' })).stdout);
  expect(measured.cases.map((value: any) => [value.graph.features, value.graph.edgesPerFeature])).toEqual([[100, 2], [100, 12], [1000, 2], [1000, 12], [10000, 2], [10000, 12]]);
  for (const sample of measured.cases) expect(sample.iterations).toEqual({ cold: 5, warmup: 10, warm: 30, refresh: 5 });
  expect(measured.provenance.sourceRevision).toBeNull();
  expect(measured.provenance.loadedBundleSha256).toMatch(/^[a-f0-9]{64}$/);
  await rm(join(exportedSource, 'node_modules'), { recursive: true });
}, 180000);
test('release_refuses_dirty_source_and_mismatched_version_without_new_output', async () => {
  await expect(exec(process.execPath, ['scripts/release.mjs', '--version', '2.0.0'], { cwd: checkout })).rejects.toThrow(/version_mismatch/);
  await writeFile(join(checkout, 'src/cli.ts'), '// unreviewed edit');
  await expect(prepare()).rejects.toThrow(/clean_checkout_required/);
  await exec('git', ['-C', checkout, 'restore', 'src/cli.ts']);
  expect(await readdir(join(checkout, 'releases'))).toEqual(['feature-network-0.1.0']);
});

test('release_refuses_missing_plugin_license_even_with_source_license_present', async () => {
  await rm(join(checkout, 'plugin/LICENSE'));
  await expect(prepare()).rejects.toThrow(/ENOENT/);
  await cp(join(checkout, 'LICENSE'), join(checkout, 'plugin/LICENSE'));
});

// The portable and source MIT files remain intact: deleting only the generated
// Codex license must block both public verification and release publication.
test.each(['verification', 'release'])('%s_refuses_missing_codex_license_with_source_and_portable_present', async operation => {
  const output = join(checkout, 'releases/feature-network-0.1.0');
  await rm(output, { recursive: true, force: true });
  const source = await readFile(join(checkout, 'LICENSE'));
  expect(await readFile(join(checkout, 'plugin/LICENSE'))).toEqual(source);
  await rm(join(checkout, 'codex-plugin/LICENSE'));
  try {
    const call = operation === 'verification'
      ? exec(process.execPath, ['scripts/verify-package.mjs'], { cwd: checkout })
      : prepare();
    await expect(call).rejects.toThrow(/unexpected_or_missing_package_file/);
    await expect(readFile(join(output, 'release-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await writeFile(join(checkout, 'codex-plugin/LICENSE'), source);
    await rm(output, { recursive: true, force: true });
  }
});
