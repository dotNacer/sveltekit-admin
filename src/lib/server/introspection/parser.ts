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
}

export interface PrismaSchema {
  models: PrismaModel[];
  enums: Map<string, string[]>;
}

const SCALAR_TYPES = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Decimal', 'BigInt'];

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
    
    models.push({
      name: modelName,
      fields,
      documentation,
      primaryKey
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
 * Get display fields for a model (fields suitable for list view)
 */
export function getDisplayFields(model: PrismaModel): PrismaField[] {
  return model.fields.filter(f => 
    !f.relation?.fields && // Skip relation foreign keys shown separately
    !f.isList && // Skip array fields
    !['password', 'hashedPassword', 'hash', 'secret'].some(
      hidden => f.name.toLowerCase().includes(hidden)
    )
  );
}

/**
 * Get editable fields for a model (fields that can be edited in forms)
 */
export function getEditableFields(model: PrismaModel): PrismaField[] {
  return model.fields.filter(f =>
    !f.isId &&
    !f.isCreatedAt &&
    !f.isUpdatedAt &&
    !f.isList &&
    !f.relation?.references // Skip the "other side" of relations
  );
}

/**
 * Get a human-readable label from a field name
 */
export function fieldToLabel(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Determine the input type for a Prisma field
 */
export function getInputType(field: PrismaField): string {
  if (field.relation) return 'relation';
  
  switch (field.type) {
    case 'String':
      if (field.name.toLowerCase().includes('email')) return 'email';
      if (field.name.toLowerCase().includes('password')) return 'password';
      if (field.name.toLowerCase().includes('url')) return 'url';
      if (field.name.toLowerCase().includes('description') || 
          field.name.toLowerCase().includes('content') ||
          field.name.toLowerCase().includes('bio')) return 'textarea';
      return 'text';
    case 'Int':
    case 'Float':
    case 'Decimal':
    case 'BigInt':
      return 'number';
    case 'Boolean':
      return 'checkbox';
    case 'DateTime':
      return 'datetime';
    case 'Json':
      return 'json';
    default:
      return 'text';
  }
}
