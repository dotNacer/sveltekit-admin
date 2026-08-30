/**
 * POST create/update/delete handling — split out of `handler.ts`, pure
 * orchestration over `AdminRuntime`. Reads `formData` unconditionally: the
 * handler only calls this on `event.request.method === 'POST'`, so the
 * request body is never consumed on GET.
 */

import { primaryKeyOf, coerceId, formDataToPrisma } from './data.js';
import { OPAQUE_FILTER_ERROR } from './adapters/filter.js';
import {
  buildAuditEvent,
  emitAudit,
  readAuditSnapshot
} from './audit.js';
import type { ParsedRoute } from './router.js';
import { scopeFrom, modelScopeFrom, modelScopeValues, type AdminRuntime } from './runtime.js';
import type { TargetGuard } from './adapters/types.js';

export async function handleMutation(
  runtime: AdminRuntime,
  event: any,
  route: ParsedRoute
): Promise<Response | null> {
  const modelsConfig = runtime.config.models ?? {};
  const audit = runtime.config.audit;

  const formData = await event.request.formData();
  const action = formData.get('_action');

  if (!route.model) return null;

  const model = runtime.findModel(route.model);
  if (!model) {
    throw new Error(`Model "${route.model}" not found`);
  }

  const redirectToList = (modelName: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${runtime.basePath}/${modelName.toLowerCase()}` }
    });

  const scopedRecord = async (id: string | number) => {
    const modelScope = modelScopeFrom(runtime, model, { locals: event.locals });
    if (!modelScope) return true;
    return runtime.adapter.data.findFirst(model, {
      op: 'and',
      clauses: [{ op: 'eq', field: primaryKeyOf(model), value: coerceId(String(id), model) }, modelScope]
    });
  };

  if (action === 'delete' && route.id) {
    const id = coerceId(route.id, model);
    if (!(await scopedRecord(id))) return null;
    const before = audit
      ? await readAuditSnapshot((m, recId) => runtime.adapter.data.getRecord(m, recId), model, id)
      : null;
    await runtime.adapter.data.deleteRecord(model, route.id, modelScopeFrom(runtime, model, { locals: event.locals }));
    if (audit) {
      await emitAudit(
        audit,
        buildAuditEvent({
          event,
          action: 'delete',
          model,
          id,
          hidden: runtime.hiddenFieldsOf(model),
          before
        })
      );
    }
    return redirectToList(route.model);
  }

  if (action === 'create' || action === 'update') {
    const data = formDataToPrisma(formData, model);
    // Appelé tôt pour échouer vite sur un scope non injectable (`or`, opérateur
    // autre que `eq`, tenant absent), avant tout travail de validation.
    // Volontairement PAS appliqué ici : `data` doit conserver ce que le client
    // a soumis, sinon la confrontation au scope plus bas ne verrait plus que la
    // valeur déjà corrigée, et ne lèverait que pour les scalaires de relation
    // — les seuls que la boucle FK réécrit.
    const scopeValues = modelScopeValues(runtime, model, { locals: event.locals });
    const m2mInput: Record<string, { targetPkField: string; ids: Array<string | number> }> = {};
    const targetGuards: TargetGuard[] = [];

    // Validation des FK owning : coercion + existence + self-ref.
    // Rejoue le `where` de scoping : un ID hors du where est rejeté,
    // pas seulement caché du select (IDOR par POST forgé).
    if (runtime.relationGraph) {
      for (const edge of runtime.relationGraph.edges.values()) {
        if (edge.model !== model.name || edge.kind !== 'to-one-owning') continue;
        if (edge.unsupported) continue;

        const scalarName = edge.scalarFields[0]!;
        // Lu directement depuis le FormData plutôt que `data` :
        // `formDataToPrisma` omet la clé pour un scalaire required
        // laissé vide, donc `data[scalarName]` ne suffirait pas ici.
        const raw = formData.get(scalarName);
        if (raw === null) continue;

        const relConfig = modelsConfig[model.name]?.relations?.[edge.field];

        // Vide sur relation optionnelle → null (disconnect).
        if (raw === '' || raw === undefined || raw === null) {
          if (edge.isRequired) {
            throw new Error(`${edge.field} is required`);
          }
          data[scalarName] = null;
          continue;
        }

        // Coercion vers le type de la PK cible. `targetModel` existe
        // toujours : le graphe n'aurait pas produit d'arête sinon.
        const targetModel = runtime.schema!.models.find((m) => m.name === edge.target)!;
        const pkField = targetModel.fields.find((f) => f.isId);
        const coerced = pkField?.type === 'Int' ? parseInt(String(raw)) : String(raw);
        if (pkField?.type === 'Int' && !Number.isSafeInteger(coerced)) {
          throw new Error(`${edge.field}: invalid id`);
        }

        // Self-ref : la ligne courante ne peut pas être sa propre cible.
        if (edge.selfReferential && route.id && String(coerced) === String(coerceId(route.id, model))) {
          throw new Error(`${edge.field}: cannot reference itself`);
        }

        // Existence + scoping. findFirst et non findUnique : le where
        // peut porter des conditions arbitraires (scoping multi-tenant).
        // Si le client ne sait pas répondre, on ne bloque pas l'écriture.
        const scopeFilter = scopeFrom(relConfig, { locals: event.locals });
        const modelFilter = modelScopeFrom(runtime, targetModel, { locals: event.locals });
        try {
          const idFilter = { op: 'eq' as const, field: primaryKeyOf(targetModel), value: coerced };
          const scopes = [scopeFilter, modelFilter].filter(Boolean);
          const filter = scopes.length ? ({ op: 'and', clauses: [idFilter, ...scopes] } as any) : idFilter;
          targetGuards.push({ targetModel, targetPk: coerced, filter: scopes.length ? ({ op: 'and', clauses: scopes } as any) : undefined });
          const found = await runtime.adapter.data.findFirst(targetModel, filter);
          if (!found) {
            throw new Error(`${edge.field}: invalid value`);
          }
        } catch (e: any) {
          if (e?.message?.includes('invalid value')) throw e;
          if (
            e?.message &&
            (e.message.includes(OPAQUE_FILTER_ERROR) ||
              OPAQUE_FILTER_ERROR.startsWith(e.message))
          ) {
            throw new Error(`${edge.field}: invalid value`);
          }
          if (e?.message?.includes('unknown field')) {
            throw new Error(`${edge.field}: invalid value`);
          }
          throw new Error(`${edge.field}: invalid value`);
        }

        data[scalarName] = coerced;
      }

      // N-N implicite : lit `__rel__<field>` (valeurs cochées) et
      // `__rel_present__<field>` (sentinelle). Sans le sentinelle,
      // le champ est absent du form (readonly/exclu) → no-op.
      // Avec le sentinelle mais zéro valeur cochée → vider la
      // relation (`set: []` / rien à connecter en création).
      for (const edge of runtime.relationGraph.edges.values()) {
        if (edge.model !== model.name || edge.kind !== 'm2m') continue;
        // Pas de garde `edge.unsupported` ici : par construction du
        // graphe, `unsupported` n'est jamais posé sur une arête
        // m2m (seulement sur to-one-owning / groupes
        // ambigus, qui retombent toujours en to-one-owning).

        const present = formData.get(`__rel_present__${edge.field}`);
        if (present === null) continue;

        const relConfig = modelsConfig[model.name]?.relations?.[edge.field];
        const targetModel = runtime.schema!.models.find((m) => m.name === edge.target)!;
        const targetPk = primaryKeyOf(targetModel);
        const pkIsInt = targetModel.fields.find((f) => f.isId)?.type === 'Int';

        const submitted = formData.getAll(`__rel__${edge.field}`).map(String);
        const rawIds: string[] =
          submitted.length === 1 && submitted[0].includes(',')
            ? submitted[0].split(',').map((s: string) => s.trim()).filter(Boolean)
            : submitted;

        const ids: (string | number)[] = rawIds.map((v: string) =>
          pkIsInt ? parseInt(v) : v
        );
        if (pkIsInt && ids.some((v) => !Number.isSafeInteger(v))) {
          throw new Error(`${edge.field}: invalid id`);
        }

        // Existence + scoping en une requête, sur l'ensemble des IDs
        // soumis. Un compte différent = au moins un ID invalide ou
        // hors scoping — IDOR bloqué au même titre que pour les FK.
        if (ids.length > 0) {
          const inFilter = { op: 'in' as const, field: targetPk, value: ids };
          const scopeFilter = scopeFrom(relConfig, { locals: event.locals });
          const modelFilter = modelScopeFrom(runtime, targetModel, { locals: event.locals });
          const scopes = [scopeFilter, modelFilter].filter(Boolean);
          const filter = scopes.length ? ({ op: 'and', clauses: [inFilter, ...scopes] } as any) : inFilter;
          try {
            const found = await runtime.adapter.data.findMany(targetModel, { filter });
            for (const id of [...new Map(ids.map((id) => [String(id), id])).values()]) {
              targetGuards.push({ targetModel, targetPk: id, filter: scopes.length ? ({ op: 'and', clauses: scopes } as any) : undefined });
            }
            if (found.length !== new Set(ids.map(String)).size) {
              throw new Error(`${edge.field}: invalid value`);
            }
          } catch (e: any) {
            if (e?.message?.includes('invalid value')) throw e;
            if (
              e?.message &&
              (e.message.includes(OPAQUE_FILTER_ERROR) ||
                OPAQUE_FILTER_ERROR.startsWith(e.message))
            ) {
              throw new Error(`${edge.field}: invalid value`);
            }
            if (e?.message?.includes('unknown field')) {
              throw new Error(`${edge.field}: invalid value`);
            }
            throw new Error(`${edge.field}: invalid value`);
          }
        }

        m2mInput[edge.field] = { targetPkField: targetPk, ids };
      }
    }

    // Imposition du scope, en dernier et volontairement après les boucles
    // ci-dessus : elles réécrivent `data[scalarName]` avec la valeur soumise,
    // et la colonne de tenant est presque toujours un scalaire de relation
    // (`organizationId`, `authorId`…). Sans ce passage, un POST forgé créait
    // dans un autre tenant, ou y déplaçait un enregistrement possédé.
    //
    // Une valeur soumise divergente est rejetée, pour toute colonne de scope et
    // pas seulement pour les scalaires de relation : la valeur est déterminée
    // par le serveur, donc une divergence est soit un POST forgé, soit un
    // formulaire qui offre un choix qu'il ne devrait pas offrir. Corriger en
    // silence masquerait les deux. Comparaison par `String` comme ailleurs pour
    // les ids (cf. la garde self-ref), afin qu'un scope numérique et une PK
    // coercée ne divergent pas sur le seul type.
    //
    // Seule une valeur réellement affirmée par le client est confrontée au
    // scope. `formDataToPrisma` renvoie `''` (String) ou `null` (Int, Float,
    // DateTime) pour un champ présent mais vide — et le formulaire de création
    // rend justement la colonne de scope vide. Traiter ce vide comme un conflit
    // rendrait toute création impossible dès que la colonne est visible.
    // Un vide veut dire « le formulaire n'a rien fourni », pas « le client
    // revendique un autre tenant » : on impose alors la valeur sans lever.
    //
    // L'affectation est HORS du `if` : c'est elle qui porte la garantie, pas la
    // comparaison. Replier ceci en `if (…) { … } else { … }` — un nettoyage
    // d'apparence anodine — réintroduirait la faille dès qu'une comparaison
    // `String` coïncide par accident.
    for (const [field, value] of Object.entries(scopeValues)) {
      const submitted = data[field];
      const asserted = field in data && submitted !== null && submitted !== undefined && submitted !== '';
      if (asserted && String(submitted) !== String(value)) {
        throw new Error(`${field}: value is outside the authorization scope`);
      }
      data[field] = value;
    }

    if (action === 'create') {
      const created = await runtime.adapter.data.createRecord(model, { scalars: data, m2m: m2mInput, targetGuards });
      if (audit) {
        await emitAudit(
          audit,
          buildAuditEvent({
            event,
            action: 'create',
            model,
            id: created[primaryKeyOf(model)] as string | number,
            hidden: runtime.hiddenFieldsOf(model),
            values: data,
            m2m: m2mInput,
            after: created
          })
        );
      }
    } else if (route.id) {
      const id = coerceId(route.id, model);
      if (!(await scopedRecord(id))) return null;
      const before = audit
        ? await readAuditSnapshot((m, recId) => runtime.adapter.data.getRecord(m, recId), model, id)
        : null;
      const updated = await runtime.adapter.data.updateRecord(model, route.id, {
        scalars: data,
        m2m: m2mInput,
        targetGuards
      }, modelScopeFrom(runtime, model, { locals: event.locals }));
      if (audit) {
        await emitAudit(
          audit,
          buildAuditEvent({
            event,
            action: 'update',
            model,
            id,
            hidden: runtime.hiddenFieldsOf(model),
            values: data,
            m2m: m2mInput,
            before,
            after: updated
          })
        );
      }
    }

    return redirectToList(route.model);
  }

  return null;
}
