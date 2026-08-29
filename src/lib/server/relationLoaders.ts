/**
 * Relation option loaders shared by the create/edit Form and the list-view
 * FK filter sidebar. Split out of `handler.ts` — pure orchestration over
 * `AdminRuntime` (schema/relationGraph/adapter already resolved at boot),
 * no boot logic lives here.
 */

import { primaryKeyOf, coerceId } from './data.js';
import type { PrismaModel } from './introspection/parser.js';
import { findFkEdge } from './query/filterDetection.js';
import type { RelationMeta, FkFilterMeta } from './views/types.js';
import { scopeFrom, modelScopeFrom, type AdminRuntime } from './runtime.js';
import { normalizeScope } from './adapters/filter.js';
import type { Filter } from './adapters/types.js';

export function combinedScope(...scopes: Array<Filter | Record<string, unknown> | undefined>): Filter | undefined {
  const clauses = scopes.map((scope) => normalizeScope(scope)).filter((scope): scope is Filter => scope !== undefined);
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { op: 'and', clauses };
}

export async function filterSelectedIds(
  runtime: AdminRuntime,
  targetModel: PrismaModel,
  ids: Array<string | number> | undefined,
  ctx: { locals?: any },
  relationScope?: Filter | Record<string, unknown>
): Promise<Array<string | number> | undefined> {
  if (!ids) return undefined;
  const scope = combinedScope(modelScopeFrom(runtime, targetModel, ctx), relationScope);
  if (!scope || ids.length === 0) return ids;
  const rows = await runtime.adapter.data.findMany(targetModel, {
    filter: combinedScope(scope, { op: 'in', field: primaryKeyOf(targetModel), value: ids })
  });
  const allowed = new Set(rows.map((row) => String(row[primaryKeyOf(targetModel)])));
  return ids.filter((id) => allowed.has(String(id)));
}

/**
 * Charge les options pour toutes les arêtes to-one-owning et m2m
 * d'un modèle. Une requête COUNT par relation avant le findMany : évite de
 * charger 10k lignes pour découvrir qu'il y en a 10k.
 */
export async function loadRelationOptions(
  runtime: AdminRuntime,
  model: PrismaModel,
  ctx: { locals?: any },
  currentId?: string
): Promise<Map<string, RelationMeta>> {
  const modelsConfig = runtime.config.models ?? {};
  const edges = [...runtime.relationGraph!.edges.values()].filter((edge) => {
    if (edge.model !== model.name) return false;
    if (edge.kind !== 'to-one-owning' && edge.kind !== 'm2m') return false;
    if (edge.unsupported) return false;
    const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
    return relConfig?.widget !== 'hidden';
  });

  // Une relation ne dépend pas de l'autre : chargées en parallèle plutôt
  // qu'en série (un modèle avec N relations ne doit pas payer N
  // aller-retours DB empilés pour afficher un seul formulaire).
  const entries = await Promise.all(
    edges.map(async (edge): Promise<[string, RelationMeta]> => {
      const key = `${edge.model}.${edge.field}`;
      const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
      const targetModel = runtime.schema!.models.find((m) => m.name === edge.target)!;
      const filter = combinedScope(modelScopeFrom(runtime, targetModel, ctx), scopeFrom(relConfig, ctx));

      try {
        const total = await runtime.adapter.data.countRecords(targetModel, filter);
        if (total > runtime.selectThreshold || relConfig?.widget === 'raw-id') {
          const selectedIds =
            edge.kind === 'm2m' && currentId
              ? await filterSelectedIds(runtime, targetModel, await runtime.adapter.data.getM2mSelectedIds(model, edge, targetModel, currentId), ctx, scopeFrom(relConfig, ctx))
              : undefined;
          return [key, { tooMany: true, options: [], selectedIds }];
        }

        const rows = await runtime.adapter.data.findMany(targetModel, { filter, orderBy: relConfig?.orderBy });
        const options = rows.map((row) => ({
          id: row[primaryKeyOf(targetModel)] as string | number,
          label: runtime.resolveLabel(targetModel, row, relConfig?.labelTemplate)
        }));
        const selectedIds =
          edge.kind === 'm2m' && currentId
            ? await filterSelectedIds(runtime, targetModel, await runtime.adapter.data.getM2mSelectedIds(model, edge, targetModel, currentId), ctx, scopeFrom(relConfig, ctx))
            : undefined;
        return [key, { tooMany: false, options, selectedIds }];
      } catch {
        // Cible absente de la base ou client incomplet : repli raw-id pour
        // garder le champ éditable plutôt que de faire échouer tout le form.
        return [key, { tooMany: true, options: [] }];
      }
    })
  );
  return new Map(entries);
}

/**
 * Options d'un filtre FK : charge et scope les valeurs possibles pour la
 * sidebar, ET résout le label du chip actif. Doctrine IDOR (docs/design
 * §6.3) : les options ET le label du chip passent par le `where` de
 * scoping de la relation — un chip forgé avec un ID hors scope affiche
 * l'ID brut, jamais le label (sinon c'est un oracle sur le nom d'un
 * enregistrement d'un autre tenant).
 */
export async function resolveFkFilterOptions(
  runtime: AdminRuntime,
  model: PrismaModel,
  fkFieldName: string,
  label: string,
  ctx: { locals?: any },
  activeRawValue: string | undefined
): Promise<FkFilterMeta> {
  // Appelé uniquement pour un filtre `kind: 'fk'` retourné par
  // resolveListFilters avec CE MÊME graphe : graphe et arête existent donc
  // par construction. Garder des gardes here masquerait une incohérence
  // interne et ajouterait du code mort (coverage artificielle).
  const edge = findFkEdge(runtime.relationGraph!, model.name, fkFieldName)!;
  // Non-null par construction : un filtre `kind: 'fk'` ne peut exister que
  // via `models[model.name].listFilter` explicite (CLAUDE.md — les filtres
  // FK ne sont jamais auto-détectés) ; `runtime.config.models` est donc
  // déjà renseigné pour ce modèle avant que cette fonction ne soit appelée.
  const modelsConfig = runtime.config.models!;

  const targetModel = runtime.schema!.models.find((m) => m.name === edge.target)!;
  // Non-null par construction : `edge` vient du graphe dérivé du même
  // schéma parsé avec succès — une arête ne peut pas cibler un modèle qui
  // n'existe pas dans `schema.models`.

  const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
  const scope = combinedScope(modelScopeFrom(runtime, targetModel, ctx), scopeFrom(relConfig, ctx));

  // Options de la sidebar (comptées puis chargées si sous le seuil) et
  // label du chip actif (§6.3.b) sont deux requêtes indépendantes — l'une
  // ne dépend pas du résultat de l'autre — donc en parallèle plutôt qu'en
  // série.
  const loadOptions = async (): Promise<{
    options: { id: string | number; label: string }[];
    tooMany: boolean;
  }> => {
    try {
      const total = await runtime.adapter.data.countRecords(targetModel, scope);
      if (total > runtime.selectThreshold) {
        return { options: [], tooMany: true };
      }
      const rows = await runtime.adapter.data.findMany(targetModel, { filter: scope, orderBy: relConfig?.orderBy });
      const options = rows.map((row) => ({
        id: row[primaryKeyOf(targetModel)] as string | number,
        label: runtime.resolveLabel(targetModel, row, relConfig?.labelTemplate)
      }));
      return { options, tooMany: false };
    } catch {
      return { options: [], tooMany: true };
    }
  };

  // Un ID hors scope retourne null ici → le composant affiche l'ID brut,
  // jamais le label (sinon c'est un oracle sur le nom d'un enregistrement
  // d'un autre tenant).
  const loadActiveLabel = async (): Promise<string | undefined> => {
    if (activeRawValue === undefined) return undefined;
    const activeId = coerceId(activeRawValue, targetModel);
    try {
      const idFilter = { op: 'eq', field: primaryKeyOf(targetModel), value: activeId } as const;
      const filter = scope ? ({ op: 'and', clauses: [idFilter, scope] } as any) : idFilter;
      const row = await runtime.adapter.data.findFirst(targetModel, filter);
      return row ? runtime.resolveLabel(targetModel, row, relConfig?.labelTemplate) : undefined;
    } catch {
      return undefined;
    }
  };

  const [{ options, tooMany }, activeLabel] = await Promise.all([loadOptions(), loadActiveLabel()]);

  return {
    field: fkFieldName,
    label,
    relationField: edge.field,
    targetModel: edge.target,
    options,
    mode: tooMany ? 'raw-id' : options.length <= runtime.filterLinkThreshold ? 'links' : 'select',
    tooMany,
    activeLabel,
    // Une cible exclue/masquée n'a pas de page admin : le chip reste du
    // texte, jamais un lien mort (docs/design §6.4).
    activeHref:
      activeLabel && runtime.findModel(edge.target)
        ? `${runtime.basePath}/${edge.target.toLowerCase()}/${encodeURIComponent(activeRawValue!)}`
        : undefined
  };
}

/**
 * Compte, pour chaque relation inverse (1-N, 1-1) d'un modèle, le nombre
 * d'enregistrements liés côté cible. Résilient : une cible dont le client
 * échoue (mock partiel, modèle absent) retombe sur 0 plutôt que de casser
 * le rendu du formulaire.
 */
export async function loadRelatedCounts(
  runtime: AdminRuntime,
  model: PrismaModel,
  currentId: string,
  ctx: { locals?: any }
): Promise<Map<string, number>> {
  const edges = [...runtime.relationGraph!.edges.values()].filter(
    (edge) => edge.model === model.name && (edge.kind === 'to-many-inverse' || edge.kind === 'to-one-inverse')
  );

  // Un count par relation inverse, indépendants entre eux : en parallèle
  // plutôt qu'empilés un par un (même raisonnement que loadRelationOptions).
  const entries = await Promise.all(
    edges.map(async (edge): Promise<[string, number] | undefined> => {
      const owning = [...runtime.relationGraph!.edges.values()].find(
        (o) => o.model === edge.target && o.kind === 'to-one-owning' && o.relationName === edge.relationName
      );
      if (!owning || owning.unsupported) return undefined;

      const scalarName = owning.scalarFields[0];
      const key = `${edge.model}.${edge.field}`;
      const targetModel = runtime.schema!.models.find((m) => m.name === edge.target)!;
      try {
        const count = await runtime.adapter.data.countRecords(targetModel, combinedScope(
          modelScopeFrom(runtime, targetModel, ctx),
          { op: 'eq', field: scalarName, value: coerceId(currentId, model) }
        ));
        return [key, count];
      } catch {
        return [key, 0];
      }
    })
  );
  return new Map(entries.filter((e): e is [string, number] => e !== undefined));
}
