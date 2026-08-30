import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Bascule de tenant : pose le cookie lu par le hook, puis renvoie à l'admin. */
export const GET: RequestHandler = ({ params, cookies, url }) => {
  cookies.set('tenant', params.slug, { path: '/', httpOnly: true, sameSite: 'lax' });
  throw redirect(303, url.searchParams.get('to') ?? '/admin/post');
};
