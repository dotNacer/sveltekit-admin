<script lang="ts">
  import type { AdminHandlerConfig } from '../handler.js';
  import type { RecordAction, ViewModel } from './types.js';
import type { RelationEdge } from '../introspection/relations.js';
  import type { SubmittedForm } from '../submitted.js';
  import { isSensitiveStringField } from '../introspection/parser.js';
  import FieldInput from './FieldInput.svelte';
  import RelationSelect from './RelationSelect.svelte';
  import RelationCheckboxes from './RelationCheckboxes.svelte';
  import RelatedBlock from './RelatedBlock.svelte';
  import { escapeHtml } from './html.js';

  let {
    mode,
    model,
    basePath,
    config,
    item,
    recordActions = [],
    submitted,
    mutationError
  }: {
    mode: 'create' | 'edit';
    model: ViewModel;
    basePath: string;
    config: AdminHandlerConfig;
    item?: any;
    recordActions?: RecordAction[];
    /**
     * Ce que le POST venait de soumettre, quand la mutation a échoué. Défini
     * uniquement sur un re-rendu d'erreur : `undefined` veut dire « affichage
     * normal », et c'est cette distinction — pas le contenu — qui permet à un
     * booléen décoché de rester décoché.
     */
    submitted?: SubmittedForm;
    /**
     * L'échec qui a provoqué ce re-rendu. `field` est absent quand la cause ne
     * désigne pas un champ (conflit d'unicité, message générique) : le message
     * ne vit alors que dans la bannière de page, posée par `handler.ts`.
     */
    mutationError?: { message: string; field?: string };
  } = $props();

  /**
   * Le message n'est rendu qu'au widget que l'erreur nomme. Un champ absent du
   * formulaire (masqué, ou un scalaire sans widget propre) ne fait rien
   * apparaître : la bannière reste le canal de repli.
   */
  const errorFor = (...names: Array<string | undefined>) =>
    mutationError?.field !== undefined && names.includes(mutationError.field)
      ? mutationError.message
      : undefined;

  const modelConfig = $derived(config.models?.[model.name] || {});
  type FormItem =
    | { kind: 'field'; field: (typeof model.fields)[number] }
    | { kind: 'select'; edge: RelationEdge }
    | { kind: 'checkbox'; edge: RelationEdge };
  const hidden = $derived(modelConfig.hidden || []);
  const readonly = $derived(modelConfig.readonly || []);
  const listPath = $derived(`${basePath}/${model.name.toLowerCase()}`);
  const fieldOrder = $derived(model.fields.map((f) => f.name));
  const edgeOrder = (a: { field: string }, b: { field: string }) =>
    fieldOrder.indexOf(a.field) - fieldOrder.indexOf(b.field);

  /**
   * `Bytes` n'a pas de widget : rendue dans la branche texte générique, la
   * colonne renvoyait au pilote une chaîne là où il attend un `Uint8Array`,
   * donc aucune écriture n'a jamais pu aboutir. L'exclure rend un modèle à
   * colonne `Bytes` obligatoire incréable depuis l'admin — c'est déjà le cas
   * en pratique, à ceci près que l'échec arrive maintenant avant le formulaire
   * plutôt qu'après le POST. La liste l'écarte déjà pareillement
   * (`List.svelte`), c'est la même décision au même endroit du schéma.
   */
  const isEditableType = (f: { type: string }) => f.type !== 'Bytes';

  const formFields = $derived(
    mode === 'create'
      ? model.fields.filter(
          (f) =>
            !hidden.includes(f.name) &&
            isEditableType(f) &&
            !f.isId &&
            !f.isCreatedAt &&
            !f.isUpdatedAt &&
            !f.relation &&
            !f.hasDefault &&
            // Masqué : remplacé par le select de sa relation ci-dessous.
            !model.relationGraph?.scalarToRelation.has(f.name)
        )
      : model.fields.filter(
          (f) =>
            !hidden.includes(f.name) &&
            isEditableType(f) &&
            !f.relation &&
            // Exclu à l'édition seulement : il existe ici une valeur stockée,
            // donc quelque chose à exposer dans le HTML et à écraser au
            // prochain enregistrement. Le formulaire de création le garde — il
            // n'y a rien à fuiter avant que la ligne existe, et le retirer
            // rendrait un modèle à colonne obligatoire incréable depuis
            // l'admin. `mutations.ts` refuse le vide de ce côté-là.
            !isSensitiveStringField(f) &&
            !model.relationGraph?.scalarToRelation.has(f.name)
        )
  );

  const isFieldReadonly = (f: (typeof formFields)[number]) =>
    mode === 'edit' && (f.isId || f.isCreatedAt || f.isUpdatedAt || readonly.includes(f.name));

  const relationSelects = $derived(
    model.relationGraph
      ? [...model.relationGraph.edges.values()].filter(
          (e) =>
            e.model === model.name &&
            e.kind === 'to-one-owning' &&
            !e.unsupported &&
            !hidden.includes(e.field) &&
            model.relationOptions?.has(`${e.model}.${e.field}`)
        ).sort(edgeOrder)
      : []
  );

  /**
   * Sur un re-rendu d'erreur, le scalaire soumis fait foi ; sinon la ligne en
   * base. Le `??` ne suffirait pas : une relation optionnelle qu'on vient de
   * vider arrive comme `''`, ce qui doit rester `''` et non retomber sur
   * l'ancienne cible.
   */
  const currentValueOf = (scalarName: string) =>
    submitted ? (submitted.values[scalarName] ?? '') : item ? item[scalarName] : null;

  const relationCheckboxGroups = $derived(
    model.relationGraph
      ? [...model.relationGraph.edges.values()].filter(
          (e) =>
            e.model === model.name &&
            e.kind === 'm2m' &&
            !e.unsupported &&
            !hidden.includes(e.field) &&
            model.relationOptions?.has(`${e.model}.${e.field}`)
        ).sort(edgeOrder)
      : []
  );
  const formItems = $derived.by(() => {
    const selects = new Map(relationSelects.map((edge) => [edge.field, edge]));
    const checkboxes = new Map(relationCheckboxGroups.map((edge) => [edge.field, edge]));
    return model.fields.flatMap((field): FormItem[] => {
      const select = selects.get(field.name);
      if (select) return [{ kind: 'select' as const, edge: select }];
      const checkbox = checkboxes.get(field.name);
      if (checkbox) return [{ kind: 'checkbox' as const, edge: checkbox }];
      return formFields.includes(field) ? [{ kind: 'field' as const, field }] : [];
    });
  });


  // render stays a single @html call: Svelte 5's SSR wraps every {#if}/{#each} node
  // in its own hydration-boundary comment regardless of the branch/array taken, so
  // nesting recordActions in its own control-flow blocks would add bytes to every
  // edit-form render even when recordActions is []. `label` and `href` are both
  // escaped manually since this goes through @html instead of Svelte's
  // auto-escaped text/attributes.
  const recordActionsHtml = $derived(
    mode === 'edit' && recordActions.length > 0
      ? `<div class="ska-record-actions">${recordActions
          .map(
            (action) =>
              `<a href="${escapeHtml(action.href)}" class="ska-btn ska-btn--secondary ska-btn--sm">${escapeHtml(action.label)}</a>`
          )
          .join('')}</div>`
      : ''
  );

  const inverseEdges = $derived(
    model.relationGraph
      ? [...model.relationGraph.edges.values()].filter(
          (e) => e.model === model.name && (e.kind === 'to-many-inverse' || e.kind === 'to-one-inverse')
        ).sort(edgeOrder)
      : []
  );
