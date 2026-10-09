import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../src/query/index.js';
import { queryContext } from '../../src/query/search.js';
import { queryImpact } from '../../src/query/impact.js';
import type { FragmentItem, ImpactRequest } from '../../src/query/pagination.js';
import type { Feature } from '../../src/model/types.js';
import type { Snapshot } from '../../src/storage/repository.js';
const feature = (id: string, summary = id): Feature => ({ schema: 1, id, summary, key_points: [], code: [{ path: `src/${id}.ts` }], evidence: [], relations: [], hypotheses: [] });
const snapshot = (features: Feature[], revision = 'a'.repeat(64)): Snapshot => ({ features, revision, integrity: 'valid', diagnostics: [], fingerprints: Object.fromEntries([['network-spec/_meta.yaml', 'm'], ...features.map(f => [`network-spec/${f.id}.yaml`, JSON.stringify(f)])]) });
describe('bounded pagination', () => {
  it('oversized_feature_has_visible_continuation', () => {
    const source = feature('huge', 'Long feature'); source.key_points = ['🦄'.repeat(3000), 'last point']; source.evidence = [{ path: 'tests/huge.ts' }];
    const index = buildIndex(snapshot([source])); let result = queryContext(index, { ids: ['huge'], detail: 'full', budget: 512 }); let text = ''; let pages = 0;
    do {
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(512); expect(result.items).toHaveLength(1);
      const item = result.items[0] as FragmentItem; expect(item.fragment.offset).toBe(text.length); text += item.fragment.text; pages++;
      if (!result.nextCursor) break;
      expect(result.truncated).toBe(true); result = queryContext(index, { cursor: result.nextCursor });
    } while (pages < 1000);
    expect(pages).toBeGreaterThan(1); expect(pages).toBeLessThan(1000); expect(JSON.parse(text)).toEqual(source); expect(result.truncated).toBe(false);
  });
  it('returns complete readable sections for a large multi-section feature', () => {
    const source = feature('sections', 's'.repeat(350)); source.key_points = ['k'.repeat(350)]; source.code = [{ path: 'src/' + 'a'.repeat(350) + '.ts' }]; source.evidence = [{ path: 'tests/' + 'b'.repeat(350) + '.ts' }];
    const index = buildIndex(snapshot([source])); let result = queryContext(index, { ids: ['sections'], detail: 'full', budget: 1500 }); const reconstructed: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1500);
      for (const item of result.items) { expect('section' in item).toBe(true); if ('section' in item) reconstructed[item.section] = item.value; }
      if (!result.nextCursor) break; result = queryContext(index, { cursor: result.nextCursor });
    }
    expect(reconstructed).toEqual(source);
  });
  it('rejects original queries that cannot fit continuation metadata', () => {
    const index = buildIndex(snapshot([feature('alpha', 'a'.repeat(1000))]));
    expect(() => queryContext(index, { query: 'a'.repeat(1000), budget: 512 })).toThrowError(expect.objectContaining({ code: 'invalid_query' }));
  });
  it('changed_revision_rejects_cursor', () => {
    const first = buildIndex(snapshot(Array.from({ length: 12 }, (_, i) => feature(`item-${i}`)))); const page = queryContext(first, {});
    expect(() => queryContext(buildIndex(snapshot([feature('other')], 'b'.repeat(64))), { cursor: page.nextCursor! })).toThrowError(expect.objectContaining({ code: 'stale_cursor' }));
  });
  it('rejects altered cursor query and malformed offsets', () => {
    const index = buildIndex(snapshot(Array.from({ length: 12 }, (_, i) => feature(`item-${i}`, 'common')))); const page = queryContext(index, { query: 'common', limit: 1 });
    expect(() => queryContext(index, { query: 'other', cursor: page.nextCursor! })).toThrowError(expect.objectContaining({ code: 'invalid_cursor' }));
    expect(() => queryContext(index, { cursor: { ...page.nextCursor!, offset: -1 } })).toThrowError(expect.objectContaining({ code: 'invalid_cursor' }));
    expect(() => queryImpact(index, { cursor: page.nextCursor! })).toThrowError(expect.objectContaining({ code: 'invalid_cursor' }));
  });
  it.each([{ budget: 511 }, { budget: 64001 }, { budget: NaN }, { limit: 0 }, { limit: 101 }, { depth: -1 }, { depth: 9 }, { depth: 1.2 }, { direction: 'wrong' }])('validates request %j', request => {
    expect(() => queryImpact(buildIndex(snapshot([feature('alpha')])), request as ImpactRequest)).toThrowError(expect.objectContaining({ code: 'invalid_query' }));
  });
  it('rejects invalid cursor positions and unknown request fields', () => {
    const index = buildIndex(snapshot([feature('alpha'), feature('beta')])); const page = queryContext(index, { limit: 1 });
    expect(() => queryContext(index, { cursor: { ...page.nextCursor!, offset: 3 } })).toThrowError(expect.objectContaining({ code: 'invalid_cursor' }));
    expect(() => queryContext(index, { cursor: { ...page.nextCursor!, fragment: 99999 } })).toThrowError(expect.objectContaining({ code: 'invalid_cursor' }));
    expect(() => queryContext(index, { unknown: 'field' } as never)).toThrowError(expect.objectContaining({ code: 'invalid_query' }));
    expect(() => queryContext(index, { cursor: { ...page.nextCursor!, parameters: { depth: 3 } } })).toThrowError(expect.objectContaining({ code: 'invalid_cursor' }));
  });
  it('bounds metadata and reports diagnostic omissions', () => {
    const source = snapshot([]); source.integrity = 'invalid'; source.diagnostics = Array.from({ length: 30 }, () => ({ code: 'bad', severity: 'error' as const, message: 'x'.repeat(10000), path: 'network-spec/bad.yaml' }));
    const result = queryContext(buildIndex(source), { budget: 512 }); expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(512); expect(result.incomplete).toBe(true); expect(result.diagnosticsOmitted).toBe(30);
  });
  it('bounds long impact paths and continues without losing evidence', () => {
    const a = feature('alpha'); const b = feature('beta'); a.relations = [{ to: 'beta', type: 'reads', status: 'evidenced', evidence: [{ path: 'src/a.ts' }], check: '🦄'.repeat(1000) }];
    const index = buildIndex(snapshot([a, b])); let result = queryImpact(index, { ids: ['alpha'], budget: 512 }); const pieces: string[] = [];
    for (let i = 0; i < 300; i++) { expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(512); for (const item of result.items) if ('fragment' in item) pieces.push(item.fragment.text); if (!result.nextCursor) break; result = queryImpact(index, { cursor: result.nextCursor }); }
    expect(JSON.parse(pieces.join('')).path[0].check).toBe('🦄'.repeat(1000)); expect(result.truncated).toBe(false);
  });
});
