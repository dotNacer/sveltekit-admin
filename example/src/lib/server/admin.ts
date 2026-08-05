import { prisma } from './db';
import { createAdmin } from '$lib/admin/admin';

export const admin = createAdmin({
  prisma,
  schemaPath: './prisma/schema.prisma',
  basePath: '/admin',
  exclude: [],
  models: {
    User: {
      hidden: ['password'],
      readonly: ['id', 'createdAt', 'updatedAt'],
      listFields: ['email', 'name', 'role', 'createdAt'],
      label: 'Users'
    },
    Post: {
      readonly: ['id', 'createdAt', 'updatedAt'],
      listFields: ['title', 'published', 'author', 'createdAt'],
      label: 'Posts'
    },
    Category: {
      readonly: ['id', 'createdAt'],
      listFields: ['name', 'description', 'createdAt'],
      label: 'Categories'
    }
  },
  branding: {
    title: 'My Admin',
    primaryColor: '#6366f1'
  },
  checkAdmin: (user: any) => user?.role === 'admin'
});
