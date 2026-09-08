import { createAdminHandler, defineAdminConfig, defineModelConfig } from '../../src/lib/index.js';

type AppModels = {
  User: 'id' | 'email' | 'password' | 'createdAt';
  Post: 'id' | 'title' | 'content';
};

const validConfig = defineAdminConfig<AppModels>({
  prisma: {},
  models: {
    User: {
      hidden: ['password'],
      readonly: ['id', 'createdAt'],
      listFields: ['email'],
      fieldOrder: ['email', 'createdAt'],
      scope: () => ({ email: 'tenant@example.test' }),
      transform: { password: async (raw: unknown) => String(raw) }
    }
  },
  modelOrder: ['User', 'Post'],
  dashboard: {
    widgets: [
      { type: 'count', model: 'User', label: 'Users' },
      { type: 'recent', model: 'Post', limit: 5 }
    ]
  },
  navigation: {
    categories: [{ label: 'Content', models: ['Post'] }]
  }
});

createAdminHandler(validConfig);

defineAdminConfig<AppModels>({
  models: {
    User: {
      // @ts-expect-error — typo must be caught by TypeScript/IDE tooling.
      hidden: ['passwrod']
    }
  }
});

defineAdminConfig<AppModels>({
  models: {
    User: {
      transform: {
        // @ts-expect-error — transform keys must be known model fields too.
        passwrod: (raw: unknown) => raw
      }
    }
  }
});

defineModelConfig<AppModels['User']>({
  scope: () => ({ email: 'tenant@example.test' }),
  transform: {
    password: (raw) => raw,
    // @ts-expect-error — the standalone helper enforces the same field map.
    passwrod: (raw: unknown) => raw
  }
});

defineAdminConfig<AppModels>({
  models: {
    User: {
      // @ts-expect-error — scope object keys must be known model fields.
      scope: () => ({ tenantIdd: 1 })
    }
  }
});

defineModelConfig<AppModels['User']>({
  // @ts-expect-error — the standalone helper enforces scope field names too.
  scope: () => ({ tenantIdd: 1 })
});

defineAdminConfig<AppModels>({
  models: {
    // @ts-expect-error — only declared models may be configured.
    Comment: { hidden: ['id'] }
  }
});

defineAdminConfig<AppModels>({
  dashboard: {
    widgets: [
      {
        type: 'count',
        // @ts-expect-error — dashboard model names share the typed model map.
        model: 'Order',
        label: 'Orders'
      }
    ]
  }
});

defineAdminConfig<AppModels>({
  navigation: {
    categories: [
      {
        label: 'Unknown',
        // @ts-expect-error — category model names are typed too.
        models: ['Comment']
      }
    ]
  }
});
