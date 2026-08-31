/**
 * Prisma Schema Parser
 * Extracts model information from Prisma schema files
 */

import { readFileSync } from 'fs';
import type { Field, Model, Schema } from '../types/schema.js';

export type PrismaField = Field;
export type PrismaModel = Model;
export type PrismaSchema = Schema;

const SCALAR_TYPES = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Decimal', 'BigInt'];

/**
 * Detect if a model is a pivot/junction table for many-to-many relations.
 * A pivot table typically:
 * - Has a name starting with _ (Prisma implicit)
 * - Has mostly foreign key fields (relations)
 * - Has few or no "business" fields beyond IDs and timestamps
 */
function detectPivotTable(modelName: string, fields: PrismaField[]): boolean {
  // Prisma implicit many-to-many tables start with _
  if (modelName.startsWith('_')) {
    return true;
  }

  // Count different field types
  const relationFields = fields.filter(f => f.relation);
  const idFields = fields.filter(f => f.isId);
  const timestampFields = fields.filter(f => f.isCreatedAt || f.isUpdatedAt);
  const fkFields = fields.filter(f =>
    f.name.toLowerCase().endsWith('id') &&
    !f.isId &&
    SCALAR_TYPES.includes(f.type)
  );

  // Total "structural" fields (not business data)
  const structuralFields = idFields.length + timestampFields.length + fkFields.length + relationFields.length;

  // If almost all fields are structural (IDs, FKs, relations, timestamps)
  // and we have at least 2 FK/relation fields, it's likely a pivot table
  const totalFields = fields.length;
  const businessFields = totalFields - structuralFields;

  // Pivot table: has 2+ relations/FKs and 0-1 business fields
  const hasMultipleRelations = (relationFields.length + fkFields.length) >= 2;
  const hasMinimalBusinessFields = businessFields <= 1;

  return hasMultipleRelations && hasMinimalBusinessFields;
}

export function parsePrismaSchema(schemaPath: string): PrismaSchema {
  const content = readFileSync(schemaPath, 'utf-8');
  return parseSchemaContent(content);
}

export function parseSchemaContent(content: string): PrismaSchema {
  const models: PrismaModel[] = [];
  const enums = new Map<string, string[]>();

  // Parse enums
  const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
  let enumMatch;
  while ((enumMatch = enumRegex.exec(content)) !== null) {
    const enumName = enumMatch[1];
    const enumValues = enumMatch[2]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('//'));
    enums.set(enumName, enumValues);
  }

  // Parse provider du bloc datasource. On ne capture qu'une valeur littérale
  // entre guillemets — `provider = env("DB_PROVIDER")` ou toute expression
  // laisse `provider` à `undefined`, volontairement : le code appelant doit
  // alors dégrader vers le comportement le plus prudent plutôt que deviner.
  const providerMatch = content.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/);
  const provider = providerMatch?.[1];

  // Parse models
  const modelRegex = /(?:\/\/\/\s*(.+)\n)?model\s+(\w+)\s*\{([^}]+)\}/g;
  let modelMatch;
  
  while ((modelMatch = modelRegex.exec(content)) !== null) {
    const documentation = modelMatch[1]?.trim();
    const modelName = modelMatch[2];
    const modelBody = modelMatch[3];
    
    const fields = parseModelFields(modelBody, enums);
    const primaryKey = fields.find(f => f.isId)?.name || 'id';
    const isPivotTable = detectPivotTable(modelName, fields);
    
    models.push({
      name: modelName,
      fields,
      documentation,
      primaryKey,
      isPivotTable
    });
  }

  return { models, enums, provider };
}

function parseModelFields(modelBody: string, enums: Map<string, string[]>): PrismaField[] {
  const fields: PrismaField[] = [];
  const lines = modelBody.split('\n');
  
  let currentDoc: string | undefined;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and block-level attributes
    if (!trimmed || trimmed.startsWith('@@')) continue;
    
    // Capture documentation comments
    if (trimmed.startsWith('///')) {
      currentDoc = trimmed.slice(3).trim();
      continue;
    }
    
    // Skip regular comments
    if (trimmed.startsWith('//')) continue;
    
    // Parse field
    const field = parseFieldLine(trimmed, enums, currentDoc);
    if (field) {
      fields.push(field);
    }
    
    currentDoc = undefined;
  }
  
  return fields;
}

