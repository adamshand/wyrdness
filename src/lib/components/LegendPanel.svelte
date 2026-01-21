<script lang="ts">
	import { palette } from '$lib/palette';
</script>

<aside class="legend-panel" aria-label="Color Legend">
	<h3>Color Legend</h3>
	<div class="legend-row">
		<span class="swatch" style={`--h:${palette.correlated_high.hue}`}></span>
		<span>Correlated &#8593; -- both streams have more 1s than expected</span>
	</div>
	<div class="legend-row">
		<span class="swatch" style={`--h:${palette.correlated_low.hue}`}></span>
		<span>Correlated &#8595; -- both streams have more 0s than expected</span>
	</div>
	<div class="legend-row">
		<span class="swatch" style={`--h:${palette.anti_ab.hue}`}></span>
		<span>Diverging A>B -- stream A has more 1s and stream B more 0s than expected</span>
	</div>
	<div class="legend-row">
		<span class="swatch" style={`--h:${palette.anti_ba.hue}`}></span>
		<span>Diverging B>A -- stream B has more 1s and stream A more 0s than expected</span>
	</div>
	<div class="legend-row">
		<span class="swatch" style={`--h:${palette.stick.hue}`}></span>
		<span>Agreement -- streams are matching more than expected</span>
	</div>
	<div class="legend-row">
		<span class="swatch" style={`--h:${palette.pearson.hue}`}></span>
		<span>Pearson -- streams trend together (not matching but moving in sync)</span>
	</div>
	<div class="legend-row">
		<span class="indicator">+ &#8722;</span>
		<span>Swirl direction (clockwise/counter)</span>
	</div>
</aside>

<style>
	.legend-panel {
		position: fixed;
		top: 18px;
		right: 18px;
		width: min(340px, calc(100vw - 36px));
		padding: 14px 16px;
		border-radius: 14px;
		color: rgba(255, 255, 255, 0.9);
		background: rgba(10, 10, 16, 0.65);
		backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
		font-size: 12px;
		z-index: 60;
	}

	.legend-panel h3 {
		margin: 0 0 8px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.6;
	}

	.legend-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 0;
		line-height: 1.4;
	}

	.swatch {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: radial-gradient(
			circle at 30% 30%,
			hsla(var(--h) 90% 70% / 0.95),
			hsla(var(--h) 90% 45% / 0.95)
		);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
		flex: 0 0 auto;
	}

	.indicator {
		width: 14px;
		text-align: center;
		font-weight: 600;
		opacity: 0.9;
		flex: 0 0 auto;
	}
</style>
