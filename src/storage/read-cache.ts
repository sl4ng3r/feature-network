import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import { featureSchema, parseFeature } from '../model/schema.js';
import type { Feature } from '../model/types.js';
import type { Project } from '../project/root.js';
import type { StorageOptions } from './repository.js';
import { atomicStorageWrite, digest, readStorage, revision, fingerprints, type Contents } from './journal.js';
import type { ByteCache } from './regular.js';

const path = '.feature-network/read-cache.json';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.strictObject({ hash, feature: featureSchema });
const payloadSchema = z.strictObject({ version: z.literal(1), binding: z.string(), revision: hash, fingerprints: z.record(z.string(), hash),
  entries: z.record(z.string().regex(/^network-spec\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.yaml$/), entrySchema) });
type ParsedEntry = z.infer<typeof entrySchema>;
export interface ReadCache { bytes: ByteCache; references: Map<string, { signature: string; hash: string }>; parsed: Map<string, ParsedEntry> }
const caches = new Map<string, ReadCache>();
// Project roots are canonical; supplied exclusion roots are part of the binding,
// while current canonical exclusions are still checked on EVERY reference read.
function binding(project: Project, options: StorageOptions): string {
  return JSON.stringify([1, project.root, project.networkDir, project.runtimeDir, [...(options.excludedReferenceRoots ?? [])].sort()]);
}
export async function readCache(project: Project, options: StorageOptions): Promise<ReadCache> {
  const key = binding(project, options);
  const existing = caches.get(key);
  if (existing) return existing;
  const cache: ReadCache = { bytes: new Map(), references: new Map(), parsed: new Map() };
  try {
    const raw = await readStorage(project, path);
    if (raw !== null) {
      const envelope = z.strictObject({ version: z.literal(1), payload: payloadSchema, checksum: hash }).parse(JSON.parse(raw));
      const payload = envelope.payload;
      const sortedFingerprints = Object.fromEntries(Object.entries(payload.fingerprints).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
      if (payload.binding === key && digest(JSON.stringify(payload)) === envelope.checksum
        && digest(JSON.stringify(sortedFingerprints)) === payload.revision) {
        for (const [name, entry] of Object.entries(payload.entries)) {
          if (name === `network-spec/${entry.feature.id}.yaml` && payload.fingerprints[name] === entry.hash) cache.parsed.set(name, entry);
        }
      }
    }
  } catch { /* Disposable cache loss/corruption is an in-memory miss, never recovery. */ }
  // Bounded by active projects, without exporting lifecycle controls solely for tests.
  if (caches.size >= 32) caches.delete(caches.keys().next().value!);
  caches.set(key, cache);
  return cache;
}
export function parsedFeature(cache: ReadCache | undefined, name: string, bytes: Buffer): Feature {
  const hash = digest(bytes);
  const old = cache?.parsed.get(name);
  if (old?.hash === hash) return structuredClone(old.feature);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new NetworkError('invalid_schema', 'YAML is not valid UTF-8', [name]); }
  const feature = parseFeature(text, name);
  cache?.parsed.set(name, { hash, feature });
  return structuredClone(feature);
}
/** Only called while an ALREADY authorized writer holds the project lock.
 * It persists derived parsed data, never hashes of reviewed source or decisions.
 * Failure cannot invalidate a successfully published authoritative transaction. */
export async function publishReadCache(project: Project, contents: Contents, options: StorageOptions): Promise<void> {
  try {
    const cache = await readCache(project, options);
    const entries: Record<string, ParsedEntry> = {};
    for (const [name, bytes] of Object.entries(contents)) {
      if (name === 'network-spec/_meta.yaml') continue;
      try { entries[name] = { hash: digest(bytes), feature: parsedFeature(cache, name, bytes) }; }
      catch { /* Invalid YAML is intentionally not cached and remains diagnosable. */ }
    }
    const payload = { version: 1 as const, binding: binding(project, options), revision: revision(contents), fingerprints: fingerprints(contents), entries };
    await atomicStorageWrite(project, path, JSON.stringify({ version: 1, payload, checksum: digest(JSON.stringify(payload)) }));
  } catch { /* Cache is optional. Source snapshots and writer checks stay authoritative. */ }
}
