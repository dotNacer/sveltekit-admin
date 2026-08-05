<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/stores';
  
  interface Props {
    title?: string;
    logo?: string;
    primaryColor?: string;
    models?: Array<{ name: string; label?: string; icon?: string }>;
    basePath?: string;
    user?: { name?: string; email?: string };
    children: Snippet;
  }

  let { 
    title = 'Admin',
    logo,
    primaryColor = '#6366f1',
    models = [],
    basePath = '/admin',
    user,
    children 
  }: Props = $props();

  let sidebarOpen = $state(true);
  
  const currentPath = $derived($page.url.pathname);

  function isActive(path: string): boolean {
    return currentPath.startsWith(path);
  }

  const icons: Record<string, string> = {
    users: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    default: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
    dashboard: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
    menu: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
    logout: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`
  };

  function getIcon(name?: string): string {
    if (!name) return icons.default;
    const lower = name.toLowerCase();
    if (lower.includes('user')) return icons.users;
    return icons[lower] || icons.default;
  }

  function toLabel(name: string): string {
    return name.replace(/([A-Z])/g, ' $1').trim();
  }
</script>

<div class="ska-layout" style="--ska-primary: {primaryColor}">
  <!-- Sidebar -->
  <aside class="ska-sidebar" class:ska-sidebar--closed={!sidebarOpen}>
    <div class="ska-sidebar__header">
      {#if logo}
        <img src={logo} alt={title} class="ska-sidebar__logo" />
      {:else}
        <span class="ska-sidebar__title">{title}</span>
      {/if}
    </div>

    <nav class="ska-sidebar__nav">
      <a 
        href={basePath} 
        class="ska-sidebar__link"
        class:ska-sidebar__link--active={currentPath === basePath}
      >
        {@html icons.dashboard}
        <span>Dashboard</span>
      </a>

      <div class="ska-sidebar__section">
        <span class="ska-sidebar__section-title">Models</span>
      </div>

      {#each models as model}
        <a 
          href="{basePath}/{model.name.toLowerCase()}"
          class="ska-sidebar__link"
          class:ska-sidebar__link--active={isActive(`${basePath}/${model.name.toLowerCase()}`)}
        >
          {@html getIcon(model.icon || model.name)}
          <span>{model.label || toLabel(model.name)}</span>
        </a>
      {/each}
    </nav>

    {#if user}
      <div class="ska-sidebar__footer">
        <div class="ska-sidebar__user">
          <div class="ska-sidebar__avatar">
            {user.name?.[0] || user.email?.[0] || 'A'}
          </div>
          <div class="ska-sidebar__user-info">
            <span class="ska-sidebar__user-name">{user.name || 'Admin'}</span>
            <span class="ska-sidebar__user-email">{user.email}</span>
          </div>
        </div>
        <a href="/api/auth/logout" class="ska-sidebar__link ska-sidebar__link--logout">
          {@html icons.logout}
          <span>Logout</span>
        </a>
      </div>
    {/if}
  </aside>

  <!-- Main content -->
  <div class="ska-main">
    <header class="ska-header">
      <button 
        class="ska-header__toggle"
        onclick={() => sidebarOpen = !sidebarOpen}
        aria-label="Toggle sidebar"
      >
        {@html icons.menu}
      </button>
    </header>

    <main class="ska-content">
      {@render children()}
    </main>
  </div>
</div>

<style>
  .ska-layout {
    --ska-bg: #f8fafc;
    --ska-sidebar-bg: #1e293b;
    --ska-sidebar-text: #94a3b8;
    --ska-sidebar-text-active: #ffffff;
    --ska-border: #e2e8f0;
    --ska-text: #1e293b;
    --ska-text-muted: #64748b;

    display: flex;
    min-height: 100vh;
    background: var(--ska-bg);
    font-family: system-ui, -apple-system, sans-serif;
  }

  .ska-sidebar {
    width: 260px;
    background: var(--ska-sidebar-bg);
    display: flex;
    flex-direction: column;
    transition: width 0.2s ease, transform 0.2s ease;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 40;
  }

  .ska-sidebar--closed {
    width: 0;
    transform: translateX(-100%);
  }

  .ska-sidebar__header {
    padding: 1.25rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .ska-sidebar__title {
    font-size: 1.25rem;
    font-weight: 700;
    color: white;
  }

  .ska-sidebar__logo {
    max-height: 2rem;
    width: auto;
  }

  .ska-sidebar__nav {
    flex: 1;
    padding: 1rem 0;
    overflow-y: auto;
  }

  .ska-sidebar__section {
    padding: 1rem 1rem 0.5rem;
  }

  .ska-sidebar__section-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ska-sidebar-text);
  }

  .ska-sidebar__link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 1rem;
    color: var(--ska-sidebar-text);
    text-decoration: none;
    font-size: 0.875rem;
    transition: all 0.15s ease;
  }

  .ska-sidebar__link:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--ska-sidebar-text-active);
  }

  .ska-sidebar__link--active {
    background: var(--ska-primary);
    color: var(--ska-sidebar-text-active);
  }

  .ska-sidebar__link--logout {
    margin-top: 0.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .ska-sidebar__footer {
    padding: 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .ska-sidebar__user {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .ska-sidebar__avatar {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    background: var(--ska-primary);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .ska-sidebar__user-info {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .ska-sidebar__user-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ska-sidebar__user-email {
    font-size: 0.75rem;
    color: var(--ska-sidebar-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ska-main {
    flex: 1;
    margin-left: 260px;
    transition: margin-left 0.2s ease;
    min-height: 100vh;
  }

  .ska-sidebar--closed + .ska-main {
    margin-left: 0;
  }

  .ska-header {
    height: 3.5rem;
    background: white;
    border-bottom: 1px solid var(--ska-border);
    display: flex;
    align-items: center;
    padding: 0 1rem;
    position: sticky;
    top: 0;
    z-index: 30;
  }

  .ska-header__toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: none;
    background: transparent;
    border-radius: 0.375rem;
    color: var(--ska-text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .ska-header__toggle:hover {
    background: var(--ska-bg);
    color: var(--ska-text);
  }

  .ska-content {
    padding: 1.5rem;
  }

  @media (max-width: 768px) {
    .ska-sidebar {
      transform: translateX(-100%);
    }

    .ska-sidebar:not(.ska-sidebar--closed) {
      transform: translateX(0);
    }

    .ska-main {
      margin-left: 0;
    }
  }
</style>
