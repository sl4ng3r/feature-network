import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { constants, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Match package.json's test command without a platform-specific npm shell.
// Forward both streams unchanged; retain only a bounded diagnostic tail.
const tailLimit = 65_536;
const annotationChunkLimit = 3000;
let tail = Buffer.alloc(0);
function utf8Tail(bytes, limit) {
  let start = Math.max(0, bytes.length - limit);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return Buffer.from(bytes.subarray(start));
}
// GitHub's check-run API truncates decoded annotation messages at 4096 bytes.
// Split before escaping, preserving whole UTF8 code points and the entire tail.
function annotationChunks(bytes) {
  const chunks = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(bytes.length, start + annotationChunkLimit);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return chunks.length ? chunks : [''];
}
function captureText(text) {
  tail = utf8Tail(Buffer.concat([tail, Buffer.from(text)]), tailLimit);
}
function escapeAnnotation(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});
for (const [source, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  // Decode independently: stderr may arrive between stdout's UTF8 bytes.
  const decoder = new StringDecoder('utf8');
  source.on('data', bytes => { destination.write(bytes); captureText(decoder.write(bytes)); });
  source.on('end', () => captureText(decoder.end()));
}
let launchError;
child.on('error', error => { launchError = error; });
const { code, signal } = await new Promise(resolve => {
  child.once('close', (code, signal) => resolve({ code, signal }));
});
if (launchError) {
  const message = `Test process launch failed: ${launchError.message}\n`;
  process.stderr.write(message); captureText(message);
}
try {
  await writeFile(join(process.env.RUNNER_TEMP || tmpdir(), 'feature-network-vitest.log'), tail, { mode: 0o600 });
} catch {
  // Diagnostic persistence must not change the actual test outcome.
  process.stderr.write('Could not persist the bounded test output tail.\n');
}
if (code !== 0 || signal || launchError) {
  const chunks = annotationChunks(tail);
  for (const [index, chunk] of chunks.entries()) {
    const part = `${index + 1}/${chunks.length}`;
    const diagnostic = `Vitest failed: exit=${code ?? 'none'}; signal=${signal ?? 'none'}; part=${part}\n${chunk}`;
    process.stderr.write(`\n::error title=Vitest diagnostics part ${part}::${escapeAnnotation(diagnostic)}\n`);
  }
}
process.exitCode = code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1);
