<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import AppNucleoIcon from './AppNucleoIcon.svelte';
	import { chevronRightIcon } from './app-icon-data';

	let { ...props }: Omit<ComponentProps<typeof AppNucleoIcon>, 'icon'> = $props();
</script>

<AppNucleoIcon icon={chevronRightIcon} {...props} />
