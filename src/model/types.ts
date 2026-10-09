import type { z } from 'zod';
import type {
  featureSchema, hypothesisSchema, networkMetaSchema, referenceSchema, relationSchema,
} from './schema.js';

export type Reference = z.infer<typeof referenceSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type NetworkMeta = z.infer<typeof networkMetaSchema>;

/** SHA-256 lowercase hex digest; generated and verified by storage. */
export type Fingerprint = string;

export interface VerifiedReference {
  path: string;
  hash: Fingerprint;
}

export interface Diagnostic {
  code: string;
  path?: string;
  message: string;
  severity: 'error' | 'warning';
}
