import type { WorkMeter } from '../diagnostics/work.js';
import { countWork,withWorkMeter } from '../diagnostics/work.js';
import { NetworkError } from '../model/errors.js';
export interface TraversalEdge {from:string;to:string;status:'evidenced'|'hypothesis';type:string}
export interface ImpactGraph<E extends TraversalEdge=TraversalEdge> {entries:ReadonlyMap<string,unknown>;summary:(id:string)=>string;outgoing:ReadonlyMap<string,readonly E[]>;incoming:ReadonlyMap<string,readonly E[]>}
export interface TraversalOptions {direction?:'incoming'|'outgoing'|'both';depth?:number;maxVisitedFeatures?:number;meter?:WorkMeter}
export interface TraversalRow<E extends TraversalEdge=TraversalEdge> {id:string;summary:string;origin:string;status:'evidenced'|'hypothesis';path:(E & {direction:'incoming'|'outgoing'})[]}
export interface TraversalResult<E extends TraversalEdge=TraversalEdge> {rows:TraversalRow<E>[];depthLimited:boolean;workLimited:boolean;visitedFeatures:number}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
/** One evidence-first shortest-path engine for standalone and connected queries. */
export function traverseImpact<E extends TraversalEdge>(graph:ImpactGraph<E>,roots:string[],options:TraversalOptions={}):TraversalResult<E>{
 return withWorkMeter(options.meter,()=>{
  const depth=options.depth??2,direction=options.direction??'both',max=options.maxVisitedFeatures??1000;
  if(!Number.isInteger(depth)||depth<0||depth>8||!Number.isSafeInteger(max)||max<1)throw new NetworkError('invalid_query','Invalid traversal bounds');
  const heap:TraversalRow<E>[]=[];const order=(a:TraversalRow<E>,b:TraversalRow<E>)=>Number(a.status==='hypothesis')-Number(b.status==='hypothesis')||a.path.length-b.path.length||compare(a.id,b.id)||compare(a.origin,b.origin);
  const push=(row:TraversalRow<E>)=>{heap.push(row);let i=heap.length-1;while(i>0){const parent=(i-1)>>1;if(order(heap[parent]!,row)<=0)break;heap[i]=heap[parent]!;i=parent;}heap[i]=row;};
  const pop=():TraversalRow<E>=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let next=i*2+1;if(next+1<heap.length&&order(heap[next+1]!,heap[next]!)<0)next++;if(order(last,heap[next]!)<=0)break;heap[i]=heap[next]!;i=next;}heap[i]=last;}return first;};
  const key=(id:string,status:string)=>JSON.stringify([id,status]);const queued=new Map<string,number>();
  for(const id of [...new Set(roots)].sort(compare))if(graph.entries.has(id)){push({id,summary:graph.summary(id),origin:id,status:'evidenced',path:[]});queued.set(key(id,'evidenced'),0);}
  const visited=new Set<string>(),explored=new Map<string,number>();const rows:TraversalRow<E>[]=[];let workLimited=false;
  const steps=(id:string)=>([
   ...(direction!=='incoming'?(graph.outgoing.get(id)??[]).map(edge=>({...edge,direction:'outgoing' as const})):[]),
   ...(direction!=='outgoing'?(graph.incoming.get(id)??[]).map(edge=>({...edge,direction:'incoming' as const})):[]),
  ]).sort((a,b)=>compare(a.from,b.from)||compare(a.to,b.to)||compare(a.type,b.type)||compare(a.status,b.status)||compare(JSON.stringify(a),JSON.stringify(b)));
  while(heap.length){
   const current=pop(),route=key(current.id,current.status);if((explored.get(route)??Infinity)<=current.path.length)continue;
   if(!visited.has(current.id)&&visited.size>=max){workLimited=true;continue;}
   explored.set(route,current.path.length);
   if(!visited.has(current.id)){visited.add(current.id);rows.push(current);countWork('visitedFeatures');}
   if(current.path.length>=depth)continue;
   for(const step of steps(current.id)){
    const id=step.direction==='outgoing'?step.to:step.from;if(!graph.entries.has(id))continue;
    const status=current.status==='hypothesis'||step.status==='hypothesis'?'hypothesis':'evidenced';const nextDepth=current.path.length+1,route=key(id,status);
    if((queued.get(route)??Infinity)<=nextDepth)continue;queued.set(route,nextDepth);push({id,summary:graph.summary(id),origin:current.origin,status,path:[...current.path,step]});
   }
  }
  const depthLimited=rows.some(row=>row.path.length===depth&&steps(row.id).some(e=>{const id=e.direction==='outgoing'?e.to:e.from;return graph.entries.has(id)&&!visited.has(id);}));
  return {rows,depthLimited,workLimited,visitedFeatures:visited.size};
 });
}
