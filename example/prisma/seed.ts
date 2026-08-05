import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      password: 'admin123' // In real app, this would be hashed
    }
  });

  // Create regular user
  const user = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      name: 'Regular User',
      role: 'user',
      password: 'user123'
    }
  });

  // Create categories
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { name: 'Technology' },
      update: {},
      create: { name: 'Technology', description: 'Tech articles and news' }
    }),
    prisma.category.upsert({
      where: { name: 'Lifestyle' },
      update: {},
      create: { name: 'Lifestyle', description: 'Life tips and stories' }
    }),
    prisma.category.upsert({
      where: { name: 'Business' },
      update: {},
      create: { name: 'Business', description: 'Business insights' }
    })
  ]);

  // Create posts
  const postsCount = await prisma.post.count();
  if (postsCount === 0) {
    await prisma.post.createMany({
      data: [
        {
          title: 'Getting Started with SvelteKit',
          content: 'SvelteKit is an amazing framework...',
          published: true,
          authorId: admin.id
        },
        {
          title: 'Why Prisma is Great',
          content: 'Prisma simplifies database access...',
          published: true,
          authorId: admin.id
        },
        {
          title: 'Draft Post',
          content: 'This is still a draft...',
          published: false,
          authorId: user.id
        }
      ]
    });
  }

  console.log('Database seeded!');
  console.log('Admin:', admin);
  console.log('User:', user);
  console.log('Categories:', categories.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
