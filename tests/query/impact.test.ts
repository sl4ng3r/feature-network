import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../src/query/index.js';
import { queryImpact, type ImpactItem } from '../../src/query/impact.js';
import type { Feature } from '../../src/model/types.js';
import type { Snapshot } from '../../src/storage/repository.js';
const feature = (id: string, summary = id): Feature => ({ schema: 1, id, summary, key_points: [], code: [{ path: `src/${id}.ts` }], evidence: [], relations: [], hypotheses: [] });
const snapshot = (features: Feature[], revision = 'a'.repeat(64)): Snapshot => ({ features, revision, integrity: 'valid', diagnostics: [], fingerprints: Object.fromEntries([['network-spec/_meta.yaml', 'm'], ...features.map(f => [`network-spec/${f.id}.yaml`, JSON.stringify(f)])]) });
import type { Relation } from '../../src/model/types.js';
const edge = (to: string, status: Relation['status'] = 'evidenced'): Relation => ({ to, type: 'reads', status, evidence: status === 'evidenced' ? [{ path: 'src/demo.ts' }] : [], when: 'profile changes', check: 'roundtrip' });
const graph = () => { const profile = feature('profile'); const backup = feature('backup'); const restore = feature('restore'); backup.relations = [edge('profile')]; restore.relations = [edge('backup')]; return buildIndex(snapshot([profile, backup, restore])); };
const ids = (result: any) => result.items.map((item: any) => item.id);
describe('impact query', () => {
  it('both_directions_find_backup_and_restore', () => {
    const result = queryImpact(graph(), { ids: ['profile'] }); expect(ids(result)).toEqual(['profile', 'backup', 'restore']);
    expect((result.items[2] as ImpactItem).origin).toBe('profile'); expect((result.items[2] as ImpactItem).path.map((step: any) => step.direction)).toEqual(['incoming', 'incoming']); expect((result.items[2] as ImpactItem).path[0]!.check).toBe('roundtrip');
    expect(ids(queryImpact(graph(), { ids: ['profile'], direction: 'outgoing' }))).toEqual(['profile']);
    expect(ids(queryImpact(graph(), { ids: ['restore'], direction: 'outgoing' }))).toEqual(['restore', 'backup', 'profile']);
  });
  it('selecting_all_dependents_as_origins_hides_paths_that_a_direct_origin_explains', () => {
    const direct = queryImpact(graph(), { ids: ['profile'], direction: 'both', depth: 2 });
    expect(direct.items.map(item => ({ id: item.id, origin: (item as ImpactItem).origin, steps: (item as ImpactItem).path.length }))).toEqual([
      { id: 'profile', origin: 'profile', steps: 0 },
      { id: 'backup', origin: 'profile', steps: 1 },
      { id: 'restore', origin: 'profile', steps: 2 },
    ]);
    const all = queryImpact(graph(), { ids: ['profile', 'backup', 'restore'], direction: 'both', depth: 2 });
    expect(all.items.map(item => ({ id: item.id, origin: (item as ImpactItem).origin, steps: (item as ImpactItem).path.length }))).toEqual([
      { id: 'backup', origin: 'backup', steps: 0 },
      { id: 'profile', origin: 'profile', steps: 0 },
      { id: 'restore', origin: 'restore', steps: 0 },
    ]);
  });
  it('cycles_terminate', () => {
    const a = feature('alpha'); const b = feature('beta'); a.relations = [edge('beta')]; b.relations = [edge('alpha')];
    expect(ids(queryImpact(buildIndex(snapshot([a, b])), { ids: ['alpha'], depth: 8 }))).toEqual(['alpha', 'beta']);
  });
  it('hypothesis_path_stays_hypothesis', () => {
    const a = feature('alpha'); const b = feature('beta'); const c = feature('gamma'); a.relations = [edge('beta', 'hypothesis')]; b.relations = [edge('gamma')];
    const result = queryImpact(buildIndex(snapshot([a, b, c])), { ids: ['alpha'], direction: 'outgoing' });
    expect((result.items[2] as ImpactItem).status).toBe('hypothesis'); expect((result.items[2] as ImpactItem).path.map((step: any) => step.status)).toEqual(['hypothesis', 'evidenced']);
  });
  it('prefers an evidenced path over a shorter hypothesis', () => {
    const a = feature('alpha'); const b = feature('beta'); const c = feature('gamma'); a.relations = [edge('gamma', 'hypothesis'), edge('beta')]; b.relations = [edge('gamma')];
    const result = queryImpact(buildIndex(snapshot([a, b, c])), { ids: ['alpha'], direction: 'outgoing' });
    expect((result.items.find(item => item.id === 'gamma') as ImpactItem).status).toBe('evidenced'); expect((result.items[2] as ImpactItem).path).toHaveLength(2);
  });
  it('shorter uncertain route preserves reachable nodes within depth', () => {
    const a = feature('alpha'); const b = feature('beta'); const c = feature('gamma'); const d = feature('delta');
    a.relations = [edge('beta'), edge('gamma', 'hypothesis')]; b.relations = [edge('gamma')]; c.relations = [edge('delta')];
    const result = queryImpact(buildIndex(snapshot([a, b, c, d])), { ids: ['alpha'], direction: 'outgoing', depth: 2 });
    expect(ids(result)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect((result.items[2] as ImpactItem).status).toBe('evidenced');
    expect((result.items[3] as ImpactItem).status).toBe('hypothesis');
  });
  it('defaults_depth_two_limit_twenty_budget_12000', () => {
    const chain = Array.from({ length: 25 }, (_, i) => feature(`node-${String(i).padStart(2, '0')}`)); chain.forEach((f, i) => { if (chain[i + 1]) f.relations = [edge(chain[i + 1]!.id)]; });
    const bounded = queryImpact(buildIndex(snapshot(chain)), { ids: ['node-00'] });
    expect(ids(bounded)).toEqual(['node-00', 'node-01', 'node-02']); expect(bounded.depth).toBe(2); expect(bounded.depthLimited).toBe(true);
    expect(queryImpact(graph(), { ids: ['profile'] }).depthLimited).toBe(false);
    const hub = feature('hub'); hub.relations = chain.map(f => edge(f.id));
    const result = queryImpact(buildIndex(snapshot([hub, ...chain])), { ids: ['hub'] }); expect(result.items).toHaveLength(20); expect(result.omitted).toBe(6); expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(12000);
  });
  it('paths and text find seeds and depth zero returns only seeds', () => {
    expect(ids(queryImpact(graph(), { paths: ['src/profile.ts'], depth: 0 }))).toEqual(['profile']);
    expect(ids(queryImpact(graph(), { query: 'restore', depth: 0 }))).toEqual(['restore']);
    expect(ids(queryImpact(graph(), {}))).toEqual([]);
  });
});
