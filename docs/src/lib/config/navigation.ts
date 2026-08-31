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
        slug: 'guides',
        name: 'Guides',
        items: [
          { slug: 'authentication', name: 'Authentication & Logout' },
          { slug: 'model-configuration', name: 'Configure Models' },
          { slug: 'relations', name: 'Configure Relations' },
          { slug: 'search-filters', name: 'Search, Filters & Sorting' },
          { slug: 'audit-log', name: 'Add Audit Logging' },
          { slug: 'plugins', name: 'Build Plugins' }
        ]
      },
      {
        slug: 'concepts',
        name: 'Concepts',
        items: [
          { slug: 'how-it-works', name: 'How It Works' },
          { slug: 'csrf', name: 'Security & CSRF' },
          { slug: 'field-types', name: 'Field Types & Limitations' }
        ]
      },
      {
        slug: 'reference',
        name: 'Reference',
        items: [{ slug: 'configuration-reference', name: 'Configuration Reference' }]
      },
      {
        slug: 'troubleshooting',
        name: 'Troubleshooting'
      },
      {
        slug: 'changelog',
        name: 'Changelog'
      }
    ]
  }
];
