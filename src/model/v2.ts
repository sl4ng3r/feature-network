import { z } from 'zod';
import { featureSchema } from './schema.js';
import { projectIdSchema, sourceRefSchema, featureRefSchema, statementRefSchema } from './identity.js';
const text = z.string().trim().min(1);
const knowledgeRefs = z.array(statementRefSchema).default([]);
export const relationV2Schema = z.strictObject({
  to: z.union([featureSchema.shape.id,featureRefSchema]),
  type: z.enum(['depends_on','reads','writes']), status: z.enum(['evidenced','hypothesis']),
  evidence: z.array(sourceRefSchema).default([]), when: text.optional(), check: text.optional(), knowledge: knowledgeRefs,
}).refine(r => r.status !== 'evidenced' || r.evidence.length > 0, {message:'An evidenced relation requires source evidence',path:['evidence']});
export const featureV2Schema = z.strictObject({
  schema: z.literal(2), id: featureSchema.shape.id, summary: text, key_points: z.array(text),
  code: z.array(sourceRefSchema).min(1), evidence: z.array(sourceRefSchema).default([]),
  relations: z.array(relationV2Schema).default([]),
  hypotheses: z.array(z.strictObject({text, evidence: z.array(sourceRefSchema).default([])})).default([]), knowledge: knowledgeRefs,
});
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}, 'Invalid calendar date');
export const statementSchema = z.strictObject({
  id: featureSchema.shape.id, type: z.enum(['idea','requirement','observation']),
  state: z.enum(['active','superseded','retracted']), text,
  origin: z.strictObject({kind:z.enum(['user_statement','agent_inference','source_review']), recorded_on:calendarDate, context:text}),
  evidence:z.array(sourceRefSchema).default([]), contradicts:knowledgeRefs, supersedes:knowledgeRefs,
}).superRefine((s, ctx) => {
  if (s.type === 'requirement' && s.origin.kind !== 'user_statement') ctx.addIssue({code:'custom',message:'Requirements need an explicit user statement',path:['origin']});
  if (s.type === 'observation' && s.origin.kind === 'user_statement') ctx.addIssue({code:'custom',message:'Observations require source review or explicit inference',path:['origin']});
  if (s.origin.kind === 'source_review' && s.evidence.length === 0) ctx.addIssue({code:'custom',message:'Source review requires inspected evidence',path:['evidence']});
});
export const knowledgeSchema = z.strictObject({
  schema:z.literal(2), kind:z.literal('knowledge'), id:featureSchema.shape.id, summary:text,
  features:z.array(featureRefSchema).default([]), statements:z.array(statementSchema).min(1),
}).refine(doc => new Set(doc.statements.map(s => s.id)).size === doc.statements.length,{message:'Duplicate statement IDs',path:['statements']});
export const metaV2Schema = z.strictObject({schema:z.literal(2),coverage:z.literal('partial'),project:z.strictObject({id:projectIdSchema,name:text}),areas:z.array(text).default([])});
export type FeatureV2 = z.infer<typeof featureV2Schema>;
export type KnowledgeDocument = z.infer<typeof knowledgeSchema>;
export type MetaV2 = z.infer<typeof metaV2Schema>;
