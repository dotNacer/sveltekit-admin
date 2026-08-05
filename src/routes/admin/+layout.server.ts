import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  // This will be injected by the plugin with actual values
  // For now, return placeholder data
  
  const user = (locals as Record<string, unknown>).user as { name?: string; email?: string } | undefined;
  
  return {
    models: [], // Will be populated by plugin
    user,
    config: {
      basePath: '/admin',
      branding: {
        title: 'Admin',
        primaryColor: '#6366f1'
      }
    }
  };
};
