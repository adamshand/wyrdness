<script lang="ts">
	import type { DemoChannel } from '$lib/demo';
	import { DEMO_CHANNELS, DEMO_LABELS } from '$lib/demo';

	type Props = {
		demoIndex: number;
		demoChannel: DemoChannel;
		demoPearsonDir: 1 | -1;
	};

	const { demoIndex, demoChannel, demoPearsonDir }: Props = $props();
	const isAnomaly = $derived(demoIndex === DEMO_CHANNELS.length);
</script>

<div class="demo-overlay">
	<div class="demo-label-main">{isAnomaly ? 'Anomaly' : DEMO_LABELS[demoChannel]}</div>
	{#if !isAnomaly}
		<div class="demo-label-pearson">
			{demoPearsonDir === 1 ? 'Pearson+  (clockwise)' : 'Pearson-  (counter-clockwise)'}
		</div>
	{/if}
	<div class="demo-progress">{demoIndex + 1} / {DEMO_CHANNELS.length + 1}</div>
</div>

<style>
	.demo-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		z-index: 100;
	}

	.demo-label-main {
		font-size: clamp(2rem, 8vw, 5rem);
		font-weight: 700;
		color: rgba(255, 255, 255, 0.95);
		text-shadow:
			0 0 40px rgba(0, 0, 0, 0.8),
			0 0 80px rgba(0, 0, 0, 0.6),
			0 4px 20px rgba(0, 0, 0, 0.9);
		text-align: center;
		padding: 0 1rem;
	}

	.demo-label-pearson {
		font-size: clamp(1rem, 4vw, 2rem);
		font-weight: 400;
		color: rgba(255, 255, 255, 0.75);
		text-shadow:
			0 0 30px rgba(0, 0, 0, 0.8),
			0 2px 10px rgba(0, 0, 0, 0.9);
		margin-top: 0.5rem;
		text-align: center;
	}

	.demo-progress {
		font-size: clamp(0.8rem, 2vw, 1.2rem);
		font-weight: 400;
		color: rgba(255, 255, 255, 0.5);
		margin-top: 1.5rem;
		font-variant-numeric: tabular-nums;
	}
</style>
