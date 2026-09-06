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
