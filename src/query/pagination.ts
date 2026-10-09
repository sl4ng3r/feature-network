import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import type { Diagnostic } from '../model/types.js';
import type { NetworkIndex } from './index.js';

const parametersSchema = z.strictObject({
  ids: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)).max(100).optional(),
  paths: z.array(z.string().min(1).max(4096)).max(100).optional(),
  query: z.string().max(4096).optional(),
  detail: z.enum(['summary', 'full']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  budget: z.number().int().min(512).max(64000).optional(),
  direction: z.enum(['both', 'incoming', 'outgoing']).optional(),
  depth: z.number().int().min(0).max(8).optional(),
});
export type QueryParameters = z.infer<typeof parametersSchema>;
export interface QueryCursor { revision: string; kind: 'context' | 'impact'; parameters: QueryParameters; offset: number; fragment: number }
export interface ContextRequest { ids?: string[]; paths?: string[]; query?: string; detail?: 'summary' | 'full'; limit?: number; budget?: number; cursor?: QueryCursor }
export interface ImpactRequest extends ContextRequest { direction?: 'both' | 'incoming' | 'outgoing'; depth?: number }
const cursorSchema = z.strictObject({ revision: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(['context', 'impact']), parameters: parametersSchema, offset: z.number().int().nonnegative(), fragment: z.number().int().nonnegative() });
const requestSchema = parametersSchema.extend({ cursor: cursorSchema.optional() });
export interface QueryState { parameters: QueryParameters; offset: number; fragment: number; kind: QueryCursor['kind'] }
export interface FragmentItem { id: string; fragment: { format: 'json'; offset: number; total: number; text: string } }
export interface QueryResult<T> {
  revision: string;
  integrity: NetworkIndex['integrity'];
  coverage: 'partial';
  incomplete: boolean;
  diagnostics: Diagnostic[];
  diagnosticsOmitted?: number;
  items: (T | FragmentItem)[];
  truncated: boolean;
  omitted: number;
  nextCursor?: QueryCursor;
  depth?: number;
  depthLimited?: boolean;
}
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
export function queryState(index: NetworkIndex, request: ContextRequest | ImpactRequest, kind: QueryCursor['kind']): QueryState {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) throw new NetworkError(Object.hasOwn(request ?? {}, 'cursor') ? 'invalid_cursor' : 'invalid_query', 'Invalid query parameters or cursor');
  const { cursor, ...parameters } = parsed.data;
  if (kind === 'context' && (parameters.depth !== undefined || parameters.direction !== undefined)) throw new NetworkError('invalid_query', 'Context queries do not accept impact parameters');
  if (cursor) {
    if (kind === 'context' && (cursor.parameters.depth !== undefined || cursor.parameters.direction !== undefined)) throw new NetworkError('invalid_cursor', 'Context cursor contains impact parameters');
    if (cursor.kind !== kind) throw new NetworkError('invalid_cursor', 'Cursor belongs to a different query');
    if (cursor.revision !== index.revision) throw new NetworkError('stale_cursor', 'Network changed; restart the query');
    for (const [key, value] of Object.entries(parameters)) if (JSON.stringify(value) !== JSON.stringify(cursor.parameters[key as keyof QueryParameters])) throw new NetworkError('invalid_cursor', 'Cursor query parameters changed');
    return { parameters: cursor.parameters, offset: cursor.offset, fragment: cursor.fragment, kind };
  }
  return { parameters, offset: 0, fragment: 0, kind };
}
/** Offset and fragment offsets are UTF-16 code-unit indices, never split surrogate pairs.
 * Reassemble a fragmented row by concatenating text in offset order, then JSON.parse.
 * total is the original serialized row length; no row content is silently discarded. */
export function paginate<T extends { id: string }>(index: NetworkIndex, state: QueryState, rows: T[], defaultLimit: number, options: { maxLimit?: number; depth?: number; depthLimited?: boolean } = {}): QueryResult<T> {
  const budget = state.parameters.budget ?? 12000; const limit = Math.min(state.parameters.limit ?? defaultLimit, options.maxLimit ?? 100);
  if (state.offset > rows.length || (state.offset === rows.length && state.fragment !== 0)) throw new NetworkError('invalid_cursor', 'Cursor offset is outside the result');
  const result: QueryResult<T> = { ...(options.depth !== undefined ? { depth: options.depth, depthLimited: options.depthLimited ?? false } : {}), revision: index.revision, integrity: index.integrity, coverage: 'partial', incomplete: index.integrity !== 'valid', diagnostics: [], ...(index.diagnostics.length ? { diagnosticsOmitted: index.diagnostics.length } : {}), items: [], truncated: false, omitted: 0 };
  const finalize = (offset: number, fragment = 0): void => {
    result.omitted = rows.length - offset;
    result.truncated = result.omitted > 0;
    if (result.truncated) result.nextCursor = { revision: index.revision, kind: state.kind, parameters: state.parameters, offset, fragment };
    else delete result.nextCursor;
  };
  let offset = state.offset; finalize(offset, state.fragment);
  // Reject continuation metadata that already exceeds the entire response budget.
  if (bytes(result) > budget && rows.length > offset) throw new NetworkError('invalid_query', 'Budget is too small for query parameters and continuation metadata');
  for (const diagnostic of index.diagnostics) {
    result.diagnostics.push(diagnostic);
    const omitted = index.diagnostics.length - result.diagnostics.length;
    if (omitted) result.diagnosticsOmitted = omitted; else delete result.diagnosticsOmitted;
    if (bytes(result) > Math.min(budget / 3, bytes({ ...result, diagnostics: [] }) + 512)) { result.diagnostics.pop(); result.diagnosticsOmitted = index.diagnostics.length - result.diagnostics.length; break; }
  }
  let fragmentOffset = state.fragment;
  while (offset < rows.length && result.items.length < limit) {
    const row = rows[offset]!; const serialized = JSON.stringify(row);
    if (fragmentOffset >= serialized.length || (fragmentOffset > 0 && isLowSurrogate(serialized.charCodeAt(fragmentOffset)))) throw new NetworkError('invalid_cursor', 'Cursor fragment is outside the row or splits Unicode');
    if (fragmentOffset === 0) {
      result.items.push(row); finalize(offset + 1);
      if (bytes(result) <= budget) { offset++; continue; }
      result.items.pop();
      if (result.items.length) { finalize(offset); break; }
    }
    const piece: FragmentItem = { id: row.id, fragment: { format: 'json', offset: fragmentOffset, total: serialized.length, text: '' } };
    result.items.push(piece);
    let low = fragmentOffset; let high = serialized.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      piece.fragment.text = serialized.slice(fragmentOffset, mid); finalize(mid === serialized.length ? offset + 1 : offset, mid === serialized.length ? 0 : mid);
      if (bytes(result) <= budget) low = mid; else high = mid - 1;
    }
    if (low < serialized.length && isLowSurrogate(serialized.charCodeAt(low))) low--;
    if (low === fragmentOffset) throw new NetworkError('invalid_query', 'Budget cannot fit a content fragment and its continuation metadata');
    piece.fragment.text = serialized.slice(fragmentOffset, low); finalize(low === serialized.length ? offset + 1 : offset, low === serialized.length ? 0 : low);
    break;
  }
  if (bytes(result) > budget) throw new NetworkError('invalid_query', 'Budget cannot fit result metadata');
  return result;
}
function isLowSurrogate(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }
