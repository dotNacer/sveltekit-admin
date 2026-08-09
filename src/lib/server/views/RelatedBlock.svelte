<script lang="ts">
  import type { RelationEdge, RelationGraph } from '../introspection/relations.js';
  import { toLabel } from './html.js';

  /**
   * Bloc read-only pour les relations inverses (1-N inverse, 1-1 inverse) :
   * compteur + lien "voir tout" filtré + lien "ajouter" pré-rempli avec la FK.
   * Jamais éditable depuis ce formulaire — éditer une liste d'enfants depuis
   * le parent, c'est un inline formset (non-objectif, voir
   * docs/design/relations.md §2.5/§3.4).
   */
  let {
    edges,
    graph,
    counts,
    currentId,
    basePath
  }: {
    edges: RelationEdge[];
    graph: RelationGraph;
    counts: Map<string, number>;
    currentId: string | number;
    basePath: string;
  } = $props();

  interface Row {
    field: string;
    label: string;
    count: number;
    viewAllHref: string;
    addHref: string;
  }

  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    for (const e of edges) {
      // Le champ FK vit sur la contrepartie owning (ex: `User.posts` inverse
      // ↔ `Post.author` owning, qui porte `authorId`), pas sur `e` lui-même.
      const owning = [...graph.edges.values()].find(
        (o) => o.model === e.target && o.kind === 'to-one-owning' && o.relationName === e.relationName
      );
      if (!owning || owning.unsupported) continue;

      const targetPath = `${basePath}/${e.target.toLowerCase()}`;
      const scalarName = owning.scalarFields[0];
      out.push({
        field: e.field,
        label: toLabel(e.field),
        count: counts.get(`${e.model}.${e.field}`)!,
        // `f.<field>=<value>` — même pipeline sécurisé que la recherche/
        // filtre (whitelist + coercion, docs/design/list-search-filters.md).
        // L'ancien `?filter=field:value` reste supporté en lecture pour la
        // rétrocompatibilité, mais ce composant n'en émet plus.
        viewAllHref: `${targetPath}?f.${encodeURIComponent(scalarName)}=${encodeURIComponent(String(currentId))}`,
        addHref: `${targetPath}/new?${encodeURIComponent(scalarName)}=${encodeURIComponent(String(currentId))}`
      });
    }
    return out;
  });
</script>

{#if rows.length > 0}
  <div class="ska-card ska-related">
    <h2 class="ska-subtitle">Liaisons</h2>
    {#each rows as row (row.field)}
      <div class="ska-related-row">
        <span class="ska-label">{row.label}</span>
        <span class="ska-subtitle">{row.count} record{row.count === 1 ? '' : 's'}</span>
        <a href={row.viewAllHref} class="ska-btn ska-btn--secondary ska-btn--sm">Voir tout</a>
        <a href={row.addHref} class="ska-btn ska-btn--secondary ska-btn--sm">Ajouter</a>
      </div>
    {/each}
  </div>
{/if}
