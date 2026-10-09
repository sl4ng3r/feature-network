import { NetworkError } from '../model/errors.js';
import type { Diagnostic, Feature, Relation } from '../model/types.js';
import type { Snapshot } from '../storage/repository.js';

export interface IndexedFeature { feature: Feature; tokens: Set<string>; paths: Set<string> }
export interface Edge extends Relation { from: string }
export interface NetworkIndex {
  revision: string;
  integrity: Snapshot['integrity'];
  diagnostics: Diagnostic[];
  fingerprints: Record<string, string>;
  entries: Map<string, IndexedFeature>;
  tokens: Map<string, Set<string>>;
  paths: Map<string, Set<string>>;
  outgoing: Map<string, Edge[]>;
  incoming: Map<string, Edge[]>;
}
/** Locale-independent normalization and tie-breaking keep results reproducible. */
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const normalize = (text: string): string => text.normalize('NFKC').toLowerCase();
export const tokenize = (text: string): string[] => normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
function entry(feature: Feature): IndexedFeature {
  const copy = structuredClone(feature);
  const refs = [...copy.code, ...copy.evidence, ...copy.relations.flatMap(r => r.evidence), ...copy.hypotheses.flatMap(h => h.evidence)];
  return { feature: copy, tokens: new Set(tokenize([copy.id, copy.summary, ...copy.key_points].join(' '))), paths: new Set(refs.map(r => r.path)) };
}
function updateSets(map: Map<string, Set<string>>, keys: Set<string>, id: string, add: boolean): void {
  for (const key of keys) {
    const ids = new Set(map.get(key));
    if (add) ids.add(id); else ids.delete(id);
    if (ids.size) map.set(key, ids); else map.delete(key);
  }
}
function updateEntry(index: NetworkIndex, value: IndexedFeature, add: boolean): void {
  const { feature } = value;
  updateSets(index.tokens, value.tokens, feature.id, add); updateSets(index.paths, value.paths, feature.id, add);
  if (add) index.entries.set(feature.id, value); else index.entries.delete(feature.id);
  index.outgoing.delete(feature.id);
  for (const relation of feature.relations) {
    const incoming = (index.incoming.get(relation.to) ?? []).filter(edge => edge.from !== feature.id);
    if (incoming.length) index.incoming.set(relation.to, incoming); else index.incoming.delete(relation.to);
  }
  if (add) {
    const edges = feature.relations.map(relation => ({ ...relation, from: feature.id })); index.outgoing.set(feature.id, edges);
    for (const edge of edges) index.incoming.set(edge.to, [...(index.incoming.get(edge.to) ?? []), edge]);
  }
}
export function buildIndex(snapshot: Snapshot): NetworkIndex {
  const index: NetworkIndex = { revision: snapshot.revision, integrity: snapshot.integrity, diagnostics: structuredClone(snapshot.diagnostics), fingerprints: { ...snapshot.fingerprints }, entries: new Map(), tokens: new Map(), paths: new Map(), outgoing: new Map(), incoming: new Map() };
  for (const feature of [...snapshot.features].sort((a, b) => compare(a.id, b.id))) updateEntry(index, entry(feature), true);
  return index;
}
/** Returns an independent index; unchanged entries and postings are reused. */
export function refreshIndex(previous: NetworkIndex, snapshot: Snapshot): NetworkIndex {
  const index: NetworkIndex = { ...previous, revision: snapshot.revision, integrity: snapshot.integrity, diagnostics: structuredClone(snapshot.diagnostics), fingerprints: { ...snapshot.fingerprints }, entries: new Map(previous.entries), tokens: new Map(previous.tokens), paths: new Map(previous.paths), outgoing: new Map(previous.outgoing), incoming: new Map(previous.incoming) };
  const features = new Map(snapshot.features.map(f => [f.id, f]));
  for (const [id, old] of previous.entries) {
    const path = `network-spec/${id}.yaml`;
    if (!features.has(id) || previous.fingerprints[path] !== snapshot.fingerprints[path]) updateEntry(index, old, false);
  }
  for (const [id, feature] of features) if (!index.entries.has(id)) updateEntry(index, entry(feature), true);
  return index;
}
export function requireQueryable(index: NetworkIndex): void {
  if (index.integrity === 'not_initialized' || index.integrity === 'pending_recovery') throw new NetworkError(index.integrity, 'Network is not available for queries');
  if (!Object.hasOwn(index.fingerprints, 'network-spec/_meta.yaml') || index.diagnostics.some(d => d.path === 'network-spec/_meta.yaml' && d.severity === 'error')) throw new NetworkError('invalid_network', 'Network marker is invalid');
}
