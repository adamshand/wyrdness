<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<!-- <link rel="icon" href={favicon} /> -->
	<link
		rel="icon"
		type="image/svg+xml"
		href="data:image/svg+xml,
			<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
				<text y='0.9em' font-size='90'>🟣</text>
			</svg>"
	/>
	<meta name="theme-color" content="#05060a" />
	<title>WyrdWeb</title>
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
