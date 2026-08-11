<script lang="ts">
  import type { AdminHandlerConfig } from '../handler.js';
  import { styles } from './theme.js';

  let {
    content,
    config,
    modelList,
    currentModel
  }: {
    content: string;
    config: AdminHandlerConfig;
    modelList: Array<{ name: string; label: string }>;
    currentModel?: string;
  } = $props();

  const branding = $derived(config.branding ?? {});
  const title = $derived(branding.title || 'Admin');
  const primaryColor = $derived(branding.primaryColor || '#6366f1');
  const basePath = $derived(config.basePath || '/admin');
  // No button at all if `logout` isn't configured — an admin that never
  // opted into this option looks exactly as it did before it existed.
  const showLogout = $derived(Boolean(config.logout));
</script>

<!doctype html>
<html lang="en">
<!-- eslint-disable-next-line svelte/no-raw-special-elements -- server-only full-document template, never mounted client-side -->
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- CSS injected as raw text; a literal <style> block can't take a dynamic value; primaryColor is developer-supplied config, not request/database data, and this raw interpolation is unchanged from the original layout.ts implementation, not a new injection point introduced by this migration -->
  {@html `<style>${styles(primaryColor)}</style>`}
</head>
<!-- eslint-disable-next-line svelte/no-raw-special-elements -- server-only full-document template, never mounted client-side -->
<body>
  <div class="ska-layout">
    <aside class="ska-sidebar">
      <a href={basePath} class="ska-logo">{title}</a>
      <nav>
        <ul class="ska-nav">
          <li class="ska-nav__item">
            <a href={basePath} class="ska-nav__link" class:ska-nav__link--active={!currentModel}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Dashboard
            </a>
          </li>
          {#each modelList as m (m.name)}
          <li class="ska-nav__item">
            <a
              href="{basePath}/{m.name.toLowerCase()}"
              class="ska-nav__link"
              class:ska-nav__link--active={currentModel?.toLowerCase() === m.name.toLowerCase()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
              {m.label}
            </a>
          </li>
          {/each}
        </ul>
      </nav>
      {#if showLogout}
        <form method="POST" action="{basePath}/_logout" class="ska-logout">
          <button type="submit" class="ska-logout__btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Log out
          </button>
        </form>
      {/if}
    </aside>
    <main class="ska-main">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- content is pre-rendered HTML from sibling view components / the handler's own escaped error string -->
      {@html content}
    </main>
  </div>
</body>
</html>
