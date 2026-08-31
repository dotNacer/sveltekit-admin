/**
 * POST create/update/delete handling — split out of `handler.ts`, pure
 * orchestration over `AdminRuntime`.
 *
 * Le corps est lu par l'appelant et reçu en paramètre, pas consommé ici : le
 * handler doit garder ce qui a été soumis pour le re-rendre si cette fonction
 * lève (`readSubmittedForm`), et un corps de requête ne se lit qu'une fois.
 * L'appelant n'invoque cette fonction que sur `POST`, donc aucun GET ne lit de
 * corps.
 */

import { primaryKeyOf, coerceId, formDataToPrisma } from './data.js';
import { isSensitiveStringField } from './introspection/parser.js';
import { AdminMutationError, classifyWriteError } from './errors.js';
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
  route: ParsedRoute,
  formData: FormData
): Promise<Response | null> {
  const modelsConfig = runtime.config.models ?? {};
  const audit = runtime.config.audit;

  const action = formData.get('_action');

  if (!route.model) return null;

  const model = runtime.findModel(route.model);
  if (!model) {
    throw new AdminMutationError('notFound', `Model "${route.model}" not found`);
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
    try {
      await runtime.adapter.data.deleteRecord(
        model,
        route.id,
        modelScopeFrom(runtime, model, { locals: event.locals })
      );
    } catch (e) {
      // Classé ici et non dans `handler.ts` : seul ce site connaît l'action
      // réellement en cours, et `reference` / `restrict` partagent le même code
      // SQLSTATE — c'est l'action qui les sépare. Un code non reconnu est relayé
      // tel quel, et c'est le handler qui le masquera.
      throw classifyWriteError(e, 'delete') ?? e;
    }
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

    // Colonnes de texte sensibles (`password`, `passwordHash`, `apiToken`…).
    // Le formulaire d'édition ne les rend pas — cf. `Form.svelte` — donc rien
    // de légitime n'arrive par là ; une valeur présente vient d'un POST forgé
    // ou d'un client qui invente un champ, et l'écrire remplacerait un
    // credential par ce que l'appelant a choisi. La clé sort du payload, sans
    // lever : ce n'est pas une donnée refusée, c'est une donnée non demandée.
    //
    // À la création, à l'inverse, le champ est offert. Un vide y était écrit
    // comme `''`, ce qui produisait un compte au credential inutilisable avec
    // un `303` d'apparence réussie. On refuse plutôt, et seulement quand la
    // colonne est réellement obligatoire — une colonne optionnelle garde le
    // droit d'être vide.
    for (const field of model.fields) {
      if (!isSensitiveStringField(field)) continue;

      if (action === 'update') {
        delete data[field.name];
        continue;
      }
      const submitted = data[field.name];
      const isEmpty = submitted === undefined || submitted === null || submitted === '';
      if (isEmpty && field.isRequired && !field.hasDefault) {
        throw new AdminMutationError('validation', `${field.name} is required`, field.name);
      }
      // Optionnelle et vide : ne rien écrire plutôt qu'une chaîne vide, qui
      // serait indistinguable d'un secret réellement égal à ''.
      if (isEmpty) delete data[field.name];
    }

    /**
     * Revalidation des enums. Le `<select>` rendu par `FieldInput` ne propose
     * que des valeurs déclarées, mais un POST forgé n'y est pas tenu — même
     * raison que la revalidation des cibles FK/m2m plus bas : ce que
     * l'interface n'aurait pas offert ne doit pas passer sous prétexte qu'elle
     * ne l'aurait pas offert. Sans ça, la valeur inventée part au pilote et
     * ressort en message générique, sans désigner le champ fautif.
     *
     * `schema!` et `get(...)!` sont sûrs par construction : `isEnum` n'est posé
     * qu'à partir de la table des enums du schéma (`parser.ts:220`, et
     * `inspect.ts` côté Drizzle qui alimente les deux ensemble), et un modèle
     * résolu implique un schéma introspecté.
     *
     * Le vide se décide sur `isRequired` seul, sans le `!hasDefault` de la
     * boucle au-dessus : celle-ci couvre une création où le défaut de la base
     * peut encore remplir la colonne, alors qu'ici « vide » vise une colonne
     * qui n'accepte pas NULL — un `@default` n'y change rien.
     */
    const schemaEnums = runtime.schema!.enums;
    for (const field of model.fields) {
      if (!field.isEnum || !(field.name in data)) continue;
      // Le vide (ce que poste le « — aucun — » du widget) ne se décide pas ici
      // mais dans le contrôle unique en fin de fonction, après l'imposition du
      // scope : une colonne de tenant qui se trouve être un enum est rendue
      // vide par le formulaire de création, et la refuser ici rendrait le
      // modèle incréable. Cette boucle ne valide plus que le domaine.
      if (data[field.name] === null) continue;

      if (!schemaEnums.get(field.type)!.includes(String(data[field.name]))) {
        throw new AdminMutationError('validation', `${field.name}: invalid value`, field.name);
      }
    }

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
            throw new AdminMutationError('validation', `${edge.field} is required`, edge.field);
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
          throw new AdminMutationError('validation', `${edge.field}: invalid id`, edge.field);
        }

        // Self-ref : la ligne courante ne peut pas être sa propre cible.
        if (edge.selfReferential && route.id && String(coerced) === String(coerceId(route.id, model))) {
          throw new AdminMutationError(
            'validation',
            `${edge.field}: cannot reference itself`,
            edge.field
          );
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
            throw new AdminMutationError('validation', `${edge.field}: invalid value`, edge.field);
          }
        } catch (e: any) {
          // Déjà typée par le `if (!found)` ci-dessus : la relayer telle quelle.
          // Toute autre cause (scope incompilable, champ inconnu, panne pilote)
          // devient le même refus : la valeur soumise n'est pas acceptable, et on
          // ne renvoie jamais au client ce que le pilote a dit.
          if (e instanceof AdminMutationError) throw e;
          throw new AdminMutationError('validation', `${edge.field}: invalid value`, edge.field);
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
          throw new AdminMutationError('validation', `${edge.field}: invalid id`, edge.field);
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
              throw new AdminMutationError('validation', `${edge.field}: invalid value`, edge.field);
            }
          } catch (e: any) {
            // Déjà typée par le contrôle de cardinalité ci-dessus : la relayer
            // telle quelle. Toute autre cause (scope incompilable, champ
            // inconnu, panne pilote) devient le même refus : la valeur soumise
            // n'est pas acceptable, et on ne renvoie jamais au client ce que le
            // pilote a dit.
            if (e instanceof AdminMutationError) throw e;
            throw new AdminMutationError('validation', `${edge.field}: invalid value`, edge.field);
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
    // scope. `formDataToPrisma` renvoie `null` pour un champ présent mais vide,
    // quel que soit son type — et le formulaire de création rend justement la
    // colonne de scope vide. Traiter ce vide comme un conflit rendrait toute
    // création impossible dès que la colonne est visible.
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
        throw new AdminMutationError(
          'authorization',
          `${field}: value is outside the authorization scope`,
          field
        );
      }
      data[field] = value;
    }

    /**
     * Vide sur une colonne qui n'accepte pas NULL : refus, et le champ fautif
     * est nommé. `formDataToPrisma` distingue déjà les deux sens du mot vide —
     * une clé ABSENTE n'a pas été soumise (readonly, masquée, colonne à défaut
     * que le formulaire de création n'affiche pas) et n'écrit rien ; une clé
     * PRÉSENTE à `null` est une saisie vidée.
     *
     * Placé ici, en dernier, et pas plus haut avec les autres validations :
     *
     * - après l'imposition du scope, parce que le formulaire de création rend
     *   la colonne de tenant vide (voir le bloc juste au-dessus). À ce point la
     *   valeur imposée par le serveur est déjà posée, donc plus rien à refuser ;
     * - après la boucle FK, qui rattache son refus à l'arête (`author is
     *   required`) et non au scalaire (`authorId`). C'est cet ordre qui lui en
     *   laisse la propriété, pas un garde ici : une arête optionnelle a un
     *   scalaire optionnel (Prisma lie les deux), donc le seul scalaire de
     *   relation qui puisse encore être `null` en arrivant ici appartient à une
     *   arête que la boucle FK ne gère pas — une FK composite, qu'aucun widget
     *   ne rend et que seul ce contrôle-ci peut alors nommer.
     *
     * Les champs sensibles n'y passent pas non plus : leur boucle, tout en
     * haut, supprime déjà la clé d'une colonne optionnelle vide plutôt que d'y
     * écrire `null` — `''` y serait indistinguable d'un secret réellement vide.
     *
     * `hasDefault` n'entre pas dans la décision : à la création la colonne à
     * défaut n'est pas rendue, donc la clé est absente ; à l'édition la ligne a
     * déjà une valeur, et la vider est une saisie, pas une absence.
     */
    for (const field of model.fields) {
      if (!field.isRequired || !(field.name in data) || data[field.name] !== null) continue;

      throw new AdminMutationError('validation', `${field.name} is required`, field.name);
    }

    if (action === 'create') {
      let created;
      try {
        created = await runtime.adapter.data.createRecord(model, {
          scalars: data,
          m2m: m2mInput,
          targetGuards
        });
      } catch (e) {
        // Classé ici et non dans `handler.ts` : seul ce site connaît l'action
        // réellement en cours, et `reference` / `restrict` partagent le même code
        // SQLSTATE — c'est l'action qui les sépare. Un code non reconnu est relayé
        // tel quel, et c'est le handler qui le masquera.
        throw classifyWriteError(e, 'create') ?? e;
      }
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
      let updated;
      try {
        updated = await runtime.adapter.data.updateRecord(
          model,
          route.id,
          { scalars: data, m2m: m2mInput, targetGuards },
          modelScopeFrom(runtime, model, { locals: event.locals })
        );
      } catch (e) {
        // Classé ici et non dans `handler.ts` : seul ce site connaît l'action
        // réellement en cours, et `reference` / `restrict` partagent le même code
        // SQLSTATE — c'est l'action qui les sépare. Un code non reconnu est relayé
        // tel quel, et c'est le handler qui le masquera.
        throw classifyWriteError(e, 'update') ?? e;
      }
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
