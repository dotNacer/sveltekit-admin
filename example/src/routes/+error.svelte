<script lang="ts">
  import { page } from '$app/stores';
</script>

<h1>{$page.status}</h1>
<p>{$page.error?.message}</p>
<pre>{JSON.stringify($page.error, null, 2)}</pre>
<a href="/">Go home</a>
