import { describe, afterEach, expect, test, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import * as schema from '../../src/model/schema.js';
import * as indexes from '../../src/query/index.js';
import { checkNetwork } from '../../src/freshness/check.js';
import { startTurn } from '../../src/freshness/session.js';
import { fixture } from '../freshness/fixture.js';
import { cleanup } from '../project/helpers.js';

const roots:string[]=[];
const clients:Client[]=[];
const servers:Array<{close():Promise<void>}>=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(clients.splice(0).map(client=>client.close()));await Promise.all(servers.splice(0).map(server=>server.close()));await Promise.all(roots.splice(0).map(cleanup));});
async function connect(p:Awaited<ReturnType<typeof fixture>>,signal:AbortSignal){
 const a:any={start:async()=>{},close:async()=>{},send:async(message:any)=>queueMicrotask(()=>b.onmessage?.(message))};
 const b:any={start:async()=>{},close:async()=>{},send:async(message:any)=>queueMicrotask(()=>a.onmessage?.(message))};
 const {createServer}=await import('../../src/mcp/server.js');const server=createServer(p);servers.push(server);await server.connect(a);const client=new Client({name:'cache-test',version:'1'});clients.push(client);await client.connect(b,{signal,timeout:15000});return client;
}
// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('real_MCP_reuses_parsing_and_index_entries_then_refreshes_same_length_manual_edit',async({signal})=>{
 const p=await fixture(roots);const client=await connect(p,signal);const parse=vi.spyOn(schema,'parseFeature');const refresh=vi.spyOn(indexes,'refreshIndex');
 const call=()=>client.callTool({name:'network_context',arguments:{ids:['alpha']}},{signal});
 await call();const count=parse.mock.calls.length;await call();expect(parse.mock.calls.length).toBe(count);
 expect(refresh).toHaveBeenCalled();
 const firstIndex=refresh.mock.calls.at(-1)![0];expect(refresh.mock.results.at(-1)!.value.entries.get('alpha')).toBe(firstIndex.entries.get('alpha'));
 const path=join(p.networkDir,'alpha.yaml');const text=await readFile(path,'utf8');await writeFile(path,text.replace('summary: Source','summary: Edited'));await utimes(path,new Date(0),new Date(0));
 const changed:any=(await call()).structuredContent;expect(changed.items[0].summary).toBe('Edited');expect(parse.mock.calls.length).toBe(count+1);
 await writeFile(path,'schema: [bad');expect(((await call()).structuredContent as any)?.integrity).toBe('invalid');
 await writeFile(join(p.runtimeDir,'journal.json'),'pending');expect(((await call()).structuredContent as any)?.error).toMatchObject({code:'pending_recovery'});
 await client.close();
});
test('hook_consumers_reuse_parsing_and_authorized_bookkeeping_populates_disposable_cache',async()=>{
 const p=await fixture(roots);const parse=vi.spyOn(schema,'parseFeature');
 await checkNetwork(p,'summary');const count=parse.mock.calls.length;await checkNetwork(p,'summary');expect(parse.mock.calls.length).toBe(count);
 await startTurn(p,'cached-hook',{allowRecovery:false});
 const path=join(p.runtimeDir,'read-cache.json');const cache=JSON.parse(await readFile(path,'utf8'));expect(cache.version).toBe(1);
 await writeFile(path,'corrupt');const before=await readFile(path);expect((await checkNetwork(p,'summary')).integrity).toBe('valid');expect(await readFile(path)).toEqual(before);
 await rm(path);expect((await checkNetwork(p,'summary')).integrity).toBe('valid');await expect(readFile(path)).rejects.toMatchObject({code:'ENOENT'});
});

test('fresh_hook_module_reads_valid_disposable_cache_and_rebuilds_corruption_without_writes',async()=>{
 const p=await fixture(roots);const path=join(p.runtimeDir,'read-cache.json');
 const initial=await readFile(path,'utf8');
 vi.resetModules();const freshSchema=await import('../../src/model/schema.js');const parse=vi.spyOn(freshSchema,'parseFeature');
 const freshCheck=await import('../../src/freshness/check.js');
 expect((await freshCheck.checkNetwork(p,'summary')).integrity).toBe('valid');expect(parse).not.toHaveBeenCalled();
 expect(await readFile(path,'utf8')).toBe(initial);
 await writeFile(path,initial.replace('"Source"','"Poison"')); // Checksum now invalid despite valid JSON/schema.
 vi.resetModules();const corruptSchema=await import('../../src/model/schema.js');const rebuilt=vi.spyOn(corruptSchema,'parseFeature');
 const rebuiltCheck=await import('../../src/freshness/check.js');
 expect((await rebuiltCheck.checkNetwork(p,'summary')).integrity).toBe('valid');expect(rebuilt).toHaveBeenCalledTimes(1);
 expect(await readFile(path,'utf8')).toContain('Poison');
});
test('cache_bindings_do_not_cross_project_exclusions_or_mask_source_changes',async()=>{
 const p=await fixture(roots); const other=await fixture(roots);
 const first=await checkNetwork(p,'full');expect(first.references[0]!.state).toBe('current');
 await writeFile(join(p.root,'source.ts'),'edited');
 expect((await checkNetwork(p,'full')).references[0]!.state).toBe('changed');
 expect((await checkNetwork(other,'full')).references[0]!.state).toBe('current');
 expect((await checkNetwork(other,'full',undefined,{excludedReferenceRoots:[other.root]})).integrity).toBe('invalid');
});

test('scoped_queries_keep_shared_reference_review_and_open_missing_decisions',async({signal})=>{
 const p=await fixture(roots);const {applyUpdate,readSnapshot}=await import('../../src/storage/repository.js');
 const {confirmReferences}=await import('../../src/freshness/references.js');
 const snap=await readSnapshot(p);const alpha=snap.features[0]!;
 const update=await applyUpdate(p,{expected:{'network-spec/beta.yaml':null},upserts:[{...alpha,id:'beta'}],deletes:[],verifiedReferences:[{path:'source.ts',hash:(await import('../freshness/fixture.js')).hash('source')}]});
 await confirmReferences(p,[{path:'source.ts',hash:(await import('../freshness/fixture.js')).hash('source')}],{networkRevision:update.revision,outcome:'no_semantic_change',reason:'Reviewed both associations'});
 const client=await connect(p,signal);const refs=await import('../../src/freshness/references.js');const inspect=vi.spyOn(refs,'inspectReference');
 const current:any=(await client.callTool({name:'network_context',arguments:{ids:['alpha'],limit:1}},{signal})).structuredContent;
 expect(current.freshness).toEqual({alpha:{state:'current',review:'recorded'}});expect(inspect).toHaveBeenCalledTimes(1);
 await rm(join(p.runtimeDir,'values/freshness/decisions.json'));
 const missing:any=(await client.callTool({name:'network_impact',arguments:{ids:['alpha']}},{signal})).structuredContent;
 expect(missing.freshness.alpha).toEqual({state:'current',review:'open'});
 await client.close();
});

});
