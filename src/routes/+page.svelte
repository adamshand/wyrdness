<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	type Stage = 1 | 2 | 3;
	type Channel = 'baseline' | 'correlated' | 'anti' | 'stick' | 'pearson';

	let canvasEl: HTMLCanvasElement;

	let showHud = $state(true);
	let showSettings = $state(false);
	let showLegend = $state(false);

	// Device-ish defaults:
	// - analysis uses 200-bit samples (A/B)
	// - signal engine ticks at a human-ish cadence (updates/sec)
	// - rendering stays on RAF; we interpolate between ticks
	let sampleBits = $state(200);
	let updatesPerSec = $state(1);

	type Preset = 'fast' | 'medium' | 'slow' | 'custom';
	const presets: Record<
		Exclude<Preset, 'custom'>,
		{ sampleBits: number; updatesPerSec: number; label: string; note: string }
	> = {
		fast: { sampleBits: 200, updatesPerSec: 5, label: 'Fast', note: 'More reactive' },
		medium: { sampleBits: 200, updatesPerSec: 2, label: 'Medium', note: 'Balanced' },
		slow: { sampleBits: 200, updatesPerSec: 1, label: 'Slow', note: 'Mellow' }
	};
	let preset = $state<Preset>('slow');
	let tickBudget = 0; // fractional analysis ticks accumulated between frames
	let alpha = $state(0.08);
	let renderScale = $state(0.75);

	let stage = $state<Stage>(1);
	let stageEnergy = $state(0);
	let coherence = $state(0);

	// Visual indicator of "how unlikely" the current anomaly is (0..1).
	let sigEnergy = $state(0);

	let hueSmooth = $state(205);
	let satSmooth = $state(58);
	let baselineHueTarget = $state(205);
	let baselineHueNextAtMs = 0;

	let zA = $state(0);
	let zB = $state(0);
	let pearsonR = $state(0);
	let pearsonSpin = $state(0);
	let pearsonDir = $state<1 | -1>(1);
	let pearsonPhase = $state(0);
	let pearsonFlip = $state(0);
	let zAgree = $state(0);

	let dominant = $state<Channel>('baseline');
	let dominance = $state(0);

	let fps = $state(0);

	let raf = 0;
	let bootMs = 0;

	let bitsA: Uint8Array;
	let bitsB: Uint8Array;
	let onesA = 0;
	let onesB = 0;
	let agree = 0; // count of A==B in the window

	let rawLast: Record<Exclude<Channel, 'baseline'>, number> = {
		correlated: 0,
		anti: 0,
		stick: 0,
		pearson: 0
	};
	let rawRender: Record<Exclude<Channel, 'baseline'>, number> = {
		correlated: 0,
		anti: 0,
		stick: 0,
		pearson: 0
	};

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

	function wrapHue(h: number) {
		const x = h % 360;
		return x < 0 ? x + 360 : x;
	}

	function hueApproach(current: number, target: number, k: number) {
		// Move along the shortest arc on the hue circle.
		const c = wrapHue(current);
		const t = wrapHue(target);
		let d = t - c;
		if (d > 180) d -= 360;
		if (d < -180) d += 360;
		return wrapHue(c + d * k);
	}

	function erfApprox(x: number) {
		// Abramowitz & Stegun 7.1.26
		const sign = x < 0 ? -1 : 1;
		const ax = Math.abs(x);
		const t = 1 / (1 + 0.3275911 * ax);
		const a1 = 0.254829592;
		const a2 = -0.284496736;
		const a3 = 1.421413741;
		const a4 = -1.453152027;
		const a5 = 1.061405429;
		const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
		return sign * y;
	}

	function normalCdf(x: number) {
		return 0.5 * (1 + erfApprox(x / Math.SQRT2));
	}

	function twoSidedPFromZ(z: number) {
		const az = Math.abs(z);
		const tail = 1 - normalCdf(az);
		return Math.max(1e-18, Math.min(1, 2 * tail));
	}

	function applyPreset(p: Exclude<Preset, 'custom'>) {
		preset = p;
		sampleBits = presets[p].sampleBits;
		updatesPerSec = presets[p].updatesPerSec;
		reseed();
	}

	function reseed() {
		// Keep buffers and aggregates consistent.
		// This prevents a huge first z-score spike.
		bitsA = randBits(sampleBits);
		bitsB = randBits(sampleBits);

		onesA = 0;
		onesB = 0;
		agree = 0;
		sumX = 0;
		sumY = 0;
		sumXY = 0;

		for (let i = 0; i < sampleBits; i++) {
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
		pearsonSpin = 0;
		pearsonDir = 1;
		pearsonPhase = 0;
		pearsonFlip = 0;
		zAgree = 0;

		coherence = 0;
		stageEnergy = 0;
		sigEnergy = 0;
		stage = 1;
		tickBudget = 0;

		dominant = 'baseline';
		dominance = 0;
		showLegend = false;
		hueSmooth = 205;

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

		const shouldSwitch =
			dominant === 'baseline' ? next !== 'baseline' : nextStrength > currentStrength + switchMargin;

		// dominance is a slow envelope to avoid sudden hue changes.
		const target = next === 'baseline' ? 0 : nextStrength;
		const tau = target > dominance ? 1200 : 1800;
		const k = 1 - Math.exp(-dtMs / tau);
		dominance = dominance + (target - dominance) * k;

		if (shouldSwitch) dominant = next;
		if (dominant === 'baseline' && dominance < 0.05) dominant = 'baseline';
	}

	function recomputeAggregatesFromBuffers() {
		onesA = 0;
		onesB = 0;
		agree = 0;
		sumX = 0;
		sumY = 0;
		sumXY = 0;

		for (let i = 0; i < sampleBits; i++) {
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
	}

	function signalTick() {
		// Replace the entire sample with fresh bits (200-bit chunks), then
		// compute channel values. Rendering will interpolate between ticks.
		bitsA = randBits(sampleBits);
		bitsB = randBits(sampleBits);
		recomputeAggregatesFromBuffers();

		// Z-scores and correlation for this sample.
		const N = sampleBits;
		const zAInst = zFromOnes(onesA, N);
		const zBInst = zFromOnes(onesB, N);
		const zAgreeInst = zFromOnes(agree, N);

		const meanX = sumX / N;
		const meanY = sumY / N;
		const exy = sumXY / N;
		const cov = exy - meanX * meanY;
		const varX = Math.max(1e-6, 1 - meanX * meanX);
		const varY = Math.max(1e-6, 1 - meanY * meanY);
		const rInst = cov / Math.sqrt(varX * varY);

		// Smooth the reported stats just a bit so the HUD isn't twitchy.
		const statsTau = 2800;
		const statsDtMs = 1000 / Math.max(0.25, updatesPerSec);
		const k = 1 - Math.exp(-statsDtMs / statsTau);
		zA = zA + (zAInst - zA) * k;
		zB = zB + (zBInst - zB) * k;
		zAgree = zAgree + (zAgreeInst - zAgree) * k;
		pearsonR = pearsonR + (rInst - pearsonR) * k;

		// Channel strengths (0..1).
		const corrRaw =
			zAInst * zBInst > 0 ? Math.min(strengthFromZ(zAInst), strengthFromZ(zBInst)) : 0;
		const antiRaw =
			zAInst * zBInst < 0 ? Math.min(strengthFromZ(zAInst), strengthFromZ(zBInst)) : 0;
		const stickRaw = 0.85 * strengthFromZ(zAgreeInst, 1.1, 3.1);
		const pearsonRaw = clamp01((Math.abs(rInst) - 0.08) / 0.55);

		const raw = {
			correlated: corrRaw,
			anti: antiRaw,
			stick: stickRaw,
			pearson: Math.max(0.06, pearsonRaw)
		};
		rawLast = raw;

		// Dominance updates on signal ticks, not every frame.
		updateDominant(raw, 1000 / Math.max(0.25, updatesPerSec));

		// Stage + significance integrate slowly.
		const base = Math.max(raw.correlated, raw.anti, raw.stick, raw.pearson);
		coherence = base;

		const riseMs = 2600;
		const fallMs = 4200;
		const dtMs = 1000 / Math.max(0.25, updatesPerSec);
		const tau = coherence > stageEnergy ? riseMs : fallMs;
		const ek = 1 - Math.exp(-dtMs / tau);
		stageEnergy = stageEnergy + (coherence - stageEnergy) * ek;
		stage = computeStageFromEnergy(stageEnergy, stage);

		const corrZ = corrRaw > 0 ? Math.min(Math.abs(zAInst), Math.abs(zBInst)) : 0;
		const antiZ = antiRaw > 0 ? Math.min(Math.abs(zAInst), Math.abs(zBInst)) : 0;
		const stickZ = stickRaw > 0 ? Math.abs(zAgreeInst) : 0;

		const rClamped = Math.max(-0.999999, Math.min(0.999999, rInst));
		const fisher =
			0.5 * Math.log((1 + rClamped) / (1 - rClamped)) * Math.sqrt(Math.max(1, sampleBits - 3));
		const pearsonZ = pearsonRaw > 0 ? Math.abs(fisher) : 0;

		const pCorr = corrZ > 0 ? twoSidedPFromZ(corrZ) : 1;
		const pAnti = antiZ > 0 ? twoSidedPFromZ(antiZ) : 1;
		const pStick = stickZ > 0 ? twoSidedPFromZ(stickZ) : 1;
		const pPearson = pearsonZ > 0 ? twoSidedPFromZ(pearsonZ) : 1;

		// Aesthetic floor: keep some life even under pure randomness.
		const pOverall = Math.min(0.35, Math.min(pCorr, pAnti, pStick, pPearson));
		const surprisal = Math.min(6, -Math.log10(pOverall));
		const targetSig = clamp01((surprisal - 0.8) / 4.8);

		const sigRiseMs = 1400;
		const sigFallMs = 2600;
		const sigTau = targetSig > sigEnergy ? sigRiseMs : sigFallMs;
		const sk = 1 - Math.exp(-dtMs / sigTau);
		sigEnergy = sigEnergy + (targetSig - sigEnergy) * sk;
	}

	function step(dtMs: number) {
		bootMs += dtMs;

		const bootT = clamp01(bootMs / 5000);
		const bootLock = bootT < 1;

		// 1) Signal engine runs on a slower clock.
		tickBudget += updatesPerSec * (dtMs / 1000);
		let ticks = Math.floor(tickBudget);
		ticks = Math.min(ticks, 8); // cap catch-up so we never spiral

		if (!bootLock && ticks > 0) {
			tickBudget -= ticks;
			for (let t = 0; t < ticks; t++) {
				signalTick();
			}
		} else {
			// During boot we keep visuals alive but lock the "meaning" logic.
			tickBudget = Math.min(2, tickBudget);
			dominant = 'baseline';
			dominance = 0;
			coherence = 0;
			stageEnergy = 0;
			sigEnergy = 0;
			stage = 1;
			rawLast = { correlated: 0, anti: 0, stick: 0, pearson: 0 };
			rawRender = { correlated: 0, anti: 0, stick: 0, pearson: 0 };
		}

		// 2) Motion and smoothing runs every frame.
		// Pearson motion: always drifting a little, speeds up with |pearson|.
		{
			const dt = dtMs / 1000;
			const spinTau = 900;
			const sk = 1 - Math.exp(-dtMs / spinTau);
			pearsonSpin = pearsonSpin + (pearsonR - pearsonSpin) * sk;

			if (!bootLock) {
				const flipThreshold = 0.055;
				let nextDir = pearsonDir;
				if (pearsonDir === 1 && pearsonSpin < -flipThreshold) nextDir = -1;
				if (pearsonDir === -1 && pearsonSpin > flipThreshold) nextDir = 1;
				if (nextDir !== pearsonDir) {
					pearsonDir = nextDir;
					pearsonFlip = 1;
				}
			} else {
				pearsonDir = 1;
			}

			pearsonFlip *= Math.exp(-dtMs / 650);

			const mag = Math.min(1, Math.abs(pearsonSpin));
			const baseSpeed = 0.03;
			const gain = 0.26;
			const speed = baseSpeed + gain * Math.pow(mag, 0.82);
			pearsonPhase = wrapHue(pearsonPhase + pearsonDir * speed * 360 * dt);
		}

		// Smooth the channel strengths for rendering so it never feels like it "steps".
		{
			const tau = 3200;
			const k = 1 - Math.exp(-dtMs / tau);
			rawRender = {
				correlated: rawRender.correlated + (rawLast.correlated - rawRender.correlated) * k,
				anti: rawRender.anti + (rawLast.anti - rawRender.anti) * k,
				stick: rawRender.stick + (rawLast.stick - rawRender.stick) * k,
				pearson: rawRender.pearson + (rawLast.pearson - rawRender.pearson) * k
			};
		}

		// Baseline hue wandering: even when dim, it slowly drifts (tens of seconds).
		if (dominant === 'baseline') {
			const nowMs = performance.now();
			if (baselineHueNextAtMs === 0) {
				baselineHueTarget = 205;
				baselineHueNextAtMs = nowMs + 15000;
			}
			if (nowMs >= baselineHueNextAtMs) {
				const picks = [186, 24, 112, 252, 205];
				baselineHueTarget = picks[Math.floor(Math.random() * picks.length)];
				baselineHueNextAtMs = nowMs + 12000 + Math.random() * 22000;
			}
		}

		// Hue follows the dominant channel slowly (10s-of-seconds feel).
		const baseHue = dominant === 'baseline' ? baselineHueTarget : palette[dominant].hue;
		const hueTau = dominant === 'baseline' ? 14000 : 9000;
		const hk = 1 - Math.exp(-dtMs / hueTau);
		hueSmooth = hueApproach(hueSmooth, baseHue, hk);

		// Saturation should still respond, but smoothly.
		const satTarget = dominant === 'baseline' ? 52 : dominant === 'pearson' ? 72 : 80;
		const satTau = 9000;
		const sk = 1 - Math.exp(-dtMs / satTau);
		satSmooth = satSmooth + (satTarget - satSmooth) * sk;

		render(rawRender);
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

		const bootT = clamp01(bootMs / 5000);
		const bootLock = bootT < 1;
		const e = stageEnergy;

		// Lamp geometry.
		const cx = w * 0.5;
		const cy = h * 0.54;
		const rFull = Math.min(w, h) * 0.42;
		// Boot: CRT-like dot that expands into the full orb.
		const rBoot = rFull * (0.06 + 0.94 * smoothstep(0, 1, bootT));
		const r = bootLock ? rBoot : rFull;

		// Pick a single hue family (smoothed across switches).
		let hue = hueSmooth;
		let sat = satSmooth;

		// Bias polarity gently shifts hue within the family.
		const polarity = Math.max(-1, Math.min(1, (zA + zB) / 6));
		hue = (hue + polarity * 10 + 6 * Math.sin(t * 0.08) + 3 * Math.sin(t * 0.13 + 1.7)) % 360;

		// Stage-based whitening (no strobe).
		const whitenStage2 = smoothstep(0.36, 0.78, e) * 0.62;
		const sheen = stage === 3 ? smoothstep(0.68, 0.98, e) : 0;
		const whitenStage3 = stage === 3 ? 0.62 + sheen * 0.12 : 0;
		const whiten = stage === 1 ? 0 : stage === 2 ? whitenStage2 : whitenStage3;

		// Brightness: stageEnergy is still the envelope, but ensure a visible baseline.
		const eVis = Math.max(e, 0.08);
		const brightness = 0.16 + 0.95 * Math.pow(eVis, 0.86);
		const orbAlpha = 0.6 + 0.3 * brightness;

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
			g.addColorStop(
				0,
				`hsla(${hue} ${sat}% ${Math.round(56 - 10 * whiten)}% / ${0.95 * orbAlpha})`
			);
			g.addColorStop(
				0.55,
				`hsla(${hue} ${sat}% ${Math.round(44 - 12 * whiten)}% / ${0.55 * orbAlpha})`
			);
			g.addColorStop(
				1,
				`hsla(${hue} ${Math.round(sat * 0.7)}% ${Math.round(22 - 10 * whiten)}% / ${0.12 * orbAlpha})`
			);
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
			g2.addColorStop(
				0,
				`hsla(${hue2} ${Math.round(sat * 0.9)}% ${Math.round(55 - 8 * whiten)}% / ${0.22 * orbAlpha})`
			);
			g2.addColorStop(
				0.55,
				`hsla(${hue3} ${Math.round(sat * 0.75)}% ${Math.round(48 - 10 * whiten)}% / ${0.18 * orbAlpha})`
			);
			g2.addColorStop(
				1,
				`hsla(${hue2} ${Math.round(sat * 0.7)}% ${Math.round(46 - 10 * whiten)}% / ${0.12 * orbAlpha})`
			);
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
			wg.addColorStop(0.55, `rgba(255,255,255,${0.1 * whiten * orbAlpha})`);
			wg.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = wg;
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
			ctx.filter = 'none';
		}

		// Significance core: creamy-white central light that grows with "unlikeliness".
		if (!bootLock && sigEnergy > 0.001) {
			const s = Math.pow(sigEnergy, 0.85);
			const coreR = r * (0.06 + 0.34 * s);
			const coreBlur = Math.max(10, 24 - 10 * s + 8 * brightness);

			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = (0.06 + 0.38 * s) * (0.75 + 0.25 * brightness);
			ctx.filter = `blur(${coreBlur}px)`;

			const cg = ctx.createRadialGradient(cx, cy, coreR * 0.05, cx, cy, coreR);
			cg.addColorStop(0, 'rgba(255, 245, 232, 0.95)');
			cg.addColorStop(0.22, 'rgba(255, 238, 218, 0.65)');
			cg.addColorStop(0.55, 'rgba(220, 240, 255, 0.22)');
			cg.addColorStop(1, 'rgba(255, 255, 255, 0)');
			ctx.fillStyle = cg;
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

			ctx.restore();
		}

		// Boot: CRT-like creamy ignition, confined to the (growing) orb.
		if (bootLock) {
			const ignition = 1 - bootT;
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.55 * ignition;
			ctx.filter = 'blur(22px)';

			// Creamy, CRT-ish activation glow: warm-white core with a faint cool fringe.
			{
				ctx.filter = 'blur(18px)';
				const g = ctx.createRadialGradient(cx, cy, r * 0.02, cx, cy, r);
				g.addColorStop(0, `rgba(255, 245, 232, ${0.85 * ignition})`);
				g.addColorStop(0.18, `rgba(255, 238, 218, ${0.5 * ignition})`);
				g.addColorStop(0.55, `rgba(220, 240, 255, ${0.22 * ignition})`);
				g.addColorStop(1, 'rgba(255,255,255,0)');
				ctx.fillStyle = g;
				ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
			}

			// Subtle horizontal "scan" line that expands with the dot (modern CRT nod).
			{
				ctx.filter = 'blur(10px)';
				ctx.globalAlpha = 0.28 * ignition;
				const bandH = Math.max(2, r * (0.05 + 0.03 * (1 - bootT)));
				const lg = ctx.createLinearGradient(cx - r, cy - bandH, cx + r, cy + bandH);
				lg.addColorStop(0, 'rgba(255, 245, 232, 0)');
				lg.addColorStop(0.5, 'rgba(255, 245, 232, 0.85)');
				lg.addColorStop(1, 'rgba(255, 245, 232, 0)');
				ctx.fillStyle = lg;
				ctx.fillRect(cx - r, cy - bandH, r * 2, bandH * 2);
				ctx.globalAlpha = 1;
			}

			ctx.globalAlpha = 1;
			ctx.filter = 'none';
		}

		// Stage 3: very subtle internal iridescence (kept minimal).
		// Pearson correlation is expressed primarily as a pearly ring (outside the orb).
		if (sheen > 0) {
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.06 * sheen * raw.pearson * (1 + 0.6 * pearsonFlip);
			ctx.filter = `blur(${Math.max(16, 22 + 14 * brightness - 6 * pearsonFlip)}px)`;

			const maybeConic = (
				ctx as unknown as {
					createConicGradient?: (a: number, x: number, y: number) => CanvasGradient;
				}
			).createConicGradient;
			if (typeof maybeConic === 'function') {
				const cg = maybeConic.call(ctx, (pearsonPhase / 360) * Math.PI * 2, cx, cy);
				cg.addColorStop(0.0, 'rgba(255, 170, 210, 0.55)');
				cg.addColorStop(0.3, 'rgba(255, 235, 180, 0.55)');
				cg.addColorStop(0.55, 'rgba(180, 255, 235, 0.55)');
				cg.addColorStop(0.78, 'rgba(175, 200, 255, 0.55)');
				cg.addColorStop(1.0, 'rgba(255, 170, 210, 0.55)');
				ctx.fillStyle = cg;
				ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
			}

			ctx.globalAlpha = 1;
			ctx.filter = 'none';
		}

		ctx.restore();

		// Pearson: pearly ring around the orb. Visible in all stages.
		{
			const p = raw.pearson;
			const pStrength = smoothstep(0.06, 0.8, p);
			if (pStrength > 0.001) {
				const ringPhase = (pearsonPhase / 360) * Math.PI * 2;

				const outerR = r * 1.05;
				const innerR = r * 0.93;
				const ringBlur = Math.max(10, 14 + 14 * pStrength + 6 * brightness);

				ctx.save();
				ctx.globalCompositeOperation = 'screen';
				ctx.globalAlpha =
					(0.06 + 0.18 * pStrength) * (0.5 + 0.5 * stageEnergy) * (1 + 0.45 * pearsonFlip);
				ctx.filter = `blur(${Math.max(8, ringBlur - 6 * pearsonFlip)}px)`;

				ctx.beginPath();
				ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
				ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
				ctx.closePath();
				ctx.clip();

				const maybeConic = (
					ctx as unknown as {
						createConicGradient?: (a: number, x: number, y: number) => CanvasGradient;
					}
				).createConicGradient;
				if (typeof maybeConic === 'function') {
					const cg = maybeConic.call(ctx, ringPhase, cx, cy);
					cg.addColorStop(0.0, 'rgba(255, 230, 245, 0.75)');
					cg.addColorStop(0.18, 'rgba(220, 245, 255, 0.75)');
					cg.addColorStop(0.36, 'rgba(255, 245, 215, 0.75)');
					cg.addColorStop(0.56, 'rgba(225, 255, 235, 0.75)');
					cg.addColorStop(0.78, 'rgba(235, 230, 255, 0.75)');
					cg.addColorStop(1.0, 'rgba(255, 230, 245, 0.75)');
					ctx.fillStyle = cg;
					ctx.fillRect(cx - outerR - 2, cy - outerR - 2, (outerR + 2) * 2, (outerR + 2) * 2);
				} else {
					// Fallback: soft pearly highlight using two opposing gradients.
					const g1 = ctx.createLinearGradient(cx - outerR, cy - outerR, cx + outerR, cy + outerR);
					g1.addColorStop(0, 'rgba(255,240,250,0.55)');
					g1.addColorStop(0.5, 'rgba(200,240,255,0.35)');
					g1.addColorStop(1, 'rgba(240,255,220,0.45)');
					ctx.fillStyle = g1;
					ctx.fillRect(cx - outerR - 2, cy - outerR - 2, (outerR + 2) * 2, (outerR + 2) * 2);
				}

				// Ring shading to keep it subtle and dimensional.
				ctx.globalCompositeOperation = 'multiply';
				ctx.globalAlpha = 0.22 * pStrength;
				const shade = ctx.createRadialGradient(cx, cy, innerR * 0.9, cx, cy, outerR);
				shade.addColorStop(0, 'rgba(0,0,0,0.0)');
				shade.addColorStop(1, 'rgba(0,0,0,0.55)');
				ctx.fillStyle = shade;
				ctx.fillRect(cx - outerR - 2, cy - outerR - 2, (outerR + 2) * 2, (outerR + 2) * 2);

				ctx.restore();
			}
		}

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
			const vg = ctx.createRadialGradient(
				cx,
				cy,
				Math.min(w, h) * 0.2,
				cx,
				cy,
				Math.max(w, h) * 0.78
			);
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
		if (
			tag === 'input' ||
			tag === 'textarea' ||
			(e.target as HTMLElement | null)?.isContentEditable
		)
			return;

		if (e.key === 'h' || e.key === 'H') {
			showHud = !showHud;
			return;
		}
		if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
			showHud = true;
			return;
		}
		if (e.key === 's' || e.key === 'S') {
			showSettings = !showSettings;
			showHud = true;
			return;
		}
		if (e.key === 'l' || e.key === 'L') {
			showLegend = !showLegend;
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
		// If the user drags sliders away from preset values, mark as custom.
		const isMatch = (p: Exclude<Preset, 'custom'>) =>
			sampleBits === presets[p].sampleBits && updatesPerSec === presets[p].updatesPerSec;
		preset = isMatch('fast')
			? 'fast'
			: isMatch('medium')
				? 'medium'
				: isMatch('slow')
					? 'slow'
					: 'custom';
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
				<span class="k">Preset</span>
				<span class="v">{preset === 'custom' ? 'Custom' : presets[preset].label}</span>
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
				<span class="v">{sampleBits.toLocaleString()} bits</span>
			</div>
			<div class="hud-row">
				<span class="k">FPS</span>
				<span class="v">{fps.toFixed(0)}</span>
			</div>

			<div class="hud-actions">
				<button
					class="hud-btn"
					type="button"
					onclick={() => (showLegend = !showLegend)}
					title="Toggle legend (L)"
				>
					Legend
				</button>
			</div>

			{#if showLegend}
				<div class="legend">
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.correlated.hue}`}></span> Teal: Correlated drift
					</div>
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.anti.hue}`}></span> Ember: Anti-correlated drift
					</div>
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.stick.hue}`}></span> Green: “Stick together” (rarer)
					</div>
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.pearson.hue}`}></span> Pearl ring: Pearson correlation
						(direction flips with +/-)
					</div>
				</div>
			{/if}

			{#if showSettings}
				<div class="sep"></div>
				<div class="controls">
					<div class="presets" role="group" aria-label="Presets">
						<button
							type="button"
							class:active={preset === 'fast'}
							onclick={() => applyPreset('fast')}
							title={`${presets.fast.label}: ${presets.fast.note}`}
						>
							Fast
						</button>
						<button
							type="button"
							class:active={preset === 'medium'}
							onclick={() => applyPreset('medium')}
							title={`${presets.medium.label}: ${presets.medium.note}`}
						>
							Medium
						</button>
						<button
							type="button"
							class:active={preset === 'slow'}
							onclick={() => applyPreset('slow')}
							title={`${presets.slow.label}: ${presets.slow.note}`}
						>
							Slow
						</button>
					</div>
					<label>
						<span>Sample</span>
						<input value={sampleBits} type="range" min="200" max="200" step="1" disabled />
						<span class="mono">{sampleBits} bits</span>
					</label>
					<label>
						<span>Updates/sec</span>
						<input bind:value={updatesPerSec} type="range" min="1" max="5" step="1" />
						<span class="mono">{updatesPerSec}</span>
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
					<div class="hint mono">
						Hotkeys: H HUD, ? show HUD, S settings, L legend, R reset, F fullscreen
					</div>
				</div>
			{:else}
				<div class="hint mono">
					Hotkeys: H HUD, ? show HUD, S settings, L legend, R reset, F fullscreen
				</div>
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

	.hud-actions {
		display: flex;
		justify-content: flex-end;
		margin: 6px 0 8px;
	}

	.hud-btn {
		appearance: none;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.9);
		border-radius: 10px;
		padding: 6px 10px;
		font-size: 12px;
		cursor: pointer;
	}

	.hud-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.legend {
		margin: 8px 0 4px;
		padding: 8px 10px;
		border-radius: 12px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(0, 0, 0, 0.18);
		font-size: 12px;
		color: rgba(255, 255, 255, 0.86);
	}

	.legend-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 3px 0;
	}

	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 999px;
		background: radial-gradient(
			circle at 30% 30%,
			hsla(var(--h) 90% 70% / 0.95),
			hsla(var(--h) 90% 45% / 0.95)
		);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
		flex: 0 0 auto;
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

	.presets {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-bottom: 2px;
	}

	.presets button {
		appearance: none;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.05);
		color: rgba(255, 255, 255, 0.9);
		border-radius: 12px;
		padding: 8px 10px;
		font-size: 12px;
		cursor: pointer;
	}

	.presets button:hover {
		background: rgba(255, 255, 255, 0.09);
	}

	.presets button.active {
		border-color: rgba(255, 255, 255, 0.32);
		background: rgba(255, 255, 255, 0.12);
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
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
	}

	.hint {
		margin-top: 4px;
		opacity: 0.65;
		font-size: 12px;
	}
</style>
