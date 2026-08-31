# Configurable Dashboard Widgets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le dashboard composable depuis la config (`dashboard.widgets`, un tableau ordonné de widgets typés) et en faire une vraie page d'accueil — actions rapides, sections nommées, compteurs filtrés, enregistrements récents.

**Architecture:** Un nouveau module `src/lib/server/dashboard.ts` porte les trois phases : `resolveDashboard` valide la config **une fois au boot** depuis `createAdminRuntime` (et pré-parse les queries de widget avec `parseListQuery`), `loadDashboard` exécute les lectures scopées par requête avec un compteur mémoïsé par modèle, et `groupWidgetRows` — pure — replie les widgets-cartes adjacents en rangées. `handler.ts` ne garde que deux appels. Les vues deviennent un dispatcher sur ces rangées.

**Tech Stack:** SvelteKit, Svelte 5 (runes + snippets), TypeScript, Vitest, Prisma + Drizzle via le `DataAdapter` maison, Changesets.

**Spec:** `docs/superpowers/specs/2026-08-31-configurable-dashboard-widgets-design.md`

## Global Constraints

- **Gate de couverture 100 %** (lines / statements / functions / branches) sur `src/lib/**`, imposé par `vitest.config.ts`. Aucun `exclude`, aucun `/* v8 ignore */` : toute branche ajoutée a un test réel. N'écris pas de code défensif inexerçable.
- **Commandes** : `pnpm run test` (suite complète), `pnpm exec vitest run <fichier>` (un fichier, après au moins un `pnpm run test:gen`), `pnpm run check` (svelte-check), `pnpm run lint`, `pnpm run test:coverage`.
- **Parité Prisma / Drizzle** obligatoire (règle de travail 4 de l'issue #25) : tout comportement de lecture ajouté passe par le `DataAdapter`, jamais par un client ORM direct.
- **Un seul prédicat de sensibilité** : `isSensitiveFieldName` (`introspection/parser.ts`). Ne jamais en réimplémenter un second.
- **Scope** : `models[].scope` est composé en `AND` dans **toute** lecture. Une `scope`/`listWhere` qui renvoie `{}` doit continuer à lever (fail loud), jamais être avalée par un `catch`.
- **Copie d'interface en anglais** (« Dashboard », « Models », « Total Records », « records », « Manage → », « + New »), comme le reste de l'admin. Les commentaires de `src/lib/server/query/**` et des nouveaux modules serveur sont en français, convention existante du dépôt.
- **Changesets** : chaque PR ajoute un fichier `.changeset/<nom>.md` écrit à la main (pas de CLI interactive), au format `---\n"sveltekit-admin": minor\n---` suivi du corps en prose.
- **Snapshots de caractérisation** : `tests/characterization/handler.snapshot.test.ts` capture le HTML complet du dashboard. Toute modification de rendu impose `pnpm exec vitest run tests/characterization -u` et la relecture du diff de snapshot avant commit.

---

## File Structure

**Créés**

| Fichier | Responsabilité |
|---|---|
| `src/lib/server/dashboard.ts` | Types publics des widgets, `resolveDashboard` (validation boot), `loadDashboard` (lectures par requête), `groupWidgetRows` (pure). Seul endroit qui connaît la sémantique des widgets. |
| `src/lib/server/views/RecentPanel.svelte` | Rendu d'un bloc « derniers enregistrements ». |
| `tests/unit/dashboard.test.ts` | Résolution + validation au boot. |
| `tests/unit/dashboardLoad.test.ts` | Chargement par requête (mémoïsation, scope, rédaction) via `prismaMock`. |
| `docs/src/lib/content/docs/dashboard.svx` | Page de doc de la feature. |

**Modifiés**

| Fichier | Modification |
|---|---|
| `src/lib/server/handler.ts` | `AdminHandlerConfig.dashboard?: DashboardConfig` ; la branche `route.view === 'dashboard'` se réduit à `loadDashboard` + `render`. |
| `src/lib/server/runtime.ts` | Appelle `resolveDashboard` au boot, expose `dashboard: ResolvedDashboard` sur `AdminRuntime` ; extrait `combinedScopeFrom`. |
| `src/lib/server/views/Dashboard.svelte` | Dispatcher sur les rangées. |
| `src/lib/server/views/ModelCard.svelte` | `<article>` à deux liens (stretched link + action rapide). |
| `src/lib/server/views/StatCard.svelte` | `href?` optionnel, icône `filter`. |
| `src/lib/server/views/theme.ts` | Styles des nouveaux blocs. |
| `src/lib/index.ts` | Export des types publics `DashboardConfig` / `DashboardWidget`. |
| `tests/unit/views/dashboard.test.ts` | Nouvelles props, nouveaux blocs. |
| `tests/characterization/handler.snapshot.test.ts.snap` | Régénéré. |
| `docs/src/lib/config/navigation.ts` | Entrée de la nouvelle page. |
| `docs/src/lib/content/docs/configuration-reference.svx` | Bloc `dashboard` dans l'exemple complet. |

---

# PR 1 — Relookage et actions rapides (aucune config)

Livrable autonome : le dashboard par défaut gagne une hiérarchie et un bouton « + New » par modèle, sans une requête de plus et sans nouvelle option de config.

## Task 1: Action rapide sur la carte modèle

**Files:**
- Modify: `src/lib/server/views/ModelCard.svelte`
- Modify: `src/lib/server/views/Dashboard.svelte`
- Modify: `src/lib/server/views/theme.ts` (bloc `/* Models grid */`, ~ligne 377)
- Test: `tests/unit/views/dashboard.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `ModelCard.svelte` accepte désormais `{ href: string; newHref: string; label: string; count: number }`. La Task 6 lui passera `newHref` depuis les données de widget.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajoute ces cas dans `tests/unit/views/dashboard.test.ts`, à l'intérieur du `describe` existant :

```ts
  it('offre une action rapide de création par modèle', () => {
    const html = renderDashboard(models, { total: 3, models: 2 });
    expect(html).toContain('href="/admin/user/new"');
    expect(html).toContain('href="/admin/post/new"');
  });

  it('nomme distinctement les deux liens de la carte', () => {
    const html = renderDashboard(models, { total: 3, models: 2 });
    // Deux liens dans la même carte : sans nom accessible distinct, un lecteur
    // d'écran annonce deux fois « + New » sans dire de quel modèle il s'agit.
    expect(html).toContain('aria-label="New Users"');
    expect(html).toContain('Manage →');
  });

  it('ne produit pas de lien imbriqué dans un lien', () => {
    const html = renderDashboard(models, { total: 3, models: 2 });
    // <a> dans <a> est invalide et casse la navigation au clavier : la carte
    // ne doit donc plus être elle-même un <a>.
    expect(html).toContain('<article class="ska-model-card"');
    expect(html).not.toMatch(/<a[^>]*class="ska-model-card"/);
  });
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm exec vitest run tests/unit/views/dashboard.test.ts`
Expected: FAIL — `href="/admin/user/new"` absent, `<article class="ska-model-card"` absent.

- [ ] **Step 3: Réécrire `ModelCard.svelte`**

Remplace intégralement `src/lib/server/views/ModelCard.svelte` par :

```svelte
<script lang="ts">
  let {
    href,
    newHref,
    label,
    count
  }: { href: string; newHref: string; label: string; count: number } = $props();
</script>

<!--
  Deux liens dans une même carte : la carte ne peut donc plus être un <a>
  (un <a> dans un <a> est invalide et casse la navigation clavier). Le lien
  « Manage » reste étendu à toute la surface via ::after (motif stretched
  link), le lien de création passe au-dessus par z-index.
-->
<article class="ska-model-card">
  <div>
    <div class="ska-model-card__name">{label}</div>
    <div class="ska-model-card__count">{count} records</div>
  </div>
  <div class="ska-model-card__footer">
    <a {href} class="ska-model-card__link">Manage →</a>
    <a href={newHref} class="ska-model-card__new" aria-label="New {label}">+ New</a>
  </div>
</article>
```

- [ ] **Step 4: Passer `newHref` depuis `Dashboard.svelte`**

Dans `src/lib/server/views/Dashboard.svelte`, remplace la ligne `<ModelCard ... />` par :

```svelte
    <ModelCard
      href="{basePath}/{m.name.toLowerCase()}"
      newHref="{basePath}/{m.name.toLowerCase()}/new"
      label={m.label}
      count={m.count}
    />
```

- [ ] **Step 5: Adapter les styles**

Dans `src/lib/server/views/theme.ts`, remplace le bloc allant de `.ska-model-card {` à `.ska-model-card__footer { … }` par :

```css
    .ska-model-card {
      position: relative;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      padding: 1.25rem;
      transition: all 0.15s;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 1rem;
      min-height: 100px;
    }

    .ska-model-card:hover,
    .ska-model-card:focus-within {
      border-color: var(--ska-primary);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }

    .ska-model-card__name {
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 0.25rem;
    }

    .ska-model-card__count {
      font-size: 0.75rem;
      color: #64748b;
    }

    .ska-model-card__footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .ska-model-card__link {
      color: var(--ska-primary);
      text-decoration: none;
    }

    /* Stretched link : toute la carte est cliquable vers la liste… */
    .ska-model-card__link::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 0.5rem;
    }

    /* …sauf l'action de création, qui repasse au-dessus de l'overlay. */
    .ska-model-card__new {
      position: relative;
      z-index: 1;
      color: #475569;
      text-decoration: none;
    }

    .ska-model-card__new:hover {
      color: var(--ska-primary);
    }
```

- [ ] **Step 6: Vérifier les tests de vue**

Run: `pnpm exec vitest run tests/unit/views/dashboard.test.ts`
Expected: PASS, y compris les tests préexistants (`href="/admin/user"`, `0 records`, échappement du label).

- [ ] **Step 7: Régénérer et relire le snapshot**

Run: `pnpm exec vitest run tests/characterization -u`
Puis: `git diff tests/characterization/__snapshots__/`
Attendu dans le diff : `<a class="ska-model-card">` devient `<article class="ska-model-card">`, apparition de `ska-model-card__link` et `ska-model-card__new`. Rien d'autre. Si une autre vue bouge, c'est une régression — corrige avant de continuer.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/views/ModelCard.svelte src/lib/server/views/Dashboard.svelte \
        src/lib/server/views/theme.ts tests/unit/views/dashboard.test.ts \
        tests/characterization/__snapshots__/
git commit -m "feat(dashboard): add a per-model quick create action"
```

## Task 2: En-tête et sections du dashboard

**Files:**
- Modify: `src/lib/server/views/Dashboard.svelte`
- Modify: `src/lib/server/views/theme.ts`
- Create: `.changeset/dashboard-quick-actions.md`
- Test: `tests/unit/views/dashboard.test.ts`

**Interfaces:**
- Consumes: `ModelCard.svelte` de la Task 1.
- Produces: les classes `ska-dashboard__header` et `ska-dashboard__section`, réutilisées par le dispatcher de la Task 6.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `tests/unit/views/dashboard.test.ts` :

```ts
  it('structure la page en en-tête et en sections', () => {
    const html = renderDashboard(models, { total: 3, models: 2 });
    expect(html).toContain('ska-dashboard__header');
    expect(html).toContain('<section class="ska-dashboard__section"');
  });
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm exec vitest run tests/unit/views/dashboard.test.ts -t "structure la page"`
Expected: FAIL — `ska-dashboard__header` absent.

- [ ] **Step 3: Restructurer `Dashboard.svelte`**

Remplace le markup (le bloc `<script>` reste inchangé) par :

```svelte
<header class="ska-dashboard__header">
  <h1>Dashboard</h1>
  <p class="ska-subtitle">Welcome to your admin panel</p>
</header>

<div class="ska-stats">
  <StatCard icon="models" value={stats.models} label="Models" />
  <StatCard icon="records" value={stats.total} label="Total Records" />
</div>

<section class="ska-dashboard__section">
  <h2>Models</h2>
  <div class="ska-models">
    {#each models as m (m.name)}
      <ModelCard
        href="{basePath}/{m.name.toLowerCase()}"
        newHref="{basePath}/{m.name.toLowerCase()}/new"
        label={m.label}
        count={m.count}
      />
    {/each}
  </div>
</section>
```

- [ ] **Step 4: Ajouter les styles**

Dans `src/lib/server/views/theme.ts`, juste avant le commentaire `/* Stats grid */` :

```css
    /* Dashboard */
    .ska-dashboard__header {
      margin-bottom: 1.5rem;
    }

    .ska-dashboard__header .ska-subtitle {
      margin-bottom: 0;
    }

    .ska-dashboard__section + .ska-dashboard__section {
      margin-top: 2rem;
    }
```

- [ ] **Step 5: Vérifier**

Run: `pnpm exec vitest run tests/unit/views/dashboard.test.ts`
Expected: PASS (5 + 4 cas).

Run: `pnpm exec vitest run tests/characterization -u` puis relis `git diff tests/characterization/__snapshots__/`.

- [ ] **Step 6: Vérifier la suite complète, les types et le lint**

```bash
pnpm run test
pnpm run check
pnpm run lint
```
Expected: tout passe, couverture 100 % maintenue.

- [ ] **Step 7: Écrire le changeset**

Crée `.changeset/dashboard-quick-actions.md` :

```markdown
---
"sveltekit-admin": minor
---

**Le dashboard offre une action de création par modèle.** Chaque carte porte un lien « + New » vers le formulaire de création, à côté du lien « Manage → » qui reste étendu à toute la surface de la carte. Créer un enregistrement ne demande plus de passer par la liste.

La carte n'est plus un `<a>` : deux liens ne peuvent pas être imbriqués l'un dans l'autre sans casser la navigation au clavier et l'annonce des lecteurs d'écran. C'est maintenant un `<article>` dont le lien « Manage → » est étendu par un overlay, avec un nom accessible distinct pour chaque lien (« New Users » plutôt qu'un second « + New » anonyme).

La page gagne au passage un en-tête et des sections délimitées, préparation du dashboard configurable. Aucune requête supplémentaire n'est émise.
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/views/Dashboard.svelte src/lib/server/views/theme.ts \
        tests/unit/views/dashboard.test.ts tests/characterization/__snapshots__/ \
        .changeset/dashboard-quick-actions.md
git commit -m "feat(dashboard): structure the page into a header and sections"
```

---

# PR 2 — `dashboard.widgets`, validation au boot, widgets `stats` et `models`

## Task 3: `resolveDashboard` — types, validation au boot, câblage runtime

**Files:**
- Create: `src/lib/server/dashboard.ts`
- Create: `tests/unit/dashboard.test.ts`
- Modify: `src/lib/server/runtime.ts` (interface `AdminRuntime` ~ligne 94, corps de `createAdminRuntime`, objet retourné ~ligne 318)
- Modify: `src/lib/server/handler.ts` (`AdminHandlerConfig`)
- Test: `tests/unit/runtime.test.ts`

**Interfaces:**
- Consumes: `AdminConfigError` (`./errors.js`), `Model` (`./types/schema.js`).
- Produces:
  - `AdminRuntime.dashboard: ResolvedDashboard` — la Task 5 en dépend
  - `AdminHandlerConfig.dashboard?: DashboardConfig`
  - `interface DashboardConfig { title?: string; subtitle?: string; widgets?: DashboardWidget[] }`
  - `type DashboardWidget = { type: 'stats' } | { type: 'models'; title?: string; models?: string[] }` (étendu en PR 3 et PR 4)
  - `type ResolvedWidget = { type: 'stats' } | { type: 'models'; title?: string; modelNames: string[] }`
  - `interface ResolvedDashboard { title: string; subtitle: string; widgets: ResolvedWidget[] }`
  - `function resolveDashboard(deps: { config?: DashboardConfig; models: Model[] }): ResolvedDashboard`

- [ ] **Step 1: Écrire les tests qui échouent**

Crée `tests/unit/dashboard.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { resolveDashboard } from '../../src/lib/server/dashboard.js';
import { parsePrismaSchema } from '../../src/lib/server/introspection/parser.js';
import { FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

const schema = parsePrismaSchema(FULL_SCHEMA_PATH);
const models = schema.models;

describe('resolveDashboard', () => {
  it('sans config, rend les widgets historiques', () => {
    const resolved = resolveDashboard({ models });
    expect(resolved.title).toBe('Dashboard');
    expect(resolved.subtitle).toBe('Welcome to your admin panel');
    expect(resolved.widgets).toEqual([
      { type: 'stats' },
      { type: 'models', title: 'Models', modelNames: ['User', 'Post', 'Category'] }
    ]);
  });

  it('accepte un dashboard vide', () => {
    expect(resolveDashboard({ config: { widgets: [] }, models }).widgets).toEqual([]);
  });

  it('respecte l’ordre et les titres déclarés', () => {
    const resolved = resolveDashboard({
      config: {
        title: 'Console',
        subtitle: 'Tout va bien',
        widgets: [
          { type: 'models', title: 'Contenu', models: ['Post'] },
          { type: 'stats' },
          { type: 'models', title: 'Comptes', models: ['User'] }
        ]
      },
      models
    });
    expect(resolved.title).toBe('Console');
    expect(resolved.subtitle).toBe('Tout va bien');
    expect(resolved.widgets.map((w) => w.type)).toEqual(['models', 'stats', 'models']);
    expect(resolved.widgets[0]).toEqual({ type: 'models', title: 'Contenu', modelNames: ['Post'] });
  });

  it('refuse un type de widget inconnu', () => {
    expect(() =>
      resolveDashboard({ config: { widgets: [{ type: 'chart' } as any] }, models })
    ).toThrow(/dashboard\.widgets\[0\].*unknown type "chart"/);
  });

  it('refuse un modèle inconnu ou exclu', () => {
    expect(() =>
      resolveDashboard({ config: { widgets: [{ type: 'models', models: ['Session'] }] }, models })
    ).toThrow(/dashboard\.widgets\[0\].*"Session".*unknown or excluded/);
  });

  it('accepte un widget models sans titre', () => {
    const resolved = resolveDashboard({
      config: { widgets: [{ type: 'models', models: ['User'] }] },
      models
    });
    expect(resolved.widgets[0]).toEqual({ type: 'models', modelNames: ['User'] });
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm exec vitest run tests/unit/dashboard.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lib/server/dashboard.js"`.

- [ ] **Step 3: Écrire `dashboard.ts`**

Crée `src/lib/server/dashboard.ts` :

```ts
/**
 * Widgets de dashboard configurables. Trois phases, trois fonctions :
 * `resolveDashboard` valide la config UNE fois au démarrage (appelée par
 * `createAdminRuntime`), `loadDashboard` exécute les lectures scopées par
 * requête, `groupWidgetRows` met en page — pure.
 *
 * Toute la validation vit ici et lève au boot : une faute de frappe dans un
 * nom de modèle doit arrêter le démarrage, pas produire silencieusement un
 * bloc vide à chaque rendu (même politique que `validateListFilterConfig`).
 */
import { AdminConfigError } from './errors.js';
import type { Model } from './types/schema.js';

export interface DashboardConfig {
  /** Titre de la page. Défaut : « Dashboard ». */
  title?: string;
  /** Sous-titre. Défaut : « Welcome to your admin panel ». */
  subtitle?: string;
  /**
   * Widgets, dans l'ordre d'affichage. Omis, le dashboard historique est
   * rendu ; `[]` rend une page vide, ce qui est un choix légitime et non
   * une erreur de config.
   */
  widgets?: DashboardWidget[];
}

export type DashboardWidget =
  | { type: 'stats' }
  | { type: 'models'; title?: string; models?: string[] };

export type ResolvedWidget =
  | { type: 'stats' }
  | { type: 'models'; title?: string; modelNames: string[] };

export interface ResolvedDashboard {
  title: string;
  subtitle: string;
  widgets: ResolvedWidget[];
}

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { type: 'stats' },
  { type: 'models', title: 'Models' }
];

export function resolveDashboard(deps: {
  config?: DashboardConfig;
  models: Model[];
}): ResolvedDashboard {
  const { config, models } = deps;
  const known = new Set(models.map((m) => m.name));
  const widgets = (config?.widgets ?? DEFAULT_WIDGETS).map((widget, index) =>
    resolveWidget(widget, index, known, models)
  );
  return {
    title: config?.title ?? 'Dashboard',
    subtitle: config?.subtitle ?? 'Welcome to your admin panel',
    widgets
  };
}

function resolveWidget(
  widget: DashboardWidget,
  index: number,
  known: Set<string>,
  models: Model[]
): ResolvedWidget {
  if (widget.type === 'stats') return { type: 'stats' };

  if (widget.type === 'models') {
    const modelNames = widget.models ?? models.map((m) => m.name);
    for (const name of modelNames) {
      // Un modèle listé dans `exclude` n'est pas dans `models` : le refuser
      // ici est ce qui empêche un widget de le rendre visible par la porte
      // de derrière.
      if (!known.has(name)) {
        throw new AdminConfigError(
          `[sveltekit-admin] dashboard.widgets[${index}] references model "${name}", ` +
            `which is unknown or excluded. Known models: [${[...known].join(', ')}].`
        );
      }
    }
    return widget.title === undefined
      ? { type: 'models', modelNames }
      : { type: 'models', title: widget.title, modelNames };
  }

  throw new AdminConfigError(
    `[sveltekit-admin] dashboard.widgets[${index}] has unknown type ` +
      `"${(widget as { type: string }).type}".`
  );
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm exec vitest run tests/unit/dashboard.test.ts`
Expected: PASS (6 cas).

- [ ] **Step 5: Écrire les tests de boot qui échouent**

Ajoute à `tests/unit/runtime.test.ts` (adapte les imports à ceux déjà présents dans ce fichier) :

```ts
  it('résout le dashboard au démarrage', () => {
    const prisma = createPrismaMock({ user: [] });
    const runtime = createAdminRuntime({
      adapter: createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH })
    } as any);
    expect(runtime.dashboard.widgets[0]).toEqual({ type: 'stats' });
  });

  it('refuse une config de dashboard invalide au démarrage, pas au rendu', () => {
    const prisma = createPrismaMock({ user: [] });
    expect(() =>
      createAdminRuntime({
        adapter: createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH }),
        dashboard: { widgets: [{ type: 'models', models: ['Nope'] }] }
      } as any)
    ).toThrow(/unknown or excluded/);
  });
```

Run: `pnpm exec vitest run tests/unit/runtime.test.ts -t dashboard`
Expected: FAIL — `runtime.dashboard` est `undefined`.

- [ ] **Step 6: Câbler le runtime**

Dans `src/lib/server/runtime.ts` :

a. Import en tête :

```ts
import { resolveDashboard, type ResolvedDashboard } from './dashboard.js';
```

b. Dans l'interface `AdminRuntime`, sous `pageSizes` :

```ts
  /** Widgets validés au démarrage (jamais re-validés par requête). */
  dashboard: ResolvedDashboard;
```

c. Dans `createAdminRuntime`, juste après la boucle de validation de `listFilter` :

```ts
  // Même politique que `listFilter` et les plugins : une config de dashboard
  // invalide arrête le démarrage plutôt que de produire un bloc mort à chaque
  // rendu.
  const dashboard = resolveDashboard({ config: config.dashboard, models });
```

d. Dans l'objet retourné, après `pageSizes,` :

```ts
    dashboard,
```

- [ ] **Step 7: Déclarer l'option de config**

Dans `src/lib/server/handler.ts`, ajoute l'import :

```ts
import type { DashboardConfig } from './dashboard.js';
```

et, dans `AdminHandlerConfig`, après `basePath` :

```ts
  /**
   * Composition du dashboard : titre, sous-titre et widgets dans l'ordre
   * d'affichage. Omis, le dashboard historique est rendu. Validé au
   * démarrage — un modèle inconnu ou exclu lève ici, pas à l'écran.
   */
  dashboard?: DashboardConfig;
```

- [ ] **Step 8: Vérifier**

```bash
pnpm exec vitest run tests/unit/dashboard.test.ts tests/unit/runtime.test.ts
pnpm run check
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/server/dashboard.ts src/lib/server/runtime.ts src/lib/server/handler.ts \
        tests/unit/dashboard.test.ts tests/unit/runtime.test.ts
git commit -m "feat(dashboard): resolve and validate widget config at boot"
```

## Task 4: `groupWidgetRows` — mise en page pure

**Files:**
- Modify: `src/lib/server/dashboard.ts`
- Test: `tests/unit/dashboard.test.ts`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces:
  - `interface DashboardCard { value: number; label: string; icon: 'models' | 'records'; href?: string }`
  - `interface ModelCardData { name: string; label: string; count: number; href: string; newHref: string }`
  - `type LoadedWidget = { type: 'stats'; models: number; total: number } | { type: 'models'; title?: string; cards: ModelCardData[] }`
  - `type DashboardRow = { kind: 'cards'; cards: DashboardCard[] } | { kind: 'models'; title?: string; cards: ModelCardData[] }`
  - `function groupWidgetRows(loaded: LoadedWidget[]): DashboardRow[]`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajoute à `tests/unit/dashboard.test.ts` :

```ts
import { groupWidgetRows } from '../../src/lib/server/dashboard.js';

const modelCard = (name: string) => ({
  name,
  label: name,
  count: 1,
  href: `/admin/${name.toLowerCase()}`,
  newHref: `/admin/${name.toLowerCase()}/new`
});

describe('groupWidgetRows', () => {
  it('développe un widget stats en deux cartes', () => {
    const rows = groupWidgetRows([{ type: 'stats', models: 3, total: 42 }]);
    expect(rows).toEqual([
      {
        kind: 'cards',
        cards: [
          { value: 3, label: 'Models', icon: 'models' },
          { value: 42, label: 'Total Records', icon: 'records' }
        ]
      }
    ]);
  });

  it('rend un widget models dans sa propre rangée', () => {
    const rows = groupWidgetRows([
      { type: 'models', title: 'Contenu', cards: [modelCard('Post')] }
    ]);
    expect(rows).toEqual([
      { kind: 'models', title: 'Contenu', cards: [modelCard('Post')] }
    ]);
  });

  it('n’ouvre pas de rangée de cartes après un widget models', () => {
    const rows = groupWidgetRows([
      { type: 'models', cards: [modelCard('Post')] },
      { type: 'stats', models: 1, total: 1 }
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['models', 'cards']);
  });

  it('rend une liste vide pour un dashboard vide', () => {
    expect(groupWidgetRows([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm exec vitest run tests/unit/dashboard.test.ts -t groupWidgetRows`
Expected: FAIL — `groupWidgetRows is not a function`.

- [ ] **Step 3: Implémenter `groupWidgetRows`**

Ajoute à la fin de `src/lib/server/dashboard.ts` :

```ts
export interface DashboardCard {
  value: number;
  label: string;
  icon: 'models' | 'records';
  href?: string;
}

export interface ModelCardData {
  name: string;
  label: string;
  count: number;
  href: string;
  newHref: string;
}

export type LoadedWidget =
  | { type: 'stats'; models: number; total: number }
  | { type: 'models'; title?: string; cards: ModelCardData[] };

export type DashboardRow =
  | { kind: 'cards'; cards: DashboardCard[] }
  | { kind: 'models'; title?: string; cards: ModelCardData[] };

/**
 * Replie les widgets-cartes ADJACENTS dans une même rangée. Sans ce repli,
 * deux compteurs consécutifs tomberaient dans deux blocs distincts et
 * s'empileraient verticalement au lieu de s'aligner. Pure et testée en
 * table : la mise en page ne vit pas dans le template.
 */
export function groupWidgetRows(loaded: LoadedWidget[]): DashboardRow[] {
  const rows: DashboardRow[] = [];
  for (const widget of loaded) {
    const cards = cardsOf(widget);
    if (cards) {
      const last = rows[rows.length - 1];
      if (last && last.kind === 'cards') last.cards.push(...cards);
      else rows.push({ kind: 'cards', cards });
      continue;
    }
    rows.push(
      widget.title === undefined
        ? { kind: 'models', cards: widget.cards }
        : { kind: 'models', title: widget.title, cards: widget.cards }
    );
  }
  return rows;
}

function cardsOf(widget: LoadedWidget): DashboardCard[] | undefined {
  if (widget.type === 'stats') {
    return [
      { value: widget.models, label: 'Models', icon: 'models' },
      { value: widget.total, label: 'Total Records', icon: 'records' }
    ];
  }
  return undefined;
}
```

Note : la rangée est reconstruite champ par champ plutôt que par étalement de `widget` — un `...widget` ferait fuiter la clé `type` dans une structure qui n'en a pas.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm exec vitest run tests/unit/dashboard.test.ts`
Expected: PASS (10 cas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/dashboard.ts tests/unit/dashboard.test.ts
git commit -m "feat(dashboard): group adjacent card widgets into rows"
```

## Task 5: `loadDashboard` — lectures scopées et mémoïsées

**Files:**
- Modify: `src/lib/server/dashboard.ts`
- Create: `tests/unit/dashboardLoad.test.ts`

**Interfaces:**
- Consumes: `AdminRuntime` et `modelScopeFrom` (`./runtime.js`, import de type pour `AdminRuntime`), `ResolvedDashboard` de la Task 3, `groupWidgetRows` de la Task 4.
- Produces: `function loadDashboard(runtime: AdminRuntime, event: { locals?: unknown }): Promise<{ title: string; subtitle: string; rows: DashboardRow[] }>`.

- [ ] **Step 1: Écrire les tests qui échouent**

Crée `tests/unit/dashboardLoad.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { loadDashboard } from '../../src/lib/server/dashboard.js';
import { createAdminRuntime } from '../../src/lib/server/runtime.js';
import { createPrismaAdapter } from '../../src/lib/server/adapters/prisma/index.js';
import { createPrismaMock, callsTo, FULL_SCHEMA_PATH } from '../fixtures/prismaMock.js';

const DATA = {
  user: [
    { id: 1, email: 'a@x.y', name: 'A', password: 'secret', isActive: true },
    { id: 2, email: 'b@x.y', name: 'B', password: 'secret', isActive: false }
  ],
  post: [{ id: 'p1', title: 'Hello', authorId: 1 }],
  category: []
};

const runtimeWith = (config: Record<string, unknown> = {}, prisma = createPrismaMock(DATA)) => ({
  prisma,
  runtime: createAdminRuntime({
    adapter: createPrismaAdapter({ prisma, schemaPath: FULL_SCHEMA_PATH }),
    ...config
  } as any)
});

describe('loadDashboard', () => {
  it('compte chaque modèle et totalise pour le widget stats', async () => {
    const { runtime } = runtimeWith();
    const { rows, title } = await loadDashboard(runtime, { locals: {} });
    expect(title).toBe('Dashboard');
    expect(rows[0]).toEqual({
      kind: 'cards',
      cards: [
        { value: 3, label: 'Models', icon: 'models' },
        { value: 3, label: 'Total Records', icon: 'records' }
      ]
    });
  });

  it('construit les liens de chaque carte modèle', async () => {
    const { runtime } = runtimeWith();
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect(rows[1]).toEqual({
      kind: 'models',
      title: 'Models',
      cards: [
        { name: 'User', label: 'User', count: 2, href: '/admin/user', newHref: '/admin/user/new' },
        { name: 'Post', label: 'Post', count: 1, href: '/admin/post', newHref: '/admin/post/new' },
        {
          name: 'Category',
          label: 'Category',
          count: 0,
          href: '/admin/category',
          newHref: '/admin/category/new'
        }
      ]
    });
  });

  it('ne compte qu’une fois un modèle présent dans deux widgets', async () => {
    const { runtime, prisma } = runtimeWith({
      dashboard: {
        widgets: [
          { type: 'stats' },
          { type: 'models', models: ['User'] },
          { type: 'models', models: ['User', 'Post'] }
        ]
      }
    });
    await loadDashboard(runtime, { locals: {} });
    expect(callsTo(prisma, 'user', 'count')).toHaveLength(1);
  });

  it('compose le scope du modèle dans chaque comptage', async () => {
    const { runtime, prisma } = runtimeWith({
      models: { User: { scope: () => ({ isActive: true }) } }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    const userCard = (rows[1] as any).cards.find((c: any) => c.name === 'User');
    expect(userCard.count).toBe(1);
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({ where: { isActive: true } });
  });

  it('affiche 0 quand la table n’existe pas encore', async () => {
    const prisma = createPrismaMock(DATA, {
      user: {
        count: () => {
          throw new Error('no such table: User');
        }
      }
    });
    const { runtime } = runtimeWith({}, prisma);
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[1] as any).cards[0].count).toBe(0);
  });

  it('laisse remonter un scope qui échouerait ouvert', async () => {
    const { runtime } = runtimeWith({ models: { User: { scope: () => ({}) } } });
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(
      /must return a non-empty condition/
    );
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm exec vitest run tests/unit/dashboardLoad.test.ts`
Expected: FAIL — `loadDashboard is not a function`.

- [ ] **Step 3: Implémenter `loadDashboard`**

Ajoute en tête de `src/lib/server/dashboard.ts` :

```ts
import { modelScopeFrom, type AdminRuntime } from './runtime.js';
```

Puis à la fin du fichier :

```ts
/**
 * Un compteur par modèle, MÉMOÏSÉ pour la requête en cours : le widget
 * `stats` compte tous les modèles, et deux widgets `models` qui se recouvrent
 * réutilisent le même comptage. Sans ça, composer son dashboard se paierait
 * en requêtes dupliquées.
 *
 * `modelScopeFrom` est appelé HORS du `catch` : il lève volontairement sur un
 * scope qui échouerait ouvert (`{}`), et cette erreur-là ne doit jamais être
 * confondue avec « la table n'existe pas encore ».
 */
function makeCounter(runtime: AdminRuntime, locals: unknown) {
  const cache = new Map<string, Promise<number>>();
  return (model: Model): Promise<number> => {
    const hit = cache.get(model.name);
    if (hit) return hit;
    const scope = modelScopeFrom(runtime, model, { locals });
    const pending = runtime.adapter.data.countRecords(model, scope).catch(() => 0);
    cache.set(model.name, pending);
    return pending;
  };
}

export async function loadDashboard(
  runtime: AdminRuntime,
  event: { locals?: unknown }
): Promise<{ title: string; subtitle: string; rows: DashboardRow[] }> {
  const { title, subtitle, widgets } = runtime.dashboard;
  const countOf = makeCounter(runtime, event.locals);

  const loaded: LoadedWidget[] = [];
  for (const widget of widgets) {
    if (widget.type === 'stats') {
      const counts = await Promise.all(runtime.models.map((m) => countOf(m)));
      loaded.push({
        type: 'stats',
        models: runtime.models.length,
        total: counts.reduce((sum, n) => sum + n, 0)
      });
      continue;
    }

    const cards = await Promise.all(
      widget.modelNames.map(async (name) => {
        // Non-null par construction : `resolveDashboard` a refusé au boot
        // tout nom absent de `runtime.models`.
        const model = runtime.models.find((m) => m.name === name)!;
        const segment = model.name.toLowerCase();
        return {
          name: model.name,
          label: runtime.labelOf(model),
          count: await countOf(model),
          href: `${runtime.basePath}/${segment}`,
          newHref: `${runtime.basePath}/${segment}/new`
        };
      })
    );
    loaded.push(
      widget.title === undefined
        ? { type: 'models', cards }
        : { type: 'models', title: widget.title, cards }
    );
  }

  return { title, subtitle, rows: groupWidgetRows(loaded) };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm exec vitest run tests/unit/dashboardLoad.test.ts`
Expected: PASS (6 cas). Les rangées sont déjà produites par `groupWidgetRows`, mais rien ne les rend encore : c'est la Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/dashboard.ts tests/unit/dashboardLoad.test.ts
git commit -m "feat(dashboard): load widget data with a per-request count cache"
```

## Task 6: Câblage handler + vue

**Files:**
- Modify: `src/lib/server/handler.ts` (branche `route.view === 'dashboard'` ~ligne 450)
- Modify: `src/lib/server/views/Dashboard.svelte`
- Modify: `src/lib/index.ts`
- Test: `tests/unit/views/dashboard.test.ts`

**Interfaces:**
- Consumes: `loadDashboard` et `DashboardRow` du module `dashboard.ts`, `runtime.dashboard` de la Task 3.
- Produces: `Dashboard.svelte` prend `{ title: string; subtitle: string; rows: DashboardRow[] }`.

- [ ] **Step 1: Réduire la branche du handler**

Complète l'import de `dashboard.js` dans `src/lib/server/handler.ts` (le type `DashboardConfig` y est déjà importé depuis la Task 3) :

```ts
import { loadDashboard, type DashboardConfig } from './dashboard.js';
```

Remplace tout le bloc `} else if (route.view === 'dashboard') { … }` de `src/lib/server/handler.ts` par :

```ts
      } else if (route.view === 'dashboard') {
        const data = await loadDashboard(runtime, event);
        // `basePath` n'est plus une prop : les liens arrivent déjà construits
        // par `loadDashboard`, la vue n'a plus rien à concaténer.
        content = render(Dashboard, { props: data }).body;
```

Supprime l'import devenu inutile s'il ne sert plus ailleurs dans le fichier — vérifie avec `pnpm run lint` à l'étape 5, ne devine pas.

- [ ] **Step 2: Faire de `Dashboard.svelte` un dispatcher**

Remplace intégralement `src/lib/server/views/Dashboard.svelte` par :

```svelte
<script lang="ts">
  import StatCard from './StatCard.svelte';
  import ModelCard from './ModelCard.svelte';
  import type { DashboardRow } from '../dashboard.js';

  let {
    title,
    subtitle,
    rows
  }: { title: string; subtitle: string; rows: DashboardRow[] } = $props();
</script>

<header class="ska-dashboard__header">
  <h1>{title}</h1>
  <p class="ska-subtitle">{subtitle}</p>
</header>

{#each rows as row, rowIndex (rowIndex)}
  {#if row.kind === 'cards'}
    <div class="ska-stats">
      {#each row.cards as card, cardIndex (cardIndex)}
        <StatCard value={card.value} label={card.label} icon={card.icon} />
      {/each}
    </div>
  {:else}
    <section class="ska-dashboard__section">
      {#if row.title}<h2>{row.title}</h2>{/if}
      <div class="ska-models">
        {#each row.cards as m (m.name)}
          <ModelCard href={m.href} newHref={m.newHref} label={m.label} count={m.count} />
        {/each}
      </div>
    </section>
  {/if}
{/each}
```

- [ ] **Step 3: Réécrire les tests de vue**

Remplace l'en-tête de `tests/unit/views/dashboard.test.ts` par une fabrique de rangées, et adapte les cas existants :

```ts
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Dashboard from '../../../src/lib/server/views/Dashboard.svelte';
import type { DashboardRow } from '../../../src/lib/server/dashboard.js';

const renderDashboard = (rows: DashboardRow[], title = 'Dashboard', subtitle = 'Welcome to your admin panel') =>
  render(Dashboard, { props: { rows, title, subtitle } }).body;

const card = (name: string, label: string, count: number) => ({
  name,
  label,
  count,
  href: `/admin/${name.toLowerCase()}`,
  newHref: `/admin/${name.toLowerCase()}/new`
});

const ROWS: DashboardRow[] = [
  {
    kind: 'cards',
    cards: [
      { value: 2, label: 'Models', icon: 'models' },
      { value: 3, label: 'Total Records', icon: 'records' }
    ]
  },
  { kind: 'models', title: 'Models', cards: [card('User', 'Users', 3), card('Post', 'Posts', 0)] }
];

describe('Dashboard.svelte', () => {
  it('affiche les statistiques', () => {
    const html = renderDashboard(ROWS);
    expect(html).toContain('>2</div>');
    expect(html).toContain('>3</div>');
  });

  it('affiche une carte par modèle avec ses deux liens', () => {
    const html = renderDashboard(ROWS);
    expect(html).toContain('href="/admin/user"');
    expect(html).toContain('href="/admin/user/new"');
    expect(html).toContain('href="/admin/post"');
    expect(html).toContain('0 records');
    expect(html).toContain('aria-label="New Users"');
  });

  it('échappe les libellés fournis par la configuration', () => {
    const html = renderDashboard(
      [{ kind: 'models', title: '<i>T', cards: [card('User', '<b>U', 1)] }],
      '<script>x',
      '<em>s'
    );
    expect(html).toContain('&lt;b>U');
    expect(html).toContain('&lt;i>T');
    expect(html).toContain('&lt;script>x');
    expect(html).not.toContain('<b>U');
  });

  it('omet le titre de section quand il n’est pas configuré', () => {
    const html = renderDashboard([{ kind: 'models', cards: [card('User', 'Users', 1)] }]);
    expect(html).toContain('ska-dashboard__section');
    expect(html).not.toContain('<h2>');
  });

  it('rend une page vide sans widget', () => {
    const html = renderDashboard([]);
    expect(html).toContain('ska-dashboard__header');
    expect(html).not.toContain('ska-models');
  });

  it('structure la page en en-tête et en sections', () => {
    const html = renderDashboard(ROWS);
    expect(html).toContain('ska-dashboard__header');
    expect(html).toContain('<section class="ska-dashboard__section"');
  });

  it('ne produit pas de lien imbriqué dans un lien', () => {
    const html = renderDashboard(ROWS);
    expect(html).toContain('<article class="ska-model-card"');
    expect(html).not.toMatch(/<a[^>]*class="ska-model-card"/);
  });
});
```

- [ ] **Step 4: Exporter les types publics**

Dans `src/lib/index.ts`, ajoute :

```ts
export type { DashboardConfig, DashboardWidget } from './server/dashboard.js';
```

Puis ajoute le cas correspondant dans `tests/unit/index.test.ts` s'il énumère les exports — lis le fichier avant d'écrire, il vérifie la surface publique.

- [ ] **Step 5: Vérifier l'ensemble**

```bash
pnpm exec vitest run tests/unit/dashboardLoad.test.ts tests/unit/dashboard.test.ts \
                    tests/unit/views/dashboard.test.ts tests/unit/runtime.test.ts
pnpm run test
pnpm run check
pnpm run lint
```
Expected: PASS partout, couverture 100 %. Régénère les snapshots (`pnpm exec vitest run tests/characterization -u`) et relis le diff : seuls le `<h1>`/`<p>` d'en-tête et l'ordre des blocs peuvent bouger.

- [ ] **Step 6: Documenter**

a. Crée `docs/src/lib/content/docs/dashboard.svx` :

```markdown
---
title: Dashboard
name: Dashboard
description: Compose the admin home page from ordered widgets.
---

Without configuration the dashboard shows global stats and one card per model,
each card linking to its list and to its create form.

`dashboard.widgets` replaces that default with an ordered list — the array
order is the on-screen order.

## Widgets

```typescript
createAdminHandler({
  adapter,
  dashboard: {
    title: 'Console',
    subtitle: 'Everything at a glance',
    widgets: [
      { type: 'stats' },
      { type: 'models', title: 'Content', models: ['Post', 'Comment'] },
      { type: 'models', title: 'Accounts', models: ['User'] }
    ]
  }
});
```

- `stats` — the two global cards: number of models, total records.
- `models` — a grid of model cards. `models` selects and orders a subset;
  omitted, it shows every visible model. `title` renders a section heading.

`widgets: []` renders an empty page, which is a valid choice.

## Validation

The configuration is validated when the handler is created, not when the page
is rendered. A widget with an unknown `type`, or one referencing a model that
does not exist or sits in `exclude`, throws at boot — a typo stops startup
instead of silently rendering an empty block.

## Scope

Every count on the dashboard composes the model's `scope`, exactly like every
other read the admin serves. A model in `exclude` cannot be surfaced by a
widget.
```

b. Enregistre la page dans `docs/src/lib/config/navigation.ts`, à côté de la ligne `{ slug: 'model-configuration', name: 'Model Configuration' },` :

```ts
					{ slug: 'dashboard', name: 'Dashboard' },
```

c. Dans `docs/src/lib/content/docs/configuration-reference.svx`, ajoute dans le bloc « Full example », après l'option `basePath` :

```typescript
  // Dashboard composition (default: global stats + one card per model)
  dashboard: {
    widgets: [{ type: 'stats' }, { type: 'models', title: 'Models' }]
  },
```

- [ ] **Step 7: Écrire le changeset**

Crée `.changeset/configurable-dashboard-widgets.md` :

```markdown
---
"sveltekit-admin": minor
---

**The dashboard is composable from configuration.** `dashboard.widgets` takes an ordered array — the array order is the on-screen order — so the home page can show the models that matter, grouped under section titles, instead of one flat grid of everything.

```ts
dashboard: {
  title: 'Console',
  widgets: [
    { type: 'stats' },
    { type: 'models', title: 'Content', models: ['Post', 'Comment'] },
    { type: 'models', title: 'Accounts', models: ['User'] }
  ]
}
```

Two widget types ship here: `stats` (the two global cards) and `models` (a grid, optionally restricted and titled). Omitting `dashboard` keeps the previous page; `widgets: []` renders an empty one, which is a valid choice.

**The configuration is validated when the handler is created, not when the page renders.** An unknown widget type, or a widget pointing at a model that does not exist or sits in `exclude`, throws at boot — the same policy as `listFilter` and plugins. A model in `exclude` therefore cannot be brought back into view through a widget.

Counts are scoped exactly as before, and a model appearing in several widgets is counted once per request.
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/runtime.ts src/lib/server/handler.ts src/lib/index.ts \
        src/lib/server/views/Dashboard.svelte tests/ docs/src/lib \
        .changeset/configurable-dashboard-widgets.md
git commit -m "feat(dashboard): render the dashboard from configured widgets"
```

---

# PR 3 — Widget `count`

## Task 7: Validation de la query d'un compteur

**Files:**
- Modify: `src/lib/server/dashboard.ts`
- Test: `tests/unit/dashboard.test.ts`

**Interfaces:**
- Consumes: `parseListQuery` et `ListQuery` (`./query/listQuery.js`), `resolveSearchFields` (idem).
- Produces:
  - `DashboardWidget` gagne `| { type: 'count'; model: string; label: string; query?: string }`
  - `ResolvedWidget` gagne `| { type: 'count'; modelName: string; label: string; query: ListQuery; href: string }`
  - `resolveDashboard` prend quatre dépendances de plus : `enums: Map<string, string[]>`, `basePath: string`, `searchFieldsOf: (m: Model) => string[]`, `filterableFieldsOf: (m: Model) => Set<string>`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajoute à `tests/unit/dashboard.test.ts`. Note la fabrique de dépendances : elle remplace les appels `resolveDashboard({ models })` des tests existants, qu'il faut donc adapter au passage.

```ts
import { resolveSearchFields } from '../../src/lib/server/query/listQuery.js';
import { isSensitiveFieldName } from '../../src/lib/server/introspection/parser.js';

const deps = (config?: any) => ({
  config,
  models,
  enums: schema.enums,
  basePath: '/admin',
  searchFieldsOf: (m: any) => resolveSearchFields(m, undefined, ['name', 'email', 'title'], new Set()),
  filterableFieldsOf: (m: any) =>
    new Set(
      m.fields
        .filter(
          (f: any) =>
            !f.relation &&
            !f.isList &&
            !['Json', 'Bytes'].includes(f.type) &&
            !isSensitiveFieldName(f.name)
        )
        .map((f: any) => f.name)
    )
});

describe('resolveDashboard — widget count', () => {
  it('parse la query au boot et construit le lien vers la liste', () => {
    const [widget] = resolveDashboard(
      deps({ widgets: [{ type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' }] })
    ).widgets;
    expect(widget).toMatchObject({
      type: 'count',
      modelName: 'User',
      label: 'Actifs',
      href: '/admin/user?f.isActive=true'
    });
    expect((widget as any).query.filters).toHaveLength(1);
  });

  it('accepte un compteur sans query', () => {
    const [widget] = resolveDashboard(
      deps({ widgets: [{ type: 'count', model: 'User', label: 'Tous' }] })
    ).widgets;
    expect(widget).toMatchObject({ href: '/admin/user' });
  });

  it('trie les paramètres du lien', () => {
    const [widget] = resolveDashboard(
      deps({
        widgets: [{ type: 'count', model: 'User', label: 'X', query: 'q=bob&f.isActive=true' }]
      })
    ).widgets;
    expect((widget as any).href).toBe('/admin/user?f.isActive=true&q=bob');
  });

  it('refuse un filtre sur un champ sensible', () => {
    expect(() =>
      resolveDashboard(
        deps({ widgets: [{ type: 'count', model: 'User', label: 'X', query: 'f.password=x' }] })
      )
    ).toThrow(/dashboard\.widgets\[0\].*"f\.password"/);
  });

  it('refuse un filtre sur un champ inexistant', () => {
    expect(() =>
      resolveDashboard(
        deps({ widgets: [{ type: 'count', model: 'User', label: 'X', query: 'f.nope=1' }] })
      )
    ).toThrow(/dashboard\.widgets\[0\].*"f\.nope"/);
  });

  it('refuse un paramètre qui n’a aucun effet sur un comptage', () => {
    expect(() =>
      resolveDashboard(
        deps({ widgets: [{ type: 'count', model: 'User', label: 'X', query: 'page=2' }] })
      )
    ).toThrow(/dashboard\.widgets\[0\].*only "q" and "f\.\*" are supported.*"page"/);
  });

  it('refuse un compteur sans libellé', () => {
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'count', model: 'User', label: '  ' }] }))
    ).toThrow(/dashboard\.widgets\[0\].*non-empty `label`/);
  });

  it('refuse un compteur sur un modèle exclu', () => {
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'count', model: 'Session', label: 'X' }] }))
    ).toThrow(/unknown or excluded/);
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm exec vitest run tests/unit/dashboard.test.ts`
Expected: FAIL — `resolveDashboard` ignore `enums`/`basePath` et lève « unknown type "count" ».

- [ ] **Step 3: Étendre `resolveDashboard`**

Dans `src/lib/server/dashboard.ts` :

a. Ajoute les imports :

```ts
import { parseListQuery, type ListQuery } from './query/listQuery.js';
```

b. Étends les unions :

```ts
export type DashboardWidget =
  | { type: 'stats' }
  | { type: 'models'; title?: string; models?: string[] }
  | {
      type: 'count';
      model: string;
      label: string;
      /**
       * Filtre exprimé dans la query string que la vue liste comprend déjà
       * (`q=`, `f.<champ>[__<op>]=`). Conséquence voulue : un widget ne peut
       * rien exprimer que la liste ne sache montrer, la whitelist
       * d'opérateurs et l'exclusion des champs sensibles s'appliquent sans
       * seconde implémentation, et le lien « voir » pointe sur une liste dont
       * le total égale le compteur.
       */
      query?: string;
    };

export type ResolvedWidget =
  | { type: 'stats' }
  | { type: 'models'; title?: string; modelNames: string[] }
  | { type: 'count'; modelName: string; label: string; query: ListQuery; href: string };
```

c. Change la signature et le corps de `resolveDashboard` :

```ts
export interface ResolveDashboardDeps {
  config?: DashboardConfig;
  models: Model[];
  enums: Map<string, string[]>;
  basePath: string;
  searchFieldsOf: (model: Model) => string[];
  filterableFieldsOf: (model: Model) => Set<string>;
}

export function resolveDashboard(deps: ResolveDashboardDeps): ResolvedDashboard {
  const widgets = (deps.config?.widgets ?? DEFAULT_WIDGETS).map((widget, index) =>
    resolveWidget(widget, index, deps)
  );
  return {
    title: deps.config?.title ?? 'Dashboard',
    subtitle: deps.config?.subtitle ?? 'Welcome to your admin panel',
    widgets
  };
}
```

`resolveWidget` reçoit désormais `deps` au lieu de `known`/`models` ; reconstruis `known` à l'intérieur (`new Set(deps.models.map((m) => m.name))`) ou hisse-le dans `resolveDashboard` et passe-le en argument — au choix, tant que le message d'erreur reste identique.

d. Ajoute la branche `count` dans `resolveWidget`, avant le `throw` final :

```ts
  if (widget.type === 'count') {
    const model = requireModel(widget.model, index, deps);
    if (!widget.label?.trim()) {
      throw new AdminConfigError(
        `[sveltekit-admin] dashboard.widgets[${index}] requires a non-empty \`label\`.`
      );
    }
    const params = new URLSearchParams(widget.query ?? '');
    for (const key of params.keys()) {
      // `page`, `perPage`, `sort`, `dir` n'ont aucun effet sur un comptage :
      // les accepter laisserait croire le contraire.
      if (key !== 'q' && !key.startsWith('f.')) {
        throw new AdminConfigError(
          `[sveltekit-admin] dashboard.widgets[${index}] query: only "q" and "f.*" ` +
            `are supported, got "${key}".`
        );
      }
    }
    const query = parseListQuery(
      params,
      model,
      deps.enums,
      deps.searchFieldsOf(model),
      deps.filterableFieldsOf(model)
    );
    // `ignored` porte exactement ce que la liste aurait silencieusement
    // écarté : champ inconnu, non filtrable, sensible, valeur incoercible.
    // Sur une config statique c'est une faute de frappe, pas une URL
    // hostile — elle doit arrêter le démarrage.
    if (query.ignored.length > 0) {
      const keys = query.ignored.map((i) => `"${i.key}"`).join(', ');
      throw new AdminConfigError(
        `[sveltekit-admin] dashboard.widgets[${index}] query rejects ${keys}: ` +
          `unknown, non-filterable, sensitive, or uncoercible for model ` +
          `"${model.name}".`
      );
    }
    return {
      type: 'count',
      modelName: model.name,
      label: widget.label,
      query,
      href: listHref(deps.basePath, model.name, params)
    };
  }
```

e. Ajoute les deux helpers :

```ts
function requireModel(name: string, index: number, deps: ResolveDashboardDeps): Model {
  const model = deps.models.find((m) => m.name === name);
  if (!model) {
    throw new AdminConfigError(
      `[sveltekit-admin] dashboard.widgets[${index}] references model "${name}", ` +
        `which is unknown or excluded. Known models: ` +
        `[${deps.models.map((m) => m.name).join(', ')}].`
    );
  }
  return model;
}

/** Clés triées, comme `buildListUrl` : le lien reste déterministe. */
function listHref(basePath: string, modelName: string, params: URLSearchParams): string {
  const sorted = new URLSearchParams();
  for (const key of [...params.keys()].sort()) {
    for (const value of params.getAll(key)) sorted.append(key, value);
  }
  const qs = sorted.toString();
  const path = `${basePath}/${modelName.toLowerCase()}`;
  return qs ? `${path}?${qs}` : path;
}
```

Vérifie la forme exacte de `IgnoredFilter` (`src/lib/server/query/listQuery.ts:31`) avant d'écrire `i.key` : si le champ porte un autre nom, utilise le vrai. Ne devine pas.

- [ ] **Step 4: Adapter l'appel du runtime**

Dans `src/lib/server/runtime.ts`, remplace l'appel de la Task 6 par :

```ts
  const dashboard = resolveDashboard({
    config: config.dashboard,
    models,
    enums: schemaEnums,
    basePath,
    searchFieldsOf: (m) =>
      resolveSearchFields(m, modelsConfig[m.name]?.searchFields, labelFieldCandidates, hiddenFieldsOf(m)),
    filterableFieldsOf: resolveFilterableFields
  });
```

⚠️ Ordre des déclarations : `labelFieldCandidates` et `resolveFilterableFields` sont définis **plus bas** dans `createAdminRuntime`. Déplace l'appel `resolveDashboard` après la définition de `resolveFilterableFields` (juste avant `resolveLabel`), et ajoute l'import `resolveSearchFields` depuis `./query/listQuery.js`.

- [ ] **Step 5: Vérifier**

```bash
pnpm exec vitest run tests/unit/dashboard.test.ts tests/unit/runtime.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/dashboard.ts src/lib/server/runtime.ts tests/unit/dashboard.test.ts
git commit -m "feat(dashboard): validate count widget queries against the list filter whitelist"
```

## Task 8: Chargement et rendu d'un compteur

**Files:**
- Modify: `src/lib/server/dashboard.ts`
- Modify: `src/lib/server/views/StatCard.svelte`
- Modify: `src/lib/server/views/Dashboard.svelte`
- Modify: `src/lib/server/views/theme.ts`
- Test: `tests/unit/dashboardLoad.test.ts`, `tests/unit/views/dashboard.test.ts`

**Interfaces:**
- Consumes: `buildWhere` (`./query/listQuery.js`), `combinedScopeFrom` (Task 9 — jusque-là, `modelScopeFrom`).
- Produces: `LoadedWidget` gagne `| { type: 'count'; label: string; value: number; href: string }` ; `DashboardCard.icon` gagne `'filter'` ; `StatCard.svelte` accepte `href?: string`.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `tests/unit/dashboardLoad.test.ts` :

```ts
  it('compte selon la query du widget et lie vers la liste filtrée', async () => {
    const { runtime } = runtimeWith({
      dashboard: {
        widgets: [{ type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' }]
      }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect(rows).toEqual([
      {
        kind: 'cards',
        cards: [
          { value: 1, label: 'Actifs', icon: 'filter', href: '/admin/user?f.isActive=true' }
        ]
      }
    ]);
  });

  it('aligne des compteurs consécutifs dans une seule rangée', async () => {
    const { runtime } = runtimeWith({
      dashboard: {
        widgets: [
          { type: 'stats' },
          { type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' },
          { type: 'count', model: 'Post', label: 'Posts' }
        ]
      }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).cards).toHaveLength(4);
  });

  it('compose le scope du modèle avec la query du compteur', async () => {
    const { runtime, prisma } = runtimeWith({
      models: { User: { scope: () => ({ id: 2 }) } },
      dashboard: {
        widgets: [{ type: 'count', model: 'User', label: 'Actifs', query: 'f.isActive=true' }]
      }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    // L'utilisateur 2 est inactif : le scope et le filtre sont bien tous les
    // deux appliqués, pas l'un à la place de l'autre.
    expect((rows[0] as any).cards[0].value).toBe(0);
    expect(callsTo(prisma, 'user', 'count')[0].args).toEqual({
      where: { AND: [{ id: 2 }, { isActive: true }] }
    });
  });

  it('affiche 0 quand le comptage filtré échoue', async () => {
    const prisma = createPrismaMock(DATA, {
      user: {
        count: () => {
          throw new Error('no such table: User');
        }
      }
    });
    const { runtime } = runtimeWith(
      { dashboard: { widgets: [{ type: 'count', model: 'User', label: 'Actifs' }] } },
      prisma
    );
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[0] as any).cards[0].value).toBe(0);
  });
```

Et dans `tests/unit/views/dashboard.test.ts` :

```ts
  it('rend un compteur comme carte cliquable', () => {
    const html = renderDashboard([
      {
        kind: 'cards',
        cards: [{ value: 7, label: 'Pending', icon: 'filter', href: '/admin/order?f.status=PENDING' }]
      }
    ]);
    expect(html).toContain('href="/admin/order?f.status=PENDING"');
    expect(html).toContain('ska-stat--link');
    expect(html).toContain('>7</div>');
  });

  it('rend une carte statistique sans lien comme un bloc non cliquable', () => {
    const html = renderDashboard([
      { kind: 'cards', cards: [{ value: 2, label: 'Models', icon: 'models' }] }
    ]);
    expect(html).not.toContain('ska-stat--link');
  });
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm exec vitest run tests/unit/dashboardLoad.test.ts tests/unit/views/dashboard.test.ts`
Expected: FAIL — rangée vide pour un widget `count`, `ska-stat--link` absent.

- [ ] **Step 3: Charger le compteur**

Dans `src/lib/server/dashboard.ts` :

a. Importe `buildWhere` :

```ts
import { buildWhere, parseListQuery, type ListQuery } from './query/listQuery.js';
```

b. Étends `LoadedWidget` et `DashboardCard` :

```ts
export interface DashboardCard {
  value: number;
  label: string;
  icon: 'models' | 'records' | 'filter';
  href?: string;
}

export type LoadedWidget =
  | { type: 'stats'; models: number; total: number }
  | { type: 'models'; title?: string; cards: ModelCardData[] }
  | { type: 'count'; label: string; value: number; href: string };
```

c. Ajoute la branche dans `cardsOf` :

```ts
  if (widget.type === 'count') {
    return [{ value: widget.value, label: widget.label, icon: 'filter', href: widget.href }];
  }
```

d. Ajoute la branche dans la boucle de `loadDashboard`, après celle de `stats` :

```ts
    if (widget.type === 'count') {
      const model = runtime.models.find((m) => m.name === widget.modelName)!;
      // `caseInsensitiveSearch` est faux ici comme dans la branche liste :
      // c'est le compilateur de l'adapter qui décide de la casse.
      const filter = buildWhere(
        widget.query,
        modelScopeFrom(runtime, model, { locals: event.locals }),
        false,
        model
      ) as Filter | undefined;
      const value = await runtime.adapter.data.countRecords(model, filter).catch(() => 0);
      loaded.push({ type: 'count', label: widget.label, value, href: widget.href });
      continue;
    }
```

et l'import de type `Filter` depuis `./adapters/types.js`.

- [ ] **Step 4: Rendre la carte cliquable**

Remplace `src/lib/server/views/StatCard.svelte` par :

```svelte
<script lang="ts">
  let {
    value,
    label,
    icon,
    href
  }: {
    value: number;
    label: string;
    icon: 'models' | 'records' | 'filter';
    href?: string;
  } = $props();
</script>

{#snippet body()}
  <div class="ska-stat__icon">
    {#if icon === 'models'}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/></svg>
    {:else if icon === 'records'}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
    {:else}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
    {/if}
  </div>
  <div>
    <div class="ska-stat__value">{value}</div>
    <div class="ska-stat__label">{label}</div>
  </div>
{/snippet}

{#if href}
  <a {href} class="ska-stat ska-stat--link">{@render body()}</a>
{:else}
  <div class="ska-stat">{@render body()}</div>
{/if}
```

Dans `Dashboard.svelte`, passe le lien :

```svelte
        <StatCard value={card.value} label={card.label} icon={card.icon} href={card.href} />
```

Dans `theme.ts`, après le bloc `.ska-stat {`, ajoute :

```css
    .ska-stat--link {
      text-decoration: none;
      color: inherit;
      transition: all 0.15s;
    }

    .ska-stat--link:hover {
      border-color: var(--ska-primary);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
```

- [ ] **Step 5: Vérifier**

```bash
pnpm exec vitest run tests/unit/dashboardLoad.test.ts tests/unit/views/dashboard.test.ts
pnpm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/dashboard.ts src/lib/server/views/ tests/unit/
git commit -m "feat(dashboard): add filtered count widgets linking to their list"
```

## Task 9: Composer `listWhere` dans les comptages du dashboard

**Files:**
- Modify: `src/lib/server/runtime.ts` (nouvelle fonction `combinedScopeFrom`)
- Modify: `src/lib/server/handler.ts` (branche liste — réutilise l'extraction)
- Modify: `src/lib/server/dashboard.ts`
- Create: `.changeset/dashboard-count-widgets.md`
- Test: `tests/unit/dashboardLoad.test.ts`

**Interfaces:**
- Consumes: `listScopeFrom`, `modelScopeFrom`, `normalizeScope`.
- Produces: `function combinedScopeFrom(runtime: AdminRuntime, model: Model, ctx: { locals?: unknown }): Filter | undefined`.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `tests/unit/dashboardLoad.test.ts` :

```ts
  it('applique aussi listWhere aux comptages du dashboard', async () => {
    const { runtime } = runtimeWith({
      models: { User: { listWhere: () => ({ isActive: true }) } }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    const userCard = (rows[1] as any).cards.find((c: any) => c.name === 'User');
    // Sans cette composition, la carte annoncerait 2 alors que la liste vers
    // laquelle elle pointe n'en montre qu'un.
    expect(userCard.count).toBe(1);
  });

  it('laisse remonter un listWhere qui échouerait ouvert', async () => {
    const { runtime } = runtimeWith({ models: { User: { listWhere: () => ({}) } } });
    await expect(loadDashboard(runtime, { locals: {} })).rejects.toThrow(
      /returned an empty object/
    );
  });
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm exec vitest run tests/unit/dashboardLoad.test.ts -t listWhere`
Expected: FAIL — `count` vaut 2.

- [ ] **Step 3: Extraire `combinedScopeFrom`**

Dans `src/lib/server/runtime.ts`, après `modelScopeFrom` :

```ts
/**
 * `scope` (toutes les lectures) ET `listWhere` (historiquement la seule vue
 * liste), composés en AND. Le dashboard l'utilise aussi : une carte qui
 * annonce 40 quand la liste vers laquelle elle pointe en montre 12 est un
 * chiffre faux, et un widget de comptage rend cet écart visible.
 */
export function combinedScopeFrom(
  runtime: AdminRuntime,
  model: Model,
  ctx: { locals?: unknown }
): Filter | undefined {
  const modelScope = modelScopeFrom(runtime, model, ctx);
  const listScope = listScopeFrom(runtime, model, ctx);
  if (modelScope && listScope) {
    return { op: 'and', clauses: [modelScope, normalizeScope(listScope)!] };
  }
  return modelScope ?? normalizeScope(listScope);
}
```

Vérifie la signature réelle de `listScopeFrom` / `normalizeScope` avant d'écrire (`ctx: { locals?: any }`) et aligne les types plutôt que de caster.

- [ ] **Step 4: L'utiliser aux trois sites**

a. Dans `src/lib/server/handler.ts`, branche liste : remplace le triplet `listScope` / `modelScope` / `scope` par un seul `const scope = combinedScopeFrom(runtime, model, { locals: event.locals });`. Les tests de liste existants doivent rester verts sans modification — s'ils bougent, c'est que la composition n'est pas équivalente : arrête-toi et compare.

b. Dans `src/lib/server/dashboard.ts`, remplace les deux appels `modelScopeFrom(...)` (dans `makeCounter` et dans la branche `count`) par `combinedScopeFrom(...)`, et ajuste l'import.

- [ ] **Step 5: Vérifier**

```bash
pnpm run test
pnpm run check
pnpm run lint
```
Expected: PASS, couverture 100 %.

- [ ] **Step 6: Documenter**

Dans `docs/src/lib/content/docs/dashboard.svx`, ajoute avant la section `## Validation` :

```markdown
### Filtered counters

```typescript
{ type: 'count', model: 'Order', label: 'Pending', query: 'f.status=PENDING&f.total__gte=100' }
```

`query` is the list view's own query string (`q=`, `f.<field>[__<op>]=`), so a
counter can only express what the list can show, it inherits the operator
whitelist and the sensitive-field exclusion, and the card links to a list whose
total equals the number displayed. Anything else — `page`, `sort`, an unknown
field — is refused at boot.
```

et remplace la section `## Scope` par :

```markdown
## Scope

Every read on the dashboard composes the model's `scope`, exactly like every
other read the admin serves, **and** its `listWhere`. A model in `exclude`
cannot be surfaced by a widget.
```

- [ ] **Step 7: Écrire le changeset**

Crée `.changeset/dashboard-count-widgets.md` :

```markdown
---
"sveltekit-admin": minor
---

**Filtered counters on the dashboard.** A `count` widget shows how many rows match a filter and links to the list already filtered the same way:

```ts
{ type: 'count', model: 'Order', label: 'Pending', query: 'f.status=PENDING&f.total__gte=100' }
```

`query` is the list view's own query string. That is the whole design: a counter cannot express anything the list cannot show, it inherits the operator whitelist and the sensitive-field exclusion rather than reimplementing them, and the card links to a list whose total is the number on the card. A typo, a `page=` parameter, or a filter on a hidden or sensitive field is refused when the handler is created — not silently ignored at render time.

**Behaviour change — dashboard counts now compose `listWhere` as well as `scope`.** A model card could previously announce 40 rows while the list it links to, scoped by `listWhere`, showed 12. The number was already wrong; a counter that links to its own filtered list makes it visibly wrong. The composition is strictly more restrictive, so nothing becomes visible that was not before, but **a dashboard count can now be lower than it was** if you use `listWhere`. If you meant that scope to apply everywhere, `scope` is the hook that does it.
```

- [ ] **Step 8: Régénérer les snapshots et commit**

```bash
pnpm exec vitest run tests/characterization -u
git add src/lib/server/ docs/src/lib/content/docs/dashboard.svx tests/ \
        .changeset/dashboard-count-widgets.md
git commit -m "feat(dashboard): compose listWhere into every dashboard count"
```

---

# PR 4 — Widget `recent`

## Task 10: Validation et résolution d'un bloc « récents »

**Files:**
- Modify: `src/lib/server/dashboard.ts`
- Test: `tests/unit/dashboard.test.ts`

**Interfaces:**
- Consumes: `resolveListColumns` (`./query/listColumns.js`), `primaryKeyOf` (`./data.js`), `ActiveSort` (`./query/sortQuery.js`).
- Produces:
  - `DashboardWidget` gagne `| { type: 'recent'; model: string; title?: string; limit?: number; sort?: string; dir?: 'asc' | 'desc' }`
  - `ResolvedWidget` gagne `| { type: 'recent'; modelName: string; title: string; limit: number; orderBy: Record<string, 'asc' | 'desc'>; href: string }`
  - `ResolveDashboardDeps` gagne `sortableColumnsOf: (m: Model) => string[]`, `defaultSortOf: (m: Model) => ActiveSort | undefined`, `labelOf: (m: Model) => string`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajoute à `tests/unit/dashboard.test.ts` (et complète la fabrique `deps` avec les trois nouvelles dépendances) :

```ts
describe('resolveDashboard — widget recent', () => {
  it('trie par clé primaire décroissante sans defaultSort', () => {
    const [widget] = resolveDashboard(
      deps({ widgets: [{ type: 'recent', model: 'User' }] })
    ).widgets;
    expect(widget).toEqual({
      type: 'recent',
      modelName: 'User',
      title: 'Latest User',
      limit: 5,
      orderBy: { id: 'desc' },
      href: '/admin/user'
    });
  });

  it('respecte un sort et un titre explicites', () => {
    const [widget] = resolveDashboard(
      deps({
        widgets: [
          { type: 'recent', model: 'User', title: 'Nouveaux', limit: 3, sort: 'email', dir: 'asc' }
        ]
      })
    ).widgets;
    expect(widget).toMatchObject({ title: 'Nouveaux', limit: 3, orderBy: { email: 'asc' } });
  });

  it('refuse un tri sur une colonne que la liste n’affiche pas', () => {
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'recent', model: 'User', sort: 'password' }] }))
    ).toThrow(/dashboard\.widgets\[0\].*"password".*does not display/);
  });

  it('refuse une limite hors bornes', () => {
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'recent', model: 'User', limit: 0 }] }))
    ).toThrow(/`limit` must be an integer between 1 and 50/);
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'recent', model: 'User', limit: 51 }] }))
    ).toThrow(/`limit` must be an integer between 1 and 50/);
    expect(() =>
      resolveDashboard(deps({ widgets: [{ type: 'recent', model: 'User', limit: 2.5 }] }))
    ).toThrow(/`limit` must be an integer between 1 and 50/);
  });

  it('refuse une direction invalide', () => {
    expect(() =>
      resolveDashboard(
        deps({ widgets: [{ type: 'recent', model: 'User', dir: 'sideways' as any }] })
      )
    ).toThrow(/`dir` must be "asc" or "desc"/);
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm exec vitest run tests/unit/dashboard.test.ts -t recent`
Expected: FAIL — « unknown type "recent" ».

- [ ] **Step 3: Implémenter la branche `recent`**

Dans `resolveWidget`, avant le `throw` final :

```ts
  if (widget.type === 'recent') {
    const model = requireModel(widget.model, index, deps);
    if (widget.limit !== undefined && !isLimit(widget.limit)) {
      throw new AdminConfigError(
        `[sveltekit-admin] dashboard.widgets[${index}] \`limit\` must be an integer ` +
          `between 1 and ${MAX_RECENT}.`
      );
    }
    if (widget.dir !== undefined && widget.dir !== 'asc' && widget.dir !== 'desc') {
      throw new AdminConfigError(
        `[sveltekit-admin] dashboard.widgets[${index}] \`dir\` must be "asc" or "desc".`
      );
    }
    if (widget.sort !== undefined) {
      const sortable = deps.sortableColumnsOf(model);
      if (!sortable.includes(widget.sort)) {
        throw new AdminConfigError(
          `[sveltekit-admin] dashboard.widgets[${index}] sorts on "${widget.sort}", ` +
            `which the list view does not display. Displayed columns: ` +
            `[${sortable.join(', ')}].`
        );
      }
    }
    // Pas de devinette sur un champ nommé `createdAt` : même position que
    // `defaultSort`, deviner réordonnerait silencieusement et la devinette
    // divergerait de ce que la vue rend. Sans tri configuré, clé primaire
    // décroissante — le défaut de l'adapter.
    const configured = deps.defaultSortOf(model);
    const field = widget.sort ?? configured?.field ?? primaryKeyOf(model);
    const dir = widget.dir ?? (widget.sort ? 'asc' : (configured?.dir ?? 'desc'));
    return {
      type: 'recent',
      modelName: model.name,
      title: widget.title ?? `Latest ${deps.labelOf(model)}`,
      limit: widget.limit ?? 5,
      orderBy: { [field]: dir },
      href: `${deps.basePath}/${model.name.toLowerCase()}`
    };
  }
```

avec, en haut du fichier :

```ts
const MAX_RECENT = 50;
const isLimit = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= MAX_RECENT;
```

et les imports `primaryKeyOf` (`./data.js`) et `type ActiveSort` (`./query/sortQuery.js`).

- [ ] **Step 4: Fournir les nouvelles dépendances depuis le runtime**

Dans `src/lib/server/runtime.ts`, complète l'objet passé à `resolveDashboard` :

```ts
    sortableColumnsOf: (m) =>
      resolveListColumns(m.fields, {
        hidden: modelsConfig[m.name]?.hidden,
        listFields: modelsConfig[m.name]?.listFields
      }).map((f) => f.name),
    defaultSortOf: (m) => defaultSorts.get(m.name),
    labelOf
```

⚠️ `defaultSorts` et `labelOf` doivent être déclarés avant l'appel : vérifie l'ordre et déplace l'appel `resolveDashboard` si nécessaire (il n'a aucune dépendance en retour, il peut descendre jusqu'au bloc juste avant le `return`).

- [ ] **Step 5: Vérifier**

Run: `pnpm exec vitest run tests/unit/dashboard.test.ts tests/unit/runtime.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/dashboard.ts src/lib/server/runtime.ts tests/unit/dashboard.test.ts
git commit -m "feat(dashboard): validate recent-record widgets at boot"
```

## Task 11: Chargement, rédaction et rendu des récents

**Files:**
- Modify: `src/lib/server/dashboard.ts`
- Create: `src/lib/server/views/RecentPanel.svelte`
- Modify: `src/lib/server/views/Dashboard.svelte`
- Modify: `src/lib/server/views/theme.ts`
- Test: `tests/unit/dashboardLoad.test.ts`, `tests/unit/views/dashboard.test.ts`

**Interfaces:**
- Consumes: `redactForAudit` (`./audit.js`), `findMany` du `DataAdapter`, `runtime.resolveLabel`, `runtime.hiddenFieldsOf`.
- Produces: `interface RecentItem { label: string; href: string }` ; `LoadedWidget` et `DashboardRow` gagnent leur variante `recent`.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `tests/unit/dashboardLoad.test.ts` :

```ts
  it('rend les derniers enregistrements, les plus récents d’abord', async () => {
    const { runtime } = runtimeWith({
      dashboard: { widgets: [{ type: 'recent', model: 'User', limit: 1 }] }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect(rows).toEqual([
      {
        kind: 'recent',
        title: 'Latest User',
        href: '/admin/user',
        items: [{ label: 'B', href: '/admin/user/2' }]
      }
    ]);
  });

  it('n’expose ni champ sensible ni champ masqué dans un libellé', async () => {
    const { runtime } = runtimeWith({
      models: { User: { hidden: ['name'] } },
      dashboard: { widgets: [{ type: 'recent', model: 'User', limit: 2 }] }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    const labels = (rows[0] as any).items.map((i: any) => i.label);
    // `name` est masqué : le label retombe sur `email`, jamais sur le mot de
    // passe ni sur le champ masqué.
    expect(labels).toEqual(['b@x.y', 'a@x.y']);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('scope la lecture des récents', async () => {
    const { runtime, prisma } = runtimeWith({
      models: { User: { scope: () => ({ isActive: true }) } },
      dashboard: { widgets: [{ type: 'recent', model: 'User' }] }
    });
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[0] as any).items).toEqual([{ label: 'A', href: '/admin/user/1' }]);
    expect(callsTo(prisma, 'user', 'findMany')[0].args).toMatchObject({
      where: { isActive: true },
      take: 5
    });
  });

  it('rend une liste vide quand la table n’existe pas encore', async () => {
    const prisma = createPrismaMock(DATA, {
      user: {
        findMany: () => {
          throw new Error('no such table: User');
        }
      }
    });
    const { runtime } = runtimeWith(
      { dashboard: { widgets: [{ type: 'recent', model: 'User' }] } },
      prisma
    );
    const { rows } = await loadDashboard(runtime, { locals: {} });
    expect((rows[0] as any).items).toEqual([]);
  });
```

Dans `tests/unit/views/dashboard.test.ts` :

```ts
  it('rend un bloc de récents', () => {
    const html = renderDashboard([
      {
        kind: 'recent',
        title: 'Latest Users',
        href: '/admin/user',
        items: [{ label: 'Alice', href: '/admin/user/1' }]
      }
    ]);
    expect(html).toContain('Latest Users');
    expect(html).toContain('href="/admin/user/1"');
    expect(html).toContain('Alice');
  });

  it('annonce un bloc de récents vide', () => {
    const html = renderDashboard([
      { kind: 'recent', title: 'Latest Users', href: '/admin/user', items: [] }
    ]);
    expect(html).toContain('No records yet');
  });

  it('échappe le libellé d’un enregistrement récent', () => {
    const html = renderDashboard([
      {
        kind: 'recent',
        title: 'T',
        href: '/admin/user',
        items: [{ label: '<img src=x>', href: '/admin/user/1' }]
      }
    ]);
    expect(html).not.toContain('<img src=x>');
  });
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `pnpm exec vitest run tests/unit/dashboardLoad.test.ts tests/unit/views/dashboard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Charger et rédiger**

Dans `src/lib/server/dashboard.ts` :

a. Importe `redactForAudit` (`./audit.js`) et `primaryKeyOf` (déjà importé à la Task 10).

b. Étends les types :

```ts
export interface RecentItem {
  label: string;
  href: string;
}

export type LoadedWidget =
  | { type: 'stats'; models: number; total: number }
  | { type: 'models'; title?: string; cards: ModelCardData[] }
  | { type: 'count'; label: string; value: number; href: string }
  | { type: 'recent'; title: string; href: string; items: RecentItem[] };

export type DashboardRow =
  | { kind: 'cards'; cards: DashboardCard[] }
  | { kind: 'models'; title?: string; cards: ModelCardData[] }
  | { kind: 'recent'; title: string; href: string; items: RecentItem[] };
```

c. Dans `groupWidgetRows`, remplace le `rows.push(...)` final par une discrimination explicite :

```ts
    if (widget.type === 'recent') {
      rows.push({
        kind: 'recent',
        title: widget.title,
        href: widget.href,
        items: widget.items
      });
      continue;
    }
    rows.push(
      widget.title === undefined
        ? { kind: 'models', cards: widget.cards }
        : { kind: 'models', title: widget.title, cards: widget.cards }
    );
```

d. Ajoute la branche dans `loadDashboard` :

```ts
    if (widget.type === 'recent') {
      const model = runtime.models.find((m) => m.name === widget.modelName)!;
      const rowsRead = await runtime.adapter.data
        .findMany(model, {
          filter: combinedScopeFrom(runtime, model, { locals: event.locals }),
          orderBy: widget.orderBy,
          take: widget.limit
        })
        .catch(() => [] as Record<string, unknown>[]);
      const pk = primaryKeyOf(model);
      const hidden = runtime.hiddenFieldsOf(model);
      loaded.push({
        type: 'recent',
        title: widget.title,
        href: widget.href,
        items: rowsRead.map((row) => ({
          // Rédigé AVANT de résoudre le libellé : sans ça, un champ masqué ou
          // sensible pourrait devenir le texte affiché.
          label: runtime.resolveLabel(model, redactForAudit(row, model, hidden)),
          href: `${widget.href}/${row[pk]}`
        }))
      });
      continue;
    }
```

- [ ] **Step 4: Créer `RecentPanel.svelte`**

```svelte
<script lang="ts">
  import type { RecentItem } from '../dashboard.js';

  let {
    title,
    href,
    items
  }: { title: string; href: string; items: RecentItem[] } = $props();
</script>

<section class="ska-dashboard__section">
  <h2>{title}</h2>
  {#if items.length === 0}
    <p class="ska-subtitle">No records yet</p>
  {:else}
    <ul class="ska-recent">
      {#each items as item (item.href)}
        <li class="ska-recent__item">
          <a href={item.href}>{item.label}</a>
        </li>
      {/each}
    </ul>
  {/if}
  <a class="ska-recent__all" {href}>View all →</a>
</section>
```

Dans `Dashboard.svelte`, importe-le et ajoute la branche :

```svelte
  {:else if row.kind === 'recent'}
    <RecentPanel title={row.title} href={row.href} items={row.items} />
```

en transformant le `{:else}` existant en `{:else if row.kind === 'models'}`.

Dans `theme.ts`, après le bloc `/* Models grid */` :

```css
    /* Recent panel */
    .ska-recent {
      list-style: none;
      margin: 0 0 0.75rem;
      padding: 0;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
    }

    .ska-recent__item + .ska-recent__item {
      border-top: 1px solid #e2e8f0;
    }

    .ska-recent__item a {
      display: block;
      padding: 0.75rem 1rem;
      color: #1e293b;
      text-decoration: none;
      font-size: 0.875rem;
    }

    .ska-recent__item a:hover {
      background: #f8fafc;
      color: var(--ska-primary);
    }

    .ska-recent__all {
      color: var(--ska-primary);
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
    }
```

- [ ] **Step 5: Vérifier**

```bash
pnpm exec vitest run tests/unit/dashboardLoad.test.ts tests/unit/views/dashboard.test.ts
pnpm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/dashboard.ts src/lib/server/views/ tests/unit/
git commit -m "feat(dashboard): add redacted recent-record panels"
```

## Task 12: Intégration, parité Drizzle, doc et changeset

**Files:**
- Modify: `tests/integration/handler.db.test.ts`
- Modify: `tests/integration/handler.drizzle.db.test.ts`
- Modify: `docs/src/lib/content/docs/dashboard.svx`
- Modify: `example/src/hooks.server.ts` (lis le fichier avant : le nom exact peut différer)
- Create: `.changeset/dashboard-recent-widgets.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien de nouveau.

- [ ] **Step 1: Écrire le test d'intégration Prisma**

Dans `tests/integration/handler.db.test.ts`, en suivant le style de fabrique déjà présent dans ce fichier (lis-le avant d'écrire, ne recopie pas une fabrique imaginaire) :

```ts
  it('rend un dashboard configuré de bout en bout', async () => {
    const handler = makeHandler({
      dashboard: {
        title: 'Console',
        widgets: [
          { type: 'count', model: 'User', label: 'Active users', query: 'f.isActive=true' },
          { type: 'models', title: 'Content', models: ['Post'] },
          { type: 'recent', model: 'User', limit: 2 }
        ]
      }
    });
    const { event, resolve } = createEvent({ url: '/admin' });
    const html = await (await handler({ event, resolve } as any)).text();
    expect(html).toContain('Console');
    expect(html).toContain('Active users');
    expect(html).toContain('href="/admin/user?f.isActive=true"');
    expect(html).toContain('Content');
    expect(html).toContain('Latest User');
    expect(html).not.toContain('password');
  });
```

- [ ] **Step 2: Écrire le même test côté Drizzle**

Réplique le cas dans `tests/integration/handler.drizzle.db.test.ts` avec la fabrique de ce fichier. C'est la vérification de la règle de parité : si le compilateur de filtre Drizzle ne sait pas traduire ce que produit `buildWhere` pour un compteur, c'est ici que ça se voit.

- [ ] **Step 3: Lancer les deux**

```bash
pnpm exec vitest run tests/integration
```
Expected: PASS. Un échec Drizzle sur un `orderBy` ou un `where` est un vrai bug de parité, pas un test à assouplir.

- [ ] **Step 4: Compléter la doc**

Dans `docs/src/lib/content/docs/dashboard.svx`, ajoute avant `## Validation` :

```markdown
### Recent records

```typescript
{ type: 'recent', model: 'User', title: 'New sign-ups', limit: 5 }
```

Rows are ordered by the model's `defaultSort` when it has one, and by primary
key descending otherwise — never by guessing at a `createdAt` column. `sort`
accepts only a column the list view actually displays.

Only the record's label and its link are rendered. The row is redacted with the
same rules as the audit payload (`hidden` plus the sensitive-name predicate)
**before** the label is resolved, so a hidden or sensitive column can never
become the visible text.
```

- [ ] **Step 5: Montrer la feature dans l'app d'exemple**

Ajoute une config `dashboard` à `example/`, avec au moins un widget de chaque type, en t'appuyant sur les modèles réellement présents dans son schéma Prisma. Vérifie ensuite :

```bash
pnpm run smoke:packaged
```
Expected: PASS. C'est le seul check qui exerce l'artefact publié — un type manquant dans `dist` s'y voit et nulle part ailleurs.

- [ ] **Step 6: Écrire le changeset**

Crée `.changeset/dashboard-recent-widgets.md` :

```markdown
---
"sveltekit-admin": minor
---

**Recent-record panels on the dashboard.** A `recent` widget lists the latest rows of a model, each linking to its edit form:

```ts
{ type: 'recent', model: 'User', title: 'New sign-ups', limit: 5 }
```

Ordering follows the model's `defaultSort` when it has one, and the primary key descending otherwise. There is deliberately no guess at a `createdAt` column: guessing would silently order by something the view does not show, the same reason `defaultSort` is explicit.

Only the label and the link are rendered, and the row is redacted with the audit rules — `hidden` plus the shared sensitive-name predicate — **before** the label is resolved. A hidden or sensitive column can therefore never become the visible text of a panel. The read is scoped like every other read the admin serves.
```

- [ ] **Step 7: Vérification finale**

```bash
pnpm run test:coverage
pnpm run check
pnpm run lint
pnpm run package
pnpm exec vitest run tests/characterization -u && git diff tests/characterization/__snapshots__/
```
Expected: couverture 100 % sur les quatre métriques, aucun avertissement `svelte-check`, aucune règle ESLint, `dist` produit. Relis le diff de snapshot avant de commiter.

- [ ] **Step 8: Commit**

```bash
git add tests/ docs/ example/ .changeset/dashboard-recent-widgets.md
git commit -m "test(dashboard): cover configured dashboards end to end on both adapters"
```

---

## Self-Review (fait à la rédaction)

- **Couverture de la spec** : surface de config → Tasks 3/7/10 ; validation au boot (7 refus) → Tasks 3/7/10 ; module `dashboard.ts` en trois phases → Tasks 3/4/5 ; mémoïsation → Task 5 ; `stats` global → Task 5 ; ordre `recent` sans devinette → Task 10 ; tolérance aux erreurs → Tasks 5/8/11 ; invariants 1 et 4 → Tasks 5/11 ; invariant 2 (`listWhere`) → Task 9 ; invariant 3 (rédaction) → Task 11 ; invariant 5 (modèle exclu) → Tasks 3/7 ; invariant 6 (échappement) → Tasks 6/11 ; rendu et composants → Tasks 1/2/6/8/11 ; `groupWidgetRows` → Task 4 ; tests → toutes ; découpage en 4 PRs → structure du document.
- **Pièges signalés explicitement** : l'ordre de déclaration dans `createAdminRuntime` (Tasks 7 et 10), le nom réel du champ de `IgnoredFilter` à vérifier (Task 7), les fabriques de test à lire avant de recopier (Tasks 6 et 12), et le snapshot de caractérisation à régénérer et relire à chaque changement de rendu.
