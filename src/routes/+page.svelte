<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	type Stage = 1 | 2 | 3;
	type Channel = 'baseline' | 'correlated' | 'anti' | 'stick' | 'pearson';

	let canvasEl: HTMLCanvasElement;

	let showHud = $state(true);
	let showSettings = $state(false);

	// "Device-ish" defaults: they mention 200-bit samples, and a few 1000 bits/sec.
	let windowBits = $state(6000);
	let bitsPerSec = $state(1600);
	let alpha = $state(0.08);
	let renderScale = $state(0.75);

	let stage = $state<Stage>(1);
	let stageEnergy = $state(0);
	let coherence = $state(0);

	let zA = $state(0);
	let zB = $state(0);
	let pearsonR = $state(0);
	let zAgree = $state(0);

	let dominant = $state<Channel>('baseline');
	let dominance = $state(0);

	let fps = $state(0);

	let raf = 0;
	let bootMs = 0;

	let bitsA: Uint8Array;
	let bitsB: Uint8Array;
	let idx = 0;
	let onesA = 0;
	let onesB = 0;
	let agree = 0; // count of A==B in the window

	// For Pearson on ±1 variables.
	let sumX = 0;
	let sumY = 0;
	let sumXY = 0;

	let bufCanvas: HTMLCanvasElement;
	let bufCtx: CanvasRenderingContext2D;

	const palette: Record<Exclude<Channel, 'baseline'>, { hue: number; name: string }> = {
		correlated: { hue: 186, name: 'Correlated' }, // teal-cyan
		anti: { hue: 24, name: 'Anti' }, // ember-orange
		stick: { hue: 112, name: 'Stick' }, // spring green
		pearson: { hue: 252, name: 'Pearson' } // indigo-violet (stage 3 sheen brings rainbow)
	};

	function clamp01(v: number) {
		return Math.min(1, Math.max(0, v));
	}

	function smoothstep(a: number, b: number, t: number) {
		const x = clamp01((t - a) / (b - a));
		return x * x * (3 - 2 * x);
	}

	function reseed() {
		// Important: keep the rolling-window aggregates consistent with the current buffer.
		// If we start with empty aggregates but non-empty buffers (or vice versa), the first window
		// produces huge z-scores and coherence pins at 100%.
		const a0 = randBits(windowBits);
		const b0 = randBits(windowBits);
		bitsA = a0;
		bitsB = b0;

		idx = 0;
		onesA = 0;
		onesB = 0;
		agree = 0;
		sumX = 0;
		sumY = 0;
		sumXY = 0;

		for (let i = 0; i < windowBits; i++) {
			const a = bitsA[i];
			const b = bitsB[i];
			if (a === 1) onesA++;
			if (b === 1) onesB++;
			if (a === b) agree++;

			const x = a === 1 ? 1 : -1;
			const y = b === 1 ? 1 : -1;
			sumX += x;
			sumY += y;
			sumXY += x * y;
		}

		zA = 0;
		zB = 0;
		pearsonR = 0;
		zAgree = 0;

		coherence = 0;
		stageEnergy = 0;
		stage = 1;

		dominant = 'baseline';
		dominance = 0;

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
		// Hysteresis: prevents stage flapping.
		if (prev === 1) return e > 0.42 ? 2 : 1;
		if (prev === 2) {
			if (e > 0.78) return 3;
			return e < 0.34 ? 1 : 2;
		}
		return e < 0.68 ? 2 : 3;
	}

	function zFromOnes(ones: number, N: number) {
		const E = N / 2;
		const sd = Math.sqrt(N / 4);
		return (ones - E) / sd;
	}

	function strengthFromZ(z: number, zStart = 0.35, zFull = 3.0) {
		return clamp01((Math.abs(z) - zStart) / (zFull - zStart));
	}

	function updateDominant(raw: Record<Exclude<Channel, 'baseline'>, number>, dtMs: number) {
		// Winner-takes-most with hysteresis and inertia.
		let best: Exclude<Channel, 'baseline'> | null = null;
		let bestV = 0;
		for (const k of Object.keys(raw) as Array<Exclude<Channel, 'baseline'>>) {
			const v = raw[k];
			if (v > bestV) {
				bestV = v;
				best = k;
			}
		}

		const next: Channel = bestV > 0.12 && best ? best : 'baseline';
		const nextStrength = next === 'baseline' ? 0 : bestV;

		const switchMargin = 0.08;
		const keepBonus = 0.04;

		let currentStrength = 0;
		if (dominant !== 'baseline') currentStrength = raw[dominant] ?? 0;
		currentStrength += keepBonus;

		const shouldSwitch = dominant === 'baseline' ? next !== 'baseline' : nextStrength > currentStrength + switchMargin;

		// dominance is a slow envelope to avoid sudden hue changes.
		const target = next === 'baseline' ? 0 : nextStrength;
		const tau = target > dominance ? 1200 : 1800;
		const k = 1 - Math.exp(-dtMs / tau);
		dominance = dominance + (target - dominance) * k;

		if (shouldSwitch) dominant = next;
		if (dominant === 'baseline' && dominance < 0.05) dominant = 'baseline';
	}

	function step(dtMs: number) {
		bootMs += dtMs;

		// Pull bits in chunks roughly like the device (200-bit samples).
		const target = Math.max(64, Math.floor(bitsPerSec * (dtMs / 1000)));
		const chunk = Math.max(200, Math.floor(target / 4) * 4);

		const aBits = randBits(chunk);
		const bBits = randBits(chunk);

		for (let i = 0; i < chunk; i++) {
			const oldA = bitsA[idx];
			const oldB = bitsB[idx];
			const neuA = aBits[i];
			const neuB = bBits[i];

			if (oldA === 1) onesA--;
			if (oldB === 1) onesB--;
			if (oldA === oldB) agree--;

			const oldX = oldA === 1 ? 1 : -1;
			const oldY = oldB === 1 ? 1 : -1;
			sumX -= oldX;
			sumY -= oldY;
			sumXY -= oldX * oldY;

			if (neuA === 1) onesA++;
			if (neuB === 1) onesB++;
			if (neuA === neuB) agree++;

			const newX = neuA === 1 ? 1 : -1;
			const newY = neuB === 1 ? 1 : -1;
			sumX += newX;
			sumY += newY;
			sumXY += newX * newY;

			bitsA[idx] = neuA;
			bitsB[idx] = neuB;
			idx = (idx + 1) % windowBits;
		}

		const N = windowBits;
		zA = alpha * zFromOnes(onesA, N) + (1 - alpha) * zA;
		zB = alpha * zFromOnes(onesB, N) + (1 - alpha) * zB;
		zAgree = alpha * zFromOnes(agree, N) + (1 - alpha) * zAgree;

		const meanX = sumX / N;
		const meanY = sumY / N;
		const exy = sumXY / N;
		const cov = exy - meanX * meanY;
		const varX = Math.max(1e-6, 1 - meanX * meanX);
		const varY = Math.max(1e-6, 1 - meanY * meanY);
		const r = cov / Math.sqrt(varX * varY);
		pearsonR = alpha * r + (1 - alpha) * pearsonR;

		// Channel strengths (0..1).
		const corrRaw = zA * zB > 0 ? Math.min(strengthFromZ(zA), strengthFromZ(zB)) : 0;
		const antiRaw = zA * zB < 0 ? Math.min(strengthFromZ(zA), strengthFromZ(zB)) : 0;
		const stickRaw = strengthFromZ(zAgree, 0.35, 3.0);
		const pearsonRaw = clamp01((Math.abs(pearsonR) - 0.08) / 0.55);

		const raw = {
			correlated: corrRaw,
			anti: antiRaw,
			stick: stickRaw,
			pearson: pearsonRaw
		};

		updateDominant(raw, dtMs);

		// Coherence is an overall envelope used for stage logic.
		const base = Math.max(raw.correlated, raw.anti, raw.stick, raw.pearson);
		coherence = base;

		const riseMs = 2600;
		const fallMs = 4200;
		const tau = coherence > stageEnergy ? riseMs : fallMs;
		const k = 1 - Math.exp(-dtMs / tau);
		stageEnergy = stageEnergy + (coherence - stageEnergy) * k;
		stage = computeStageFromEnergy(stageEnergy, stage);

		render(raw);
	}

	function render(raw: Record<Exclude<Channel, 'baseline'>, number>) {
		const w = bufCanvas.width;
		const h = bufCanvas.height;
		const t = performance.now() / 1000;

		const ctx = bufCtx;
		ctx.save();
		ctx.clearRect(0, 0, w, h);

		// Dark base.
		{
			const bg = ctx.createLinearGradient(0, 0, 0, h);
			bg.addColorStop(0, '#05060a');
			bg.addColorStop(0.6, '#04040a');
			bg.addColorStop(1, '#020208');
			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, w, h);
		}

		const e = stageEnergy;
		const bootT = clamp01(bootMs / 5000);
		const bootMix = 1 - bootT;

		// Lamp geometry.
		const cx = w * 0.5;
		const cy = h * 0.54;
		const r = Math.min(w, h) * 0.42;

		// Pick a single hue family.
		let hue = 205;
		let sat = 78;
		if (dominant !== 'baseline') {
			hue = palette[dominant].hue;
			sat = dominant === 'pearson' ? 70 : 78;
		} else {
			sat = 55;
		}

		// Bias polarity gently shifts hue within the family.
		const polarity = Math.max(-1, Math.min(1, (zA + zB) / 6));
		hue = (hue + polarity * 10 + 6 * Math.sin(t * 0.08) + 3 * Math.sin(t * 0.13 + 1.7)) % 360;

		// Stage-based whitening (no strobe).
		const whitenStage2 = smoothstep(0.36, 0.78, e) * 0.62;
		const sheen = stage === 3 ? smoothstep(0.68, 0.98, e) : 0;
		const whitenStage3 = stage === 3 ? 0.62 + sheen * 0.12 : 0;
		const whiten = stage === 1 ? 0 : stage === 2 ? whitenStage2 : whitenStage3;

		const brightness = 0.18 + 0.95 * Math.pow(e, 0.86);
		const orbAlpha = 0.55 + 0.35 * brightness;

		// Orb: soft fill with moving internal gradients (lamp-like convection).
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();

		ctx.globalCompositeOperation = 'source-over';
		ctx.fillStyle = 'rgba(0,0,0,0.12)';
		ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

		const drift = 0.08 * r * (0.3 + 0.7 * brightness);
		const ox = drift * Math.sin(t * 0.17) + drift * 0.35 * Math.sin(t * 0.31 + 2.1);
		const oy = drift * Math.cos(t * 0.14) + drift * 0.35 * Math.cos(t * 0.27 + 0.7);

		// Main body color.
		{
			const g = ctx.createRadialGradient(cx + ox, cy + oy, r * 0.1, cx, cy, r);
			g.addColorStop(0, `hsla(${hue} ${sat}% ${Math.round(56 - 10 * whiten)}% / ${0.95 * orbAlpha})`);
			g.addColorStop(0.55, `hsla(${hue} ${sat}% ${Math.round(44 - 12 * whiten)}% / ${0.55 * orbAlpha})`);
			g.addColorStop(1, `hsla(${hue} ${Math.round(sat * 0.7)}% ${Math.round(22 - 10 * whiten)}% / ${0.12 * orbAlpha})`);
			ctx.fillStyle = g;
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
		}

		// Secondary layer to make it feel alive.
		ctx.globalCompositeOperation = 'screen';
		ctx.filter = `blur(${Math.max(10, 16 + 10 * brightness)}px)`;
		{
			const g2 = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
			const hue2 = (hue + 28 + 22 * Math.sin(t * 0.12)) % 360;
			const hue3 = (hue - 24 + 18 * Math.sin(t * 0.09 + 1.1)) % 360;
			g2.addColorStop(0, `hsla(${hue2} ${Math.round(sat * 0.9)}% ${Math.round(55 - 8 * whiten)}% / ${0.22 * orbAlpha})`);
			g2.addColorStop(0.55, `hsla(${hue3} ${Math.round(sat * 0.75)}% ${Math.round(48 - 10 * whiten)}% / ${0.18 * orbAlpha})`);
			g2.addColorStop(1, `hsla(${hue2} ${Math.round(sat * 0.7)}% ${Math.round(46 - 10 * whiten)}% / ${0.12 * orbAlpha})`);
			ctx.fillStyle = g2;
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
		}
		ctx.filter = 'none';

		// Stage 2/3: gentle whitening glow.
		if (whiten > 0) {
			ctx.globalCompositeOperation = 'screen';
			ctx.filter = `blur(${Math.max(14, 18 + 24 * brightness)}px)`;
			const wg = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
			wg.addColorStop(0, `rgba(255,255,255,${0.36 * whiten * orbAlpha})`);
			wg.addColorStop(0.55, `rgba(255,255,255,${0.10 * whiten * orbAlpha})`);
			wg.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = wg;
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
			ctx.filter = 'none';
		}

		// Boot: subtle rainbow wash inside the orb for ~5 seconds.
		if (bootMix > 0.001) {
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.28 * bootMix;
			ctx.filter = 'blur(22px)';

			const maybeConic = (ctx as unknown as { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
			if (typeof maybeConic === 'function') {
				const cg = maybeConic.call(ctx, t * 0.22, cx, cy);
				cg.addColorStop(0.0, 'rgba(255, 90, 120, 0.9)');
				cg.addColorStop(0.18, 'rgba(255, 170, 80, 0.9)');
				cg.addColorStop(0.36, 'rgba(180, 255, 120, 0.9)');
				cg.addColorStop(0.55, 'rgba(80, 220, 255, 0.9)');
				cg.addColorStop(0.72, 'rgba(140, 120, 255, 0.9)');
				cg.addColorStop(0.88, 'rgba(255, 90, 220, 0.9)');
				cg.addColorStop(1.0, 'rgba(255, 90, 120, 0.9)');
				ctx.fillStyle = cg;
				ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
			}

			ctx.globalAlpha = 1;
			ctx.filter = 'none';
		}

		// Stage 3: subtle iridescent sheen, not full rainbow.
		if (sheen > 0) {
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.14 * sheen;
			ctx.filter = `blur(${Math.max(18, 22 + 16 * brightness)}px)`;

			const maybeConic = (ctx as unknown as { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
			if (typeof maybeConic === 'function') {
				const cg = maybeConic.call(ctx, t * 0.12, cx, cy);
				cg.addColorStop(0.0, 'rgba(255, 120, 170, 0.55)');
				cg.addColorStop(0.28, 'rgba(255, 210, 140, 0.55)');
				cg.addColorStop(0.5, 'rgba(140, 255, 210, 0.55)');
				cg.addColorStop(0.7, 'rgba(140, 170, 255, 0.55)');
				cg.addColorStop(1.0, 'rgba(255, 120, 170, 0.55)');
				ctx.fillStyle = cg;
				ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
			}

			ctx.globalAlpha = 1;
			ctx.filter = 'none';
		}

		ctx.restore();

		// Orb rim glow and outer bloom.
		ctx.globalCompositeOperation = 'screen';
		{
			ctx.filter = `blur(${Math.max(16, 22 + 26 * brightness)}px)`;
			const glow = ctx.createRadialGradient(cx, cy, r * 0.65, cx, cy, r * 1.25);
			glow.addColorStop(0, `hsla(${hue} ${Math.round(sat * 0.9)}% 62% / ${0.26 * orbAlpha})`);
			glow.addColorStop(0.5, `hsla(${hue} ${Math.round(sat * 0.8)}% 56% / ${0.18 * orbAlpha})`);
			glow.addColorStop(1, 'rgba(0,0,0,0)');
			ctx.fillStyle = glow;
			ctx.fillRect(0, 0, w, h);
			ctx.filter = 'none';
		}

		// Vignette.
		ctx.globalCompositeOperation = 'source-over';
		{
			const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.2, cx, cy, Math.max(w, h) * 0.78);
			vg.addColorStop(0, 'rgba(0,0,0,0)');
			vg.addColorStop(1, 'rgba(0,0,0,0.66)');
			ctx.fillStyle = vg;
			ctx.fillRect(0, 0, w, h);
		}

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

	// Avoid cancelAnimationFrame during SSR; onMount cleanup handles it in the browser.
	onDestroy(() => {});

	$effect(() => {
		if (typeof window === 'undefined') return;
		reseed();
	});

	$effect(() => {
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
				<span class="k">Dominant</span>
				<span class="v">{dominant === 'baseline' ? 'Baseline' : palette[dominant].name}</span>
			</div>
			<div class="hud-row">
				<span class="k">Coherence</span>
				<span class="v">{Math.round(stageEnergy * 100)}%</span>
			</div>
			<div class="hud-row">
				<span class="k">zA / zB</span>
				<span class="v">{zA.toFixed(2)} / {zB.toFixed(2)}</span>
			</div>
			<div class="hud-row">
				<span class="k">Pearson</span>
				<span class="v">{pearsonR.toFixed(2)}</span>
			</div>
			<div class="hud-row">
				<span class="k">Agree z</span>
				<span class="v">{zAgree.toFixed(2)}</span>
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
						<input bind:value={windowBits} type="range" min="800" max="24000" step="400" />
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
						<input bind:value={renderScale} type="range" min="0.45" max="1" step="0.05" />
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
