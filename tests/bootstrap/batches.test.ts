import { expect, test } from 'vitest';
import { planBatches, sliceText } from '../../src/bootstrap/batches.js';
test('twenty_files_and_65536_bytes_max', () => {
  const files = Array.from({ length: 23 }, (_, n) => ({ path: `${n}.ts`, hash: 'a'.repeat(64), status: 'pending' as const, reason: null, slices: sliceText('x'.repeat(4000)) }));
  const batches = planBatches(files);
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.every(b => new Set(b.slices.map(s => s.path)).size <= 20 && b.plannedBytes <= 65536)).toBe(true);
  expect(batches.flatMap(b => b.slices).reduce((n, s) => n + s.bytes, 0)).toBe(92000);
  expect(planBatches(files.map(f => ({ ...f, slices: sliceText('a') })))[0]!.slices).toHaveLength(20);
});
test('slices_large_unicode_file_without_loss', () => {
  const text = '😀'.repeat(40000) + '\nlast\n'; const bytes = Buffer.from(text); const slices = sliceText(text);
  expect(slices.length).toBeGreaterThan(2);
  const pieces = slices.map(s => bytes.subarray(s.startByte, s.endByte));
  expect(Buffer.concat(pieces)).toEqual(bytes);
  for (const piece of pieces) expect(() => new TextDecoder('utf8', { fatal: true }).decode(piece)).not.toThrow();
  expect(slices[0]).toMatchObject({ startByte: 0, startLine: 1, endLine: 1, bytes: 65536 });
  expect(slices.at(-1)?.endLine).toBe(2);
});
