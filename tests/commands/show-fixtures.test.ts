import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../src/query/index.js';
import { queryContext } from '../../src/query/search.js';
import type { Feature } from '../../src/model/types.js';
import type { Snapshot } from '../../src/storage/repository.js';
import type { ContextRequest } from '../../src/query/pagination.js';
import { contextSchema } from '../../src/mcp/tools.js';
import { classifyCommand, commandPolicy } from '../../src/commands/policy.js';

interface ScriptedCase { user: string; request: ContextRequest; ids: string[]; omitted: number; shape: 'overview' | 'choices' | 'detail' | 'theme' | 'gap'; gap?: string }
interface ScriptedFixture { provenance: string; features: { id: string; summary: string }[]; cases: ScriptedCase[] }

describe('scripted show transcripts (not model or host acceptance)', () => {
  it('display_cases_use_real_bounded_queries_and_read_policy', async () => {
    let fixture: ScriptedFixture;
    try { fixture = JSON.parse(await readFile(new URL('./fixtures/show-transcripts.json', import.meta.url), 'utf8')); }
    catch { expect.fail('scripted display contract fixture is missing'); }
    expect(fixture.provenance).toBe('hand-authored synthetic transcripts; no actual model or host execution');
    const features: Feature[] = fixture.features.map(f => ({ schema: 1, ...f, key_points: [], code: [{ path: `src/${f.id}.ts` }], evidence: [], relations: [], hypotheses: [] }));
    const snapshot: Snapshot = { features, revision: 'a'.repeat(64), integrity: 'valid', diagnostics: [], fingerprints: { "network-spec/_meta.yaml": "b".repeat(64) } };
    const before = JSON.stringify(snapshot); const index = buildIndex(snapshot);
    for (const scenario of fixture.cases) {
      expect(contextSchema.safeParse(scenario.request).success).toBe(true);
      expect(commandPolicy(classifyCommand(scenario.user))).toEqual({ analyzeCode: false, updateFeatures: false, continueForMaintenance: false });
      const response = queryContext(index, scenario.request);
      expect(response.items.map(item => item.id)).toEqual(scenario.ids);
      expect(response.omitted).toBe(scenario.omitted);
      if (scenario.shape === 'overview') { expect(response.items).toHaveLength(10); expect(response.nextCursor).toBeDefined(); }
      if (scenario.shape === 'choices') { expect(response.items).toHaveLength(5); expect(response.nextCursor).toBeDefined(); }
      if (scenario.shape === 'gap') { expect(response.items).toHaveLength(0); expect(scenario.gap).toBe('No grounded memory entry; describe differently or explicitly request init/sync.'); }
      expect(response.coverage).toBe('partial');
    }
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
