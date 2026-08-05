import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // This will be populated by the plugin with actual counts
  // For now, return placeholder data structure
  
  return {
    models: [],
    stats: {
      totalRecords: 0,
      modelsCount: 0
    }
  };
};
