<script lang="ts">
  let { message, basePath }: { message: string; basePath: string } = $props();
</script>

<h1>Not Found</h1>
<p class="ska-subtitle">{message}</p>
<a href={basePath} class="ska-btn ska-btn--secondary">← Back to Dashboard</a>
