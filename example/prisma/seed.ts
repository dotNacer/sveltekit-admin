import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Deux organisations avec des données volontairement homonymes (une catégorie
 * « Technology » chacune, un « Draft Post » chacune). Si l'isolation fuit, on
 * voit immédiatement les doublons apparaître dans une seule vue.
 */
const TENANTS = [
  {
    slug: 'acme',
    name: 'Acme Corp',
    users: [
      { email: 'ada@acme.test', name: 'Ada (Acme)' },
      { email: 'bob@acme.test', name: 'Bob (Acme)' }
    ],
    categories: ['Technology', 'Business'],
    posts: [
      { title: 'Acme — roadmap interne', published: true },
      { title: 'Acme — Draft Post', published: false }
    ]
  },
  {
    slug: 'globex',
    name: 'Globex',
    users: [
      { email: 'gina@globex.test', name: 'Gina (Globex)' },
      { email: 'hank@globex.test', name: 'Hank (Globex)' }
    ],
    categories: ['Technology', 'Lifestyle'],
    posts: [
      { title: 'Globex — plan produit confidentiel', published: true },
      { title: 'Globex — Draft Post', published: false }
    ]
  }
];

async function main() {
  // Base de démo : on repart de zéro à chaque seed pour que les comparaisons
  // entre tenants restent lisibles.
  await prisma.post.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  for (const tenant of TENANTS) {
    const org = await prisma.organization.create({
      data: { slug: tenant.slug, name: tenant.name }
    });

    const users = [];
    for (const user of tenant.users) {
      users.push(
        await prisma.user.create({
          data: { ...user, role: 'admin', password: 'demo', organizationId: org.id }
        })
      );
    }

    for (const name of tenant.categories) {
      await prisma.category.create({
        data: { name, description: `${name} chez ${tenant.name}`, organizationId: org.id }
      });
    }

    for (const [index, post] of tenant.posts.entries()) {
      await prisma.post.create({
        data: {
          ...post,
          content: `Contenu appartenant à ${tenant.name}.`,
          authorId: users[index % users.length]!.id,
          organizationId: org.id
        }
      });
    }

    console.log(`${tenant.name} (/${tenant.slug}) : ${tenant.users.length} users, ${tenant.categories.length} catégories, ${tenant.posts.length} posts`);
  }

  console.log('\nSeed terminé. `pnpm run dev`, puis http://localhost:5173');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
