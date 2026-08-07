/**
 * Prisma Schema Parser
 * Extracts model information from Prisma schema files
 */

import { readFileSync } from 'fs';

export interface PrismaField {
  name: string;
  type: string;
  isRequired: boolean;
  isList: boolean;
  isUnique: boolean;
  isId: boolean;
  isUpdatedAt: boolean;
  isCreatedAt: boolean;
  hasDefault: boolean;
  defaultValue?: string;
  relation?: {
    name?: string;
    model: string;
    fields?: string[];
    references?: string[];
  };
  documentation?: string;
}

export interface PrismaModel {
  name: string;
  fields: PrismaField[];
  documentation?: string;
  primaryKey?: string;
  isPivotTable?: boolean;
}

export interface PrismaSchema {
  models: PrismaModel[];
  enums: Map<string, string[]>;
}

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

  return { models, enums };
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
  
  // Parse relation
  let relation: PrismaField['relation'];
  const relationMatch = attributes.match(/@relation\s*\(([^)]*)\)/);
  if (relationMatch || (!SCALAR_TYPES.includes(type) && !enums.has(type))) {
    relation = {
      model: type,
    };
    
    if (relationMatch) {
      const relContent = relationMatch[1];
      
      // Parse relation name
      const nameMatch = relContent.match(/name:\s*"([^"]+)"/);
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
 * Get display fields for a model (fields suitable for list view)
 */
export function getDisplayFields(model: Pick<PrismaModel, 'fields'>): PrismaField[] {
  return model.fields.filter(f =>
    !f.relation?.fields && // Skip relation foreign keys shown separately
    !f.isList && // Skip array fields
    !SENSITIVE_FIELD_NAMES.some(
      hidden => f.name.toLowerCase().includes(hidden)
    )
  );
}
