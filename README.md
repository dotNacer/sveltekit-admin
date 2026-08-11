# sveltekit-admin

🎛️ A Django-like admin panel for SvelteKit applications with Prisma.

![Version](https://img.shields.io/npm/v/sveltekit-admin)
![License](https://img.shields.io/npm/l/sveltekit-admin)

See [CHANGELOG.md](./CHANGELOG.md) for release notes and breaking changes.

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

### Logout

Same philosophy as `authCheck`: the library has no session system of its
own, so it can't clear one for you. Provide the side effect (clear a
cookie, invalidate a session, call your auth library's sign-out...) and a
"Log out" button appears in the sidebar automatically — no button is
rendered at all if `logout` isn't set.

```typescript
const adminHandle = createAdminHandler({
  prisma,
  authCheck: (event) => event.locals.session?.user?.role === 'admin',
  logout: (event) => {
    event.cookies.delete('session', { path: '/' });
  },
  logoutRedirectTo: '/login' // default: '/'
});
```

The button submits a `POST {basePath}/_logout` form (never a bare link —
logging out must never be triggerable by a GET, unlike a crawler or link
prefetch would allow), and this route is checked *before* `authCheck`, so
a user whose session already expired can still use it to clean up
client-side state instead of being stuck behind a 401 with no way back.

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

## Multi-tenant / row-level scoping (`listWhere`) — read this before relying on it

```typescript
models: {
  Post: {
    // Applied to the LIST VIEW ONLY: search, sidebar filters (including
    // the FK filter), and pagination counts. Composed with an AND, never
    // a spread, so it can never be overwritten by a user-supplied filter
    // on the same field.
    listWhere: ({ locals }) => ({ tenantId: locals.tenantId })
  }
}
```

**`listWhere` does NOT scope anything except the list view.** The detail
view, the edit form, the delete action, and the dashboard's per-model
counts have no equivalent scoping hook in this version and remain fully
open regardless of this config. Concretely: with only `listWhere` set, a
user who obtains another tenant's row ID through any other channel (a
referrer header, a log line, or simple enumeration on a model with an
`Int` primary key) can still view, edit, and delete that row directly —
`listWhere` only stops them from *discovering* the ID through the list or
the FK filter in the first place.

If you configure a `relations[field].where` scope for an FK filter (to
resolve the target's display options/label, see the FK filter docs), it
is a **separate function** from `listWhere` and is **not** kept in sync
automatically — you must set both if you want the FK filter's dropdown
*and* its active-value chip *and* the list rows to all be scoped
consistently for the same relation.

A `listWhere` function that returns `{}` throws instead of silently
disabling the scope — this is deliberate: an empty object composed into
an `AND` clause matches every row, which would fail *open* exactly when a
caller (e.g. one built from a session value that unexpectedly turned out
to be undefined) most needs protection. Make sure your scope function
either returns a real condition or isn't called at all for a given
request.

Real per-record scoping (detail/edit/delete) is a known gap, not an
oversight — track it separately if your application needs it; do not
assume `listWhere` covers it.

## Prisma Schema Introspection

The admin automatically parses your Prisma schema and:

- Extracts all models and their fields
- Detects field types and generates appropriate form inputs
- Handles relations (excluded from forms for now)
- Respects field attributes (@id, @unique, @default, @updatedAt)
- Auto-hides common sensitive fields from the list view: any field whose name
  contains `password`, `hash`, `secret` or `token` (case-insensitive), so
  `hashedPassword`, `passwordHash` and `refreshToken` are all covered. Two things
  to know about it:
  - The match is on substrings, so it also catches ordinary names such as
    `hashtag`, `tokenCount` or `secretariat`. Listing a field in
    `models[].listFields` shows it regardless — that is the explicit override,
    and the way to display a column the heuristic gets wrong.
  - It only applies to the list view. Edit forms still render these fields, so
    you can set a value; use `models[].hidden` to remove one everywhere.

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
