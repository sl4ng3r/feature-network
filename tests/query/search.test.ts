import { describe, expect, it } from 'vitest';
import { buildIndex, refreshIndex } from '../../src/query/index.js';
import { queryContext } from '../../src/query/search.js';
import type { Feature } from '../../src/model/types.js';
import type { Snapshot } from '../../src/storage/repository.js';

export const feature = (id: string, summary = id): Feature => ({ schema: 1, id, summary, key_points: [], code: [{ path: `src/${id}.ts` }], evidence: [], relations: [], hypotheses: [] });
export const snapshot = (features: Feature[], revision = 'a'.repeat(64)): Snapshot => ({ features, revision, integrity: 'valid', diagnostics: [], fingerprints: Object.fromEntries([['network-spec/_meta.yaml', 'm'], ...features.map(f => [`network-spec/${f.id}.yaml`, JSON.stringify(f)])]) });
const ids = (result: any) => result.items.map((item: any) => item.id);

describe('context query', () => {
  it('id_path_and_text_rank_stably', () => {
    const index = buildIndex(snapshot([feature('zeta', 'profile'), feature('beta', 'profile'), feature('alpha', 'profile')]));
    expect(ids(queryContext(index, { ids: ['zeta'], paths: ['src/beta.ts'], query: 'profile' }))).toEqual(['zeta', 'beta', 'alpha']);
    expect(ids(queryContext(index, { query: 'profile' }))).toEqual(['alpha', 'beta', 'zeta']);
  });
  it('reference paths preserve case', () => {
    const source = feature('alpha'); source.code = [{ path: 'src/Profile.ts' }];
    const index = buildIndex(snapshot([source]));
    expect(ids(queryContext(index, { paths: ['src/profile.ts'] }))).toEqual([]);
    expect(ids(queryContext(index, { paths: ['src/Profile.ts'] }))).toEqual(['alpha']);
  });
  it('normalizes_unicode', () => {
    expect(ids(queryContext(buildIndex(snapshot([feature('cafe', 'CAFÉ Nutzerprofil')])), { query: 'cafe\u0301 NUTZERPROFIL' }))).toEqual(['cafe']);
  });
  it('queryless_overview_pages_ten', () => {
    const index = buildIndex(snapshot(Array.from({ length: 12 }, (_, i) => feature(`item-${String(i).padStart(2, '0')}`))));
    expect(queryContext(index, { limit: 100 }).items).toHaveLength(10);
    const first = queryContext(index, {});
    expect(first.items).toHaveLength(10); expect(first.omitted).toBe(2); expect(first.truncated).toBe(true);
    expect(ids(queryContext(index, { cursor: first.nextCursor! }))).toEqual(['item-10', 'item-11']);
  });
  it('broken_feature_marks_incomplete_results', () => {
    const source = snapshot([feature('backup')]); source.integrity = 'invalid'; source.diagnostics = [{ code: 'invalid_schema', path: 'network-spec/broken.yaml', severity: 'error', message: 'bad feature' }];
    const result = queryContext(buildIndex(source), {});
    expect(ids(result)).toEqual(['backup']); expect(result.incomplete).toBe(true); expect(result.integrity).toBe('invalid'); expect(result.diagnostics[0]!.code).toBe('invalid_schema');
  });
  it.each(['not_initialized', 'pending_recovery'] as const)('blocks %s', integrity => {
    const source = snapshot([]); source.integrity = integrity;
    expect(() => queryContext(buildIndex(source), {})).toThrowError(expect.objectContaining({ code: integrity }));
  });
  it('blocks invalid marker even with valid features', () => {
    const source = snapshot([feature('backup')]); source.integrity = 'invalid'; source.diagnostics = [{ code: 'invalid_schema', path: 'network-spec/_meta.yaml', severity: 'error', message: 'bad marker' }];
    expect(() => queryContext(buildIndex(source), {})).toThrowError(expect.objectContaining({ code: 'invalid_network' }));
  });
  it('incremental_refresh_replaces_only_changed_features', () => {
    const first = buildIndex(snapshot([feature('alpha'), feature('beta')]));
    const next = refreshIndex(first, snapshot([feature('alpha'), feature('beta', 'updated')], 'b'.repeat(64)));
    expect(next.entries.get('alpha')).toBe(first.entries.get('alpha')); expect(next.entries.get('beta')).not.toBe(first.entries.get('beta'));
    expect(ids(queryContext(next, { query: 'updated' }))).toEqual(['beta']); expect(ids(queryContext(first, { query: 'updated' }))).toEqual([]);
  });
  it('manual_edit_invalidates_cached_index', () => {
    const first = buildIndex(snapshot([feature('alpha', 'old')]));
    const next = refreshIndex(first, snapshot([feature('alpha', 'new')], 'b'.repeat(64)));
    expect(ids(queryContext(next, { query: 'old' }))).toEqual([]); expect(ids(queryContext(next, { paths: ['src/alpha.ts'] }))).toEqual(['alpha']);
  });
  it('indexes evidence references and removes deleted features', () => {
    const alpha = feature('alpha'); alpha.hypotheses = [{ text: 'maybe', evidence: [{ path: 'tests/alpha.ts' }] }];
    const first = buildIndex(snapshot([alpha, feature('beta')])); expect(ids(queryContext(first, { paths: ['tests/alpha.ts'] }))).toEqual(['alpha']);
    const next = refreshIndex(first, snapshot([feature('beta')], 'b'.repeat(64)));
    expect(ids(queryContext(next, { paths: ['tests/alpha.ts'] }))).toEqual([]);
  });
});
