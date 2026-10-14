import { countWork } from '../diagnostics/work.js';
import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { NetworkError } from '../model/errors.js';

/** Static special entries are rejected before open. POSIX nonblocking admission
 * also closes the FIFO replacement window; handle validation remains mandatory.
 * This is cooperative filesystem confinement, not a hostile same-user sandbox. */
export async function openRegular(path: string, code = 'unsafe_path'): Promise<FileHandle> {
  countWork('metadataChecks');
  if (!(await lstat(path)).isFile()) throw new NetworkError(code, 'Entry is not a regular file');
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK);
  const handle = await open(path, flags);
  try {
    countWork('metadataChecks');
    if (!(await handle.stat()).isFile()) throw new NetworkError(code, 'Entry is not a regular file');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
export async function readRegular(path: string): Promise<Buffer> {
  const handle = await openRegular(path);
  try { return await handle.readFile(); } finally { await handle.close(); }
}
export interface ByteEntry { signature: string; bytes: Buffer }
export type ByteCache = Map<string, ByteEntry>;
/** ctime + inode detect same-length edits with restored mtime and replacements. */
export async function regularSignature(path: string, code = 'unsafe_path'): Promise<string> {
  countWork('metadataChecks');
  const info = await lstat(path, { bigint: true });
  if (!info.isFile()) throw new NetworkError(code, 'Entry is not a regular file');
  return [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(':');
}
