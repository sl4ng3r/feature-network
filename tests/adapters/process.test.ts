import { afterEach, beforeAll, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture } from '../freshness/fixture.js';
import { cleanup, tree, exec } from '../project/helpers.js';
const roots: string[] = [];
const cli = resolve('plugin/dist/cli.mjs'); const hook = resolve('plugin/dist/hook.mjs');
beforeAll(async () => { await exec(process.execPath, ['scripts/build-plugin.mjs']); });
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
async function run(path: string, args: string[], input: string, executable = process.execPath, env: NodeJS.ProcessEnv = process.env) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolveRun, reject) => {
    const child = spawn(executable, [path, ...args], { env: { ...env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolveRun({ stdout, stderr, code })); child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
test('real_bundle_host_json_protocol_and_concurrent_stop_processes', async () => {
  const p = await fixture(roots); const events = JSON.parse(await readFile(resolve('tests/adapters/fixtures/host-events.json'), 'utf8'));
  const event = (index: number) => ({ ...events.codex[index], cwd: p.root });
  expect((await run(hook, ['--host', 'codex'], JSON.stringify(event(0)))).stderr).toBe('');
  expect(JSON.parse((await run(cli, ['hook', '--host', 'codex'], JSON.stringify(event(1)))).stdout).hookSpecificOutput).toBeDefined();
  await writeFile(join(p.root, 'source.ts'), 'changed');
  const outputs = await Promise.all(Array.from({ length: 4 }, () => run(hook, ['--host', 'codex'], JSON.stringify(event(2)))));
  expect(outputs.every(out => out.code === 0 && out.stderr === '')).toBe(true);
  expect(outputs.filter(out => JSON.parse(out.stdout).decision === 'block')).toHaveLength(1);
});
test('malformed_oversized_unknown_hook_input_is_bounded_and_redacted', async () => {
  for (const input of ['SECRET malformed', JSON.stringify({ secret: 'SECRET', hook_event_name: 'unknown' }), 'SECRET'.repeat(50000)]) {
    const out = await run(hook, ['--host', 'codex'], input); expect(out.code).toBe(0); expect(JSON.parse(out.stdout)).toEqual({}); expect(out.stderr).not.toContain('SECRET');
  }
});
test('copilot_uses_configured_event_not_fabricated_stdin_event', async () => {
  const p = await fixture(roots); const events = JSON.parse(await readFile(resolve('tests/adapters/fixtures/host-events.json'), 'utf8'));
  for (const item of events.copilot) {
    const out = await run(hook, ['--host', 'copilot', '--event', item.event], JSON.stringify({ ...item.payload, cwd: p.root }));
    expect(out.code).toBe(0); expect(out.stderr).toBe('');
    if (item.event === 'sessionStart') expect(JSON.parse(out.stdout).additionalContext).toContain('last_known');
    else expect(JSON.parse(out.stdout)).toEqual({});
  }
});
test('setup_dry_run_real_entry_offline_bundle_preserves_disk_and_redacts_existing_config', async () => {
  const root = await tree(); roots.push(root); const installed = join(root, "plugin it's;$SAFE"); await mkdir(installed);
  await cp(resolve('plugin/dist'), join(installed, 'dist'), { recursive: true });
  const project = join(root, 'project'); await mkdir(join(project, '.codex'), { recursive: true });
  await writeFile(join(project, '.codex/config.toml'), 'model = "SECRET_MANUAL"\n');
  const result = await run(join(installed, 'dist/cli.mjs'), ['setup', '--host', 'codex', '--project-root', project, '--dry-run'], '');
  expect(result.code).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).not.toContain('SECRET_MANUAL');
  const plan = JSON.parse(result.stdout); expect(plan.files).toHaveLength(2); expect(plan.files[1].content).toContain(project);
  expect(await readdir(join(project, '.codex'))).toEqual(['config.toml']);
  const context = await run(join(installed, 'dist/hook.mjs'), ['--host', 'codex'], '{}'); expect(context.code).toBe(0);
});

test.skipIf(process.platform === 'win32')('portable_codex_and_generated_project_hook_commands_consume_quoted_paths_POSIX', async () => {
  const root = await tree(); roots.push(root); const installed = join(root, "plugin it's;$HOME`bad`$(bad)"); await mkdir(installed);
  await cp(resolve('plugin/dist'), join(installed, 'dist'), { recursive: true });
  const p = await fixture(roots); const input = JSON.stringify({ session_id: 'redacted', cwd: p.root, hook_event_name: 'SessionStart' });
  const config = JSON.parse(await readFile(resolve('plugin/hooks/hooks.json'), 'utf8'));
  const command = config.hooks.SessionStart[0].hooks[0].command;
  const portable = await run('-c', [command], input, '/bin/bash', { ...process.env, PLUGIN_ROOT: installed });
  expect(portable.stderr).toBe(''); expect(JSON.parse(portable.stdout).hookSpecificOutput.additionalContext).toContain('last_known');
  const dry = await run(join(installed, 'dist/cli.mjs'), ['setup', '--host', 'codex', '--project-root', p.root, '--dry-run'], '');
  const generated = JSON.parse(JSON.parse(dry.stdout).files[0].content).hooks.SessionStart[0].hooks[0].command;
  const out = await run('-c', [generated], input, '/bin/bash'); expect(out.stderr).toBe(''); expect(JSON.parse(out.stdout).hookSpecificOutput).toBeDefined();
});
test('stdin_that_never_finishes_cannot_block_agent_indefinitely', async () => {
  const child = spawn(process.execPath, [hook, '--host', 'codex'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const begin = Date.now(); let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise<number | null>(done => child.on('close', done));
  expect(code).toBe(0); expect(Date.now() - begin).toBeLessThan(8000); expect(JSON.parse(stdout)).toEqual({}); expect(stderr).toContain('hook_timeout');
}, 10000);

// PowerShell 7 defaults to UTF-8 output; explicitly bind native pipe encoding.
// Primary encoding contract: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.5
// This is a genuine Windows execution test, not a portable quoting equality claim.
test.skipIf(process.platform !== 'win32')('generated_copilot_powershell_hook_runs_real_Node_bundle_on_Windows', async () => {
  const root = await tree(); roots.push(root); const installed = join(root, "plugin it's;$SAFE"); await mkdir(installed);
  await cp(resolve('plugin/dist'), join(installed, 'dist'), { recursive: true });
  const p = await fixture(roots);
  const dry = await run(join(installed, 'dist/cli.mjs'), ['setup', '--host', 'copilot', '--project-root', p.root, '--dry-run'], '');
  expect(dry.code).toBe(0); const preview = JSON.parse(dry.stdout);
  const command = JSON.parse(preview.files[0].content).hooks.sessionStart[0].powershell;
  const input = JSON.stringify({ sessionId: 'synthetic-session', timestamp: 1791540000000, cwd: p.root, source: 'startup' });
  const literal = "'" + input.replaceAll("'", "''") + "'";
  const script = '$OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' + literal + ' | ' + command + '; exit $LASTEXITCODE';
  const out = await run('-NoProfile', ['-NonInteractive', '-Command', script], '', 'pwsh');
  expect(out.code).toBe(0); expect(out.stderr).toBe(''); expect(JSON.parse(out.stdout).additionalContext).toContain('last_known');
});
