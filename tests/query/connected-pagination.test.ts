import { afterEach,expect,test } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectedFixture,testFeature } from '../helpers/connected.js';
import { cleanup } from '../project/helpers.js';
const api=await import('../../src/query/connected.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
test('large_unicode_documents_continue_without_splitting_or_silent_loss',async()=>{
 expect(api?.readConnectedContext).toBeTypeOf('function');const f=await connectedFixture(roots,{projects:1});const feature={...testFeature(),summary:'🙂'.repeat(2500)};await writeFile(join(f.active.root,'network-spec/access.yaml'),JSON.stringify(feature));
 let result=await api!.readConnectedContext(f.binding,{ids:['access'],detail:'full',budget:3500},{});let text='';let offset=0;let pages=0;
 for(;;){expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(3500);for(const row of result.items){if(!('fragment' in row))throw new Error('Expected a complete JSON fragment');expect(row.fragment.offset).toBe(offset);text+=row.fragment!.text;offset+=row.fragment!.text.length;}if(!result.nextCursor)break;result=await api!.readConnectedContext(f.binding,{cursor:result.nextCursor},{});expect(++pages).toBeLessThan(100);}
 expect(JSON.parse(text).document.summary).toBe(feature.summary);
});
test('cursor_rejects_changed_network_in_any_considered_project',async()=>{
 expect(api?.readConnectedContext).toBeTypeOf('function');const f=await connectedFixture(roots);const result=await api!.readConnectedContext(f.binding,{scope:'connected',limit:1},{});expect(result.nextCursor).toBeDefined();
 await writeFile(join(f.projects[2]!.root,'network-spec/access.yaml'),JSON.stringify({...testFeature(),summary:'Changed elsewhere'}));
 await expect(api!.readConnectedContext(f.binding,{cursor:result.nextCursor!},{})).rejects.toMatchObject({code:'stale_cursor'});
});
test('tiny_budget_and_changed_cursor_parameters_are_rejected_without_writes',async()=>{
 expect(api?.readConnectedContext).toBeTypeOf('function');const f=await connectedFixture(roots);await expect(api!.readConnectedContext(f.binding,{scope:'connected',limit:1,budget:512},{})).rejects.toMatchObject({code:'invalid_query'});
 const result=await api!.readConnectedContext(f.binding,{scope:'connected',limit:1},{});await expect(api!.readConnectedContext(f.binding,{cursor:result.nextCursor!,query:'override'},{})).rejects.toMatchObject({code:'invalid_cursor'});
});
