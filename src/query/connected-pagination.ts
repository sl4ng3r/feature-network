import { z } from 'zod';
import { featureRefSchema,projectIdSchema } from '../model/identity.js';
import type { ProjectId,RevisionSet } from '../model/identity.js';
import type { EditableDocument } from '../model/documents.js';
import type { Diagnostic } from '../model/types.js';
import { NetworkError } from '../model/errors.js';
import { parametersSchema,paginate,type QueryState,type QueryResult,type FragmentItem } from './pagination.js';
import type { NetworkIndex } from './index.js';
import type { ConnectedIndex,ConnectedEdge } from './connected-index.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const connectedParametersSchema=parametersSchema.extend({scope:z.enum(['active','connected']).optional(),projects:z.array(projectIdSchema).max(128).optional(),features:z.array(featureRefSchema).max(100).optional(),knowledge:z.array(z.strictObject({project:projectIdSchema,knowledge:z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)})).max(100).optional(),knowledgeTypes:z.array(z.enum(['idea','requirement','observation'])).max(3).optional(),freshness:z.enum(['last_known','returned_features']).optional(),maxProjects:z.number().int().min(1).max(32).optional(),maxVisitedFeatures:z.number().int().min(1).max(10000).optional()});
export type ConnectedParameters=z.infer<typeof connectedParametersSchema>;
export const connectedCursorSchema=z.strictObject({revision:hash,registerRevision:hash,revisions:z.record(projectIdSchema,hash),projects:z.array(projectIdSchema).max(128),kind:z.enum(['context','impact']),parameters:connectedParametersSchema,offset:z.number().int().nonnegative(),fragment:z.number().int().nonnegative()});
export type ConnectedCursor=z.infer<typeof connectedCursorSchema>;
export const connectedContextSchema=connectedParametersSchema.omit({depth:true,direction:true}).extend({cursor:connectedCursorSchema.optional()});
export const connectedImpactSchema=connectedParametersSchema.extend({cursor:connectedCursorSchema.optional()});
export type ConnectedContextRequest=z.input<typeof connectedContextSchema>;
export type ConnectedImpactRequest=z.input<typeof connectedImpactSchema>;
export interface ConnectedRow {id:string;project:ProjectId;localId:string;kind:'feature'|'knowledge';summary:string;document?:EditableDocument;origin?:string;status?:'evidenced'|'hypothesis';path?:(ConnectedEdge & {direction:'incoming'|'outgoing'})[]}
export type ConnectedFreshness=Record<string,{state:'current'|'changed'|'missing'|'unknown';review:'recorded'|'open';resolution:'resolved'|'not_connected'|'unavailable'|'ambiguous'|'missing'}>;
export interface ConnectedResult {
 revision:string;registerRevision:string;revisions:RevisionSet;coverage:'partial';integrity:'valid'|'invalid';incomplete:boolean;
 items:(ConnectedRow|FragmentItem)[];truncated:boolean;omitted:number;nextCursor?:ConnectedCursor;
 diagnostics:Diagnostic[];diagnosticsOmitted?:number;
 projectsExamined:ProjectId[];projectsUnexamined:{project:ProjectId;reason:string}[];
 projects:Record<ProjectId,{name:string;revision:string;fingerprints:Record<string,string>}>;
 basis:'last_known'|'fresh_snapshots';sourceFreshnessBasis:'last_known'|'returned_features';sourceValidationScope:'none'|'returned_features';freshness?:ConnectedFreshness;
 limits:{maxProjects:number;maxVisitedFeatures:number;projectsLimited:boolean;featuresLimited:boolean};unexaminedMatchCount:null|0;
 depth?:number;depthLimited?:boolean;
}
export interface ConnectedFrame extends Omit<ConnectedResult,'items'|'truncated'|'omitted'|'nextCursor'|'diagnostics'|'diagnosticsOmitted'|'freshness'> {selectedProjects:ProjectId[]}
export function connectedState(input:ConnectedContextRequest|ConnectedImpactRequest,kind:'context'|'impact'):{parameters:ConnectedParameters;cursor?:ConnectedCursor}{
 const parsed=(kind==='context'?connectedContextSchema:connectedImpactSchema).safeParse(input);
 if(!parsed.success)throw new NetworkError('cursor'in input?'invalid_cursor':'invalid_query','Invalid connected query');
 const {cursor,...parameters}=parsed.data;
 if(cursor){if(Object.keys(parameters).length||cursor.kind!==kind||kind==='context'&&(cursor.parameters.depth!==undefined||cursor.parameters.direction!==undefined))throw new NetworkError('invalid_cursor','Continue with the original cursor only');return {parameters:cursor.parameters,cursor};}
 return {parameters};
}
const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
/** Share selection and Unicode fragmentation, measuring the exact connected
 * projection for every candidate rather than approximating its outer overhead. */
export function paginateConnected(index:ConnectedIndex,rows:ConnectedRow[],parameters:ConnectedParameters,kind:'context'|'impact',frame:ConnectedFrame,cursor?:ConnectedCursor,freshness?:ConnectedFreshness,responseReserveBytes=0):ConnectedResult{
 const state:QueryState={parameters:{budget:parameters.budget??12000,...(parameters.limit!==undefined?{limit:parameters.limit}:{})},kind,offset:cursor?.offset??0,fragment:cursor?.fragment??0};
 const adapter:NetworkIndex={revision:index.revision,integrity:frame.integrity,diagnostics:index.diagnostics,fingerprints:{},entries:new Map(),tokens:new Map(),paths:new Map(),outgoing:new Map(),incoming:new Map()};
 const overview=kind==='context'&&!parameters.query?.trim()&&!parameters.ids?.length&&!parameters.features?.length&&!parameters.knowledge?.length&&!parameters.paths?.length;
 const {selectedProjects,...publicFrame}=frame;
 const project=(page:QueryResult<ConnectedRow>):ConnectedResult=>{
  const {nextCursor:inner,freshness:legacyFreshness,...core}=page;
  const result:ConnectedResult={...core,...publicFrame,projects:Object.fromEntries(Object.entries(frame.projects).map(([id,p])=>[id,{...p,fingerprints:{}}]))};
  for(const item of result.items){const entity=index.entries.get(item.id);if(!entity)continue;const p=result.projects[entity.project];if(p)p.fingerprints[entity.path]=entity.fingerprint;}
  if(inner)result.nextCursor={revision:index.revision,registerRevision:index.registerRevision,revisions:index.revisions,projects:selectedProjects,kind,parameters,offset:inner.offset,fragment:inner.fragment};
  if(freshness)result.freshness=Object.fromEntries(result.items.filter(item=>index.entries.get(item.id)?.kind==='feature').map(item=>[item.id,freshness[item.id]??{state:'unknown',review:'open',resolution:'missing'}]));
  return result;
 };
 return project(paginate(adapter,state,rows,overview?10:20,{responseReserveBytes,maxLimit:overview?10:100,measure:page=>bytes(project(page))}));
}
