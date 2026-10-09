import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import type { Diagnostic } from '../model/types.js';
import { readGitState, type GitState } from '../project/git.js';
import type { Project } from '../project/root.js';
import { featureReferences, readSnapshot, type Snapshot, type StorageOptions } from '../storage/repository.js';
import { readRuntime, runtimeRevision, writeRuntime, type RuntimeWriteOptions } from '../storage/runtime.js';
import { inspectChange, inspectReference, isIgnoredChange } from './references.js';

export interface TurnState {
  sessionId: string;
  turnId: string;
  startedAt: string;
  networkRevision: string;
  integrity: Snapshot['integrity'];
  git: GitState;
  observed: Record<string, string | null>;
  preexistingChanges: string[];
  diagnostics: Diagnostic[];
}
export function sessionKey(sessionId: string): string {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 4096) throw new NetworkError('invalid_session', 'A bounded non-empty session ID is required');
  return `freshness/sessions/${createHash('sha256').update(sessionId).digest('hex')}`;
}
const diagnosticSchema = z.object({ code: z.string(), severity: z.enum(['error', 'warning']), message: z.string(), path: z.string().optional() });
const turnSchema = z.object({ sessionId: z.string(), turnId: z.string().uuid(), startedAt: z.iso.datetime(),
  networkRevision: z.string().regex(/^[a-f0-9]{64}$/), integrity: z.enum(['valid', 'invalid', 'not_initialized', 'pending_recovery']),
  git: z.object({ status: z.enum(['available', 'unavailable']), head: z.string().nullable(), branch: z.string().nullable(),
    staged: z.array(z.string()), unstaged: z.array(z.string()), untracked: z.array(z.string()), diagnostics: z.array(diagnosticSchema) }),
  observed: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/).nullable()), preexistingChanges: z.array(z.string()), diagnostics: z.array(diagnosticSchema) });
export async function readTurn(project: Project, sessionId: string): Promise<TurnState | null> {
  const value = await readRuntime<unknown>(project, sessionKey(sessionId));
  if (value === null) return null;
  const parsed = turnSchema.safeParse(value);
  if (!parsed.success || parsed.data.sessionId !== sessionId) throw new NetworkError('invalid_session', 'Stored turn state is invalid');
  return parsed.data as TurnState;
}
export async function relevantChanges(project: Project, paths: string[], options: StorageOptions = {}): Promise<string[]> {
  const output: string[] = [];
  for (const path of [...new Set(paths)].sort()) if (!(await isIgnoredChange(project, path, options))) output.push(path);
  return output;
}
export const workingPaths = (git: GitState): string[] => [...git.staged, ...git.unstaged, ...git.untracked];
/** Explicit start of a new work turn; fingerprints only references and existing edits. */
export async function startTurn(project: Project, sessionId: string, options: RuntimeWriteOptions = {}): Promise<TurnState> {
  const key = sessionKey(sessionId); const snapshot = await readSnapshot(project, options);
  const blocked = snapshot.integrity === 'pending_recovery' || snapshot.integrity === 'not_initialized';
  const git: GitState = blocked ? { status: 'unavailable', head: null, branch: null, staged: [], unstaged: [], untracked: [], diagnostics: [] } : await readGitState(project);
  const state: TurnState = { sessionId, turnId: randomUUID(), startedAt: new Date().toISOString(), networkRevision: snapshot.revision,
    integrity: snapshot.integrity, git, observed: Object.create(null) as Record<string, string | null>, preexistingChanges: [], diagnostics: [...snapshot.diagnostics, ...git.diagnostics] };
  if (blocked) return state; // In particular, never recover by writing a session on a pending read.
  state.preexistingChanges = await relevantChanges(project, workingPaths(git), options);
  const referencePaths = new Set(snapshot.features.flatMap(featureReferences).map(ref => ref.path));
  const paths = [...new Set([...referencePaths, ...state.preexistingChanges])].sort();
  for (const path of paths) {
    const observation = await (referencePaths.has(path) ? inspectReference : inspectChange)(project, path, options); state.observed[path] = observation.hash;
    if (observation.diagnostic) state.diagnostics.push(observation.diagnostic);
  }
  const before = await readRuntime(project, key);
  await writeRuntime(project, key, before === null ? null : runtimeRevision(before), state, options);
  return state;
}
