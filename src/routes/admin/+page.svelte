<script lang="ts">
  interface Props {
    data: {
      models: Array<{
        name: string;
        label?: string;
        count: number;
      }>;
      stats: {
        totalRecords: number;
        modelsCount: number;
      };
    };
  }

  let { data }: Props = $props();

  const icons = {
    database: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`,
    layers: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/></svg>`,
    arrowRight: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`
  };

  function toLabel(name: string): string {
    return name.replace(/([A-Z])/g, ' $1').trim();
  }
</script>

<div class="ska-dashboard">
  <header class="ska-dashboard__header">
    <h1 class="ska-dashboard__title">Dashboard</h1>
    <p class="ska-dashboard__subtitle">Welcome to your admin panel</p>
  </header>

  <!-- Stats -->
  <div class="ska-dashboard__stats">
    <div class="ska-stat-card">
      <div class="ska-stat-card__icon">
        {@html icons.layers}
      </div>
      <div class="ska-stat-card__content">
        <span class="ska-stat-card__value">{data.stats.modelsCount}</span>
        <span class="ska-stat-card__label">Models</span>
      </div>
    </div>
    <div class="ska-stat-card">
      <div class="ska-stat-card__icon">
        {@html icons.database}
      </div>
      <div class="ska-stat-card__content">
        <span class="ska-stat-card__value">{data.stats.totalRecords}</span>
        <span class="ska-stat-card__label">Total Records</span>
      </div>
    </div>
  </div>

  <!-- Models Grid -->
  <section class="ska-dashboard__section">
    <h2 class="ska-dashboard__section-title">Models</h2>
    <div class="ska-models-grid">
      {#each data.models as model}
        <a href="/admin/{model.name.toLowerCase()}" class="ska-model-card">
          <div class="ska-model-card__header">
            <h3 class="ska-model-card__name">{model.label || toLabel(model.name)}</h3>
            <span class="ska-model-card__count">{model.count} records</span>
          </div>
          <div class="ska-model-card__footer">
            <span>Manage</span>
            {@html icons.arrowRight}
          </div>
        </a>
      {/each}
    </div>
  </section>
</div>

<style>
  .ska-dashboard {
    max-width: 1200px;
  }

  .ska-dashboard__header {
    margin-bottom: 2rem;
  }

  .ska-dashboard__title {
    font-size: 1.875rem;
    font-weight: 700;
    color: #1e293b;
    margin: 0 0 0.25rem;
  }

  .ska-dashboard__subtitle {
    color: #64748b;
    margin: 0;
  }

  .ska-dashboard__stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .ska-stat-card {
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 1.25rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .ska-stat-card__icon {
    width: 3rem;
    height: 3rem;
    background: #eef2ff;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ska-primary, #6366f1);
  }

  .ska-stat-card__content {
    display: flex;
    flex-direction: column;
  }

  .ska-stat-card__value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e293b;
  }

  .ska-stat-card__label {
    font-size: 0.875rem;
    color: #64748b;
  }

  .ska-dashboard__section {
    margin-bottom: 2rem;
  }

  .ska-dashboard__section-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 1rem;
  }

  .ska-models-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .ska-model-card {
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 1.25rem;
    text-decoration: none;
    transition: all 0.15s;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 120px;
  }

  .ska-model-card:hover {
    border-color: var(--ska-primary, #6366f1);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .ska-model-card__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .ska-model-card__name {
    font-size: 1rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
  }

  .ska-model-card__count {
    font-size: 0.75rem;
    color: #64748b;
    background: #f1f5f9;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
  }

  .ska-model-card__footer {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--ska-primary, #6366f1);
    font-size: 0.875rem;
    font-weight: 500;
  }
</style>
