import { prisma } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const organizations = await prisma.organization.findMany({
    orderBy: { name: 'asc' },
    select: { slug: true, name: true, _count: { select: { posts: true, users: true, categories: true } } }
  });
  return { organizations, current: locals.organization ?? null };
};
