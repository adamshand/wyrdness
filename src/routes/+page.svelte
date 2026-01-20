<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	type Stage = 1 | 2 | 3;

	let canvasEl: HTMLCanvasElement;

	let showHud = $state(true);
	let showSettings = $state(false);

	let windowBits = $state(5000);
	let bitsPerSec = $state(1200);
	let alpha = $state(0.08);
	let renderScale = $state(0.7);

	let z = $state(0);
	let zSmooth = $state(0);
	let ones = $state(0);
	let stage = $state<Stage>(1);
	let coherence = $state(0);

	let fps = $state(0);

	let raf = 0;
	let bits: Uint8Array;
	let idx = 0;

	let bootMs = 0;
	let stageEnergy = $state(0);

	let bufCanvas: HTMLCanvasElement;
	let bufCtx: CanvasRenderingContext2D;

	function clamp01(v: number) {
		return Math.min(1, Math.max(0, v));
	}

	function smoothstep(a: number, b: number, t: number) {
		const x = clamp01((t - a) / (b - a));
		return x * x * (3 - 2 * x);
	}

	function reseed() {
		bits = new Uint8Array(windowBits);
		idx = 0;
		ones = 0;
		z = 0;
		zSmooth = 0;
		coherence = 0;
		stage = 1;
		stageEnergy = 0;
		bootMs = 0;
	}

	function randBits(count: number) {
		const byteCount = Math.ceil(count / 8);
		const buf = new Uint8Array(byteCount);
		crypto.getRandomValues(buf);
		const out = new Uint8Array(count);
		for (let i = 0; i < count; i++) {
			out[i] = (buf[i >> 3] >> (i & 7)) & 1;
		}
		return out;
	}

	function resize() {
		const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
		const w = Math.floor(window.innerWidth * dpr);
		const h = Math.floor(window.innerHeight * dpr);

		canvasEl.width = w;
		canvasEl.height = h;
		canvasEl.style.width = `${window.innerWidth}px`;
		canvasEl.style.height = `${window.innerHeight}px`;

		const bw = Math.max(2, Math.floor(w * renderScale));
		const bh = Math.max(2, Math.floor(h * renderScale));
		bufCanvas.width = bw;
		bufCanvas.height = bh;
	}

	function computeStageFromEnergy(e: number, prev: Stage): Stage {
		// Hysteresis thresholds prevent stage flapping.
		if (prev === 1) return e > 0.42 ? 2 : 1;
		if (prev === 2) {
			if (e > 0.78) return 3;
			return e < 0.34 ? 1 : 2;
		}
		// prev === 3
		return e < 0.68 ? 2 : 3;
	}

	function step(dtMs: number) {
		bootMs += dtMs;

		// Drive the signal with a rolling bit window.
		const target = Math.max(1, Math.floor(bitsPerSec * (dtMs / 1000)));
		const newBits = randBits(target);

		for (let i = 0; i < newBits.length; i++) {
			const old = bits[idx];
			const neu = newBits[i];

			if (old === 1) ones--;
			if (neu === 1) ones++;

			bits[idx] = neu;
			idx = (idx + 1) % windowBits;
		}

		const N = windowBits;
		const E = N / 2;
		const sd = Math.sqrt(N / 4);
		z = (ones - E) / sd;
		zSmooth = alpha * z + (1 - alpha) * zSmooth;

		// Coherence is derived from |zSmooth| with a gentle curve.
		const mag = Math.min(1, Math.abs(zSmooth) / 3.6);
		coherence = Math.pow(mag, 0.72);

		// Stage energy is a slower integrator (lamp-like).
		const riseMs = 2600;
		const fallMs = 4200;
		const tau = coherence > stageEnergy ? riseMs : fallMs;
		const k = 1 - Math.exp(-dtMs / tau);
		stageEnergy = stageEnergy + (coherence - stageEnergy) * k;

		stage = computeStageFromEnergy(stageEnergy, stage);

		render(dtMs);
	}

	function render(_dtMs: number) {
		const w = bufCanvas.width;
		const h = bufCanvas.height;
		const t = performance.now() / 1000;

		const ctx = bufCtx;
		ctx.save();
		ctx.clearRect(0, 0, w, h);

		// Base background: deep ink + a subtle vertical bias.
		{
			const base = ctx.createLinearGradient(0, 0, 0, h);
			base.addColorStop(0, '#05060a');
			base.addColorStop(0.55, '#05040a');
			base.addColorStop(1, '#020208');
			ctx.fillStyle = base;
			ctx.fillRect(0, 0, w, h);
		}

		// Boot: 5s rainbow drift, then normal stages.
		const bootT = clamp01(bootMs / 5000);
		const bootMix = 1 - bootT;

		const quality = Math.max(-1, Math.min(1, zSmooth / 3.6));
		const hueCool = 198;
		const hueWarm = 22;
		const hueBias = hueCool + (hueWarm - hueCool) * (1 - (quality + 1) / 2);
		const hueWander = 10 * Math.sin(t * 0.07) + 6 * Math.sin(t * 0.11 + 1.7);

		const e = stageEnergy;
		const whitenStage2 = smoothstep(0.36, 0.78, e) * 0.65;
		const swirl = stage === 3 ? smoothstep(0.68, 0.98, e) : 0;
		const whitenStage3 = stage === 3 ? 0.65 + swirl * 0.2 : 0;
		const whiten = stage === 1 ? 0 : stage === 2 ? whitenStage2 : whitenStage3;

		const intensity = 0.25 + 0.85 * Math.pow(e, 0.85);
		const sat = 0.75 - 0.35 * whiten;

		ctx.globalCompositeOperation = 'screen';
		ctx.globalAlpha = 0.95;

		// Aurora ribbons.
		const ribbonCount = 5;
		for (let i = 0; i < ribbonCount; i++) {
			const band = i / (ribbonCount - 1);

			const baseY = h * (0.15 + 0.7 * band) + h * 0.02 * Math.sin(t * (0.18 + i * 0.03) + i);
			const thickness = h * (0.12 + 0.06 * (1 - band));
			const amp = h * (0.06 + 0.05 * intensity) * (0.7 + 0.6 * (1 - band));
			const speed = 0.14 + 0.08 * band + swirl * 0.22;

			const hueBase =
				(hueBias + hueWander + 22 * Math.sin(t * (0.12 + i * 0.05) + 3.2 * band) + 60 * swirl * Math.sin(t * 0.25 + i)) %
				360;

			const hueA = (hueBase + 42 + 32 * Math.sin(t * 0.12 + i * 1.7)) % 360;
			const hueB = (hueBase - 38 + 28 * Math.sin(t * 0.09 + i * 1.1 + 0.7)) % 360;
			const hueC = (hueBase + 110 + 20 * Math.sin(t * 0.07 + i * 1.9)) % 360;

			ctx.save();
			ctx.filter = `blur(${Math.max(10, 18 + 18 * intensity)}px)`;

			const grad = ctx.createLinearGradient(0, baseY - thickness, 0, baseY + thickness);
			const a = 0.75 * intensity;
			const b = 0.55 * intensity;
			const c = 0.42 * intensity;

			// Mix in boot rainbow.
			const bootHue = (t * 50 + i * 60) % 360;
			const bootColor = (h: number, l: number, alpha: number) =>
				`hsla(${h} ${Math.round(100 * sat)}% ${Math.round(l)}% / ${alpha})`;

			const colA = bootMix > 0 ? bootColor(bootHue, 62, a * bootMix) : null;
			const colB = bootMix > 0 ? bootColor((bootHue + 120) % 360, 58, b * bootMix) : null;
			const colC = bootMix > 0 ? bootColor((bootHue + 240) % 360, 55, c * bootMix) : null;

			const mainA = `hsla(${hueA} ${Math.round(100 * sat)}% ${Math.round(58 - 12 * whiten)}% / ${a})`;
			const mainB = `hsla(${hueB} ${Math.round(100 * sat)}% ${Math.round(54 - 10 * whiten)}% / ${b})`;
			const mainC = `hsla(${hueC} ${Math.round(100 * sat)}% ${Math.round(52 - 8 * whiten)}% / ${c})`;

			grad.addColorStop(0.0, colA ?? mainA);
			grad.addColorStop(0.45, colB ?? mainB);
			grad.addColorStop(1.0, colC ?? mainC);

			// Whiten blend (Stage 2/3).
			if (whiten > 0) {
				grad.addColorStop(0.52, `rgba(255,255,255,${0.16 * whiten * intensity})`);
				grad.addColorStop(0.62, `rgba(255,255,255,${0.12 * whiten * intensity})`);
			}

			ctx.fillStyle = grad;

			const segments = 26;
			ctx.beginPath();
			for (let s = 0; s <= segments; s++) {
				const x = (w * s) / segments;
				const xn = s / segments;
				const y =
					baseY +
					Math.sin(xn * 6.5 + t * speed + i * 1.3) * amp +
					Math.sin(xn * 14.0 + t * (speed * 0.7) + i * 2.4) * (amp * 0.35) +
					swirl * Math.sin(xn * 9.0 - t * 0.9 + i) * (amp * 0.25);
				if (s === 0) ctx.moveTo(x, y - thickness);
				else ctx.lineTo(x, y - thickness);
			}
			for (let s = segments; s >= 0; s--) {
				const x = (w * s) / segments;
				const xn = s / segments;
				const y =
					baseY +
					Math.sin(xn * 6.5 + t * speed + i * 1.3) * amp +
					Math.sin(xn * 14.0 + t * (speed * 0.7) + i * 2.4) * (amp * 0.35) +
					swirl * Math.sin(xn * 9.0 - t * 0.9 + i) * (amp * 0.25);
				ctx.lineTo(x, y + thickness);
			}
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}

		// Stage 3: prismatic swirl overlay (no strobe).
		if (swirl > 0) {
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.33 * swirl;
			ctx.filter = `blur(${Math.max(18, 26 + 10 * intensity)}px)`;

			const cx = w * 0.52;
			const cy = h * 0.52;

			const maybeConic = (ctx as unknown as { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
			if (typeof maybeConic === 'function') {
				const cg = maybeConic.call(ctx, t * 0.18, cx, cy);
				cg.addColorStop(0.0, 'rgba(255, 60, 120, 0.7)');
				cg.addColorStop(0.18, 'rgba(255, 160, 60, 0.7)');
				cg.addColorStop(0.36, 'rgba(160, 255, 120, 0.7)');
				cg.addColorStop(0.55, 'rgba(60, 220, 255, 0.7)');
				cg.addColorStop(0.72, 'rgba(110, 90, 255, 0.7)');
				cg.addColorStop(0.88, 'rgba(255, 60, 200, 0.7)');
				cg.addColorStop(1.0, 'rgba(255, 60, 120, 0.7)');
				ctx.fillStyle = cg;
				ctx.fillRect(0, 0, w, h);
			} else {
				const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.8);
				rg.addColorStop(0, 'rgba(255,255,255,0.28)');
				rg.addColorStop(0.35, 'rgba(120,180,255,0.18)');
				rg.addColorStop(1, 'rgba(10,10,18,0)');
				ctx.fillStyle = rg;
				ctx.fillRect(0, 0, w, h);
			}
			ctx.restore();
		}

		// Gentle central glow (Stage 2+).
		if (whiten > 0) {
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.22 * whiten;
			ctx.filter = `blur(${Math.max(20, 30 + 18 * intensity)}px)`;
			const rg = ctx.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.55);
			rg.addColorStop(0, 'rgba(255,255,255,0.65)');
			rg.addColorStop(0.55, 'rgba(255,255,255,0.08)');
			rg.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = rg;
			ctx.fillRect(0, 0, w, h);
			ctx.restore();
		}

		// Vignette (helps during screen share, keeps center luminous).
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = 1;
		{
			const vg = ctx.createRadialGradient(w * 0.5, h * 0.55, Math.min(w, h) * 0.15, w * 0.5, h * 0.55, Math.max(w, h) * 0.7);
			vg.addColorStop(0, 'rgba(0,0,0,0)');
			vg.addColorStop(1, 'rgba(0,0,0,0.62)');
			ctx.fillStyle = vg;
			ctx.fillRect(0, 0, w, h);
		}

		ctx.restore();

		// Blit buffer to the main canvas.
		const out = canvasEl.getContext('2d');
		if (!out) return;
		out.save();
		out.imageSmoothingEnabled = true;
		out.clearRect(0, 0, canvasEl.width, canvasEl.height);
		out.drawImage(bufCanvas, 0, 0, canvasEl.width, canvasEl.height);
		out.restore();
	}

	function toggleFullscreen() {
		const el = document.documentElement;
		if (!document.fullscreenElement) {
			void el.requestFullscreen?.();
		} else {
			void document.exitFullscreen?.();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
		if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement | null)?.isContentEditable) return;

		if (e.key === 'h' || e.key === 'H') {
			showHud = !showHud;
			return;
		}
		if (e.key === 's' || e.key === 'S') {
			showSettings = !showSettings;
			showHud = true;
			return;
		}
		if (e.key === 'r' || e.key === 'R') {
			reseed();
			return;
		}
		if (e.key === 'f' || e.key === 'F') {
			toggleFullscreen();
			return;
		}
		if (e.key === 'Escape' && showSettings) {
			showSettings = false;
		}
	}

	onMount(() => {
		bufCanvas = document.createElement('canvas');
		const ctx = bufCanvas.getContext('2d');
		if (!ctx) throw new Error('2D canvas not supported');
		bufCtx = ctx;

		reseed();
		resize();

		window.addEventListener('resize', resize, { passive: true });
		window.addEventListener('keydown', handleKeydown);

		let last = performance.now();
		let fpsSmooth = 0;

		const loop = (now: number) => {
			const dt = Math.min(80, now - last);
			last = now;

			// fps smoothing
			const inst = 1000 / Math.max(1, dt);
			fpsSmooth = fpsSmooth ? fpsSmooth * 0.92 + inst * 0.08 : inst;
			fps = fpsSmooth;

			step(dt);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		return () => {
			window.removeEventListener('resize', resize);
			window.removeEventListener('keydown', handleKeydown);
			cancelAnimationFrame(raf);
		};
	});

	// Avoid using cancelAnimationFrame during SSR; the onMount cleanup handles it in the browser.
	onDestroy(() => {});

	$effect(() => {
		// Reseed when window size changes.
		reseed();
	});

	$effect(() => {
		// Resize buffer when renderScale changes (browser only).
		if (typeof window === 'undefined') return;
		if (bufCanvas) resize();
	});
</script>

<main class="wrap">
	<canvas bind:this={canvasEl} class="lamp" aria-label="Wyrd Light visual"></canvas>

	{#if showHud}
		<section class="hud" aria-label="HUD">
			<div class="hud-title">
				<div class="hud-name">Wyrdlight</div>
				<div class="hud-stage">Stage {stage}</div>
			</div>

			<div class="hud-row">
				<span class="k">Coherence</span>
				<span class="v">{Math.round(stageEnergy * 100)}%</span>
			</div>
			<div class="hud-row">
				<span class="k">z(smooth)</span>
				<span class="v">{zSmooth.toFixed(2)}</span>
			</div>
			<div class="hud-row">
				<span class="k">Window</span>
				<span class="v">{windowBits.toLocaleString()} bits</span>
			</div>
			<div class="hud-row">
				<span class="k">FPS</span>
				<span class="v">{fps.toFixed(0)}</span>
			</div>

			{#if showSettings}
				<div class="sep"></div>
				<div class="controls">
					<label>
						<span>Window bits</span>
						<input bind:value={windowBits} type="range" min="500" max="30000" step="500" />
						<span class="mono">{windowBits}</span>
					</label>
					<label>
						<span>Bits/sec</span>
						<input bind:value={bitsPerSec} type="range" min="200" max="6000" step="100" />
						<span class="mono">{bitsPerSec}</span>
					</label>
					<label>
						<span>Smoothing</span>
						<input bind:value={alpha} type="range" min="0.01" max="0.25" step="0.01" />
						<span class="mono">{alpha.toFixed(2)}</span>
					</label>
					<label>
						<span>Render scale</span>
						<input bind:value={renderScale} type="range" min="0.4" max="1" step="0.05" />
						<span class="mono">{renderScale.toFixed(2)}</span>
					</label>
					<div class="hint mono">Hotkeys: H HUD, S settings, R reset, F fullscreen</div>
				</div>
			{:else}
				<div class="hint mono">Hotkeys: H HUD, S settings, R reset, F fullscreen</div>
			{/if}
		</section>
	{/if}
</main>

<style>
	.wrap {
		position: fixed;
		inset: 0;
	}

	.lamp {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}

	.hud {
		position: fixed;
		left: 18px;
		top: 18px;
		width: min(360px, calc(100vw - 36px));
		padding: 12px 12px 10px;
		border-radius: 14px;
		color: rgba(255, 255, 255, 0.92);
		background: rgba(10, 10, 16, 0.42);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
		user-select: none;
	}

	.hud-title {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
	}

	.hud-name {
		font-weight: 650;
		letter-spacing: 0.02em;
		font-size: 14px;
	}

	.hud-stage {
		font-variant-numeric: tabular-nums;
		opacity: 0.9;
		font-size: 13px;
	}

	.hud-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 2px 0;
		font-size: 13px;
	}

	.k {
		opacity: 0.72;
	}

	.v {
		font-variant-numeric: tabular-nums;
	}

	.sep {
		height: 1px;
		background: rgba(255, 255, 255, 0.1);
		margin: 10px 0;
	}

	.controls {
		display: grid;
		gap: 8px;
	}

	label {
		display: grid;
		grid-template-columns: 90px 1fr auto;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.86);
	}

	input[type='range'] {
		width: 100%;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
	}

	.hint {
		margin-top: 4px;
		opacity: 0.65;
		font-size: 12px;
	}
</style>
