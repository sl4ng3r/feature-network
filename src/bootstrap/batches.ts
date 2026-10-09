import { digest } from '../storage/journal.js';
import type { InventoryFile } from './inventory.js';
export interface Slice { startByte: number; endByte: number; startLine: number; endLine: number; bytes: number; hash: string }
export interface PackageSlice extends Slice { path: string; fileHash: string }
export interface Batch { id: string; slices: PackageSlice[]; plannedBytes: number }
/** Half-open UTF-8 offsets are authoritative, inclusive lines help ordinary agent readers. */
export function sliceText(text: string, maxBytes = 65536): Slice[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 4 || maxBytes > 65536) throw new Error('Invalid slice byte limit');
  const bytes = Buffer.from(text); const slices: Slice[] = []; let start = 0; let line = 1;
  do {
    let end = Math.min(bytes.length, start + maxBytes);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    const chunk = bytes.subarray(start, end); const startLine = line;
    for (const byte of chunk) if (byte === 10) line++;
    slices.push({ startByte: start, endByte: end, startLine, endLine: Math.max(startLine, line - (chunk.at(-1) === 10 ? 1 : 0)), bytes: end - start, hash: digest(chunk) });
    start = end;
  } while (start < bytes.length);
  return slices;
}
export function planBatches(files: InventoryFile[], maxFiles = 20, maxBytes = 65536): Batch[] {
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 20 || !Number.isInteger(maxBytes) || maxBytes < 4 || maxBytes > 65536) throw new Error('Invalid package limits');
  const batches: Batch[] = []; let slices: PackageSlice[] = []; let plannedBytes = 0;
  const flush = () => { if (slices.length) batches.push({ id: digest(JSON.stringify(slices)), slices, plannedBytes }); slices = []; plannedBytes = 0; };
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    if (file.status !== 'pending' || file.hash === null) continue;
    for (const slice of file.slices) {
      if (slice.bytes > maxBytes) throw new Error('Slice exceeds configured byte limit');
      const paths = new Set(slices.map(s => s.path)); paths.add(file.path);
      if (paths.size > maxFiles || plannedBytes + slice.bytes > maxBytes) flush();
      slices.push({ ...slice, path: file.path, fileHash: file.hash }); plannedBytes += slice.bytes;
    }
  }
  flush(); return batches;
}
