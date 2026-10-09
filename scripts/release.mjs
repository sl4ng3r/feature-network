import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { packageFiles, verifyPackage } from './verify-package.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Reproducible USTAR entries: no owner names, checkout timestamps or local paths.
function tarEntry(path, bytes) {
  const header = Buffer.alloc(512); let name = path; let prefix = '';
  if (Buffer.byteLength(name) > 100) { const split = name.lastIndexOf('/', 155); prefix = name.slice(0, split); name = name.slice(split + 1); }
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('archive_path_too_long');
  header.write(name, 0, 100); header.write('0000644\0', 100, 8); header.write('0000000\0', 108, 8); header.write('0000000\0', 116, 8);
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12); header.write('00000000000\0', 136, 12);
  header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257, 6); header.write('00', 263, 2); header.write(prefix, 345, 155);
  const sum = header.reduce((total, byte) => total + byte, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return [header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)];
}
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('node_24_required');
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--version' || !/^\d+\.\d+\.\d+$/.test(args[1])) throw new Error('usage: release:prepare -- --version <version>');
  const version = args[1];
  let license;
  try { license = await readFile('LICENSE', 'utf8'); } catch { throw new Error('license_required'); }
  if (!license.includes('MIT License') || !license.includes('Permission is hereby granted')) throw new Error('license_required');
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  if (metadata.version !== version) throw new Error('version_mismatch');
  const git = (...params) => execFileSync('git', params, { encoding: 'utf8' });
  if (git('status', '--porcelain').trim()) throw new Error('clean_checkout_required');
  const revision = git('rev-parse', 'HEAD').trim();
  const verification = await verifyPackage();
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  // Public source allowlist deliberately excludes local AGENTS, planning history and runtime data.
  const source = tracked.filter(path => /^(src\/|scripts\/|tests\/|demo\/|bench\/|docs\/validation\/|\.github\/|\.agents\/plugins\/|docs\/(?:installation|adapters|mcp)\.md$|(?:README|CONTRIBUTING|LICENSE|CHANGELOG)\.md$|LICENSE$|package(?:-lock)?\.json$|tsconfig\.json$|vitest\.config\.ts$|\.node-version$|\.gitignore$)/.test(path) && !/(?:^|\/)(?:private-fixtures|\.feature-network|\.env(?:\.[^/]+)?)(?:\/|$)/.test(path));
  const entries = new Map();
  for (const path of source) {
    if (path.split('/').includes('..') || /(?:^|\/)(?:\.env|\.feature-network|node_modules)(?:\/|$)/.test(path) || !(await lstat(path)).isFile()) throw new Error('unsafe_source_file');
    entries.set('source/' + path, execFileSync('git', ['show', `${revision}:${path}`], { maxBuffer: 32 * 1024 * 1024 }));
  }
  // Canonical package source is also present in the development/source tree.
  for (const path of await packageFiles('plugin')) {
    const bytes = await readFile(join('plugin', path)); entries.set('plugin/' + path, bytes);
    if (!path.startsWith('dist/') && path !== 'LICENSE') entries.set('source/plugin/' + path, execFileSync('git', ['show', `${revision}:plugin/${path}`], { maxBuffer: 1024 * 1024 }));
  }
  const checksums = Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([path, bytes]) => [path, hash(bytes)]));
  const manifest = { format: 1, version, sourceRevision: revision, sourceTree: git('rev-parse', 'HEAD^{tree}').trim(), checksums };
  entries.set('release-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  // The source snapshot and checked plugin are held in memory before publication.
  if (git('status', '--porcelain').trim() || git('rev-parse', 'HEAD').trim() !== revision) throw new Error('source_changed');
  await verifyPackage();
  const name = `feature-network-${version}`; const parent = 'releases'; const target = join(parent, name);
  try { const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe_release_path'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(parent, { recursive: true });
  if ((await lstat(parent)).isSymbolicLink()) throw new Error('unsafe_release_path');
  try { await lstat(target); throw new Error('release_target_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(parent, name + '.tmp-' + process.pid); await mkdir(temporary);
  try {
    for (const [path, bytes] of entries) { const destination = join(temporary, path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes, { flag: 'wx', mode: 0o644 }); }
    const chunks = [...entries].sort(([a], [b]) => a.localeCompare(b, 'en')).flatMap(([path, bytes]) => tarEntry(name + '/' + path, bytes));
    const archive = gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]), { level: 9 });
    await writeFile(join(temporary, name + '.tar.gz'), archive, { flag: 'wx' });
    const report = { status: 'prepared_locally', version, sourceRevision: revision, sourceTree: manifest.sourceTree, platform: process.platform, arch: process.arch, node: process.version, archiveSha256: hash(archive), verification, externalCi: 'not_established_by_local_preparation', hostLiveAcceptance: 'pending', published: false };
    await writeFile(join(temporary, 'release-report.json'), JSON.stringify(report, null, 2) + '\n');
    await rename(temporary, target); process.stdout.write(JSON.stringify({ ...report, directory: target }, null, 2) + '\n');
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
} catch (error) { process.stderr.write(`FeatureNetwork release: ${error.message}\n`); process.exitCode = 1; }
