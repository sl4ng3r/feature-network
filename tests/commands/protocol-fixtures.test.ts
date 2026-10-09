import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { contextSchema, impactSchema, updateSchema } from '../../src/mcp/tools.js';

async function transcript(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL('./fixtures/protocol-transcript.json', import.meta.url), 'utf8'));
}
describe('strict request transcript contracts (no model or host acceptance)', () => {
  it('context_continuation_uses_the_actual_strict_input_field', async () => {
    expect(contextSchema.safeParse((await transcript()).contextContinuation).success).toBe(true);
  });
  it('impact_continuation_uses_the_actual_strict_input_field', async () => {
    expect(impactSchema.safeParse((await transcript()).impactContinuation).success).toBe(true);
  });
  it('new_file_expectation_is_a_per_path_mapping', async () => {
    expect(updateSchema.safeParse((await transcript()).newFeatureUpdate).success).toBe(true);
  });
  it('response_cursor_name_is_rejected_as_a_request_property', async () => {
    const cursor = { revision: 'a'.repeat(64), kind: 'context', parameters: {}, offset: 10, fragment: 0 };
    expect(contextSchema.safeParse({ nextCursor: cursor }).success).toBe(false);
    expect(impactSchema.safeParse({ nextCursor: { ...cursor, kind: 'impact' } }).success).toBe(false);
  });
  it('null_is_not_a_replacement_for_the_expected_map', async () => {
    const request = (await transcript()).newFeatureUpdate as Record<string, unknown>;
    expect(updateSchema.safeParse({ ...request, expected: null }).success).toBe(false);
  });
});
