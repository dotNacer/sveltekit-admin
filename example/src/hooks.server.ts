import { createAdminHandler } from 'sveltekit-admin';
import { prisma } from '$lib/server/db';

export const handle = createAdminHandler({
  prisma,
  prismaSchemaPath: './prisma/schema.prisma',
  basePath: '/admin',
  branding: { title: 'My Admin', primaryColor: '#6366f1' },
  models: {
    User: { label: 'Users', hidden: ['password'], readonly: ['id', 'createdAt', 'updatedAt'] },
    Post: { label: 'Posts', readonly: ['id', 'createdAt', 'updatedAt'] },
    Category: { label: 'Categories', readonly: ['id', 'createdAt'] }
  },
  authCheck: (event) => event.locals.user?.role === 'admin'
});
