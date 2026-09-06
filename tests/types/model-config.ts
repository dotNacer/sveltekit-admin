import { createAdminHandler, defineAdminConfig } from '../../src/lib/index.js';

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
      fieldOrder: ['email', 'createdAt']
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
