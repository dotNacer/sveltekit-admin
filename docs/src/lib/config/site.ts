/**
 * Canonical site-level metadata shared across SEO tags, manifests, and feeds.
 */
export const siteConfig = {
	/** Primary site name used in titles and Open Graph site fields. */
	name: 'sveltekit-admin',
	/** Compact site name for environments with strict length limits. */
	shortName: 'sveltekit-admin',
	/** Public canonical URL used to build absolute links. */
	url: 'https://sveltekit-admin.dev',
	/** Default SEO description for the homepage and fallback metadata. */
	description:
		'A Django-like admin panel for SvelteKit applications with Prisma. Auto-generated CRUD, list views, and forms from your Prisma schema in three lines of code.',
	/** Author shown in metadata and structured data. */
	author: 'dotNacer',
	/** Primary SEO keywords for indexing and discovery. */
	keywords: [
		'svelte',
		'sveltekit',
		'admin',
		'prisma',
		'crud',
		'dashboard',
		'admin-panel',
		'documentation'
	],
	/** Default social preview image endpoint. */
	ogImage: '/og',
	/** Browser chrome colors synchronized with the light and dark inset surfaces. */
	themeColor: {
		light: '#f7f7f8',
		dark: '#17181a'
	},
	/** External profile links used by docs actions and metadata. */
	links: {
		github: 'https://github.com/dotNacer/sveltekit-admin',
		twitter: 'https://example.com/'
	},
	/** Package metadata used in installation snippets and docs helpers. */
	package: {
		name: 'sveltekit-admin'
	}
};

/** Inferred type for strongly-typed consumers of `siteConfig`. */
export type SiteConfig = typeof siteConfig;
