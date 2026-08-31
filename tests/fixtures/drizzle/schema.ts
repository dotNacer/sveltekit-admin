import { relations } from 'drizzle-orm';
import { integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  name: text('name'),
  // Colonne sensible, pour la parité du chemin d'écriture avec Prisma :
  // `isSensitiveStringField` doit l'attraper via le mapping
  // `dataType: 'string'` -> `'String'` de l'introspecteur Drizzle. Nullable
  // exprès, pour ne pas contraindre les insertions des autres tests.
  passwordHash: text('password_hash'),
  tenantId: integer('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
});

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  authorId: integer('author_id')
    .notNull()
    .references(() => users.id)
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull()
});

export const postsToTags = sqliteTable(
  'posts_to_tags',
  {
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id)
  },
  (t) => ({ pk: primaryKey({ columns: [t.postId, t.tagId] }) })
);

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts)
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  postsToTags: many(postsToTags)
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  postsToTags: many(postsToTags)
}));

export const postsToTagsRelations = relations(postsToTags, ({ one }) => ({
  post: one(posts, { fields: [postsToTags.postId], references: [posts.id] }),
  tag: one(tags, { fields: [postsToTags.tagId], references: [tags.id] })
}));