</script>

<a href={listPath} class="ska-back">← Back to list</a>
<h1>{mode === 'create' ? 'Create' : 'Edit'} {model.singularLabel ?? model.label}</h1>
{#if mode === 'edit'}
  <p class="ska-subtitle">ID: {item[model.primaryKey]}</p>
{/if}

<!-- eslint-disable-next-line svelte/no-at-html-tags -- recordActionsHtml escapes both action.label and action.href via escapeHtml -->
{@html recordActionsHtml}

<div class="ska-card">
  <form method="POST" class="ska-form">
    <input type="hidden" name="_action" value={mode === 'create' ? 'create' : 'update'} />
    {#each formItems as formItem (formItem.kind === 'field' ? formItem.field.name : formItem.edge.field)}
      {#if formItem.kind === 'field'}
        <FieldInput
          field={formItem.field}
          value={item ? item[formItem.field.name] : null}
          isReadonly={isFieldReadonly(formItem.field)}
          {submitted}
          errorMessage={errorFor(formItem.field.name)}
          enums={model.enums}
        />
      {:else if formItem.kind === 'select'}
        <RelationSelect
          edge={formItem.edge}
          meta={model.relationOptions!.get(`${formItem.edge.model}.${formItem.edge.field}`)!}
          currentValue={currentValueOf(formItem.edge.scalarFields[0])}
          {config}
          errorMessage={errorFor(formItem.edge.field, formItem.edge.scalarFields[0])}
        />
      {:else}
        <RelationCheckboxes
          edge={formItem.edge}
          meta={model.relationOptions!.get(`${formItem.edge.model}.${formItem.edge.field}`)!}
          submittedIds={submitted?.m2m[formItem.edge.field]}
          errorMessage={errorFor(formItem.edge.field)}
        />
      {/if}
    {/each}
    <div class="ska-form__actions">
      <button type="submit" class="ska-btn ska-btn--primary">{mode === 'create' ? 'Create' : 'Save Changes'}</button>
      <a href={listPath} class="ska-btn ska-btn--secondary">Cancel</a>
    </div>
  </form>
</div>
{#if mode === 'edit' && model.relationGraph && model.relatedCounts}
  <RelatedBlock
    edges={inverseEdges}
    graph={model.relationGraph}
    counts={model.relatedCounts}
    currentId={item[model.primaryKey]}
    {basePath}
  />
{/if}

