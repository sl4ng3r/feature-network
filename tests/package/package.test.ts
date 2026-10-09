import { afterEach, expect, test } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parse } from 'smol-toml';
import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { cleanup, exec, tree } from '../project/helpers.js';
const roots: string[] = [];
const root = resolve('.');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
async function fixture() {
  const temp = await realpath(await tree()); roots.push(temp);
  const installed = join(temp, "plugin it's;$SAFE"); await cp(join(root, 'plugin'), installed, { recursive: true });
  const project = join(temp, 'project'); await mkdir(project);
  const cli = join(installed, 'dist/cli.mjs');
  return { temp, installed, project, cli };
}
async function run(cli: string, host: string, project: string, tail: string[]) {
  return exec(process.execPath, [cli, 'setup', '--host', host, '--project-root', project, ...tail]);
}
async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isDirectory()) result.push(...(await files(join(directory, item.name))).map(path => item.name + '/' + path));
    else result.push(item.name);
  }
  return result.sort();
}

test('manifest_and_mcp_validate_against_official_schemas', async () => {
  const ajv = new Ajv2020({ strict: true });
  for (const name of ['plugin', 'mcp']) {
    const validate = ajv.compile(await json(join(root, `tests/package/schemas/${name}.schema.json`)));
    expect(validate(await json(join(root, `plugin/${name}.json`))), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...(await json(join(root, `plugin/${name}.json`))), bogus: true })).toBe(false);
  }
  const manifest = await json(join(root, 'plugin/plugin.json'));
  expect(manifest.license).toBe('MIT'); expect(manifest.version).toBe('0.1.0');
  expect(manifest.extensions['com.openai'].hooks).toBe('./hooks/hooks.json');
  // No portable project-root variable exists: activation needs reviewed project setup.
  expect((await json(join(root, 'plugin/mcp.json'))).mcpServers).toEqual({});
  expect((await json(join(root, '.agents/plugins/marketplace.json'))).plugins[0].source).toEqual({ source: 'local', path: './plugin' });
  expect((await json(join(root, '.github/plugin/marketplace.json'))).plugins[0].source).toBe('./plugin');
});
test('all_skill_and_hook_paths_exist', async () => {
  const paths = await files(join(root, 'plugin'));
  expect(paths.filter(path => path.endsWith('/SKILL.md'))).toHaveLength(7);
  expect(paths.filter(path => path.endsWith('/agents/openai.yaml'))).toHaveLength(7);
  expect(paths).toContain('dist/cli.mjs'); expect(paths).toContain('dist/hook.mjs');
  expect((await json(join(root, 'plugin/com.github.copilot/hooks/hooks.json'))).hooks).toEqual({});
  const hooks = await json(join(root, 'plugin/hooks/hooks.json'));
  for (const entries of Object.values(hooks.hooks) as any[]) expect(entries[0].hooks[0].command).toContain('$PLUGIN_ROOT/dist/hook.mjs');
});
test('offline_start_without_node_modules_and_native_mode_consumes_generated_binding', async () => {
  const f = await fixture(); await mkdir(join(f.project, '.codex'));
  await writeFile(join(f.project, '.codex/hooks.json'), '{"hooks":{},"manual":"PRIVATE"}');
  await writeFile(join(f.project, '.codex/config.toml'), '\ufeffmodel = "PRIVATE_MANUAL"\n');
  const preview = JSON.parse((await run(f.cli, 'codex', f.project, ['--native-plugin', '--dry-run'])).stdout);
  expect(preview.files).toHaveLength(1); expect(preview.registration).toBe('native-plugin');
  expect(preview.receipt).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(preview)).not.toContain('PRIVATE');
  await run(f.cli, 'codex', f.project, ['--native-plugin', '--approve-and-apply', preview.receipt]);
  expect(await readFile(join(f.project, '.codex/hooks.json'), 'utf8')).toBe('{"hooks":{},"manual":"PRIVATE"}');
  const config = parse((await readFile(join(f.project, '.codex/config.toml'), 'utf8')).slice(1)) as any;
  expect(config.model).toBe('PRIVATE_MANUAL'); const server = config.mcp_servers['feature-network'];
  expect(server.args).toEqual([f.cli, 'mcp', '--project-root', f.project]);
  const validate = new Ajv2020().compile(await json(join(root, 'tests/package/schemas/mcp.schema.json')));
  expect(validate({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { 'feature-network': { type: 'stdio', ...server } } })).toBe(true);
  const client = new Client({ name: 'offline-package-test', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', NODE_PATH: '' }, stderr: 'pipe' }));
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['network_bootstrap', 'network_check', 'network_context', 'network_impact', 'network_update']);
    const rejected = await client.callTool({ name: 'network_check', arguments: { projectRoot: f.temp } }); expect(rejected.isError).toBe(true);
  } finally { await client.close(); }
  const hook = spawnSync(process.execPath, [join(f.installed, 'dist/hook.mjs'), '--host', 'codex'], { input: '{}', encoding: 'utf8', timeout: 8000 });
  expect(hook.status).toBe(0); expect(hook.stderr).toBe(''); expect(JSON.parse(hook.stdout)).toEqual({});
  expect(await readdir(f.project)).toEqual(['.codex']);
});
test('native_plugin_setup_blocks_existing_exact_project_hook_handlers', async () => {
  const f = await fixture();
  const fallback = JSON.parse((await run(f.cli, 'codex', f.project, ['--dry-run'])).stdout);
  await mkdir(join(f.project, '.codex'));
  await writeFile(join(f.project, '.codex/hooks.json'), fallback.files[0].content);
  await expect(run(f.cli, 'codex', f.project, ['--native-plugin', '--dry-run'])).rejects.toThrow(/duplicate_hooks/);
  expect(await readdir(join(f.project, '.codex'))).toEqual(['hooks.json']);
});
test('copilot_project_fallback_apply_preserves_unrelated_configuration', async () => {
  const f = await fixture(); await writeFile(join(f.project, '.mcp.json'), '\ufeff{"mcpServers":{"manual":{"command":"keep"}}}');
  const preview = JSON.parse((await run(f.cli, 'copilot', f.project, ['--dry-run'])).stdout);
  await run(f.cli, 'copilot', f.project, ['--approve-and-apply', preview.receipt]);
  const config = JSON.parse((await readFile(join(f.project, '.mcp.json'), 'utf8')).slice(1));
  expect(config.mcpServers.manual.command).toBe('keep'); expect(config.mcpServers['feature-network'].type).toBe('local');
  expect(config.mcpServers['feature-network'].args).toEqual([f.cli, 'mcp', '--project-root', f.project]);
  expect(Object.keys((await json(join(f.project, '.github/hooks/feature-network.json'))).hooks)).toEqual(['sessionStart', 'userPromptSubmitted', 'agentStop']);
});
test.each(['target', 'source', 'root', 'receipt', 'mode', 'plugin'])('approved_receipt_rejects_%s_tamper_before_publication', async kind => {
  const f = await fixture(); const preview = JSON.parse((await run(f.cli, 'codex', f.project, ['--dry-run'])).stdout);
  expect(preview.receipt).toMatch(/^[a-f0-9]{64}$/);
  let project = f.project; let cli = f.cli; let receipt = preview.receipt; let flags: string[] = [];
  if (kind === 'target') { await mkdir(join(project, '.codex')); await writeFile(join(project, '.codex/config.toml'), '\ufeff# changed'); }
  if (kind === 'source') await writeFile(join(f.installed, 'dist/hook.mjs'), '// changed source');
  if (kind === 'root') { project = join(f.temp, 'other'); await mkdir(project); }
  if (kind === 'receipt') receipt = '0'.repeat(64);
  if (kind === 'mode') flags = ['--native-plugin'];
  if (kind === 'plugin') { const other = join(f.temp, 'other-plugin'); await cp(f.installed, other, { recursive: true }); cli = join(other, 'dist/cli.mjs'); }
  await expect(run(cli, 'codex', project, [...flags, '--approve-and-apply', receipt])).rejects.toThrow();
  expect(await readdir(project)).toEqual(kind === 'target' ? ['.codex'] : []);
  if (kind === 'target') expect(await readdir(join(project, '.codex'))).toEqual(['config.toml']);
});
test('public_apply_is_explicit_and_concurrent_receipts_cannot_publish_twice', async () => {
  const f = await fixture(); const preview = JSON.parse((await run(f.cli, 'codex', f.project, ['--native-plugin', '--dry-run'])).stdout);
  expect(await readdir(f.project)).toEqual([]);
  await expect(run(f.cli, 'codex', f.project, ['--native-plugin', '--approve-and-apply', preview.receipt, '--force'])).rejects.toThrow(/setup_usage/);
  const attempts = await Promise.allSettled(Array.from({ length: 2 }, () => run(f.cli, 'codex', f.project, ['--native-plugin', '--approve-and-apply', preview.receipt])));
  expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
  const raw = await readFile(join(f.project, '.codex/config.toml'), 'utf8');
  expect(raw.match(/mcp_servers\.feature-network/g)).toHaveLength(1);
  expect(await readdir(join(f.project, '.codex'))).toEqual(['config.toml']);
});
test('native_receipt_binds_read_only_duplicate_hook_guard_bytes', async () => {
  const f = await fixture(); const preview = JSON.parse((await run(f.cli, 'codex', f.project, ['--native-plugin', '--dry-run'])).stdout);
  await mkdir(join(f.project, '.codex')); await writeFile(join(f.project, '.codex/hooks.json'), '{"hooks":{},"manual":"changed"}');
  await expect(run(f.cli, 'codex', f.project, ['--native-plugin', '--approve-and-apply', preview.receipt])).rejects.toThrow(/setup_conflict/);
  expect(await readdir(join(f.project, '.codex'))).toEqual(['hooks.json']);
});
test('same_sources_produce_same_artifacts', async () => {
  const before = await Promise.all(['cli.mjs', 'hook.mjs', 'build-info.json', 'third-party-notices.json'].map(name => readFile(join(root, 'plugin/dist', name))));
  await exec(process.execPath, ['scripts/build-plugin.mjs']);
  const after = await Promise.all(['cli.mjs', 'hook.mjs', 'build-info.json', 'third-party-notices.json'].map(name => readFile(join(root, 'plugin/dist', name))));
  expect(after).toEqual(before);
}, 20000);
test('package_contains_no_developer_paths_runtime_or_private_fixtures', async () => {
  const paths = await files(join(root, 'plugin'));
  expect(paths.some(path => /(?:node_modules|network-spec|\.feature-network|fixtures|\.env)/.test(path))).toBe(false);
  for (const path of paths) expect(await readFile(join(root, 'plugin', path), 'utf8')).not.toMatch(/\/Users\/|\/home\/[^/]+\/|[A-Z]:\\Users\\/);
  const notices = await json(join(root, 'plugin/dist/third-party-notices.json'));
  expect(notices.packages.length).toBeGreaterThan(3);
  for (const entry of notices.packages) { expect(entry.license).toBeTruthy(); expect(entry.text.length).toBeGreaterThan(100); }
  await exec(process.execPath, ['scripts/verify-package.mjs']);
});
test('update_does_not_touch_project_data', async () => {
  const f = await fixture();
  await mkdir(join(f.project, 'network-spec')); await mkdir(join(f.project, '.feature-network'));
  await writeFile(join(f.project, 'network-spec/manual.yaml'), 'manual bytes'); await writeFile(join(f.project, '.feature-network/session.json'), 'runtime bytes');
  await mkdir(join(f.project, '.codex')); await writeFile(join(f.project, '.codex/config.toml'), 'model = "keep"');
  await cp(join(root, 'plugin'), f.installed, { recursive: true });
  expect(await readFile(join(f.project, 'network-spec/manual.yaml'), 'utf8')).toBe('manual bytes');
  expect(await readFile(join(f.project, '.feature-network/session.json'), 'utf8')).toBe('runtime bytes');
  expect(await readFile(join(f.project, '.codex/config.toml'), 'utf8')).toBe('model = "keep"');
});
test('missing_license_blocks_release_not_local_build', async () => {
  // This integration fixture copies actual dependencies and executes two CLIs.
  // A framework timeout does not cancel fs.cp. Own its cleanup here so afterEach
  // cannot remove the tree while an in-flight copy is still creating entries.
  const temp = await tree();
  try {
    for (const directory of ['src', 'scripts', 'plugin']) await cp(join(root, directory), join(temp, directory), { recursive: true });
    await cp(join(root, 'node_modules'), join(temp, 'node_modules'), { recursive: true });
    for (const name of ['package.json', 'package-lock.json']) await cp(join(root, name), join(temp, name));
    await exec(process.execPath, ['scripts/build-plugin.mjs'], { cwd: temp });
    await expect(exec(process.execPath, ['scripts/release.mjs', '--version', '0.1.0'], { cwd: temp })).rejects.toThrow(/license_required/);
  } finally { await cleanup(temp); }
}, 30000);
