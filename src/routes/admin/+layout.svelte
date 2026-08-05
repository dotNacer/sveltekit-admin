<script lang="ts">
  import AdminLayout from '$lib/components/AdminLayout.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    data: {
      models: Array<{ name: string; label?: string }>;
      user?: { name?: string; email?: string };
      config: {
        basePath: string;
        branding: {
          title: string;
          logo?: string;
          primaryColor: string;
        };
      };
    };
    children: Snippet;
  }

  let { data, children }: Props = $props();
</script>

<AdminLayout
  title={data.config.branding.title}
  logo={data.config.branding.logo}
  primaryColor={data.config.branding.primaryColor}
  models={data.models}
  basePath={data.config.basePath}
  user={data.user}
>
  {@render children()}
</AdminLayout>
