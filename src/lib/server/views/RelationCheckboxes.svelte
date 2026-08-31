<script lang="ts">
  import type { RelationEdge } from '../introspection/relations.js';
  import type { RelationMeta } from './types.js';
  import { toLabel, fieldErrorAttrs } from './html.js';

  let {
    edge,
    meta,
    submittedIds,
    errorMessage
  }: {
    edge: RelationEdge;
    meta: RelationMeta;
    /**
     * IDs cochés au dernier POST, quand la mutation a échoué. Un tableau vide
     * dit « tout décoché » et doit gagner sur `meta.selectedIds` ; `undefined`
     * dit « pas un re-rendu d'erreur ». C'est la même distinction que le
     * sentinelle `__rel_present__` côté écriture.
     */
    submittedIds?: string[];
    /** Défini seulement si c'est cette relation que l'erreur désigne. */
    errorMessage?: string;
  } = $props();

  const label = $derived(toLabel(edge.field));
  const inputName = $derived(`__rel__${edge.field}`);
  const selected = $derived(
    new Set((submittedIds ?? meta.selectedIds ?? []).map(String))
  );
  const err = $derived(fieldErrorAttrs(inputName, errorMessage));
</script>

<!--
  Fieldset de checkboxes pour une arête m2m.

  Nommage `__rel__<field>` pour les valeurs cochées et un hidden sentinelle
  `__rel_present__<field>` toujours émis : en HTML, zéro checkbox cochée
  retire la clé du POST, donc impossible de distinguer "tout décoché" de
  "widget absent" sans ce sentinelle. Voir docs/design/relations.md §3.1.
-->
{#if meta.tooMany}
  <!-- Au-delà du seuil : liste d'IDs texte, jamais des centaines de checkboxes. -->
  <div class="ska-field">
    <label class="ska-label" for={inputName}>{label} (IDs séparés par des virgules)</label>
    <input type="hidden" name="__rel_present__{edge.field}" value="1" />
    <input id={inputName} type="text" name={inputName} value={[...selected].join(',')} class="ska-input" aria-invalid={err.ariaInvalid} aria-describedby={err.describedBy} />
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- fieldErrorAttrs échappe l'id et le message -->
    {@html err.html}
  </div>
{:else}
  <div class="ska-field">
    <label class="ska-label" for={inputName}>{label}</label>
    <input type="hidden" name="__rel_present__{edge.field}" value="1" />
    <!-- Pas d'`aria-invalid` ici : l'attribut n'est pas permis sur le rôle
         `group` implicite d'un `<fieldset>`. Le rattachement du message se fait
         par `aria-describedby` seul, qui l'est. -->
    <fieldset id={inputName} class="ska-checkbox-group" aria-describedby={err.describedBy}>
      {#each meta.options as opt (opt.id)}
        <label class="ska-checkbox-wrap">
          <input
            type="checkbox"
            name={inputName}
            value={opt.id}
            class="ska-checkbox"
            checked={selected.has(String(opt.id))}
          />
          <span class="ska-label">{opt.label}</span>
        </label>
      {/each}
    </fieldset>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- fieldErrorAttrs échappe l'id et le message -->
    {@html err.html}
  </div>
{/if}
