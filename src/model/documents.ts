import { z } from 'zod';
import { featureSchema, networkMetaSchema, parseYaml, validate } from './schema.js';
import { featureV2Schema, knowledgeSchema, metaV2Schema } from './v2.js';
import type { Feature, NetworkMeta } from './types.js';
import type { FeatureV2, KnowledgeDocument, MetaV2 } from './v2.js';
import { NetworkError } from './errors.js';
export type FeatureV1 = Feature;
export type MetaV1 = NetworkMeta;
export type FeatureDocument = FeatureV1 | FeatureV2;
export type EditableDocument = FeatureDocument | KnowledgeDocument;
export type NetworkDocument = EditableDocument | MetaV1 | MetaV2;
export type EditablePath = `network-spec/${string}.yaml`;
export type NetworkPath = EditablePath;
export const editablePathSchema = z.string().regex(/^network-spec\/(?:knowledge\/)?[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.yaml$/);
export const networkPathSchema = z.union([z.literal('network-spec/_meta.yaml'),editablePathSchema]);
export function documentPath(doc: EditableDocument): EditablePath {
  const id = featureSchema.shape.id.parse(doc.id);
  return `network-spec/${'kind' in doc ? 'knowledge/' : ''}${id}.yaml`;
}
export function parseNetworkDocument(text: string, path: NetworkPath): NetworkDocument {
  if (!networkPathSchema.safeParse(path).success) throw new NetworkError('invalid_schema','Unknown document path',[path]);
  const value = parseYaml(text,path);
  let result: NetworkDocument;
  if (path === 'network-spec/_meta.yaml') result = validate(z.union([networkMetaSchema,metaV2Schema]),value,path);
  else if (path.startsWith('network-spec/knowledge/')) result = validate(knowledgeSchema,value,path);
  else result = validate(z.union([featureSchema,featureV2Schema]),value,path);
  if ('id' in result && documentPath(result) !== path) throw new NetworkError('invalid_schema','Document ID must match path',[path]);
  return result;
}
export function parseNetworkMeta(text: string): MetaV1 | MetaV2 {
  return validate(z.union([networkMetaSchema,metaV2Schema]),parseYaml(text,'network-spec/_meta.yaml'),'network-spec/_meta.yaml');
}
