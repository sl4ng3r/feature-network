import { expect,test } from 'vitest';
const api=await import('../../src/query/traversal.js').catch(()=>null);
function graph(edges:{from:string;to:string;status:'evidenced'|'hypothesis'}[]){const ids=new Set(edges.flatMap(e=>[e.from,e.to]));const outgoing=new Map<string,any[]>(),incoming=new Map<string,any[]>();for(const edge of edges){const e={...edge,type:'depends_on',evidence:[]};outgoing.set(e.from,[...(outgoing.get(e.from)??[]),e]);incoming.set(e.to,[...(incoming.get(e.to)??[]),e]);}return {entries:new Map([...ids].map(id=>[id,{}])),summary:(id:string)=>id,outgoing,incoming};}
test('incoming_traversal_follows_consumers_without_reversing_stored_edges',()=>{
 expect(api?.traverseImpact).toBeTypeOf('function');const result=api!.traverseImpact(graph([{from:'consumer',to:'provider',status:'evidenced'},{from:'view',to:'consumer',status:'evidenced'}]),['provider'],{direction:'incoming',depth:2,maxVisitedFeatures:1000});
 expect(result.rows.map(r=>r.id)).toEqual(['provider','consumer','view']);expect(result.rows[2]!.path.map(e=>e.direction)).toEqual(['incoming','incoming']);
});
test('evidenced_path_wins_over_shorter_hypothesis_and_cycles_terminate',()=>{
 expect(api?.traverseImpact).toBeTypeOf('function');const result=api!.traverseImpact(graph([{from:'a',to:'b',status:'hypothesis'},{from:'a',to:'c',status:'evidenced'},{from:'c',to:'b',status:'evidenced'},{from:'b',to:'a',status:'evidenced'}]),['a'],{direction:'outgoing',depth:2,maxVisitedFeatures:1000});
 expect(result.rows.find(r=>r.id==='b')).toMatchObject({status:'evidenced',path:[{from:'a',to:'c'},{from:'c',to:'b'}]});expect(result.rows).toHaveLength(3);
});
test('work_limit_is_visible_instead_of_claiming_no_more_effects',()=>{
 expect(api?.traverseImpact).toBeTypeOf('function');const result=api!.traverseImpact(graph([{from:'a',to:'b',status:'evidenced'},{from:'b',to:'c',status:'evidenced'}]),['a'],{direction:'outgoing',depth:2,maxVisitedFeatures:1});
 expect(result.rows.map(r=>r.id)).toEqual(['a']);expect(result.workLimited).toBe(true);
});
test('default_and_explicit_work_caps_bound_large_fanout',()=>{
 expect(api?.traverseImpact).toBeTypeOf('function');const g=graph(Array.from({length:10005},(_,i)=>({from:'root',to:`node-${i}`,status:'evidenced' as const})));
 expect(api!.traverseImpact(g,['root'],{depth:1,direction:'outgoing'}).rows).toHaveLength(1000);
 const larger=api!.traverseImpact(g,['root'],{depth:1,direction:'outgoing',maxVisitedFeatures:10000});expect(larger.rows).toHaveLength(10000);expect(larger.workLimited).toBe(true);
});
