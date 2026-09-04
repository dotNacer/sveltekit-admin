<script lang="ts">
  import type { AdminHandlerConfig } from '../handler.js';
  import { styles } from './theme.js';

  let {
    content,
    config,
    modelList,
    modelGroups,
    currentModel,
    extraStyles = '',
    extraScripts = ''
  }: {
    content: string;
    config: AdminHandlerConfig;
    modelList: Array<{ name: string; label: string }>;
    modelGroups?: Array<{ label: string; models: Array<{ name: string; label: string }> }>;
    currentModel?: string;
    extraStyles?: string;
    extraScripts?: string;
  } = $props();

  const branding = $derived(config.branding ?? {});
  const title = $derived(branding.title || 'Admin');
  const primaryColor = $derived(branding.primaryColor || '#6366f1');
  const basePath = $derived(config.basePath || '/admin');
  // No button at all if `logout` isn't configured — an admin that never
  // opted into this option looks exactly as it did before it existed.
  const showLogout = $derived(Boolean(config.logout));

  // extraStyles is concatenated into the SAME @html expression as the theme <style>
  // below, rather than a sibling {#if}/{@html} block: Svelte 5's SSR unconditionally
  // wraps every {#if}/{#each}/{@html} node in its own hydration-boundary comment, even
  // for a false/empty branch (see svelte/internal/server's `html()` helper) — a sibling
  // block would add bytes to every render regardless of extraStyles being set.
  // Concatenating keeps this ONE @html call, byte-identical to the pre-plugin-slots
  // template when extraStyles is ''. extraScripts (bottom of <body>) has no such
  // pre-existing @html call to fold into, so it stays its own @html — the smallest
  // achievable footprint, though it still adds a fixed hydration-boundary comment
  // pair even when empty (see task-6-report.md fix-round-1 notes).
  //
  // Built as a $derived here (rather than a nested template literal inline in the
  // markup below) so tooling that tag-sniffs {@html} expressions for literal
  // <style>/<script> text doesn't misparse the nested backticks.
  const headStyleHtml = $derived(
    `<style>${styles(primaryColor)}</style>${extraStyles ? `<style>${extraStyles}</style>` : ''}`
  );
  const bodyScriptHtml = $derived(extraScripts ? '<script>' + extraScripts + '</scr' + 'ipt>' : '');
</script>

<!doctype html>
<html lang="en">
<!-- eslint-disable-next-line svelte/no-raw-special-elements -- server-only full-document template, never mounted client-side -->
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- CSS injected as raw text; a literal <style> block can't take a dynamic value; primaryColor is developer-supplied config, not request/database data, and this raw interpolation is unchanged from the original layout.ts implementation, not a new injection point introduced by this migration -->
  {@html headStyleHtml}
</head>
<!-- eslint-disable-next-line svelte/no-raw-special-elements -- server-only full-document template, never mounted client-side -->
<body>
  <!-- Premier élément focusable de la page : sans lui, atteindre le contenu au
       clavier demande de retraverser toute la nav latérale à chaque page. -->
  <a href="#ska-content" class="ska-skip">Skip to content</a>
  <div class="ska-layout">
    <aside class="ska-sidebar">
      <a href={basePath} class="ska-logo">{title}</a>
      <nav aria-label="Main">
        <ul class="ska-nav">
          <li class="ska-nav__item">
            <a href={basePath} class="ska-nav__link" class:ska-nav__link--active={!currentModel}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Dashboard
            </a>
          </li>
          {#if modelGroups}
            {#each modelGroups as group (group.label)}
              <li class="ska-nav__section" aria-label={group.label}>{group.label}</li>
              {#each group.models as m (m.name)}
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
            {/each}
          {/if}
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
    <main class="ska-main" id="ska-content" tabindex="-1">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- content is pre-rendered HTML from sibling view components / the handler's own escaped error string -->
      {@html content}
    </main>
  </div>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- plugin JS is developer-supplied, same trust as branding.primaryColor -->
  {@html bodyScriptHtml}
</body>
</html>
