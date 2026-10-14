import { traverseImpact } from './traversal.js';
import type { FeatureFreshness } from '../freshness/check.js';
import type { Feature, Relation } from '../model/types.js';
import { requireQueryable, type Edge, type NetworkIndex } from './index.js';
import { paginate, queryState, type ImpactRequest, type QueryResult } from './pagination.js';
import { rankedIds } from './search.js';
export type { ImpactRequest } from './pagination.js';
export interface ImpactStep extends Edge { direction: 'incoming' | 'outgoing' }
export interface ImpactItem { id: string; summary: string; origin: string; status: Relation['status']; path: ImpactStep[]; feature?: Feature }
export type ImpactResult = QueryResult<ImpactItem>;
export function queryImpact(index: NetworkIndex, request: ImpactRequest = {}, options: { freshness?: Record<string, FeatureFreshness>; responseReserveBytes?: number } = {}): ImpactResult {
  requireQueryable(index);
  const state = queryState(index, request, 'impact');
  const depth = state.parameters.depth ?? 2;
  const direction = state.parameters.direction ?? 'both';
  const traversed = traverseImpact({...index,summary:id=>index.entries.get(id)!.feature.summary},rankedIds(index,state.parameters,false),{depth,direction,maxVisitedFeatures:Math.max(1,index.entries.size)});
  const rows: ImpactItem[] = traversed.rows.map(row => state.parameters.detail === 'full' ? {...row,feature:index.entries.get(row.id)!.feature} : row);
  const depthLimited = traversed.depthLimited;
  return paginate(index, state, rows, 20, { ...options, depth, depthLimited });
}
