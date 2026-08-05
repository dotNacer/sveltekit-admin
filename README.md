# sveltekit-admin

🎛️ A Django-like admin panel for SvelteKit applications with Prisma and better-auth.

![Version](https://img.shields.io/npm/v/sveltekit-admin)
![License](https://img.shields.io/npm/l/sveltekit-admin)

## Features

- 🔍 **Auto-introspection** of Prisma schema
- 📝 **CRUD operations** auto-generated for all models
- 🔐 **better-auth integration** for admin authentication
- 🎨 **Standalone UI** - no Tailwind or other CSS framework required
- ⚡ **Zero-config** - just add the plugin and you're ready
- 🔧 **Customizable** - hide fields, set readonly, custom labels

## Installation

```bash
npm install sveltekit-admin
# or
bun add sveltekit-admin
# or
pnpm add sveltekit-admin
```

## Quick Start

### 1. Add the Vite plugin

```typescript
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteKitAdmin } from 'sveltekit-admin/plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    svelteKitAdmin({
      prismaSchemaPath: './prisma/schema.prisma',
      basePath: '/admin',
      auth: {
        provider: 'better-auth',
        adminRole: 'admin'
      }
    })
  ]
});
```

### 2. Add the auth hook (optional, for protected admin)

```typescript
// src/hooks.server.ts
import { createAdminHandle } from 'sveltekit-admin';
import { sequence } from '@sveltejs/kit/hooks';

const adminHandle = createAdminHandle({
  basePath: '/admin',
  auth: {
    provider: 'better-auth',
    adminRole: 'admin'
  }
});

export const handle = sequence(
  // your auth handle first
  adminHandle
);
```

### 3. Access your admin panel

Navigate to `/admin` and you'll see:
- Dashboard with model statistics
- List views with pagination, search, and sorting
- Create/Edit forms auto-generated from your Prisma schema
- Delete with confirmation

## Configuration

```typescript
svelteKitAdmin({
  // Path to your Prisma schema (default: './prisma/schema.prisma')
  prismaSchemaPath: './prisma/schema.prisma',
  
  // Base path for admin routes (default: '/admin')
  basePath: '/admin',
  
  // Authentication configuration
  auth: {
    provider: 'better-auth',
    adminRole: 'admin', // Role required to access admin
    // Or custom check function:
    adminCheck: async (user) => user.isAdmin === true
  },
  
  // Per-model configuration
  models: {
    User: {
      // Fields to hide from all views
      hidden: ['password', 'hashedPassword'],
      // Fields that cannot be edited
      readonly: ['id', 'createdAt', 'updatedAt'],
      // Fields to show in list view (default: auto-detect)
      listFields: ['email', 'name', 'role', 'createdAt'],
      // Custom label for the model
      label: 'Users',
      // Icon name (Lucide icon)
      icon: 'users'
    },
    Session: {
      // Completely exclude this model from admin
      hidden: true
    }
  },
  
  // Models to exclude from admin
  exclude: ['Session', 'VerificationToken'],
  
  // Custom branding
  branding: {
    title: 'My Admin',
    logo: '/logo.svg',
    primaryColor: '#6366f1'
  }
})
```

## Components

You can also use the admin components directly in your own pages:

```svelte
<script>
  import { AdminLayout, DataTable, AdminForm } from 'sveltekit-admin/components';
</script>

<AdminLayout title="Custom Admin" models={[...]}>
  <DataTable 
    data={users}
    columns={[
      { key: 'email', label: 'Email', sortable: true },
      { key: 'name', label: 'Name', sortable: true }
    ]}
    basePath="/admin"
    modelName="User"
  />
</AdminLayout>
```

## Prisma Schema Introspection

The admin automatically parses your Prisma schema and:

- Extracts all models and their fields
- Detects field types and generates appropriate form inputs
- Handles relations (1-1, 1-N, N-N)
- Respects field attributes (@id, @unique, @default, @updatedAt)
- Hides sensitive fields by name pattern (password, hash, secret)

## Requirements

- SvelteKit 2.x
- Svelte 5.x
- Prisma 5.x or 6.x
- better-auth 1.x (for authentication)

## License

MIT
