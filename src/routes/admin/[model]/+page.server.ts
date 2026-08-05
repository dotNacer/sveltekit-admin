import type { PageServerLoad, Actions } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const { model: modelName } = params;

  // Parse query params
  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = parseInt(url.searchParams.get('perPage') || '20');
  const search = url.searchParams.get('search') || '';
  const orderBy = url.searchParams.get('orderBy') || 'id';
  const orderDir = (url.searchParams.get('orderDir') || 'desc') as 'asc' | 'desc';

  // This will be populated by the plugin
  // For now, return placeholder structure
  return {
    model: {
      name: modelName,
      label: modelName,
      fields: [],
      primaryKey: 'id'
    },
    items: [],
    total: 0,
    page,
    perPage,
    orderBy,
    orderDir,
    search,
    config: {
      basePath: '/admin',
      hidden: [],
      listFields: []
    }
  };
};

export const actions: Actions = {
  delete: async ({ params, request, locals }) => {
    const formData = await request.formData();
    const id = formData.get('id');

    if (!id) {
      throw error(400, 'Missing ID');
    }

    // This will be implemented by the plugin
    // For now, just redirect back
    throw redirect(303, `/admin/${params.model}`);
  }
};
