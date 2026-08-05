# sveltekit-admin

## Vision
Django-like admin panel for SvelteKit + Prisma + better-auth

## Core Features (v0.1)
- [ ] Prisma schema introspection
- [ ] Auto-generated CRUD routes (/admin/*)
- [ ] List view with pagination, search, filters
- [ ] Create/Edit forms (auto-generated from schema)
- [ ] Delete with confirmation
- [ ] better-auth integration (admin role check)

## Architecture

### Package Structure
```
sveltekit-admin/
├── src/
│   ├── lib/
│   │   ├── server/
│   │   │   ├── introspection/     # Prisma schema parser
│   │   │   ├── crud/              # CRUD operations generator
│   │   │   └── auth/              # better-auth integration
│   │   ├── components/            # Standalone UI components
│   │   │   ├── DataTable.svelte
│   │   │   ├── Form.svelte
│   │   │   ├── Field.svelte
│   │   │   └── ...
│   │   ├── styles/                # Standalone CSS
│   │   └── index.ts               # Public API
│   ├── routes/                    # Virtual routes (injected)
│   │   └── admin/
│   │       ├── +layout.svelte
│   │       ├── +page.svelte       # Dashboard
│   │       └── [model]/
│   │           ├── +page.svelte   # List
│   │           ├── new/+page.svelte
│   │           └── [id]/+page.svelte
│   └── index.ts                   # Plugin entry
├── package.json
└── README.md
```

### Integration Method
Using SvelteKit's `config.kit.files.routes` or Vite virtual modules
to inject admin routes without user needing to create files.

### Configuration
```typescript
// svelte.config.js
import { svelteKitAdmin } from 'sveltekit-admin';

export default {
  kit: {
    // ...
  },
  plugins: [
    svelteKitAdmin({
      prismaSchemaPath: './prisma/schema.prisma',
      basePath: '/admin',
      auth: {
        provider: 'better-auth',
        adminRole: 'admin'
      },
      models: {
        User: {
          hidden: ['password', 'hashedPassword'],
          readonly: ['id', 'createdAt'],
          listFields: ['email', 'name', 'role', 'createdAt']
        }
      }
    })
  ]
};
```
