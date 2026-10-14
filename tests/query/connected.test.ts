import { afterEach,expect,test } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectedFixture,testFeature,revokeConnectionOnDisk } from '../helpers/connected.js';
import { cleanup } from '../project/helpers.js';
import { createWorkMeter,withWorkMeter } from '../../src/diagnostics/work.js';
import { parseYaml } from '../../src/model/schema.js';
const api=await import('../../src/query/connected.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
function query(){expect(api?.readConnectedContext).toBeTypeOf('function');return api!;}
test('actual_yaml_parser_calls_are_counted_even_outside_snapshot_validation',()=>{const meter=createWorkMeter();withWorkMeter(meter,()=>parseYaml('schema: 1','network-spec/_meta.yaml'));expect(meter.yamlParses).toBe(1);});
test('warm_hint_has_no_yaml_parse_product_source_reads_or_memory_writes',async()=>{
 const a=query(),f=await connectedFixture(roots);await a.readConnectedContext(f.binding,{scope:'connected'},{});
 const meter=createWorkMeter();const result=await a.readConnectedContext(f.binding,{scope:'connected'},{meter});
 expect(result.basis).toBe('last_known');expect(result.sourceValidationScope).toBe('none');expect(result.items).toHaveLength(3);
 expect(meter.yamlParses).toBe(0);expect(meter.sourceReadOps).toBe(0);expect(meter.knowledgeWrites).toBe(0);
});
test('fresh_impact_discovers_new_incoming_relation_after_saved_hint',async()=>{
 const a=query(),f=await connectedFixture(roots);await a.readConnectedContext(f.binding,{scope:'connected'},{});
 const consumer=testFeature();consumer.relations=[{to:{project:f.active.id,feature:'access'},type:'depends_on',status:'evidenced',evidence:[{path:'src/source.ts'}],knowledge:[]}];
 await writeFile(join(f.projects[1]!.root,'network-spec/access.yaml'),JSON.stringify(consumer));
 const result=await a.readConnectedImpact(f.binding,{features:[{project:f.active.id,feature:'access'}],direction:'incoming',freshness:'last_known'},{});
 expect(result.basis).toBe('fresh_snapshots');expect(result.items).toContainEqual(expect.objectContaining({project:f.projects[1]!.id,path:[expect.objectContaining({direction:'incoming'})]}));
 expect(result.projectsExamined).toHaveLength(3);
});
test('project_budget_is_honest_and_requires_explicit_enlargement',async()=>{
 const a=query(),f=await connectedFixture(roots,{projects:16});const limited=await a.readConnectedContext(f.binding,{scope:'connected'},{});
 expect(limited.projectsExamined).toHaveLength(8);expect(limited.projectsUnexamined).toHaveLength(8);expect(limited.incomplete).toBe(true);
 const larger=await a.readConnectedContext(f.binding,{scope:'connected',maxProjects:16},{});expect(larger.projectsExamined).toHaveLength(16);expect(larger.projectsUnexamined).toEqual([]);
 await expect(a.readConnectedContext(f.binding,{scope:'connected',maxProjects:33},{})).rejects.toMatchObject({code:'invalid_query'});
});
test('revoked_binding_does_not_reuse_warm_foreign_memory',async()=>{
 const a=query(),f=await connectedFixture(roots);await a.readConnectedContext(f.binding,{scope:'connected'},{});await revokeConnectionOnDisk(f.active,f.projects[1]!.id);
 await expect(a.readConnectedContext(f.binding,{scope:'connected'},{})).rejects.toMatchObject({code:'connection_changed'});
});
test('requesting_current_source_checks_without_provider_is_not_a_clean_result',async()=>{
 const a=query(),f=await connectedFixture(roots,{projects:1});await expect(a.readConnectedImpact(f.binding,{ids:['access']},{})).rejects.toMatchObject({code:'freshness_unavailable'});
});
test('impact_without_direct_origins_does_not_seed_the_entire_graph',async()=>{
 const a=query(),f=await connectedFixture(roots);await expect(a.readConnectedImpact(f.binding,{freshness:'last_known'},{})).rejects.toMatchObject({code:'invalid_query'});
});
test('source_freshness_cannot_be_attached_to_a_different_network_revision',async()=>{
 const a=query(),f=await connectedFixture(roots,{projects:1});
 await expect(a.readConnectedImpact(f.binding,{ids:['access']},{readFreshness:async()=>{
  await writeFile(join(f.active.root,'network-spec/access.yaml'),JSON.stringify({...testFeature(),summary:'Concurrent network change'}));
  return {};
 }})).rejects.toMatchObject({code:'conflict'});
});
