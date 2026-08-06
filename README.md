# sveltekit-admin

🎛️ A Django-like admin panel for SvelteKit applications with Prisma.

![Version](https://img.shields.io/npm/v/sveltekit-admin)
![License](https://img.shields.io/npm/l/sveltekit-admin)

## 0.3.0 — Breaking changes

- Removed the loader-based API (`createAdmin`, `createLayoutLoad`, `createDashboardLoad`,
  `createModelListLoad`, `createModelNewLoad`, `createModelNewAction`, `createModelEditLoad`,
  `createModelEditAction`, `createModelDeleteAction`, `createAdminGuard`). Use `createAdminHandler`.
- Removed the exported Svelte components (`sveltekit-admin/components`) and the `sveltekit-admin/admin` export.
- Removed the exported CRUD utilities (`createListOperation`, `buildSearchWhere`, …) and `createAuthGuard`.
- Removed the configuration options that were never implemented: `branding.logo` and `models[].icon`.
- Security fix: values coming from the URL and from the database are now escaped in the rendered HTML.
- Behaviour fixes:
  - id coercion consults the primary key's type (a fully numeric `String` PK is no longer
    sent to Prisma as an `Int`);
  - an invalid `?page=` (`abc`, `0`, a negative value, or one outside the safe integer range)
    falls back to the first page instead of sending a `NaN` or negative `skip`;
  - a URL of three or more segments renders a "not found" page instead of the dashboard;
  - the "Back to Dashboard" link on "not found" pages now points at `basePath`;
  - the form textarea heuristic is case-insensitive and covers `bio`;
  - an invalid branding colour falls back to the default colour instead of rendering black;
  - the schema default values exposed by `PrismaField.defaultValue` are no longer
    truncated (`@default(now())` yields `now()`, not `now(`).

## Features

- 🔍 **Auto-introspection** of Prisma schema
- 📝 **CRUD operations** auto-generated for all models
- 🎨 **Standalone UI** - no external CSS required
- ⚡ **Zero routes** - everything handled via a single hook
- 🪶 **3 lines of code** to setup
- 🔧 **Customizable** - hide fields, set readonly, custom labels

## Installation

```bash
npm install sveltekit-admin
# or
bun add sveltekit-admin
# or
pnpm add sveltekit-admin
```

## Quick Start (3 lines!)

```typescript
// src/hooks.server.ts
import { createAdminHandler } from 'sveltekit-admin';
import { prisma } from '$lib/server/prisma';

export const handle = createAdminHandler({ prisma });
```

That's it! Navigate to `/admin` and you'll see:
- Dashboard with model statistics  
- List views with pagination
- Create/Edit forms auto-generated from your Prisma schema
- Delete with confirmation

## Configuration

```typescript
createAdminHandler({
  // Required: your Prisma client
  prisma,
  
  // Path to your Prisma schema (default: './prisma/schema.prisma')
  prismaSchemaPath: './prisma/schema.prisma',
  
  // Base path for admin routes (default: '/admin')
  basePath: '/admin',
  
  // Authentication check (optional)
  authCheck: async (event) => {
    const session = event.locals.session;
    return session?.user?.role === 'admin';
  },
  
  // Per-model configuration
  models: {
    User: {
      hidden: ['password', 'hashedPassword'],
      readonly: ['id', 'createdAt', 'updatedAt'],
      listFields: ['email', 'name', 'role', 'createdAt'],
      label: 'Users'
    }
  },
  
  // Models to exclude from admin
  exclude: ['Session', 'VerificationToken'],
  
  // Custom branding
  branding: {
    title: 'My Admin',
    primaryColor: '#6366f1'
  }
});
```

## With Authentication

If you already have an auth handler, use `sequence`:

```typescript
import { createAdminHandler } from 'sveltekit-admin';
import { sequence } from '@sveltejs/kit/hooks';
import { prisma } from '$lib/server/prisma';

const authHandle = async ({ event, resolve }) => {
  // Your auth logic here
  event.locals.session = await getSession(event);
  return resolve(event);
};

const adminHandle = createAdminHandler({
  prisma,
  authCheck: (event) => {
    return event.locals.session?.user?.role === 'admin';
  }
});

export const handle = sequence(authHandle, adminHandle);
```

## How It Works

The admin handler intercepts all requests to `/admin/*` and:

1. Parses your Prisma schema to discover models
2. Generates HTML pages on-the-fly (no Svelte routing needed)
3. Handles all CRUD operations via form submissions

Routes handled:
- `/admin` → Dashboard
- `/admin/user` → List all users  
- `/admin/user/new` → Create user form
- `/admin/user/123` → Edit user form

## Model Configuration

```typescript
models: {
  User: {
    // Fields to hide from all views
    hidden: ['password', 'hashedPassword', 'twoFactorSecret'],
    
    // Fields that cannot be edited (shown as readonly)
    readonly: ['id', 'createdAt', 'updatedAt', 'emailVerified'],
    
    // Fields to show in list view (default: first 6 non-hidden fields)
    listFields: ['email', 'name', 'role', 'createdAt'],
    
    // Custom display name for the model
    label: 'Users'
  }
}
```

## Prisma Schema Introspection

The admin automatically parses your Prisma schema and:

- Extracts all models and their fields
- Detects field types and generates appropriate form inputs
- Handles relations (excluded from forms for now)
- Respects field attributes (@id, @unique, @default, @updatedAt)
- Auto-hides common sensitive fields (password, hash, secret, token)

## Supported Field Types

| Prisma Type | Form Input |
|-------------|------------|
| String | text input (textarea for description/content/body) |
| Int, Float, Decimal, BigInt | number input |
| Boolean | checkbox |
| DateTime | datetime-local input |
| Json | textarea with JSON |

## Requirements

- SvelteKit 2.x
- Prisma 5.x or 6.x

## License

MIT
