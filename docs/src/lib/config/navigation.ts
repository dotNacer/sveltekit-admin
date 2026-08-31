import type { DeepPartial, SectionUiConfig } from '$lib/config/content-ui';
import { AppBookIcon } from '$lib/components/icons';
import type { Component } from 'svelte';

export type ContentSectionLink = {
	label: string;
	href: string;
	icon?: Component<{ size?: number; class?: string }>;
	description?: string;
};

export type ContentSectionConfig = {
	/**
	 * URL-safe identifier used as the route segment and content directory name.
	 * The base path is derived as `/${id}`.
	 */
	id: string;
	label: string;
	navigation: ContentItem[];
	ui?: DeepPartial<SectionUiConfig>;
	icon?: Component;
	description?: string;
};

export type ContentItem = {
	slug: string;
	name: string;
	category?: string;
	showPagination?: boolean;
	items?: ContentItem[];
};

export const contentSections: ContentSectionConfig[] = [
	{
		id: 'docs',
		label: 'Docs',
		icon: AppBookIcon,
		description: 'Documentation for sveltekit-admin',
		navigation: [
			{
				slug: 'getting-started',
				name: 'Getting Started',
				items: [
					{ slug: '', name: 'Introduction' },
					{ slug: 'installation', name: 'Installation & Quick Start' }
				]
			},
			{
				slug: 'configuration',
				name: 'Configuration',
				items: [
					{ slug: 'configuration-reference', name: 'Configuration Reference' },
					{ slug: 'model-configuration', name: 'Model Configuration' },
					{ slug: 'dashboard', name: 'Dashboard' },
					{ slug: 'field-types', name: 'Field Types' },
					{ slug: 'authentication', name: 'Authentication' },
					{ slug: 'csrf', name: 'Cross-site protection' },
					{ slug: 'audit-log', name: 'Audit log' },
					{ slug: 'plugins', name: 'Plugins' }
				]
			},
			{
				slug: 'advanced',
				name: 'Advanced',
				items: [
					{ slug: 'how-it-works', name: 'How It Works' },
					{ slug: 'search-filters', name: 'Search & Filters' },
					{ slug: 'relations', name: 'Relations' }
				]
			},
			{
				slug: 'changelog',
				name: 'Changelog'
			}
		]
	}
];
