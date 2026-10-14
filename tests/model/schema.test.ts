import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { parseFeature, parseMeta } from '../../src/model/schema.js';
import { minimalFeatureYaml, validBackupYaml } from '../helpers/fixture.js';

function invalidFeature(text: string, filename = 'backup.yaml') {
  expect(() => parseFeature(text, filename)).toThrowError(
    expect.objectContaining({ code: 'invalid_schema', paths: [filename] }),
  );
}

// Each assertion protects a consumer-facing acceptance, rejection or normalization
// contract. Fixtures and expected values are hand-written, with no parser mocks.
describe('Feature YAML contract', () => {
  it('valid_backup_roundtrip', () => {
    const feature = parseFeature(validBackupYaml, 'backup.yaml');
    expect(feature).toMatchObject({
      schema: 1, id: 'backup', summary: 'Saves a local demo profile for restoration.',
      key_points: ['Includes persistent profile fields.', 'Excludes temporary session state.'],
      code: [{ path: 'src/backup.ts', symbol: 'createBackup' }],
      evidence: [{ path: 'tests/backup.test.ts' }],
      relations: [{ to: 'user-profile', type: 'reads', status: 'evidenced',
        evidence: [{ path: 'src/backup.ts' }], when: 'Persistent fields change.',
        check: 'Verify a backup and restore roundtrip.' }],
      hypotheses: [{ text: 'Export may require a size limit.', evidence: [] }],
    });
    expect(parseFeature(stringify(feature), 'backup.yaml')).toEqual(feature);
  });

  it.each([
    ['unknown version', minimalFeatureYaml.replace('schema: 1', 'schema: 2')],
    ['unknown root field', minimalFeatureYaml + 'extra: true\n'],
    ['unknown reference field', minimalFeatureYaml.replace('path: docs/backup.md', 'path: docs/backup.md\n    line: 7')],
    ['unknown relation field', validBackupYaml.replace('type: reads', 'type: reads\n    extra: true')],
    ['unknown hypothesis field', validBackupYaml + '    extra: true\n'],
  ])('rejects_unknown_schema_and_fields: %s', (_name, yaml) => invalidFeature(yaml));

  it('rejects_id_filename_mismatch', () => invalidFeature(minimalFeatureYaml, 'restore.yaml'));
  it.each(['_meta.yaml', 'backup.yml', 'Backup.yaml'])('rejects incompatible filename %s', filename => invalidFeature(minimalFeatureYaml, filename));

  it.each([
    ['duplicate root key', minimalFeatureYaml + 'id: backup\n'],
    ['duplicate nested key', minimalFeatureYaml.replace('path: docs/backup.md', 'path: docs/backup.md\n    path: docs/other.md')],
    ['custom executable tag', minimalFeatureYaml.replace('summary: Saves a local demo profile.', 'summary: !exec dangerous')],
    ['explicit standard tag', minimalFeatureYaml.replace('summary: Saves a local demo profile.', 'summary: !!str example')],
    ['alias', minimalFeatureYaml.replace('key_points: []', 'key_points: &points []') + 'evidence: *points\n'],
    ['recursive alias', minimalFeatureYaml.replace('key_points: []', 'key_points: &points [*points]')],
    ['anchor', minimalFeatureYaml.replace('key_points: []', 'key_points: &points []')],
  ])('rejects_duplicate_yaml_keys_tags_aliases: %s', (_name, yaml) => invalidFeature(yaml));

  it.each([
    ['sequence key', '? [PRIVATE_TEST_SENTINEL]\n: ignored\n'],
    ['mapping key', '? {secret: PRIVATE_TEST_SENTINEL}\n: ignored\n'],
    ['numeric key', '42: ignored\n'],
    ['boolean key', 'true: ignored\n'],
    ['null key', 'null: ignored\n'],
    ['nested collection key', 'evidence:\n  - ? [PRIVATE_TEST_SENTINEL]\n    : ignored\n'],
  ])('rejects non-string mapping keys without leaking input: %s', (_name, extra) => {
    // Exercise the real parser in a process with real console/stderr. Waiting for
    // process exit also captures Node's deferred emitWarning output.
    const parserUrl = new URL('../../src/model/schema.ts', import.meta.url).href;
    const script = `
      import { registerHooks } from 'node:module';
      import { readFileSync } from 'node:fs';
      // Node24 strips TS; this test-only resolver maps source .js imports to TS.
      registerHooks({ resolve(specifier, context, next) {
        try { return next(specifier, context); }
        catch (error) {
          if (error.code === 'ERR_MODULE_NOT_FOUND' && (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
            return next(specifier.slice(0, -3) + '.ts', context);
          }
          throw error;
        }
      } });
      const { parseFeature } = await import(${JSON.stringify(parserUrl)});
      try { parseFeature(readFileSync(0, 'utf8'), 'backup.yaml'); }
      catch (error) { process.stdout.write(JSON.stringify({ code: error.code, paths: error.paths, message: error.message })); }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', input: minimalFeatureYaml + extra,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ code: 'invalid_schema', paths: ['backup.yaml'] });
    expect(result.stdout).not.toContain('PRIVATE_TEST_SENTINEL');
  });

  it('rejects_over_65536_utf8_bytes', () => {
    const base = minimalFeatureYaml + '#';
    const exactLimit = base + 'a'.repeat(65536 - Buffer.byteLength(base));
    expect(parseFeature(exactLimit, 'backup.yaml')).toMatchObject({ id: 'backup' });
    invalidFeature(exactLimit + 'a');
    // Character count below the limit still exceeds the UTF-8 byte limit.
    invalidFeature(base + 'ä'.repeat(32768));
  });

  it('allows_empty_key_points', () => {
    expect(parseFeature(minimalFeatureYaml, 'backup.yaml')).toMatchObject({
      key_points: [], evidence: [], relations: [], hypotheses: [],
    });
  });

  it('requires_evidence_for_evidenced_relation', () => {
    invalidFeature(minimalFeatureYaml + 'relations:\n  - to: user-profile\n    type: reads\n    status: evidenced\n');
    invalidFeature(minimalFeatureYaml + 'relations:\n  - to: user-profile\n    type: reads\n    status: evidenced\n    evidence: []\n');
  });

  it('allows an explicitly unconfirmed relation without evidence', () => {
    expect(parseFeature(minimalFeatureYaml + 'relations:\n  - to: user-profile\n    type: depends_on\n    status: hypothesis\n', 'backup.yaml')).toMatchObject({
      relations: [{ to: 'user-profile', type: 'depends_on', status: 'hypothesis', evidence: [] }],
    });
  });

  it.each([
    ['missing required field', minimalFeatureYaml.replace('key_points: []\n', '')],
    ['empty references', minimalFeatureYaml.replace('code:\n  - path: docs/backup.md', 'code: []')],
    ['empty summary', minimalFeatureYaml.replace('summary: Saves a local demo profile.', 'summary: " "')],
    ['invalid id', minimalFeatureYaml.replace('id: backup', 'id: backup--item')],
    ['wrong scalar type', minimalFeatureYaml.replace('summary: Saves a local demo profile.', 'summary: 42')],
    ['empty symbol', minimalFeatureYaml.replace('path: docs/backup.md', 'path: docs/backup.md\n    symbol: ""')],
    ['absolute path', minimalFeatureYaml.replace('docs/backup.md', '/private/backup.md')],
    ['parent traversal', minimalFeatureYaml.replace('docs/backup.md', '../backup.md')],
    ['windows absolute path', minimalFeatureYaml.replace('docs/backup.md', 'C:\\private\\backup.md')],
    ['backslash traversal', minimalFeatureYaml.replace('docs/backup.md', '..\\backup.md')],
    ['unknown relation type', validBackupYaml.replace('type: reads', 'type: calls')],
    ['unknown relation status', validBackupYaml.replace('status: evidenced', 'status: verified')],
    ['multiple YAML documents', minimalFeatureYaml + '---\n' + minimalFeatureYaml],
    ['non-object document', '[backup, restore]'],
    ['malformed YAML', 'schema: ['],
    ['merge key', minimalFeatureYaml + '<<: {extra: true}\n'],
    ['prototype key', minimalFeatureYaml + '__proto__: {polluted: true}\n'],
  ])('rejects invalid data: %s', (_name, yaml) => invalidFeature(yaml));
});

describe('Network metadata contract', () => {
  it('keeps declared coverage partial and normalizes area hints', () => {
    expect(parseMeta('schema: 1\ncoverage: partial\n')).toEqual({ schema: 1, coverage: 'partial', areas: [] });
    expect(parseMeta('schema: 1\ncoverage: partial\nareas:\n  - Profile storage\n')).toEqual({
      schema: 1, coverage: 'partial', areas: ['Profile storage'],
    });
  });

  it.each([
    'schema: 2\ncoverage: partial', 'schema: 1\ncoverage: complete',
    'schema: 1\ncoverage: partial\ncompleted: true',
    'schema: 1\ncoverage: partial\nareas: [" "]',
    'schema: 1\ncoverage: partial\ncoverage: partial',
    'schema: 1\ncoverage: !exec partial',
  ])('rejects invalid metadata: %s', text => {
    expect(() => parseMeta(text)).toThrowError(expect.objectContaining({ code: 'invalid_schema', paths: ['_meta.yaml'] }));
  });
});
