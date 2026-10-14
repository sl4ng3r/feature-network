import { expect, test } from 'vitest';
import { minimalFeatureYaml } from '../helpers/fixture.js';
import { feature, idea } from './v2-fixtures.js';
const api = await import('../../src/model/documents.js').catch(() => null);
function parse(text: string, path: string): any {
  expect(api?.parseNetworkDocument).toBeTypeOf('function');
  return api!.parseNetworkDocument(text, path as any);
}
test('legacy_feature_parser_remains_compatible', () => expect(parse(minimalFeatureYaml,'network-spec/backup.yaml')).toMatchObject({schema:1,id:'backup'}));
test('document_paths_are_closed_to_known_shapes', () => {
  for (const path of ['network-spec/nested/roles.yaml','network-spec/knowledge/nested/roles.yaml','network-spec/knowledge/../roles.yaml','network-spec/access.yml','network-spec/_other.yaml','elsewhere/access.yaml']) {
    expect(() => parse(JSON.stringify(idea),path)).toThrow();
  }
});
test('filename_must_match_the_document_id', () => expect(() => parse(JSON.stringify(feature),'network-spec/other.yaml')).toThrow());
test.each(['schema: 3','schema: 2\nschema: 2','schema: 2\nfoo: &a hi','schema: 2\nfoo: *a','schema: 2\nfoo: !!str hi'])('unsafe_yaml_is_rejected_%s', text => expect(() => parse(text,'network-spec/_meta.yaml')).toThrow());
test('utf8_document_limit_is_bytes_including_non_ascii', () => {
  const valid = JSON.stringify(idea); const exact = valid + ' '.repeat(65536 - Buffer.byteLength(valid));
  expect(parse(exact,'network-spec/knowledge/roles.yaml').id).toBe('roles');
  expect(() => parse(exact + 'é','network-spec/knowledge/roles.yaml')).toThrow();
});
test('knowledge_path_is_derived_without_traversal', () => {
  expect(api?.documentPath).toBeTypeOf('function');
  expect(api!.documentPath(parse(JSON.stringify(idea),'network-spec/knowledge/roles.yaml'))).toBe('network-spec/knowledge/roles.yaml');
  expect(() => api!.documentPath({...feature,id:'../secret'} as any)).toThrow();
});
