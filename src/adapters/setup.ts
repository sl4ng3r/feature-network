import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { parse, stringify } from 'smol-toml';
import { digest } from '../storage/journal.js';
import { NetworkError } from '../model/errors.js';
export type SetupHost = 'codex' | 'copilot';
export interface SetupFile { readonly path: string; readonly expectedHash: string | null; readonly content: string }
/** Public preview contains ONLY additions, never unrelated original config values. */
export interface SetupPlan { readonly host: SetupHost; readonly projectRoot: string; readonly files: readonly SetupFile[]; readonly note: string }
export interface SetupOptions { pluginRoot: string; nodePath: string }
interface InternalPlan { root: string; files: { path: string; before: string | null; after: string }[]; sources: { path: string; hash: string }[] }
const plans = new WeakMap<SetupPlan, InternalPlan>();
const applying = new Set<string>();
const maxConfigBytes = 1024 * 1024;
function fail(code = 'setup_conflict'): never { throw new NetworkError(code, 'Setup cannot safely preserve the reviewed configuration'); }
export const quoteBash = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`;
export const quotePowerShell = (value: string): string => `'${value.replaceAll("'", "''")}'`;
export const setupTargets = (host: SetupHost): string[] => host === 'codex' ? ['.codex/hooks.json', '.codex/config.toml'] : ['.github/hooks/feature-network.json', '.mcp.json'];
async function safePath(root: string, path: string): Promise<string> {
  const full = resolve(root, path); const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) fail('unsafe_path');
  let cursor = root;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) fail('unsafe_path'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return full;
}
async function readConfig(root: string, path: string): Promise<string | null> {
  let file;
  try { file = await open(await safePath(root, path), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat(); if (!info.isFile() || info.size > maxConfigBytes) fail('unsafe_config');
    const bytes = await file.readFile(); if (bytes.byteLength > maxConfigBytes) fail('unsafe_config');
    // Retain BOM in the raw text: valid UTF-8 must round-trip byte-for-byte for CAS.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally { await file.close(); }
}
export async function readSetupConfig(host: SetupHost, root: string): Promise<Record<string, string | null>> {
  const canonical = await realpath(root);
  return Object.fromEntries(await Promise.all(setupTargets(host).map(async path => [path, await readConfig(canonical, path)])));
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('unsafe_config');
  return value as Record<string, unknown>;
}
// Parsing may ignore the encoding marker; fingerprints and original content never do.
const parseable = (raw: string): string => raw.startsWith('\ufeff') ? raw.slice(1) : raw;
const preserveBom = (raw: string | null, output: string): string => (raw?.startsWith('\ufeff') ? '\ufeff' : '') + output;
function json(raw: string | null): Record<string, unknown> { return raw === null ? {} : object(JSON.parse(parseable(raw))); }
const formatted = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
function hookConfig(host: SetupHost, node: string, script: string): Record<string, unknown> {
  const events = host === 'codex' ? ['SessionStart', 'UserPromptSubmit', 'Stop'] : ['sessionStart', 'userPromptSubmitted', 'agentStop'];
  const hooks = Object.fromEntries(events.map(event => {
    const args = [node, script, '--host', host, ...(host === 'copilot' ? ['--event', event] : [])];
    const bash = args.map(quoteBash).join(' ');
    const definition = host === 'codex' ? [{ hooks: [{ type: 'command', command: bash, timeout: 8 }] }]
      : [{ type: 'command', bash, powershell: '& ' + args.map(quotePowerShell).join(' '), timeoutSec: 8 }];
    return [event, definition];
  }));
  return host === 'codex' ? { hooks } : { version: 1, hooks };
}
function mergeHooks(raw: string | null, additions: Record<string, unknown>): string {
  const existing = json(raw); const hooks = object(existing.hooks ?? {}); const incoming = object(additions.hooks);
  if (existing.version !== undefined && existing.version !== 1) fail('unsafe_config');
  const merged = { ...hooks };
  for (const [event, entries] of Object.entries(incoming)) {
    const old = hooks[event] ?? []; if (!Array.isArray(old)) fail('unsafe_config');
    // Exact existing generated entries are idempotent; manual entries remain untouched.
    merged[event] = [...old, ...(entries as unknown[]).filter(entry => !old.some(item => JSON.stringify(item) === JSON.stringify(entry)))];
  }
  return preserveBom(raw, formatted({ ...existing, ...(additions.version === 1 ? { version: 1 } : {}), hooks: merged }));
}
/** Pure proposal with fixed project targets; this does not grant installation consent. */
async function createSetupPlan(host: SetupHost, project: string, existingConfig: Record<string, string | null>, trusted: SetupOptions): Promise<SetupPlan> {
  if (host !== 'codex' && host !== 'copilot') fail('unsupported_host');
  const root = await realpath(project); if (!(await lstat(root)).isDirectory()) fail('unsafe_path');
  const pluginRoot = await realpath(trusted.pluginRoot);
  const node = await realpath(trusted.nodePath);
  const version = await promisify(execFile)(node, ['--version'], { timeout: 1500, maxBuffer: 1024 });
  if (!/^v24\./.test(version.stdout)) fail('node_24_required');
  const sources = [];
  for (const name of ['dist/cli.mjs', 'dist/hook.mjs']) {
    const path = await safePath(pluginRoot, name); const info = await lstat(path);
    if (!info.isFile()) fail('unsafe_path');
    sources.push({ path, hash: digest(await readFile(path)) });
  }
  const targets = setupTargets(host);
  if (Object.keys(existingConfig).some(key => !targets.includes(key))) fail('unsafe_config');
  for (const target of targets) {
    if (!Object.hasOwn(existingConfig, target) || await readConfig(root, target) !== existingConfig[target]) fail();
  }
  const additions = hookConfig(host, node, join(pluginRoot, 'dist/hook.mjs'));
  const hookTarget = targets[0]!; const mcpTarget = targets[1]!;
  const args = [join(pluginRoot, 'dist/cli.mjs'), 'mcp', '--project-root', root];
  const mcp = { command: node, args };
  let mcpAfter: string; let mcpPreview: string;
  const old = existingConfig[mcpTarget]!;
  if (host === 'codex') {
    const config = old === null ? {} : parse(parseable(old)); const servers = object(config.mcp_servers ?? {});
    if (Object.hasOwn(servers, 'feature-network')) fail(); // Preserve manual policy; never replace it.
    mcpPreview = stringify({ mcp_servers: { 'feature-network': mcp } });
    mcpAfter = (old ?? '') + '\n' + mcpPreview;
    parse(parseable(mcpAfter)); // Reject inline-table / incompatible section extension.
  } else {
    const config = json(old); const wrapped = old === null || Object.hasOwn(config, 'mcpServers');
    const servers = wrapped ? object(config.mcpServers ?? {}) : config;
    if (Object.hasOwn(servers, 'feature-network')) fail();
    const entry = { type: 'local', ...mcp, tools: ['network_context', 'network_impact', 'network_update', 'network_check', 'network_bootstrap'] };
    mcpPreview = formatted({ mcpServers: { 'feature-network': entry } });
    mcpAfter = preserveBom(old, formatted(wrapped ? { ...config, mcpServers: { ...servers, 'feature-network': entry } } : { ...config, 'feature-network': entry }));
  }
  const internal: InternalPlan = { root, sources, files: [
    { path: hookTarget, before: existingConfig[hookTarget]!, after: mergeHooks(existingConfig[hookTarget]!, additions) },
    { path: mcpTarget, before: old, after: mcpAfter },
  ] };
  const plan: SetupPlan = Object.freeze({ host, projectRoot: root,
    files: Object.freeze(internal.files.map((file, index) => Object.freeze({ path: join(root, file.path), expectedHash: file.before === null ? null : digest(file.before), content: index === 0 ? formatted(additions) : mcpPreview }))),
    note: 'Preview of additions only; unrelated values are preserved privately. Applying requires explicit approval of these exact targets. Host trust review remains required. Local paths must not be committed or released.' });
  plans.set(plan, internal); return plan;
}
/** Parser diagnostics can contain secret source values: never expose those errors. */
export async function planSetup(host: SetupHost, project: string, existingConfig: Record<string, string | null>, trusted: SetupOptions): Promise<SetupPlan> {
  try { return await createSetupPlan(host, project, existingConfig, trusted); }
  catch (error) { if (error instanceof NetworkError) throw error; fail('unsafe_config'); }
}

/** Call only after concrete approval of this exact in-process plan. JSON cannot authorize writes. */
export async function applySetup(plan: SetupPlan): Promise<void> {
  const internal = plans.get(plan); if (!internal || applying.has(internal.root)) fail('unapproved_plan');
  applying.add(internal.root);
  const temporary: string[] = []; const locks: string[] = [];
  try {
    if (await realpath(internal.root) !== internal.root) fail('unsafe_path');
    for (const source of internal.sources) {
      if ((await lstat(source.path)).isSymbolicLink() || await realpath(source.path) !== source.path || digest(await readFile(source.path)) !== source.hash) fail();
    }
    for (const file of internal.files) {
      const target = await safePath(internal.root, file.path); await mkdir(dirname(target), { recursive: true });
      const lock = `${file.path}.feature-network-setup-lock`;
      const handle = await open(await safePath(internal.root, lock), 'wx', 0o600);
      locks.push(lock); await handle.close();
    }
    for (const file of internal.files) if (await readConfig(internal.root, file.path) !== file.before) fail();
    for (const file of internal.files) {
      const target = await safePath(internal.root, file.path); await mkdir(dirname(target), { recursive: true });
      const temp = `${file.path}.tmp-${randomUUID()}`; temporary.push(temp);
      const handle = await open(await safePath(internal.root, temp), 'wx', 0o600);
      try { await handle.writeFile(file.after); await handle.sync(); } finally { await handle.close(); }
    }
    // Revalidate the complete preview once more before first publication.
    for (const file of internal.files) if (await readConfig(internal.root, file.path) !== file.before) fail();
    for (let index = 0; index < internal.files.length; index++) {
      const file = internal.files[index]!;
      if (await readConfig(internal.root, file.path) !== file.before) fail();
      await rename(await safePath(internal.root, temporary[index]!), await safePath(internal.root, file.path));
    }
    plans.delete(plan);
  } finally {
    for (const path of [...temporary, ...locks]) await unlink(await safePath(internal.root, path)).catch(() => {});
    applying.delete(internal.root);
  }
}
