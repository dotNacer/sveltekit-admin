import type { SchemaIntrospector } from "../types.js";
import type { Schema } from "../../types/schema.js";

export function createDrizzleIntrospector(schema: Schema): SchemaIntrospector {
  return { introspect: () => schema };
}
