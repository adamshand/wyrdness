<script lang="ts">
	import type { Channel, EpisodeState } from '$lib/signal/types';
	import { palette } from '$lib/palette';

	type Props = {
		dominant: Channel;
		coherence: number;
		sigEnergy: number;
		zA: number;
		zB: number;
		pearsonR: number;
		zAgree: number;
		tickCount: number;
		fps: number;
		episodes: Record<Exclude<Channel, 'baseline'>, EpisodeState>;
		cumLen: number;
		demoBoost: number;
		demoMode: boolean;
	};

	const {
		dominant,
		coherence,
		sigEnergy,
		zA,
		zB,
		pearsonR,
		zAgree,
		tickCount,
		fps,
		episodes,
		cumLen,
		demoBoost,
		demoMode
	}: Props = $props();

	const domNonBaseline = $derived(
		dominant === 'baseline' ? null : (dominant as Exclude<Channel, 'baseline'>)
	);
</script>

<aside class="dev-panel" aria-label="Debug Info">
	<h3>Debug</h3>
	<div class="dev-row">
		<span class="k">Dominant</span>
		<span class="v">{domNonBaseline ? palette[domNonBaseline].name : 'Baseline'}</span>
	</div>
	<div class="dev-row">
		<span class="k">Coherence</span>
		<span class="v">{(coherence * 100).toFixed(1)}%</span>
	</div>
	<div class="dev-row">
		<span class="k">Significance</span>
		<span class="v">{(sigEnergy * 100).toFixed(1)}%</span>
	</div>
	<div class="dev-row">
		<span class="k">zA / zB</span>
		<span class="v">{zA.toFixed(2)} / {zB.toFixed(2)}</span>
	</div>
	<div class="dev-row">
		<span class="k">Pearson r</span>
		<span class="v">{pearsonR.toFixed(3)}</span>
	</div>
	<div class="dev-row">
		<span class="k">Agree z</span>
		<span class="v">{zAgree.toFixed(2)}</span>
	</div>
	<div class="dev-row">
		<span class="k">Tick</span>
		<span class="v">{tickCount}</span>
	</div>
	<div class="dev-row">
		<span class="k">FPS</span>
		<span class="v">{fps.toFixed(0)}</span>
	</div>
	{#if domNonBaseline && episodes[domNonBaseline]}
		{@const ep = episodes[domNonBaseline]}
		{@const duration = tickCount > 0 ? Math.max(0, cumLen - 1 - ep.startTick) : 0}
		<div class="dev-row episode">
			<span class="k">Episode</span>
			<span class="v">{duration}s | peak z={ep.peakZ.toFixed(2)}</span>
		</div>
	{/if}
	{#if demoBoost > 0.01 && !demoMode}
		<div class="dev-row demo">
			<span class="k">Demo Boost</span>
			<span class="v">{(demoBoost * 100).toFixed(0)}%</span>
		</div>
	{/if}
</aside>

<style>
	.dev-panel {
		position: fixed;
		top: 18px;
		left: 18px;
		width: min(280px, calc(100vw - 36px));
		padding: 14px 16px;
		border-radius: 14px;
		color: rgba(255, 255, 255, 0.9);
		background: rgba(10, 10, 16, 0.65);
		backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
		font-size: 12px;
		z-index: 60;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.dev-panel h3 {
		margin: 0 0 10px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.6;
	}

	.dev-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 2px 0;
	}

	.dev-row .k {
		opacity: 0.6;
	}

	.dev-row .v {
		font-variant-numeric: tabular-nums;
	}

	.dev-row.demo {
		color: rgba(255, 200, 100, 0.9);
	}

	.dev-row.episode {
		color: rgba(180, 220, 255, 0.9);
	}
</style>
