<script lang="ts">
	import type { Channel, LightMode } from '$lib/signal/types';
	import { DISPLAY_NAMES, getDirectionArrow, getPearsonIndicator } from '$lib/palette';

	type Props = {
		dominant: Channel;
		pearsonSpin: number;
		lightMode: LightMode;
		responseSpeed: 1 | 2 | 3 | 4 | 5;
	};

	const { dominant, pearsonSpin, lightMode, responseSpeed }: Props = $props();
	const resolvedRepoUrl = 'https://github.com/adamshand/wyrdness';
</script>

<nav class="bottom-bar" aria-label="Controls">
	<div class="bar-left">
		<span class="shortcut"><b>?</b> help</span>
		<span class="shortcut"><b>M</b> mode</span>
		<span class="shortcut"><b>1-5</b> speed</span>
		<span class="shortcut"><b>D</b> demo</span>
		<span class="shortcut"><b>L</b> legend</span>
		<span class="shortcut"><b>`</b> debug</span>
	</div>
	<div class="bar-center">
		<span class="state-name"
			>{DISPLAY_NAMES[dominant]}{getDirectionArrow(dominant)}{getPearsonIndicator(
				pearsonSpin
			)}</span
		>
	</div>
	<div class="bar-right">
		<span class="mode-info">{lightMode === 'wow' ? 'Wow' : 'Mellow'} {responseSpeed}</span>
		<a href={resolvedRepoUrl} target="_blank" rel="noopener" class="brand">
			Wyrdness
			<svg class="github-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
				<path
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
				/>
			</svg>
		</a>
	</div>
</nav>

<style>
	.bottom-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 20px;
		background: rgba(10, 10, 16, 0.5);
		backdrop-filter: blur(10px);
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.85);
		font-size: 13px;
		user-select: none;
		z-index: 50;
	}

	.bar-left {
		display: flex;
		gap: 16px;
		opacity: 0.6;
		font-size: 12px;
	}

	.shortcut {
		white-space: nowrap;
	}

	.bar-center {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
	}

	.state-name {
		font-size: 16px;
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.bar-right {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.mode-info {
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 6px;
		color: rgba(255, 255, 255, 0.9);
		text-decoration: none;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.brand:hover {
		color: white;
	}

	.github-icon {
		width: 16px;
		height: 16px;
		opacity: 0.7;
	}

	.brand:hover .github-icon {
		opacity: 1;
	}

	@media (max-width: 640px) {
		.bar-left {
			display: none;
		}

		.bottom-bar {
			justify-content: center;
			gap: 20px;
		}

		.bar-center {
			position: static;
			transform: none;
		}
	}
</style>
