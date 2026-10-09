import { afterEach, beforeAll, expect, test } from 'vitest';
import { mkdir, readFile, writeFile, symlink, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { planSetup, readSetupConfig, applySetup, quoteBash, quotePowerShell } from '../../src/adapters/setup.js';
import { cleanup, tree, exec } from '../project/helpers.js';
const roots: string[] = [];
const options = { pluginRoot: resolve('plugin'), nodePath: process.execPath };
beforeAll(async () => { await exec(process.execPath, ['scripts/build-plugin.mjs']); });
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
async function project() { const root = await tree(); roots.push(root); return root; }
test('setup_preserves_unrelated_config', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  const original = 'model = "manual-model"\n# keep my comment\n[mcp_servers.other]\ncommand = "manual"\n';
  await writeFile(join(root, '.codex/config.toml'), original);
  const plan = await planSetup('codex', root, { '.codex/config.toml': original, '.codex/hooks.json': null }, options);
  expect(JSON.stringify(plan)).not.toContain('manual-model');
  expect(plan.files.find(file => file.path.endsWith('config.toml'))?.content).toContain('mcp_servers');
  await expect(access(join(root, '.codex/hooks.json'))).rejects.toThrow();
  await applySetup(plan);
  expect(await readFile(join(root, '.codex/config.toml'), 'utf8')).toContain(original);
});
test('config_changed_since_preview_conflicts before any config writes', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  const plan = await planSetup('codex', root, { '.codex/config.toml': null, '.codex/hooks.json': null }, options);
  await writeFile(join(root, '.codex/config.toml'), '# changed');
  await expect(applySetup(plan)).rejects.toThrow();
  await expect(access(join(root, '.codex/hooks.json'))).rejects.toThrow();
});
test('forged plan or replacement content is not authorization', async () => {
  const root = await project();
  const plan = await planSetup('copilot', root, { '.mcp.json': null, '.github/hooks/feature-network.json': null }, options);
  await expect(applySetup(JSON.parse(JSON.stringify(plan)))).rejects.toThrow();
  await expect(applySetup({ ...plan, projectRoot: '/tmp' })).rejects.toThrow();
});
test('parent_symlink_escape is refused', async () => {
  const root = await project(); const other = await project(); await symlink(other, join(root, '.codex'));
  await expect(planSetup('codex', root, { '.codex/config.toml': null, '.codex/hooks.json': null }, options)).rejects.toThrow();
});
test.skipIf(process.platform === 'win32')('quoted_paths_on_bash_POSIX_execution', async () => {
  const value = "path with space/it's;$HOME`touch BAD`$(echo bad)";
  expect((await exec('/bin/bash', ['-c', `printf '%s' ${quoteBash(value)}`])).stdout).toBe(value);
});
test('quoted_paths_on_powershell_contract', () => {
  const value = "path with space/it's;$HOME`touch BAD`$(echo bad)";
  expect(quotePowerShell(value)).toBe("'path with space/it''s;$HOME`touch BAD`$(echo bad)'");
});
test('config_values_and_manual_hook_settings_are_preserved_but_not_previewed', async () => {
  const root = await project(); await mkdir(join(root, '.github/hooks'), { recursive: true });
  const manual = JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: 'command', bash: 'manual SECRET_SETTING' }] } });
  const mcp = JSON.stringify({ mcpServers: { other: { command: 'manual', env: { TOKEN: 'SECRET_VALUE' } } } });
  await writeFile(join(root, '.github/hooks/feature-network.json'), manual); await writeFile(join(root, '.mcp.json'), mcp);
  const plan = await planSetup('copilot', root, { '.mcp.json': mcp, '.github/hooks/feature-network.json': manual }, options);
  expect(JSON.stringify(plan)).not.toContain('SECRET'); await applySetup(plan);
  expect(JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8')).mcpServers.other.env.TOKEN).toBe('SECRET_VALUE');
  expect(JSON.parse(await readFile(join(root, '.github/hooks/feature-network.json'), 'utf8')).hooks.sessionStart[0].bash).toBe('manual SECRET_SETTING');
});
test('existing_manual_FeatureNetwork_entry_is_not_replaced', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  const original = '[mcp_servers."feature-network"]\ncommand = "manual"\n'; await writeFile(join(root, '.codex/config.toml'), original);
  await expect(planSetup('codex', root, { '.codex/config.toml': original, '.codex/hooks.json': null }, options)).rejects.toThrow();
});
test('parent_symlink_created_after_preview_conflicts', async () => {
  const root = await project(); const other = await project();
  const plan = await planSetup('codex', root, { '.codex/config.toml': null, '.codex/hooks.json': null }, options);
  await symlink(other, join(root, '.codex')); await expect(applySetup(plan)).rejects.toThrow();
});
test('invalid_existing_config_error_does_not_echo_secret_contents', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  const raw = 'token = SECRET_CONFIG_VALUE'; await writeFile(join(root, '.codex/config.toml'), raw);
  const proposed = planSetup('codex', root, { '.codex/config.toml': raw, '.codex/hooks.json': null }, options);
  await expect(proposed).rejects.toMatchObject({ code: 'unsafe_config' });
  const error = await proposed.catch(error => error);
  expect(String(error)).not.toContain('SECRET_CONFIG_VALUE');
});
test('another_setup_lock_blocks_publication_without_overwriting_or_reclaiming_it', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  const plan = await planSetup('codex', root, { '.codex/config.toml': null, '.codex/hooks.json': null }, options);
  const lock = join(root, '.codex/hooks.json.feature-network-setup-lock'); await writeFile(lock, 'other-owner');
  await expect(applySetup(plan)).rejects.toThrow(); expect(await readFile(lock, 'utf8')).toBe('other-owner');
  await expect(access(join(root, '.codex/config.toml'))).rejects.toThrow();
});
test('plugin_source_symlink_escape_is_refused', async () => {
  const root = await project(); const pluginRoot = await project(); await symlink(join(options.pluginRoot, 'dist'), join(pluginRoot, 'dist'));
  await expect(planSetup('codex', root, { '.codex/config.toml': null, '.codex/hooks.json': null }, { ...options, pluginRoot })).rejects.toThrow();
});

const rawHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
test('BOM_configuration_fingerprint_hashes_exact_original_UTF8_bytes', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  const original = Buffer.from('\ufeffmodel = "manual-Ü"\n'); await writeFile(join(root, '.codex/config.toml'), original);
  const plan = await planSetup('codex', root, await readSetupConfig('codex', root), options);
  expect(plan.files.find(file => file.path.endsWith('config.toml'))?.expectedHash).toBe(rawHash(original));
});
test('BOM_only_modification_after_preview_conflicts_before_publication', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  const original = 'model = "manual"\n'; await writeFile(join(root, '.codex/config.toml'), original);
  const plan = await planSetup('codex', root, await readSetupConfig('codex', root), options);
  await writeFile(join(root, '.codex/config.toml'), '\ufeff' + original);
  await expect(applySetup(plan)).rejects.toMatchObject({ code: 'setup_conflict' });
  expect(await readFile(join(root, '.codex/config.toml'), 'utf8')).toBe('\ufeff' + original);
  await expect(access(join(root, '.codex/hooks.json'))).rejects.toThrow();
});
test('applying_unchanged_BOM_TOML_preserves_every_original_byte', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  const original = Buffer.from('\ufeff# keep CRLF and Ü\r\nmodel = "manual"\r\n');
  await writeFile(join(root, '.codex/config.toml'), original);
  const plan = await planSetup('codex', root, await readSetupConfig('codex', root), options); await applySetup(plan);
  const updated = await readFile(join(root, '.codex/config.toml'));
  expect(updated.subarray(0, original.length)).toEqual(original);
});
test('BOM_JSON_parsing_is_separate_from_raw_fingerprint_and_preserves_BOM', async () => {
  const root = await project(); await mkdir(join(root, '.github/hooks'), { recursive: true });
  const hookRaw = Buffer.from('\ufeff{"version":1,"hooks":{},"manual":"keep"}');
  const mcpRaw = Buffer.from('\ufeff{"mcpServers":{"other":{"command":"manual"}}}');
  await writeFile(join(root, '.github/hooks/feature-network.json'), hookRaw); await writeFile(join(root, '.mcp.json'), mcpRaw);
  const config = await readSetupConfig('copilot', root);
  expect(Buffer.from(config['.mcp.json']!)).toEqual(mcpRaw);
  const plan = await planSetup('copilot', root, config, options);
  expect(plan.files.map(file => file.expectedHash)).toEqual([rawHash(hookRaw), rawHash(mcpRaw)]);
  await applySetup(plan);
  const hooks = await readFile(join(root, '.github/hooks/feature-network.json'), 'utf8');
  const mcp = await readFile(join(root, '.mcp.json'), 'utf8');
  expect(hooks[0]).toBe('\ufeff'); expect(mcp[0]).toBe('\ufeff');
  expect(JSON.parse(hooks.slice(1)).manual).toBe('keep'); expect(JSON.parse(mcp.slice(1)).mcpServers.other.command).toBe('manual');
});
test('invalid_UTF8_config_is_rejected_before_planning', async () => {
  const root = await project(); await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/config.toml'), Buffer.from([0xef, 0xbb, 0xbf, 0xff]));
  await expect(readSetupConfig('codex', root)).rejects.toThrow();
});
