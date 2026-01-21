<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#05060a" />
	<title>Wyrdlight</title>
</svelte:head>

{@render children()}

<style>
	:global(html, body) {
		margin: 0;
		height: 100%;
		background: #05060a;
		overflow: hidden;
	}

	:global(body) {
		font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
	}

	:global(*) {
		box-sizing: border-box;
	}
</style>
