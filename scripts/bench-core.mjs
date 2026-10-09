import { build } from 'esbuild';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if (!/^v24\./.test(process.version)) throw new Error('node_24_required');
const temporary = await mkdtemp(resolve('.feature-network-build-bench-'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
try {
  const outfile = resolve(temporary, 'core.mjs');
  const built = await build({ entryPoints: ['bench/core.ts'], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent', metafile: true });
  const invocation = `import { runCoreBenchmark } from ${JSON.stringify(pathToFileURL(outfile).href)}; process.stdout.write(JSON.stringify(runCoreBenchmark(), null, 2) + '\\n');`;
  const measured = JSON.parse(execFileSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', invocation], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  let sourceRevision = null; let sourceTree = null; let workingTreeDirty = null;
  try {
    // An exported source directory inside some other checkout is NOT that checkout's HEAD.
    if (await realpath(git('rev-parse', '--show-toplevel')) === await realpath(process.cwd())) {
      sourceRevision = git('rev-parse', 'HEAD'); sourceTree = git('rev-parse', 'HEAD^{tree}'); workingTreeDirty = git('status', '--porcelain').length > 0;
    }
  } catch { /* No Git metadata is an honest source-export condition, not a failed benchmark. */ }
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const inputs = await Promise.all([...Object.keys(built.metafile.inputs), 'scripts/bench-core.mjs'].sort().map(async path => ({ path, sha256: sha256(await readFile(path)) })));
  measured.provenance = { sourceRevision, sourceTree, workingTreeDirty, loadedBundleSha256: sha256(await readFile(outfile)), inputs,
    sourceBinding: 'HEAD/tree are nullable checkout metadata; loadedBundleSha256 binds exact executed synthetic code; inputs are post-build source observations' };
  process.stdout.write(JSON.stringify(measured, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
