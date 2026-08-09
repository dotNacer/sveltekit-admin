<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import AppNucleoIcon from './AppNucleoIcon.svelte';
	import { moreHorizontalIcon } from './app-icon-data';

	let { ...props }: Omit<ComponentProps<typeof AppNucleoIcon>, 'icon'> = $props();
</script>

<AppNucleoIcon icon={moreHorizontalIcon} {...props} />
