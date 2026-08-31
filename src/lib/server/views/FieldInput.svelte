<script lang="ts">
  import type { PrismaField } from '../introspection/parser.js';
  import type { SubmittedForm } from '../submitted.js';
  import { toLabel, fieldErrorAttrs } from './html.js';

  let {
    field,
    value,
    isReadonly,
    submitted,
    errorMessage,
    enums = new Map<string, string[]>()
  }: {
    field: PrismaField;
    value: any;
    isReadonly: boolean;
    /** Voir `Form.svelte` : défini seulement sur un re-rendu après échec. */
    submitted?: SubmittedForm;
    /** Défini seulement si c'est ce champ que l'erreur désigne. */
    errorMessage?: string;
    /** Valeurs de chaque enum du schéma, indexées par nom de type. */
    enums?: Map<string, string[]>;
  } = $props();

  const err = $derived(fieldErrorAttrs(field.name, errorMessage));

  const label = $derived(toLabel(field.name));

  /**
   * `submitted` défini signifie « ce formulaire vient d'être posté et refusé ».
   * On teste sa présence, pas celle de la clé : une checkbox décochée et un
   * champ sensible non ré-émis n'envoient rien, et retomber sur la valeur en
   * base rallumerait à l'écran un booléen que l'utilisateur vient d'éteindre.
   *
   * Un champ readonly est exclu : la ligne en base fait foi puisqu'il n'est pas
   * éditable. Un navigateur soumet bien un `readonly` (contrairement à un
   * `disabled`), mais rien ne l'y oblige — un POST forgé ou un client partiel
   * viderait alors l'ID et les horodatages à l'écran, sans que ce soit une
   * donnée que l'utilisateur ait saisie.
   */
  const hasSubmission = $derived(submitted !== undefined && !isReadonly);
  const submittedValue = $derived(submitted?.values[field.name]);
  const required = $derived(field.isRequired && !field.hasDefault && !isReadonly);

  const lower = $derived(field.name.toLowerCase());
  const isLongText = $derived(
    field.type === 'String' &&
    ['description', 'content', 'body', 'bio'].some((k) => lower.includes(k))
  );

  const inputType = $derived.by(() => {
    switch (field.type) {
      case 'Int':
      case 'Float':
      case 'Decimal':
      case 'BigInt':
        return 'number';
      case 'DateTime':
        return 'datetime-local';
      default:
        return 'text';
    }
  });

  const inputValue = $derived.by(() => {
    // Rendue telle qu'elle a été tapée : la re-normaliser (un `datetime-local`
    // incomplet, un nombre en cours de frappe) transformerait la valeur refusée
    // en une autre, et l'utilisateur ne reconnaîtrait plus ce qu'il a saisi.
    if (hasSubmission) return submittedValue ?? '';
    if (field.type === 'DateTime' && value) {
      return new Date(value).toISOString().slice(0, 16);
    }
    return value ?? '';
  });

  /**
   * Valeur retenue par le `<select>` d'un enum : même arbitrage que
   * `inputValue` (ce qui vient d'être soumis prime sur la ligne en base),
   * ramené à une chaîne pour se comparer aux valeurs déclarées de l'enum.
   */
  const enumValue = $derived(String(inputValue));

  const jsonValue = $derived.by(() => {
    if (hasSubmission) return submittedValue ?? '';
    return value ? JSON.stringify(value, null, 2) : '';
  });

  // Absence = décochée : c'est ce que le navigateur envoie, et `formDataToPrisma`
  // l'interprète déjà comme `false` côté écriture.
  const isChecked = $derived(
    hasSubmission ? submittedValue !== undefined : !!value
  );
</script>

{#if field.type === 'Boolean'}
  <div class="ska-field">
    <label class="ska-checkbox-wrap">
      <input
        type="checkbox"
        name={field.name}
        class="ska-checkbox"
        checked={isChecked}
        disabled={isReadonly}
        aria-invalid={err.ariaInvalid}
        aria-describedby={err.describedBy}
      />
      <span class="ska-label">{label}</span>
    </label>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- fieldErrorAttrs échappe l'id et le message -->
    {@html err.html}
  </div>
{:else if field.type === 'Json'}
  <div class="ska-field">
    <label class="ska-label" for={field.name}>{label}{required ? ' *' : ''}</label>
    <textarea id={field.name} name={field.name} class="ska-input" rows="4" readonly={isReadonly} required={required} aria-invalid={err.ariaInvalid} aria-describedby={err.describedBy}>{jsonValue}</textarea>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- fieldErrorAttrs échappe l'id et le message -->
    {@html err.html}
  </div>
{:else if isLongText}
  <div class="ska-field">
    <label class="ska-label" for={field.name}>{label}{required ? ' *' : ''}</label>
    <textarea id={field.name} name={field.name} class="ska-input" rows="4" readonly={isReadonly} required={required} aria-invalid={err.ariaInvalid} aria-describedby={err.describedBy}>{inputValue}</textarea>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- fieldErrorAttrs échappe l'id et le message -->
    {@html err.html}
  </div>
{:else if field.isEnum && enums.has(field.type)}
  <!--
    Calqué sur `RelationSelect.svelte` (même structure, même « — aucun — »), à
    deux écarts près, tous deux volontaires :

    1. Un placeholder désactivé quand la colonne est non nullable et n'a pas
       encore de valeur. Sans lui le navigateur présélectionne la première
       valeur de l'enum, et une création écrit un choix que l'utilisateur n'a
       jamais fait. `RelationSelect` a le même défaut pour une FK obligatoire —
       il n'est pas corrigé ici, ce serait un autre comportement dans une autre
       PR.
    2. `disabled` et non `readonly` : un `<select>` n'a pas de `readonly`. Le
       champ sort donc du POST, `formDataToPrisma` ignore la clé absente et la
       colonne n'est pas réécrite — exactement ce que « lecture seule » veut
       dire, et plus sûr que les branches texte qui, elles, réémettent la valeur.

    L'option vide se décide sur `field.isRequired` (la colonne accepte-t-elle
    NULL) et non sur `required` (l'attribut du widget, faux dès qu'il y a un
    `@default`) : une colonne non nullable à défaut n'accepte toujours pas
    « aucun ».
  -->
  <div class="ska-field">
    <label class="ska-label" for={field.name}>{label}{required ? ' *' : ''}</label>
    <select id={field.name} name={field.name} class="ska-input" disabled={isReadonly} required={required} aria-invalid={err.ariaInvalid} aria-describedby={err.describedBy}>
      {#if !field.isRequired}
        <option value="">— aucun —</option>
      {:else if !enumValue}
        <option value="" disabled selected>Select…</option>
      {/if}
      {#each enums.get(field.type)! as v (v)}
        <option value={v} selected={v === enumValue}>{v}</option>
      {/each}
    </select>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- fieldErrorAttrs échappe l'id et le message -->
    {@html err.html}
  </div>
{:else}
  <div class="ska-field">
    <label class="ska-label" for={field.name}>{label}{required ? ' *' : ''}</label>
    <input id={field.name} type={inputType} name={field.name} value={inputValue} class="ska-input" readonly={isReadonly} required={required} aria-invalid={err.ariaInvalid} aria-describedby={err.describedBy} />
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- fieldErrorAttrs échappe l'id et le message -->
    {@html err.html}
  </div>
{/if}
