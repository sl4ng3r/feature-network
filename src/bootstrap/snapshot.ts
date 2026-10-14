import {projectSchema} from '../project/schema-version.js';
import type {Project} from '../project/root.js';
import {readSnapshot,type Snapshot,type StorageOptions} from '../storage/repository.js';
import {readProjectSnapshot} from '../storage/documents.js';
import type {Feature} from '../model/types.js';
/** Local inventory view only: original full revision/fingerprints remain authoritative.
 * Qualified foreign sources/edges cannot become local code slices. Never persist this view. */
export async function readBootstrapSnapshot(project:Project,options:StorageOptions):Promise<Snapshot>{
 let schema:1|2|null;try{schema=await projectSchema(project);}catch{return readSnapshot(project,options);}
 if(schema!==2)return readSnapshot(project,options);
 const snapshot=await readProjectSnapshot(project,{...options,sourceMode:'all'});const own=snapshot.meta?.schema===2?snapshot.meta.project.id:null;
 const local=(refs:{path:string;symbol?:string|undefined;project?:string|undefined}[])=>refs.filter(r=>r.project===undefined||r.project===own).map(({project:_,...r})=>r);
 const features:Feature[]=snapshot.features.map(f=>({schema:1,id:f.id,summary:f.summary,key_points:f.key_points,code:local(f.code),evidence:local(f.evidence),hypotheses:f.hypotheses.map(h=>({...h,evidence:local(h.evidence)})),relations:f.relations.filter(r=>typeof r.to==='string'||r.to.project===own).map(r=>({to:typeof r.to==='string'?r.to:r.to.feature,type:r.type,status:r.status,evidence:local(r.evidence),...(r.when?{when:r.when}:{}),...(r.check?{check:r.check}:{})}))}));
 return {revision:snapshot.revision,fingerprints:snapshot.fingerprints,features,diagnostics:snapshot.diagnostics,integrity:snapshot.integrity};
}
