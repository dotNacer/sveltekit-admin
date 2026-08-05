<script lang="ts">
  import type { Snippet } from 'svelte';
  
  interface Props {
    data: {
      models: Array<{ name: string; label?: string }>;
      config: { basePath: string };
    };
    children: Snippet;
  }

  let { data, children }: Props = $props();
</script>

<div style="display: flex; min-height: 100vh; font-family: system-ui, sans-serif;">
  <aside style="width: 250px; background: #1e293b; color: white; padding: 1rem;">
    <h2 style="margin: 0 0 1rem; font-size: 1.25rem;">Admin</h2>
    <nav>
      <a href="{data.config.basePath}" style="display: block; padding: 0.5rem; color: #94a3b8; text-decoration: none;">Dashboard</a>
      {#each data.models as model}
        <a 
          href="{data.config.basePath}/{model.name.toLowerCase()}" 
          style="display: block; padding: 0.5rem; color: #94a3b8; text-decoration: none;"
        >
          {model.label || model.name}
        </a>
      {/each}
    </nav>
  </aside>
  <main style="flex: 1; padding: 1.5rem; background: #f8fafc;">
    {@render children()}
  </main>
</div>
