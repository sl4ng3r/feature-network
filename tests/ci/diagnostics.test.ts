import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, constants } from 'node:os';
import { exec } from '../project/helpers.js';

const roots: string[] = [];
const script = resolve('scripts/ci-test.mjs');
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(code: string) {
  const root = await mkdtemp(join(tmpdir(), 'fn-ci-diagnostics-')); roots.push(root);
  const project = join(root, 'project'); const runtime = join(root, 'runner-temp');
  await mkdir(join(project, 'node_modules/vitest'), { recursive: true }); await mkdir(runtime);
  const child = join(project, 'node_modules/vitest/vitest.mjs');
  await writeFile(child, `if (process.argv[2] !== 'run' || process.argv.length !== 3) throw new Error('test_arguments_changed');\n${code}`);
  const options = { cwd: project, env: { ...process.env, RUNNER_TEMP: runtime }, timeout: 4000 };
  return { project, runtime, child, options };
}
async function run(f: Awaited<ReturnType<typeof fixture>>) {
  return exec(process.execPath, [script], f.options).then(result => ({ ...result, code: 0, signal: null }), error => error as { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null });
}
async function captured(f: Awaited<ReturnType<typeof fixture>>) {
  const files = await readdir(f.runtime); expect(files).toHaveLength(1);
  return readFile(join(f.runtime, files[0]!));
}

test('nonzero_test_exit_keeps_stdout_stderr_and_emits_escaped_actual_failure', async () => {
  const f = await fixture(`process.stdout.write('actual stdout\\n'); process.stderr.write('failure 100%\\r\\n::notice::actual child line\\n'); process.exitCode = 7;`);
  const result = await run(f);
  expect(result.code).toBe(7); expect(result.signal).toBeNull();
  expect(result.stdout).toBe('actual stdout\n'); expect(result.stderr).toContain('failure 100%\r\n::notice::actual child line\n');
  const annotation = result.stderr.split('\n').find(line => line.startsWith('::error::'))!;
  expect(annotation).toContain('exit=7; signal=none');
  expect(annotation).toContain('failure 100%25%0D%0A::notice::actual child line%0A');
  expect((await captured(f)).toString('utf8')).toContain('failure 100%\r\n::notice::actual child line\n');
  expect(await readdir(f.project)).toEqual(['node_modules']);
});

test('successful_test_process_has_no_failure_annotation_and_log_stays_outside_checkout', async () => {
  const f = await fixture(`process.stdout.write('complete suite\\n'); process.stderr.write('ordinary warning\\n');`);
  const result = await run(f);
  expect(result.code).toBe(0); expect(result.stdout).toBe('complete suite\n'); expect(result.stderr).toBe('ordinary warning\n');
  expect((await captured(f)).toString('utf8')).toContain('complete suite\n');
  expect(await readdir(f.project)).toEqual(['node_modules']);
});

test('large_failure_output_retains_a_bounded_complete_UTF8_tail_and_annotation', async () => {
  const f = await fixture(`process.stdout.write('discarded prefix\\n' + '😀%'.repeat(30000) + '\\nfinal failure marker\\n'); process.exitCode = 3;`);
  const result = await run(f); expect(result.code).toBe(3);
  const log = await captured(f); expect(log.byteLength).toBeLessThanOrEqual(65536);
  expect(log.toString('utf8')).not.toContain('discarded prefix'); expect(log.toString('utf8')).toContain('final failure marker');
  expect(() => new TextDecoder('utf8', { fatal: true }).decode(log)).not.toThrow();
  const annotation = result.stderr.split('\n').find(line => line.startsWith('::error::'))!;
  expect(Buffer.byteLength(annotation)).toBeLessThan(50000); expect(annotation).toContain('final failure marker%0A');
});

test('test_process_termination_reports_actual_signal_and_remains_a_failure', async () => {
  const f = await fixture(`process.stderr.write('before termination\\n'); process.kill(process.pid, 'SIGTERM');`);
  const direct = await exec(process.execPath, [f.child, 'run'], f.options).catch(error => error);
  const result = await run(f);
  const expectedCode = direct.signal ? 128 + constants.signals[direct.signal as keyof typeof constants.signals] : direct.code;
  expect(result.code).toBe(expectedCode); expect(result.code).not.toBe(0);
  expect(result.stderr).toContain(`exit=${direct.code ?? 'none'}; signal=${direct.signal ?? 'none'}`);
  expect(result.stderr).toContain('before termination');
});


test('interleaved_streams_preserve_split_UTF8_in_diagnostics_and_raw_forwarding', async () => {
  const f = await fixture(`process.stdout.write(Buffer.from([0xf0, 0x9f]));
    setTimeout(() => process.stderr.write('interleaved stderr\\n'), 100);
    setTimeout(() => { process.stdout.write(Buffer.from([0x98, 0x80])); process.exitCode = 4; }, 200);`);
  const result = await run(f);
  expect(result.code).toBe(4); expect(result.stdout).toBe('😀');
  expect(result.stderr).toContain('interleaved stderr\n');
  const log = await captured(f);
  expect(() => new TextDecoder('utf8', { fatal: true }).decode(log)).not.toThrow();
  expect(log.toString('utf8')).toContain('😀'); expect(log.toString('utf8')).toContain('interleaved stderr\n');
  const annotation = result.stderr.split('\n').find(line => line.startsWith('::error::'))!;
  expect(annotation).toContain('😀'); expect(annotation).not.toContain('�');
});
