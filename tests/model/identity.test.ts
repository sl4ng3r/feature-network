import { expect, test } from 'vitest';
import { projectA, projectB } from './v2-fixtures.js';
const api = await import('../../src/model/identity.js').catch(() => null);
test('same_feature_id_in_two_projects_is_unambiguous', () => {
  expect(api?.featureKey).toBeTypeOf('function');
  expect(api!.featureKey({project:projectA, feature:'access'})).toBe(JSON.stringify([projectA,'feature','access']));
  expect(api!.featureKey({project:projectB, feature:'access'})).not.toBe(api!.featureKey({project:projectA, feature:'access'}));
});
