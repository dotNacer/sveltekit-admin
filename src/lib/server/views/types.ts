import type { PrismaField } from '../introspection/parser.js';

export interface ViewModel {
  name: string;
  label: string;
  fields: PrismaField[];
  primaryKey: string;
}
