import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { createAdminHandler } from 'sveltekit-admin';
import { prisma } from '$lib/server/db';

/**
 * Résout le tenant courant et le pose dans `locals`.
 *
 * Dans une vraie app, ceci vient de la session (better-auth, un JWT, …). Ici un
 * cookie suffit : ce qu'on veut éprouver c'est le scoping, pas l'auth. Le point
 * important est le même dans les deux cas — le tenant est déterminé par le
 * serveur. Il n'est jamais lu depuis l'URL ou le formulaire de la requête
 * courante, sinon l'utilisateur n'aurait qu'à changer le paramètre.
 */
const resolveTenant: Handle = async ({ event, resolve }) => {
  const slug = event.cookies.get('tenant') ?? 'acme';
  const org = await prisma.organization.findUnique({
    where: { slug },
    include: { users: { take: 1, orderBy: { email: 'asc' } } }
  });

  if (org?.users[0]) {
    const actor = org.users[0];
    event.locals.user = {
      id: actor.id,
      email: actor.email,
      name: actor.name ?? undefined,
      role: 'admin',
      organizationId: org.id
    };
    event.locals.organization = { id: org.id, slug: org.slug, name: org.name };
  }

  return resolve(event);
};

/**
 * `scope` doit renvoyer une condition non vide. Si `locals.user` est absent —
 * cookie pointant vers un tenant supprimé, session expirée — cette fonction
 * renvoie `{ organizationId: undefined }`, et la lib lève plutôt que de laisser
 * passer. C'est voulu : une condition vide se composerait en `AND` et
 * matcherait toutes les lignes, donc échouerait ouvert exactement au moment où
 * la protection est le plus nécessaire.
 */
const tenantScope = ({ locals }: { locals?: any }) => ({
  organizationId: locals?.user?.organizationId
});

const admin = createAdminHandler({
  prisma,
  prismaSchemaPath: './prisma/schema.prisma',
  basePath: '/admin',
  branding: { title: 'Multi-tenant demo', primaryColor: '#6366f1' },

  // La racine du tenant n'a rien à faire dans un admin scopé. La laisser
  // visible et non scopée est précisément ce qui rendait exploitable la faille
  // corrigée sur cette branche : la revalidation d'une FK vers un modèle non
  // scopé accepte n'importe quel id existant.
  exclude: ['Organization'],

  models: {
    User: {
      label: 'Users',
      hidden: ['password'],
      readonly: ['id', 'createdAt', 'updatedAt'],
      scope: tenantScope
    },
    Post: {
      label: 'Posts',
      readonly: ['id', 'createdAt', 'updatedAt'],
      scope: tenantScope
    },
    Category: {
      label: 'Categories',
      readonly: ['id', 'createdAt'],
      scope: tenantScope
    }
  },

  // Un widget de chaque type. Chaque lecture compose `tenantScope` comme
  // n'importe quelle autre lecture servie par l'admin : ce dashboard ne
  // montre jamais les données d'une autre organisation.
  dashboard: {
    title: 'Multi-tenant demo',
    subtitle: 'Everything below is scoped to the current tenant',
    widgets: [
      { type: 'stats' },
      { type: 'models', title: 'Content', models: ['Post', 'Category'] },
      { type: 'count', model: 'Post', label: 'Published posts', query: 'f.published=true' },
      { type: 'recent', model: 'Post', title: 'Latest posts', limit: 5 }
    ]
  },

  authCheck: (event) => event.locals.user?.role === 'admin'
});

export const handle = sequence(resolveTenant, admin);
