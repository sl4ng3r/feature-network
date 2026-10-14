import { afterEach,expect,test } from 'vitest';
import { mkdir,writeFile,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanup } from './helpers.js';
import { projectV2 } from '../helpers/connected.js';
const api=await import('../../src/project/connections.js').catch(()=>null);
const sources=await import('../../src/project/source-access.js').catch(()=>null);
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(cleanup));});
test('source_access_enforces_rights_and_canonical_sensitive_exclusions',async()=>{
 expect(api?.readConnections).toBeTypeOf('function');expect(sources?.createSourceReader).toBeTypeOf('function');
 const a=await projectV2(roots,'A'),b=await projectV2(roots,'B');
 await api!.applyConnections(await api!.planConnections(a.project,{schema:1,learning:{enabled:true},projects:[{id:b.id,root:b.root,readSources:true,writeMemory:true}]}));
 const reader=sources!.createSourceReader(await api!.readConnections(a.project),{});
 expect(await reader({project:b.id,path:'src/source.ts'})).toMatchObject({project:b.id,path:'src/source.ts',hash:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect(await reader({project:b.id,path:'src/missing.ts'})).toEqual({project:b.id,path:'src/missing.ts',state:'missing'});
 await writeFile(join(b.root,'.env'),'SECRET=synthetic');await symlink('../.env',join(b.root,'src/alias.ts'));
 for(const path of ['../escape','.env','src/alias.ts','network-spec/_meta.yaml','.git/config'])await expect(reader({project:b.id,path})).rejects.toThrow();
 await symlink('missing-target.ts',join(b.root,'src/dangling.ts'));
 await expect(reader({project:b.id,path:'src/dangling.ts'})).rejects.toThrow();
});
test('metadata_permission_does_not_imply_source_permission',async()=>{
 expect(api?.readConnections).toBeTypeOf('function');expect(sources?.createSourceReader).toBeTypeOf('function');
 const a=await projectV2(roots,'A'),b=await projectV2(roots,'B');
 await api!.applyConnections(await api!.planConnections(a.project,{schema:1,learning:{enabled:false},projects:[{id:b.id,root:b.root,readSources:false,writeMemory:false}]}));
 const binding=await api!.readConnections(a.project);expect((await api!.assertConnection(binding,b.id,'read_memory')).root).toBe(b.root);
 await expect(sources!.createSourceReader(binding,{})({project:b.id,path:'src/source.ts'})).rejects.toMatchObject({code:'permission_denied'});
});
