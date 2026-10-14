import { assertConnection,type ConnectionBinding } from './connections.js';
import type { StorageOptions } from '../storage/repository.js';
import { readLocalSource,type SourceReader } from '../storage/documents.js';
import { assertMissingReference } from '../storage/sources.js';
import { isMissing } from '../storage/lock.js';
import { withWorkMeter,type WorkMeter } from '../diagnostics/work.js';
const readerBindings=new WeakMap<SourceReader,ConnectionBinding>();
export function createSourceReader(binding:ConnectionBinding,options:StorageOptions & {meter?:WorkMeter}):SourceReader{
 const reader:SourceReader=async ref=>withWorkMeter(options.meter,async()=>{
  const project=await assertConnection(binding,ref.project,'read_source');
  try{return {project:ref.project,path:ref.path,hash:await readLocalSource(project,ref.path,options)};}
  catch(error){if(!isMissing(error))throw error;await assertMissingReference(project,ref.path,options);return {project:ref.project,path:ref.path,state:'missing'};}
 });
 readerBindings.set(reader,binding);return reader;
}
/** Select a policy-enforcing reader even for sources local to a foreign write
 * target. A custom trusted IO seam never substitutes for connection rights. */
export function bindSourceAccess(binding:ConnectionBinding,options:import('../storage/documents.js').DocumentStorageOptions):import('../storage/documents.js').DocumentStorageOptions{
 const supplied=options.sourceReader;
 const sourceReader=supplied&&readerBindings.get(supplied)===binding?supplied:supplied?async(ref:Parameters<SourceReader>[0])=>{await assertConnection(binding,ref.project,'read_source');return supplied(ref);}:createSourceReader(binding,options);
 return {...options,sourceReader};
}
