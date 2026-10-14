import { basename } from 'node:path';
import { isAlias, isScalar, parseDocument, visit } from 'yaml';
import { z } from 'zod';
import { NetworkError } from './errors.js';
import type { Feature, NetworkMeta } from './types.js';

const nonemptyText = z.string().refine(text => text.trim().length > 0, 'Must contain non-whitespace text');
const featureId = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'Must be a lowercase feature ID');
const relativePath = nonemptyText.refine(path => {
  if (/^[\/\\]/.test(path) || /^[a-zA-Z]:/.test(path) || /[\\\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}, 'Must be a relative path without traversal');

export const referenceSchema = z.strictObject({
  path: relativePath,
  symbol: nonemptyText.optional(),
});

export const relationSchema = z.strictObject({
  to: featureId,
  type: z.enum(['depends_on', 'reads', 'writes']),
  status: z.enum(['evidenced', 'hypothesis']),
  evidence: z.array(referenceSchema).default([]),
  when: nonemptyText.optional(),
  check: nonemptyText.optional(),
}).refine(relation => relation.status !== 'evidenced' || relation.evidence.length > 0, {
  message: 'An evidenced relation requires at least one evidence reference',
  path: ['evidence'],
});

export const hypothesisSchema = z.strictObject({
  text: nonemptyText,
  evidence: z.array(referenceSchema).default([]),
});

export const featureSchema = z.strictObject({
  schema: z.literal(1),
  id: featureId,
  summary: nonemptyText,
  key_points: z.array(nonemptyText),
  code: z.array(referenceSchema).min(1),
  evidence: z.array(referenceSchema).default([]),
  relations: z.array(relationSchema).default([]),
  hypotheses: z.array(hypothesisSchema).default([]),
});

export const networkMetaSchema = z.strictObject({
  schema: z.literal(1),
  coverage: z.literal('partial'),
  // Descriptive hints only; they cannot establish complete coverage.
  areas: z.array(nonemptyText).default([]),
});

function invalid(message: string, filename: string): never {
  throw new NetworkError('invalid_schema', message, [filename]);
}

/** Read data-only YAML without ever resolving aliases or executable tags. */
export function parseYaml(text: string, filename: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > 65536) invalid('YAML exceeds the 65536-byte UTF-8 limit', filename);
  try {
    const document = parseDocument(text, {
      version: '1.2', schema: 'core', merge: false,
      customTags: [], strict: true, uniqueKeys: true, prettyErrors: false,
    });
    const issue = document.errors[0] ?? document.warnings[0];
    if (issue) invalid(`Invalid YAML: ${issue.code}`, filename);
    visit(document, {
      Pair(_key, pair) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
          invalid('YAML mapping keys must be strings', filename);
        }
      },
      Node(_key, node) {
        if (isAlias(node) || node.anchor || node.tag) {
          invalid('YAML aliases, anchors and explicit tags are not supported', filename);
        }
      },
    });
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    invalid('Unable to parse YAML safely', filename);
  }
}

export function validate<T>(schema: z.ZodType<T>, value: unknown, filename: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map(issue => `${issue.path.join('.') || 'document'}: ${issue.message}`).join('; ');
    invalid(details, filename);
  }
  return result.data;
}

/** Validates structure only; project reference existence is checked by storage. */
export function parseFeature(text: string, filename: string): Feature {
  const feature = validate(featureSchema, parseYaml(text, filename), filename);
  if (basename(filename) !== `${feature.id}.yaml`) invalid('Feature ID must match the .yaml filename', filename);
  return feature;
}

export function parseMeta(text: string): NetworkMeta {
  return validate(networkMetaSchema, parseYaml(text, '_meta.yaml'), '_meta.yaml');
}
