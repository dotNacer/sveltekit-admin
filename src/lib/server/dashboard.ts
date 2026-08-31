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
    if (widget.type === 'models') {
      rows.push(
        widget.title === undefined
          ? { kind: 'models', cards: widget.cards }
          : { kind: 'models', title: widget.title, cards: widget.cards }
      );
      continue;
    }
    const cards = cardsOf(widget);
    const last = rows[rows.length - 1];
    if (last && last.kind === 'cards') last.cards.push(...cards);
    else rows.push({ kind: 'cards', cards });
  }
  return rows;
}

// `Exclude<..., { type: 'models' }>` : seul le widget « models » n'est pas
// carte. Quand les tâches suivantes ajouteront les variantes 'count' et
// 'recent' (elles aussi en cartes), ce type et ce switch grandiront avec
// elles — pas de branche pour un widget qui n'existe pas encore.
function cardsOf(widget: Exclude<LoadedWidget, { type: 'models' }>): DashboardCard[] {
  return [
    { value: widget.models, label: 'Models', icon: 'models' },
    { value: widget.total, label: 'Total Records', icon: 'records' }
  ];
}
