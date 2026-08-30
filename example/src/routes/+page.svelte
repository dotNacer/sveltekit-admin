<script lang="ts">
  let { data } = $props();
</script>

<main>
  <h1>Démo multi-tenant</h1>

  {#if data.current}
    <p class="current">
      Tenant actif : <strong>{data.current.name}</strong>
      <code>({data.current.slug})</code>
    </p>
  {:else}
    <p class="warn">
      Aucun tenant résolu — le cookie pointe vers une organisation inconnue.
      L'admin répondra 401&nbsp;: <code>authCheck</code> ne voit pas d'utilisateur.
    </p>
  {/if}

  <h2>Basculer</h2>
  <ul class="tenants">
    {#each data.organizations as org (org.slug)}
      <li>
        <a class:active={data.current?.slug === org.slug} href="/tenant/{org.slug}">
          {org.name}
        </a>
        <span class="counts">
          {org._count.posts} posts · {org._count.users} users · {org._count.categories} catégories
        </span>
      </li>
    {/each}
  </ul>

  <h2>Ce qu'il faut regarder</h2>
  <ol>
    <li>
      <a href="/admin/post">Liste des posts</a> — bascule d'un tenant à l'autre :
      le total et les lignes changent, alors que la base contient les deux.
    </li>
    <li>
      <a href="/admin/post/new">Créer un post</a> — le menu déroulant
      <em>author</em> ne propose que les utilisateurs du tenant actif.
    </li>
    <li>
      Ouvre un post, note son id, bascule de tenant, et rejoue l'URL
      <code>/admin/post/&lt;id&gt;</code> : elle répond « not found » au lieu de
      montrer la fiche du voisin.
    </li>
    <li>
      <a href="/admin">Tableau de bord</a> — les compteurs sont scopés eux aussi.
    </li>
  </ol>
</main>

<style>
  main { font-family: system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; }
  h1 { margin-bottom: 0.25rem; }
  h2 { margin-top: 2rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  .current { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; padding: 0.6rem 0.9rem; }
  .warn { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 0.6rem 0.9rem; }
  .tenants { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .tenants li { display: flex; align-items: baseline; gap: 0.75rem; }
  .tenants a { display: inline-block; padding: 0.35rem 0.9rem; border: 1px solid #d1d5db; border-radius: 6px; text-decoration: none; color: #111827; }
  .tenants a.active { background: #6366f1; border-color: #6366f1; color: white; }
  .counts { color: #6b7280; font-size: 0.875rem; }
  code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; }
</style>
