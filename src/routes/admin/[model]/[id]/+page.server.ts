import type { PageServerLoad, Actions } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals }) => {
  const { model: modelName, id } = params;

  // This will be populated by the plugin
  return {
    model: {
      name: modelName,
      label: modelName,
      primaryKey: 'id',
      fields: []
    },
    item: { id },
    config: {
      basePath: '/admin',
      hidden: [],
      readonly: []
    },
    relationOptions: {}
  };
};

export const actions: Actions = {
  default: async ({ params, request, locals }) => {
    const formData = await request.formData();
    const data = Object.fromEntries(formData);

    // This will be implemented by the plugin
    throw redirect(303, `/admin/${params.model}`);
  }
};
