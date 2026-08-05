# Development Tasks

## Task 1: Prisma Introspection (src/lib/server/introspection/)
Parse Prisma schema and extract:
- Model names, fields, types
- Relations (1-1, 1-N, N-N)
- Field attributes (required, unique, default, etc.)

## Task 2: Vite Plugin (src/plugin.ts)
Create a Vite plugin that:
- Injects virtual routes at /admin/*
- Provides virtual modules for config access
- Handles HMR for admin routes

## Task 3: UI Components (src/lib/components/)
Standalone components with embedded styles:
- DataTable (pagination, sorting, search)
- AdminForm (auto-generated fields)
- AdminLayout (sidebar, header)
- Field types (text, number, date, select, relation)

## Task 4: CRUD Operations (src/lib/server/crud/)
Generate Prisma operations:
- List with filters/pagination
- Get single record
- Create/Update/Delete
- Handle relations
