import { z } from 'zod';
import { featureSchema, referenceSchema } from '../model/schema.js';
import { reviewDecisionSchema, reviewObservationSchema } from '../freshness/references.js';
import { cursorSchema, parametersSchema } from '../query/pagination.js';
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const path = referenceSchema.shape.path;
const id = featureSchema.shape.id;
const budget = parametersSchema.shape.budget;
export const contextSchema = parametersSchema.omit({ depth: true, direction: true }).extend({ cursor: cursorSchema.optional() });
export const impactSchema = parametersSchema.extend({ cursor: cursorSchema.optional() });
export const updateSchema = z.strictObject({
  expected: z.record(z.string().regex(/^network-spec\/(?:_meta|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.yaml$/), fingerprint.nullable()).describe('Copy exact path fingerprints from network_context structured responses; new feature paths use null. Never truncate or reconstruct tokens.'),
  expectedRevision: fingerprint.optional().describe('Copy the exact revision from a fresh successful structured network_context/update response; a complete lowercase SHA-256 token.'), expectedMissingReferences: z.array(path).max(100).optional(),
  upserts: z.array(featureSchema).max(100), deletes: z.array(id).max(100),
  verifiedReferences: z.array(z.strictObject({ path, hash: fingerprint })).max(100).describe('Only actually mapped network source references; copy exact SHA-256 hashes of inspected bytes. Unmapped tests belong in a separate observations/no_semantic_change request.'),
  observations: z.array(reviewObservationSchema).max(100).optional().describe('If supplied, replaces the implicit verifiedReferences review list: must be nonempty and include every verified source with identical path and hash. Omit for ordinary mapped updated writes; never send an empty overriding array. Unmapped sources require no_semantic_change.'),
  decision: reviewDecisionSchema.omit({ networkRevision: true }), initialize: z.boolean().optional(), budget,
});
export const checkSchema = z.strictObject({ mode: z.enum(['summary', 'full']).optional(), sessionId: z.string().min(1).max(128).optional(), budget });
const source = z.strictObject({ path, hash: fingerprint });
const result = z.strictObject({ path, startByte: z.number().int().nonnegative(), endByte: z.number().int().nonnegative(), featureIds: z.array(id).max(100), outcome: z.enum(['analyzed', 'needs_review']), reason: z.string().trim().min(1).max(8192) });
export const bootstrapSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('status'), budget, recordFilter: z.enum(['all', 'needs_review', 'excluded', 'scope']).optional(), recordCursor: z.strictObject({ revision: fingerprint, filter: z.enum(['all', 'needs_review', 'excluded', 'scope']), offset: z.number().int().nonnegative() }).optional() }),
  z.strictObject({ action: z.literal('start'), reconcile: z.boolean().optional(), maxFiles: z.number().int().min(1).max(20).optional(), maxBytes: z.number().int().min(4).max(65536).optional(), scope: z.array(path).max(100).optional(), exclusions: z.array(path).max(100).optional(), sanitizedExamples: z.array(source).max(100).optional(), budget }),
  z.strictObject({ action: z.literal('next'), budget }),
  z.strictObject({ action: z.literal('checkpoint'), expectedRunRevision: fingerprint, packageId: fingerprint.nullable(), networkRevision: fingerprint, sources: z.array(source).max(20), featureFingerprints: z.record(id, fingerprint), results: z.array(result).max(20), relationalReviewComplete: z.boolean().optional(), reason: z.string().trim().min(1).max(8192).optional(), budget }),
]);
export const toolSchemas = { network_context: contextSchema, network_impact: impactSchema, network_update: updateSchema, network_check: checkSchema, network_bootstrap: bootstrapSchema };
export type ToolName = keyof typeof toolSchemas;
