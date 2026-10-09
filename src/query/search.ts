import type { Feature } from '../model/types.js';
import { compare, requireQueryable, tokenize, type NetworkIndex } from './index.js';
import { paginate, queryState, type ContextRequest, type QueryParameters, type QueryResult } from './pagination.js';
export type { ContextRequest } from './pagination.js';
export interface SummaryItem { id: string; summary: string }
export interface SectionItem { id: string; section: keyof Feature; sectionIndex: number; sectionCount: number; value: Feature[keyof Feature] }
export type ContextItem = SummaryItem | Feature | SectionItem;
export type ContextResult = QueryResult<ContextItem>;
/** Explicit IDs > exact reference paths > number of normalized token matches. */
export function rankedIds(index: NetworkIndex, request: QueryParameters, overview: boolean): string[] {
  const scores = new Map<string, number>();
  for (const id of request.ids ?? []) if (index.entries.has(id)) scores.set(id, 1000000);
  for (const path of request.paths ?? []) for (const id of index.paths.get(path) ?? []) scores.set(id, Math.max(scores.get(id) ?? 0, 100000));
  for (const token of new Set(tokenize(request.query ?? ''))) for (const id of index.tokens.get(token) ?? []) if ((scores.get(id) ?? 0) < 100000) scores.set(id, (scores.get(id) ?? 0) + 1);
  if (overview && !request.ids?.length && !request.paths?.length && !request.query?.trim()) return [...index.entries.keys()].sort(compare);
  return [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)! || compare(a, b));
}
export function queryContext(index: NetworkIndex, request: ContextRequest = {}, options: { responseReserveBytes?: number; includeFingerprints?: boolean } = {}): ContextResult {
  requireQueryable(index); const state = queryState(index, request, 'context');
  const ids = rankedIds(index, state.parameters, true); const budget = state.parameters.budget ?? 12000;
  const rows: ContextItem[] = ids.flatMap<ContextItem>(id => {
    const feature = index.entries.get(id)!.feature;
    if (state.parameters.detail !== 'full') return [{ id, summary: feature.summary }];
    const sections = Object.entries(feature).map(([section, value], sectionIndex) => ({ id, section: section as keyof Feature, sectionIndex, sectionCount: Object.keys(feature).length, value }));
    // Prefer readable complete sections if the feature is large but each section is bounded.
    if (Buffer.byteLength(JSON.stringify(feature)) > budget / 2 && sections.every(section => Buffer.byteLength(JSON.stringify(section)) < budget / 3)) return sections;
    return [feature];
  });
  const overview = !state.parameters.ids?.length && !state.parameters.paths?.length && !state.parameters.query?.trim();
  return paginate(index, state, rows, overview ? 10 : 20, { ...options, maxLimit: overview ? 10 : 100 });
}
