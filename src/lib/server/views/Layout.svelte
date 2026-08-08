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

  const branding = config.branding ?? {};
  const title = branding.title || 'Admin';
  const primaryColor = branding.primaryColor || '#6366f1';
  const basePath = config.basePath || '/admin';
</script>

<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  {@html `<style>${styles(primaryColor)}</style>`}
</head>
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
          {#each modelList as m}
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
    </aside>
    <main class="ska-main">
      {@html content}
    </main>
  </div>
</body>
</html>