function parseFieldLine(
  line: string, 
  enums: Map<string, string[]>,
  documentation?: string
): PrismaField | null {
  // Match: fieldName Type? @attributes
  const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
  if (!fieldMatch) return null;
  
  const [, name, rawType, listMarker, optionalMarker, attributes] = fieldMatch;
  
  const type = rawType;
  const isList = !!listMarker;
  const isRequired = !optionalMarker && !isList;
  
  // Parse attributes
  const isId = /@id\b/.test(attributes);
  const isUnique = /@unique\b/.test(attributes);
  const isUpdatedAt = /@updatedAt\b/.test(attributes);
  const hasDefault = /@default\b/.test(attributes);
  
  // Detect createdAt pattern
  const isCreatedAt = name.toLowerCase() === 'createdat' || 
    (type === 'DateTime' && /@default\s*\(\s*now\s*\(\s*\)\s*\)/.test(attributes));
  
  // Parse default value
  let defaultValue: string | undefined;
  // Le motif accepte un niveau d'imbrication : sans lui, `[^)]+` s'arrêtait à la
  // première parenthèse fermante et tronquait tout défaut sous forme d'appel
  // (`autoincrement()` → 'autoincrement('). Couvre autoincrement/now/cuid/uuid et
  // dbgenerated("…") sans appel imbriqué dans la chaîne.
  const defaultMatch = attributes.match(/@default\s*\(((?:[^()]|\([^)]*\))*)\)/);
  if (defaultMatch) {
    defaultValue = defaultMatch[1].trim();
  }
  
  // Parse relation. Le motif accepte un niveau d'imbrication pour les
  // arguments comme `fields: [authorId]` — sans lui, `[^)]+` s'arrêtait à la
  // première parenthèse fermante et tronquait `name: "..."` placé après.
  let relation: PrismaField['relation'];
  const relationMatch = attributes.match(/@relation\s*\(((?:[^()]|\([^)]*\))*)\)/);
  if (relationMatch || (!SCALAR_TYPES.includes(type) && !enums.has(type))) {
    relation = {
      model: type,
    };
    
    if (relationMatch) {
      const relContent = relationMatch[1];

      // Parse relation name : `name: "X"` (nommé) ou `"X"` en première
      // position (chaîne positionnelle, forme utilisée côté back-reference).
      const nameMatch =
        relContent.match(/name:\s*"([^"]+)"/) ??
        relContent.match(/^\s*"([^"]+)"/);
      if (nameMatch) relation.name = nameMatch[1];
      
      // Parse fields
      const fieldsMatch = relContent.match(/fields:\s*\[([^\]]+)\]/);
      if (fieldsMatch) {
        relation.fields = fieldsMatch[1].split(',').map(f => f.trim());
      }
      
      // Parse references
      const refsMatch = relContent.match(/references:\s*\[([^\]]+)\]/);
      if (refsMatch) {
        relation.references = refsMatch[1].split(',').map(r => r.trim());
      }
    }
  }
  
  return {
    name,
    type,
    isRequired,
    isList,
    isUnique,
    isId,
    isUpdatedAt,
    isCreatedAt,
    hasDefault,
    defaultValue,
    isEnum: enums.has(type),
    relation,
    documentation
  };
}

/**
 * Nom de champ considéré comme sensible : la comparaison est une inclusion en
 * minuscules, donc 'password' couvre `hashedPassword`, 'hash' couvre
 * `passwordHash` et 'token' couvre `apiToken`/`accessToken`/`refreshToken`.
 */
const SENSITIVE_FIELD_NAMES = ['password', 'hash', 'secret', 'token'];

/**
 * Un champ est-il sensible par son nom ? Prédicat UNIQUE, partagé par
 * `getDisplayFields` (liste) et par le module de recherche/filtre
 * (`query/listQuery.ts`) — sans ce partage, les deux heuristiques
 * divergeraient tôt ou tard et un champ masqué de la liste redeviendrait
 * cherchable/filtrable par URL forgée.
 */
export function isSensitiveFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_FIELD_NAMES.some((hidden) => lower.includes(hidden));
}

/**
 * Restreint `isSensitiveFieldName` aux colonnes de texte, pour le chemin
 * formulaire/écriture.
 *
 * Le prédicat de nom matche par sous-chaîne : sans le filtre de type, un
 * `tokenCount` ou un `hashtagCount` (`Int`) serait traité comme un secret et
 * deviendrait impossible à éditer dans l'admin. Un mot de passe, un secret,
 * un token sont du texte ; un compteur ne l'est pas.
 *
 * Volontairement plus étroit que `isSensitiveFieldName` seul, qui reste le
 * prédicat utilisé pour l'affichage, la recherche, les filtres et l'audit :
 * là, ne pas montrer un `tokenCount` est sans conséquence, alors qu'ici ça
 * retirerait une capacité.
 */
export function isSensitiveStringField(field: Pick<PrismaField, 'name' | 'type'>): boolean {
  return field.type === 'String' && isSensitiveFieldName(field.name);
}

/**
 * Get display fields for a model (fields suitable for list view)
 */
export function getDisplayFields(model: Pick<PrismaModel, 'fields'>): PrismaField[] {
  return model.fields.filter(f =>
    !f.relation?.fields && // Skip relation foreign keys shown separately
    !f.isList && // Skip array fields
    !isSensitiveFieldName(f.name)
  );
}
