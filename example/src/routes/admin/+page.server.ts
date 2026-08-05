import { admin } from '$lib/server/admin';
import { createDashboardLoad } from '$lib/admin/admin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = createDashboardLoad(admin);
