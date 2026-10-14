import { expect, test } from 'vitest';
import { feature, idea, marker, projectB } from './v2-fixtures.js';
const api = await import('../../src/model/documents.js').catch(() => null);
function parse(value: unknown, path: `network-spec/${string}.yaml` = 'network-spec/knowledge/roles.yaml'): any {
  expect(api?.parseNetworkDocument, 'versioned document parser').toBeTypeOf('function');
  return api!.parseNetworkDocument(JSON.stringify(value), path);
}
test('conversation_idea_without_code_is_not_a_fake_feature', () => {
  expect(parse(idea)).toMatchObject({kind: 'knowledge', features: [], statements: [{type: 'idea', evidence: [], contradicts: [], supersedes: []}]});
});
test('schema_two_marker_keeps_persistent_uuid', () => expect(parse(marker, 'network-spec/_meta.yaml')).toMatchObject(marker));
test('external_dependency_preserves_direction_and_evidence', () => {
  const result = parse({...feature, relations: [{to: {project: projectB, feature: 'contract'}, type: 'depends_on', status: 'evidenced', evidence: [{path:'src/access.ts'}]}]}, 'network-spec/access.yaml');
  expect(result.relations[0]).toMatchObject({to:{project:projectB, feature:'contract'},type:'depends_on'});
});
test.each(['idea', 'requirement'])('user_statement_can_record_%s', type => {
  expect(parse({...idea, statements:[{...idea.statements[0], type}]}).statements[0].type).toBe(type);
});
test('requirement_needs_user_statement', () => {
  expect(() => parse({...idea, statements:[{...idea.statements[0], type:'requirement', origin:{...idea.statements[0]!.origin, kind:'agent_inference'}}]})).toThrow();
});
test('inference_stays_unconfirmed', () => {
  const value = parse({...idea, statements:[{...idea.statements[0],type:'observation',origin:{...idea.statements[0]!.origin,kind:'agent_inference'}}]});
  expect(value.statements[0].origin.kind).toBe('agent_inference');
});
test('source_review_requires_a_real_reference', () => {
  expect(() => parse({...idea,statements:[{...idea.statements[0],type:'observation',origin:{...idea.statements[0]!.origin,kind:'source_review'}}]})).toThrow();
  expect(parse({...idea,statements:[{...idea.statements[0],type:'observation',origin:{...idea.statements[0]!.origin,kind:'source_review'},evidence:[{project:projectB,path:'src/roles.ts'}]}]}).statements[0].evidence).toEqual([{project:projectB,path:'src/roles.ts'}]);
});
test.each(['2026-02-30','2026-13-01','2026-1-01','2026-10-14T12:00:00Z'])('invalid_calendar_date_%s_is_rejected', recorded_on => {
  expect(() => parse({...idea,statements:[{...idea.statements[0],origin:{...idea.statements[0]!.origin,recorded_on}}]})).toThrow();
});
test('duplicate_statement_ids_are_rejected', () => expect(() => parse({...idea,statements:[idea.statements[0],idea.statements[0]]})).toThrow());
test.each([
  {...marker, project:{id:'../other',name:'x'}},
  {...marker, project:{...marker.project,id:marker.project.id.toUpperCase()}},
  {...marker, surprise:true},
])('invalid_marker_is_rejected', value => expect(() => parse(value,'network-spec/_meta.yaml')).toThrow());
test('features_still_need_existing_source_references_in_structure', () => expect(() => parse({...feature,code:[]},'network-spec/access.yaml')).toThrow());
test('evidenced_relation_cannot_use_a_conversation_as_source', () => expect(() => parse({...feature,relations:[{to:'access',type:'reads',status:'evidenced',knowledge:[{project:projectB,knowledge:'roles',statement:'shared'}]}]},'network-spec/access.yaml')).toThrow());
