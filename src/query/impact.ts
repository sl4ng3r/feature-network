import type { FeatureFreshness } from '../freshness/check.js';
import type { Feature, Relation } from '../model/types.js';
import { compare, requireQueryable, type Edge, type NetworkIndex } from './index.js';
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
  const queue: ImpactItem[] = rankedIds(index, state.parameters, false).map(id => ({ id, summary: index.entries.get(id)!.feature.summary, origin: id, status: 'evidenced', path: [] }));
  const queuedDepth = new Map(queue.map(row => [`${row.id}:${row.status}`, 0]));
  const visited = new Set<string>();
  const exploredDepth = new Map<string, number>();
  const rows: ImpactItem[] = [];
  // Evidence-only BFS is exhausted before any hypothesis path is chosen. Stable sort
  // preserves shortest evidenced routes and deterministic origin/edge tie-breaking.
  while (queue.length) {
    queue.sort((a, b) => Number(a.status === 'hypothesis') - Number(b.status === 'hypothesis') || a.path.length - b.path.length || compare(a.id, b.id) || compare(a.origin, b.origin));
    const current = queue.shift()!;
    const routeKey = `${current.id}:${current.status}`;
    if ((exploredDepth.get(routeKey) ?? Infinity) <= current.path.length) continue;
    exploredDepth.set(routeKey, current.path.length);
    if (!visited.has(current.id)) {
      visited.add(current.id);
      rows.push(current);
    }
    if (state.parameters.detail === 'full') current.feature = index.entries.get(current.id)!.feature;
    if (current.path.length >= depth) continue;
    const steps: ImpactStep[] = [
      ...(direction !== 'incoming' ? (index.outgoing.get(current.id) ?? []).map(edge => ({ ...edge, direction: 'outgoing' as const })) : []),
      ...(direction !== 'outgoing' ? (index.incoming.get(current.id) ?? []).map(edge => ({ ...edge, direction: 'incoming' as const })) : []),
    ];
    steps.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.type, b.type) || compare(a.status, b.status) || compare(JSON.stringify(a), JSON.stringify(b)));
    for (const step of steps) {
      const id = step.direction === 'outgoing' ? step.to : step.from;
      if (!index.entries.has(id)) continue;
      const status = current.status === 'hypothesis' || step.status === 'hypothesis' ? 'hypothesis' : 'evidenced';
      const routeKey = `${id}:${status}`;
      const nextDepth = current.path.length + 1;
      if ((queuedDepth.get(routeKey) ?? Infinity) <= nextDepth) continue;
      queuedDepth.set(routeKey, nextDepth);
      queue.push({ id, summary: index.entries.get(id)!.feature.summary, origin: current.origin, status, path: [...current.path, step] });
    }
  }
  const reached = new Set(rows.map(row => row.id));
  const depthLimited = rows.some(row => row.path.length === depth && [
    ...(direction !== 'incoming' ? (index.outgoing.get(row.id) ?? []).map(edge => edge.to) : []),
    ...(direction !== 'outgoing' ? (index.incoming.get(row.id) ?? []).map(edge => edge.from) : []),
  ].some(id => index.entries.has(id) && !reached.has(id)));
  return paginate(index, state, rows, 20, { ...options, depth, depthLimited });
}
