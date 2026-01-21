<script lang="ts">
	import { onMount } from 'svelte';

	type Channel =
		| 'baseline'
		| 'correlated_high'
		| 'correlated_low'
		| 'anti_ab'
		| 'anti_ba'
		| 'stick';
	type RenderMode = 'orb' | 'signal';
	type LightMode = 'wow' | 'mellow';

	// === Mode Presets ===
	// Wyrd Light has "Wow (for showing off)" and "Mellow (for meetings and retreats)"
	// plus 5 response speed settings. We combine these into mode presets.
	type ModePreset = {
		// Smoothing time constants (ms)
		sigEnergyRiseMs: number;
		sigEnergyFallMs: number;
		hueTauMs: number;
		satTauMs: number;
		// Visual intensity
		maxBrightness: number; // 0..1 multiplier on brightness
		saturationBoost: number; // added to base saturation
		// Dominance behavior
		switchMargin: number; // how much stronger new channel must be to take over
		keepBonus: number; // bonus to current channel to prevent rapid switching
	};

	const MODE_PRESETS: Record<LightMode, ModePreset> = {
		wow: {
			// Faster response, more dramatic
			sigEnergyRiseMs: 1000,
			sigEnergyFallMs: 2000,
			hueTauMs: 6000,
			satTauMs: 5000,
			maxBrightness: 1.0,
			saturationBoost: 12,
			switchMargin: 0.06,
			keepBonus: 0.03
		},
		mellow: {
			// Slower, softer, more stable for meetings
			sigEnergyRiseMs: 2000,
			sigEnergyFallMs: 3600,
			hueTauMs: 14000,
			satTauMs: 12000,
			maxBrightness: 0.85,
			saturationBoost: 0,
			switchMargin: 0.12,
			keepBonus: 0.06
		}
	};

	let canvasEl: HTMLCanvasElement;

	// === UI State ===
	let showHud = $state(true);
	let showSettings = $state(false);
	let showLegend = $state(false);
	let renderMode = $state<RenderMode>('orb');
	let lightMode = $state<LightMode>('mellow'); // default to mellow for calmer experience
	let responseSpeed = $state<1 | 2 | 3 | 4 | 5>(3); // 1=slowest, 5=fastest, 3=default

	// Speed multipliers: speed 3 is baseline (1.0x), speed 1 is slower, speed 5 is faster
	const SPEED_MULTIPLIERS: Record<1 | 2 | 3 | 4 | 5, number> = {
		1: 1.8, // slowest - 1.8x tau (slower response)
		2: 1.35,
		3: 1.0, // baseline
		4: 0.7,
		5: 0.45 // fastest - 0.45x tau (faster response)
	};

	// Derived preset from current mode, with speed applied
	const basePreset = $derived(MODE_PRESETS[lightMode]);
	const speedMult = $derived(SPEED_MULTIPLIERS[responseSpeed]);
	const preset = $derived({
		...basePreset,
		sigEnergyRiseMs: basePreset.sigEnergyRiseMs * speedMult,
		sigEnergyFallMs: basePreset.sigEnergyFallMs * speedMult,
		hueTauMs: basePreset.hueTauMs * speedMult,
		satTauMs: basePreset.satTauMs * speedMult
	});

	// === Signal Engine Config ===
	// 200-bit samples at 1Hz matches Wyrd's description
	let sampleBits = $state(200);
	let updatesPerSec = $state(1);

	// === Thresholds (tuned for ~5-10 min episode frequency) ===
	// These control how "hard" it is to trigger a visible episode
	const STRENGTH_Z_START = 1.8; // z-score where channel strength begins
	const STRENGTH_Z_FULL = 3.5; // z-score for full channel strength
	const STICK_Z_START = 2.2; // stick is rarer
	const STICK_Z_FULL = 3.8;
	const PEARSON_R_START = 0.18; // |r| threshold to start showing pearson
	const PEARSON_R_FULL = 0.45; // |r| for full pearson strength
	const DOMINANCE_THRESHOLD = 0.15; // min strength to leave baseline
	const COHERENCE_FLOOR = 0.35; // p-value floor for aesthetic minimum

	// === Cumulative Deviation / Starting Point Config ===
	// How far back (in ticks) we search for optimal starting points
	const MAX_LOOKBACK = 120; // ~2 minutes at 1Hz
	// Minimum segment length to consider (prevents noise from tiny windows)
	const MIN_SEGMENT_LEN = 3;
	// Z-score threshold to consider a segment as an "episode"
	const EPISODE_Z_THRESHOLD = 1.6;

	// === Signal State ===
	let coherence = $state(0);
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
	let zAgree = $state(0);

	// === Significance Pulse State ===
	// Visual indicator when crossing into statistical significance
	const SIG_PULSE_THRESHOLD = 0.35; // sigEnergy level to trigger pulse
	const SIG_PULSE_DURATION = 800; // ms for ring to expand
	const SIG_PULSE_COOLDOWN = 2500; // minimum ms between pulses
	let sigPulseStart = $state(0); // timestamp when pulse started (0 = no active pulse)
	let sigWasAboveThreshold = $state(false); // for detecting upward crossing
	let sigPulseLastTime = 0; // last time a pulse was triggered (for cooldown)

	let dominant = $state<Channel>('baseline');
	let dominance = $state(0);

	let fps = $state(0);

	// === Demo Mode ===
	// Auto-cycling showcase of all channels with Pearson spin
	const DEMO_CHANNELS: Exclude<Channel, 'baseline'>[] = [
		'correlated_high',
		'correlated_low',
		'anti_ab',
		'anti_ba',
		'stick'
	];
	const DEMO_LABELS: Record<Exclude<Channel, 'baseline'>, string> = {
		correlated_high: 'Both streams HIGH',
		correlated_low: 'Both streams LOW',
		anti_ab: 'A high, B low',
		anti_ba: 'B high, A low',
		stick: 'Bits matching'
	};
	const DEMO_DURATION_MS = 3000; // 3 seconds per channel

	let demoMode = $state(false); // whether auto-cycling is active
	let demoBoost = $state(0); // injected fake coherence (0..1)
	let demoChannel = $state<Exclude<Channel, 'baseline'>>('correlated_high');
	let demoIndex = $state(0); // which channel in the sequence (0-4)
	let demoPearsonDir = $state<1 | -1>(1); // alternates each channel
	let demoStartTime = $state(0); // timestamp when current channel started
	let demoPearsonBoost = $state(0); // injected Pearson value for spin effect

	// === History for strip chart (last 180 seconds at 1Hz) ===
	const HISTORY_LEN = 180;
	let historyCoherence: number[] = $state([]);
	let historyDominant: Channel[] = $state([]);
	let historyPearson: number[] = $state([]);

	// === Internal ===
	let raf = 0;
	let bootMs = 0;
	let tickBudget = 0;

	let bitsA: Uint8Array;
	let bitsB: Uint8Array;
	let onesA = 0;
	let onesB = 0;
	let agree = 0;
	let sumX = 0;
	let sumY = 0;
	let sumXY = 0;

	// === Cumulative Deviation State ===
	// Each tick adds sampleBits worth of bits. We track cumulative sums as random walks.
	// cumSumA[i] = cumulative sum of stream A up to tick i (bits mapped to ±1)
	// We store the cumulative sum at each tick boundary, not each bit.
	let cumSumA = $state<number[]>([]); // cumulative sum of A (±1 per bit)
	let cumSumB = $state<number[]>([]); // cumulative sum of B
	let cumSumAgree = $state<number[]>([]); // cumulative sum of agreement (1 if match, 0 if not) - but stored as deviation from expectation
	let cumSumXY = $state<number[]>([]); // cumulative sum of X*Y for Pearson
	let tickCount = $state(0); // total ticks since reseed

	// Episode state: tracks the "best" current segment for each channel
	type EpisodeState = {
		startTick: number; // when this episode started
		peakZ: number; // best z-score seen in this episode
		currentZ: number; // current z-score from startTick to now
		strength: number; // derived strength (0..1)
	};
	const defaultEpisode = (): EpisodeState => ({ startTick: 0, peakZ: 0, currentZ: 0, strength: 0 });
	let episodes = $state<Record<Exclude<Channel, 'baseline'>, EpisodeState>>({
		correlated_high: defaultEpisode(),
		correlated_low: defaultEpisode(),
		anti_ab: defaultEpisode(),
		anti_ba: defaultEpisode(),
		stick: defaultEpisode()
	});

	let rawLast: Record<Exclude<Channel, 'baseline'>, number> = {
		correlated_high: 0,
		correlated_low: 0,
		anti_ab: 0,
		anti_ba: 0,
		stick: 0
	};
	let rawRender: Record<Exclude<Channel, 'baseline'>, number> = {
		correlated_high: 0,
		correlated_low: 0,
		anti_ab: 0,
		anti_ba: 0,
		stick: 0
	};

	// Render-smoothed version (updated every frame, not just on ticks)
	let sigEnergyRender = 0;

	let bufCanvas: HTMLCanvasElement;
	let bufCtx: CanvasRenderingContext2D;
	let renderScale = 0.75;

	// Channel colors: light/dark pairs for directional channels
	const palette: Record<Exclude<Channel, 'baseline'>, { hue: number; name: string }> = {
		correlated_high: { hue: 180, name: 'Corr +' }, // Light teal/cyan (both toward 1s)
		correlated_low: { hue: 210, name: 'Corr -' }, // Dark teal/blue (both toward 0s)
		anti_ab: { hue: 35, name: 'Anti A>B' }, // Orange/amber (A high, B low)
		anti_ba: { hue: 8, name: 'Anti B>A' }, // Coral/red (B high, A low)
		stick: { hue: 112, name: 'Stick' } // Green (agreement)
	};

	// === Utility Functions ===
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
		const c = wrapHue(current);
		const t = wrapHue(target);
		let d = t - c;
		if (d > 180) d -= 360;
		if (d < -180) d += 360;
		return wrapHue(c + d * k);
	}

	function erfApprox(x: number) {
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

	// === Starting Point Detection ===
	// Find the optimal starting point that maximizes |S(t) - S(s)| / sqrt((t-s) * bitsPerTick)
	// Returns { startIdx, z } where startIdx is the tick index and z is the z-score
	function findOptimalStartingPoint(
		cumSum: number[],
		currentIdx: number,
		bitsPerTick: number,
		lookback: number = MAX_LOOKBACK,
		minLen: number = MIN_SEGMENT_LEN
	): { startIdx: number; z: number } {
		let bestZ = 0;
		let bestStart = currentIdx;

		const endSum = cumSum[currentIdx] ?? 0;
		const searchStart = Math.max(0, currentIdx - lookback);

		for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
			const startSum = cumSum[s] ?? 0;
			const delta = endSum - startSum;
			const tickSpan = currentIdx - s;
			const bitSpan = tickSpan * bitsPerTick;

			// z = deviation / sqrt(variance) = delta / sqrt(bitSpan)
			// For ±1 bits, variance per bit is 1, so variance over N bits is N
			const z = delta / Math.sqrt(bitSpan);

			if (Math.abs(z) > Math.abs(bestZ)) {
				bestZ = z;
				bestStart = s;
			}
		}

		return { startIdx: bestStart, z: bestZ };
	}

	// Find optimal starting point for agreement channel
	// Agreement is: count positions where A[i] == B[i]
	// Under null: P(agree) = 0.5, so expected agreement count = N/2
	// We track cumulative deviation from expectation: (agree - 0.5) per bit
	function findOptimalStartingPointAgreement(
		cumSum: number[],
		currentIdx: number,
		bitsPerTick: number,
		lookback: number = MAX_LOOKBACK,
		minLen: number = MIN_SEGMENT_LEN
	): { startIdx: number; z: number } {
		let bestZ = 0;
		let bestStart = currentIdx;

		const endSum = cumSum[currentIdx] ?? 0;
		const searchStart = Math.max(0, currentIdx - lookback);

		for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
			const startSum = cumSum[s] ?? 0;
			const delta = endSum - startSum; // excess agreement count above expectation
			const tickSpan = currentIdx - s;
			const bitSpan = tickSpan * bitsPerTick;

			// Variance of agreement count over N bits is N/4 (binomial with p=0.5)
			const z = delta / Math.sqrt(bitSpan / 4);

			if (Math.abs(z) > Math.abs(bestZ)) {
				bestZ = z;
				bestStart = s;
			}
		}

		return { startIdx: bestStart, z: bestZ };
	}

	// Find optimal starting point for Pearson correlation
	// We track cumulative X*Y where X, Y are ±1
	// Under null: E[XY] = 0, Var[XY] = 1
	function findOptimalStartingPointPearson(
		cumSumXY: number[],
		cumSumA: number[],
		cumSumB: number[],
		currentIdx: number,
		bitsPerTick: number,
		lookback: number = MAX_LOOKBACK,
		minLen: number = MIN_SEGMENT_LEN
	): { startIdx: number; z: number; r: number } {
		let bestZ = 0;
		let bestR = 0;
		let bestStart = currentIdx;

		const searchStart = Math.max(0, currentIdx - lookback);

		for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
			const tickSpan = currentIdx - s;
			const bitSpan = tickSpan * bitsPerTick;

			const sumXY = (cumSumXY[currentIdx] ?? 0) - (cumSumXY[s] ?? 0);
			const sumX = (cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0);
			const sumY = (cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0);

			// Pearson correlation for ±1 variables
			const meanX = sumX / bitSpan;
			const meanY = sumY / bitSpan;
			const cov = sumXY / bitSpan - meanX * meanY;
			const varX = Math.max(1e-6, 1 - meanX * meanX);
			const varY = Math.max(1e-6, 1 - meanY * meanY);
			const r = cov / Math.sqrt(varX * varY);

			// Fisher z-transformation for significance
			const rClamped = Math.max(-0.999, Math.min(0.999, r));
			const fisherZ = 0.5 * Math.log((1 + rClamped) / (1 - rClamped));
			const z = fisherZ * Math.sqrt(Math.max(1, bitSpan - 3));

			if (Math.abs(z) > Math.abs(bestZ)) {
				bestZ = z;
				bestR = r;
				bestStart = s;
			}
		}

		return { startIdx: bestStart, z: bestZ, r: bestR };
	}

	// === RNG ===
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

	// === Signal Engine ===
	function reseed() {
		bitsA = randBits(sampleBits);
		bitsB = randBits(sampleBits);
		recomputeAggregatesFromBuffers();

		zA = 0;
		zB = 0;
		pearsonR = 0;
		pearsonSpin = 0;
		pearsonDir = 1;
		pearsonPhase = 0;
		zAgree = 0;

		coherence = 0;
		sigEnergy = 0;
		tickBudget = 0;

		dominant = 'baseline';
		dominance = 0;
		hueSmooth = 205;

		demoBoost = 0;
		demoMode = false;
		demoIndex = 0;
		demoPearsonBoost = 0;
		bootMs = 0;

		// Reset cumulative deviation state
		cumSumA = [0]; // Start with 0 at tick 0
		cumSumB = [0];
		cumSumAgree = [0];
		cumSumXY = [0];
		tickCount = 0;

		// Reset episode states
		episodes = {
			correlated_high: defaultEpisode(),
			correlated_low: defaultEpisode(),
			anti_ab: defaultEpisode(),
			anti_ba: defaultEpisode(),
			stick: defaultEpisode()
		};

		// Clear history
		historyCoherence = [];
		historyDominant = [];
		historyPearson = [];

		// Reset significance pulse state
		sigPulseStart = 0;
		sigWasAboveThreshold = false;
		sigPulseLastTime = 0;
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

	function zFromOnes(ones: number, N: number) {
		const E = N / 2;
		const sd = Math.sqrt(N / 4);
		return (ones - E) / sd;
	}

	function strengthFromZ(z: number, zStart = STRENGTH_Z_START, zFull = STRENGTH_Z_FULL) {
		return clamp01((Math.abs(z) - zStart) / (zFull - zStart));
	}

	function updateDominant(raw: Record<Exclude<Channel, 'baseline'>, number>, dtMs: number) {
		let best: Exclude<Channel, 'baseline'> | null = null;
		let bestV = 0;
		for (const k of Object.keys(raw) as Array<Exclude<Channel, 'baseline'>>) {
			const v = raw[k];
			if (v > bestV) {
				bestV = v;
				best = k;
			}
		}

		const next: Channel = bestV > DOMINANCE_THRESHOLD && best ? best : 'baseline';
		const nextStrength = next === 'baseline' ? 0 : bestV;

		// Use preset values for mode-dependent behavior
		const { switchMargin, keepBonus } = preset;

		let currentStrength = 0;
		if (dominant !== 'baseline') currentStrength = raw[dominant] ?? 0;
		currentStrength += keepBonus;

		const shouldSwitch =
			dominant === 'baseline' ? next !== 'baseline' : nextStrength > currentStrength + switchMargin;

		const target = next === 'baseline' ? 0 : nextStrength;
		const tau = target > dominance ? 1200 : 1800;
		const k = 1 - Math.exp(-dtMs / tau);
		dominance = dominance + (target - dominance) * k;

		if (shouldSwitch) dominant = next;
		if (dominant === 'baseline' && dominance < 0.05) dominant = 'baseline';
	}

	function signalTick() {
		// Fresh 200-bit samples
		bitsA = randBits(sampleBits);
		bitsB = randBits(sampleBits);
		recomputeAggregatesFromBuffers();
		tickCount++;

		const N = sampleBits;

		// === Update cumulative sums ===
		// Get previous cumulative values
		const prevCumA = cumSumA[cumSumA.length - 1] ?? 0;
		const prevCumB = cumSumB[cumSumB.length - 1] ?? 0;
		const prevCumAgree = cumSumAgree[cumSumAgree.length - 1] ?? 0;
		const prevCumXY = cumSumXY[cumSumXY.length - 1] ?? 0;

		// Add this tick's contribution
		// sumX/sumY are already ±1 sums from recomputeAggregatesFromBuffers
		cumSumA.push(prevCumA + sumX);
		cumSumB.push(prevCumB + sumY);
		// Agreement deviation from expectation: agree - N/2 (we want excess agreement)
		cumSumAgree.push(prevCumAgree + (agree - N / 2));
		cumSumXY.push(prevCumXY + sumXY);

		// Trim old data to limit memory (keep MAX_LOOKBACK + some buffer)
		const maxLen = MAX_LOOKBACK + 20;
		if (cumSumA.length > maxLen) {
			cumSumA = cumSumA.slice(-maxLen);
			cumSumB = cumSumB.slice(-maxLen);
			cumSumAgree = cumSumAgree.slice(-maxLen);
			cumSumXY = cumSumXY.slice(-maxLen);
		}

		const currentIdx = cumSumA.length - 1;

		// === Find optimal starting points for each channel ===

		// Stream A and B individually (for correlated/anti detection)
		const spA = findOptimalStartingPoint(cumSumA, currentIdx, N);
		const spB = findOptimalStartingPoint(cumSumB, currentIdx, N);

		// Agreement channel
		const spAgree = findOptimalStartingPointAgreement(cumSumAgree, currentIdx, N);

		// Pearson channel
		const spPearson = findOptimalStartingPointPearson(cumSumXY, cumSumA, cumSumB, currentIdx, N);

		// === Compute channel strengths from segments ===
		// Now with directional channels: correlated_high, correlated_low, anti_ab, anti_ba

		// Correlated: both streams deviate in same direction
		let corrHighZ = 0;
		let corrLowZ = 0;
		let corrStart = currentIdx;
		if (spA.z * spB.z > 0) {
			// Same sign - correlated
			const commonStart = Math.max(spA.startIdx, spB.startIdx);
			const tickSpan = currentIdx - commonStart;
			if (tickSpan >= MIN_SEGMENT_LEN) {
				const bitSpan = tickSpan * N;
				const deltaA = (cumSumA[currentIdx] ?? 0) - (cumSumA[commonStart] ?? 0);
				const deltaB = (cumSumB[currentIdx] ?? 0) - (cumSumB[commonStart] ?? 0);
				const zA_seg = deltaA / Math.sqrt(bitSpan);
				const zB_seg = deltaB / Math.sqrt(bitSpan);
				// Strength is the weaker of the two
				const strength = Math.min(Math.abs(zA_seg), Math.abs(zB_seg));
				if (zA_seg > 0 && zB_seg > 0) {
					corrHighZ = strength; // Both toward 1s
				} else {
					corrLowZ = strength; // Both toward 0s
				}
				corrStart = commonStart;
			}
		}

		// Anti-correlated: streams deviate in opposite directions
		let antiAbZ = 0; // A high, B low
		let antiBaZ = 0; // B high, A low
		let antiStart = currentIdx;
		if (spA.z * spB.z < 0) {
			// Opposite sign - anti-correlated
			const commonStart = Math.max(spA.startIdx, spB.startIdx);
			const tickSpan = currentIdx - commonStart;
			if (tickSpan >= MIN_SEGMENT_LEN) {
				const bitSpan = tickSpan * N;
				const deltaA = (cumSumA[currentIdx] ?? 0) - (cumSumA[commonStart] ?? 0);
				const deltaB = (cumSumB[currentIdx] ?? 0) - (cumSumB[commonStart] ?? 0);
				const zA_seg = deltaA / Math.sqrt(bitSpan);
				const zB_seg = deltaB / Math.sqrt(bitSpan);
				// Strength is the weaker magnitude
				const strength = Math.min(Math.abs(zA_seg), Math.abs(zB_seg));
				if (zA_seg > 0 && zB_seg < 0) {
					antiAbZ = strength; // A high, B low
				} else {
					antiBaZ = strength; // B high, A low
				}
				antiStart = commonStart;
			}
		}

		// Stick together
		const stickZ = spAgree.z;
		const stickStart = spAgree.startIdx;

		// Pearson (for visual effect only, not a competing channel)
		const pearsonZ_seg = spPearson.z;
		const pearsonR_seg = spPearson.r;

		// === Convert z-scores to strengths (0..1) ===
		const corrHighRaw = strengthFromZ(corrHighZ);
		const corrLowRaw = strengthFromZ(corrLowZ);
		const antiAbRaw = strengthFromZ(antiAbZ);
		const antiBaRaw = strengthFromZ(antiBaZ);
		const stickRaw = strengthFromZ(stickZ, STICK_Z_START, STICK_Z_FULL);

		// === Update episode states ===
		const EPISODE_DECAY_THRESHOLD = 0.8;

		function updateEpisode(
			channel: Exclude<Channel, 'baseline'>,
			currentZ: number,
			segmentStart: number
		) {
			const ep = episodes[channel];
			const absZ = Math.abs(currentZ);

			if (absZ > EPISODE_Z_THRESHOLD) {
				if (absZ > ep.peakZ) {
					if (ep.peakZ < EPISODE_Z_THRESHOLD) {
						ep.startTick = segmentStart;
					}
					ep.peakZ = absZ;
				}
				ep.currentZ = absZ;
			} else if (ep.peakZ > EPISODE_Z_THRESHOLD && absZ < ep.peakZ * EPISODE_DECAY_THRESHOLD) {
				ep.startTick = currentIdx;
				ep.peakZ = absZ;
				ep.currentZ = absZ;
			} else {
				ep.currentZ = absZ;
			}

			const effectiveZ = ep.peakZ > EPISODE_Z_THRESHOLD ? Math.max(absZ, ep.peakZ * 0.7) : absZ;
			ep.strength = strengthFromZ(effectiveZ, STRENGTH_Z_START, STRENGTH_Z_FULL);
		}

		updateEpisode('correlated_high', corrHighZ, corrStart);
		updateEpisode('correlated_low', corrLowZ, corrStart);
		updateEpisode('anti_ab', antiAbZ, antiStart);
		updateEpisode('anti_ba', antiBaZ, antiStart);
		updateEpisode('stick', stickZ, stickStart);

		// === Smooth stats for HUD ===
		const statsTau = 2800;
		const statsDtMs = 1000 / Math.max(0.25, updatesPerSec);
		const k = 1 - Math.exp(-statsDtMs / statsTau);
		zA = zA + (spA.z - zA) * k;
		zB = zB + (spB.z - zB) * k;
		zAgree = zAgree + (stickZ - zAgree) * k;
		pearsonR = pearsonR + (pearsonR_seg - pearsonR) * k;

		// Build raw channel strengths with demo boost applied
		const raw: Record<Exclude<Channel, 'baseline'>, number> = {
			correlated_high:
				demoChannel === 'correlated_high' ? Math.min(1, corrHighRaw + demoBoost) : corrHighRaw,
			correlated_low:
				demoChannel === 'correlated_low' ? Math.min(1, corrLowRaw + demoBoost) : corrLowRaw,
			anti_ab: demoChannel === 'anti_ab' ? Math.min(1, antiAbRaw + demoBoost) : antiAbRaw,
			anti_ba: demoChannel === 'anti_ba' ? Math.min(1, antiBaRaw + demoBoost) : antiBaRaw,
			stick: demoChannel === 'stick' ? Math.min(1, stickRaw + demoBoost) : stickRaw
		};
		rawLast = raw;

		updateDominant(raw, 1000 / Math.max(0.25, updatesPerSec));

		// Coherence = max channel strength
		coherence = Math.max(
			raw.correlated_high,
			raw.correlated_low,
			raw.anti_ab,
			raw.anti_ba,
			raw.stick
		);

		// Decay demo boost slowly (only when not in active demo mode)
		if (!demoMode) {
			demoBoost *= 0.97;
			if (demoBoost < 0.01) demoBoost = 0;
		}

		// Significance energy (p-value based)
		const dtMs = 1000 / Math.max(0.25, updatesPerSec);
		const pCorrHigh = corrHighZ !== 0 ? twoSidedPFromZ(corrHighZ) : 1;
		const pCorrLow = corrLowZ !== 0 ? twoSidedPFromZ(corrLowZ) : 1;
		const pAntiAb = antiAbZ !== 0 ? twoSidedPFromZ(antiAbZ) : 1;
		const pAntiBa = antiBaZ !== 0 ? twoSidedPFromZ(antiBaZ) : 1;
		const pStick = stickZ !== 0 ? twoSidedPFromZ(stickZ) : 1;
		const pPearson = pearsonZ_seg !== 0 ? twoSidedPFromZ(pearsonZ_seg) : 1;

		const pOverallReal = Math.min(
			COHERENCE_FLOOR,
			pCorrHigh,
			pCorrLow,
			pAntiAb,
			pAntiBa,
			pStick,
			pPearson
		);
		const pOverall =
			demoBoost > 0.05 ? Math.min(pOverallReal, 0.001 * (1 - demoBoost)) : pOverallReal;
		const surprisal = Math.min(6, -Math.log10(pOverall));
		const targetSig = clamp01((surprisal - 0.8) / 4.8);

		const sigTau = targetSig > sigEnergy ? preset.sigEnergyRiseMs : preset.sigEnergyFallMs;
		const sk = 1 - Math.exp(-dtMs / sigTau);
		sigEnergy = sigEnergy + (targetSig - sigEnergy) * sk;

		// Record history
		historyCoherence = [...historyCoherence.slice(-(HISTORY_LEN - 1)), coherence];
		historyDominant = [...historyDominant.slice(-(HISTORY_LEN - 1)), dominant];
		historyPearson = [...historyPearson.slice(-(HISTORY_LEN - 1)), pearsonR];
	}

	function step(dtMs: number) {
		bootMs += dtMs;

		const bootT = clamp01(bootMs / 5000);
		const bootLock = bootT < 1;

		tickBudget += updatesPerSec * (dtMs / 1000);
		let ticks = Math.floor(tickBudget);
		ticks = Math.min(ticks, 8);

		if (!bootLock && ticks > 0) {
			tickBudget -= ticks;
			for (let t = 0; t < ticks; t++) {
				signalTick();
			}
		} else {
			tickBudget = Math.min(2, tickBudget);
			dominant = 'baseline';
			dominance = 0;
			coherence = 0;
			sigEnergy = 0;
			rawLast = { correlated_high: 0, correlated_low: 0, anti_ab: 0, anti_ba: 0, stick: 0 };
			rawRender = { correlated_high: 0, correlated_low: 0, anti_ab: 0, anti_ba: 0, stick: 0 };
		}

		// === Demo Mode Sequencing ===
		if (demoMode) {
			const now = performance.now();
			const elapsed = now - demoStartTime;

			// Smooth envelope: sin²(π * t) peaks at middle, smooth start/end
			const t = Math.min(1, elapsed / DEMO_DURATION_MS);
			const envelope = Math.pow(Math.sin(Math.PI * t), 2);
			const prevEnvelope = demoBoost / 0.85; // Previous envelope value
			demoBoost = 0.85 * envelope;
			demoPearsonBoost = 0.35 * demoPearsonDir * envelope;

			// Trigger significance pulse when envelope crosses 0.5 on the way up
			// This shows the expanding ring effect during each channel's demo
			if (envelope >= 0.5 && prevEnvelope < 0.5) {
				sigPulseStart = now;
			}

			// Force sigEnergy high during demo so core is visible
			sigEnergyRender = envelope * 0.7;

			// Force dominant channel during demo (bypass normal selection)
			dominant = demoChannel;
			dominance = envelope;

			if (elapsed >= DEMO_DURATION_MS) {
				// Move to next channel
				demoIndex++;
				if (demoIndex >= DEMO_CHANNELS.length) {
					// Demo complete
					demoMode = false;
					demoBoost = 0;
					demoPearsonBoost = 0;
					// Reset to baseline after demo
					dominant = 'baseline';
					dominance = 0;
				} else {
					// Advance to next channel
					demoChannel = DEMO_CHANNELS[demoIndex];
					demoPearsonDir = demoPearsonDir === 1 ? -1 : 1; // Alternate direction
					demoStartTime = now;
				}
			}
		}

		// Pearson motion - drives the swirling disc effect
		// Still when |r| < threshold, spins when significant
		{
			const dt = dtMs / 1000;
			const spinTau = 900;
			const sk = 1 - Math.exp(-dtMs / spinTau);

			// Use demo Pearson boost if in demo mode, otherwise use real pearsonR
			const effectivePearson = demoMode ? demoPearsonBoost : pearsonR;
			pearsonSpin = pearsonSpin + (effectivePearson - pearsonSpin) * sk;

			if (!bootLock) {
				// Direction based on sign of pearson
				const flipThreshold = 0.05; // threshold to consider "still"
				if (Math.abs(pearsonSpin) > flipThreshold) {
					pearsonDir = pearsonSpin > 0 ? 1 : -1;
				}
				// else keep previous direction (avoids jitter near zero)
			} else {
				pearsonDir = 1;
			}

			// Speed: still when |r| < 0.05, then ramp up
			const PEARSON_STILL_THRESHOLD = 0.05;
			const mag = Math.max(0, Math.abs(pearsonSpin) - PEARSON_STILL_THRESHOLD);
			const speed = mag > 0 ? 0.08 + 0.35 * Math.pow(mag / (1 - PEARSON_STILL_THRESHOLD), 0.7) : 0;
			pearsonPhase = wrapHue(pearsonPhase + pearsonDir * speed * 360 * dt);
		}

		// Smooth channel strengths
		{
			const riseTau = 1800;
			const fallTau = 4000;
			for (const ch of [
				'correlated_high',
				'correlated_low',
				'anti_ab',
				'anti_ba',
				'stick'
			] as const) {
				const target = rawLast[ch];
				const current = rawRender[ch];
				const tau = target > current ? riseTau : fallTau;
				const k = 1 - Math.exp(-dtMs / tau);
				rawRender[ch] = current + (target - current) * k;
			}
		}

		// Per-frame smoothing of sigEnergy for rendering
		{
			const tau = 600;
			const k = 1 - Math.exp(-dtMs / tau);
			sigEnergyRender = sigEnergyRender + (sigEnergy - sigEnergyRender) * k;
		}

		// Detect significance threshold crossing and trigger pulse
		{
			const now = performance.now();
			const isAbove = sigEnergyRender >= SIG_PULSE_THRESHOLD;
			const cooledDown = now - sigPulseLastTime >= SIG_PULSE_COOLDOWN;

			// Trigger pulse on upward crossing (was below, now above) with cooldown
			if (isAbove && !sigWasAboveThreshold && cooledDown && !bootLock) {
				sigPulseStart = now;
				sigPulseLastTime = now;
			}

			sigWasAboveThreshold = isAbove;

			// Clear pulse after duration
			if (sigPulseStart > 0 && now - sigPulseStart >= SIG_PULSE_DURATION) {
				sigPulseStart = 0;
			}
		}

		// Baseline hue wandering
		if (dominant === 'baseline') {
			const nowMs = performance.now();
			if (baselineHueNextAtMs === 0) {
				baselineHueTarget = 205;
				baselineHueNextAtMs = nowMs + 15000;
			}
			if (nowMs >= baselineHueNextAtMs) {
				// Pick from channel hues for wandering
				const picks = [180, 210, 35, 8, 112, 205];
				baselineHueTarget = picks[Math.floor(Math.random() * picks.length)];
				baselineHueNextAtMs = nowMs + 12000 + Math.random() * 22000;
			}
		}

		// Hue smoothing - uses mode preset, faster during demo
		const baseHue = dominant === 'baseline' ? baselineHueTarget : palette[dominant].hue;
		// Use much faster hue transition during demo mode for snappy color changes
		const hueTau = demoMode ? 400 : dominant === 'baseline' ? 14000 : preset.hueTauMs;
		const hk = 1 - Math.exp(-dtMs / hueTau);
		hueSmooth = hueApproach(hueSmooth, baseHue, hk);

		// Saturation smoothing
		const baseSat = dominant === 'baseline' ? 52 : 80;
		const satTarget = baseSat + preset.saturationBoost;
		const sk = 1 - Math.exp(-dtMs / preset.satTauMs);
		satSmooth = satSmooth + (satTarget - satSmooth) * sk;

		if (renderMode === 'orb') {
			renderOrb(rawRender);
		} else {
			renderSignal();
		}
	}

	// === Resize ===
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

	// === Signal Mode Render (Boring Mode) ===
	function renderSignal() {
		const w = bufCanvas.width;
		const h = bufCanvas.height;
		const ctx = bufCtx;

		ctx.save();
		ctx.fillStyle = '#05060a';
		ctx.fillRect(0, 0, w, h);

		const cx = w * 0.5;
		const cy = h * 0.35;
		const r = Math.min(w, h) * 0.18;

		// Simple brightness circle based on sigEnergy
		const brightness = 0.1 + 0.9 * sigEnergyRender;
		const hue = hueSmooth;

		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.closePath();

		const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
		g.addColorStop(
			0,
			`hsla(${hue} 60% ${Math.round(20 + 50 * brightness)}% / ${0.6 + 0.4 * brightness})`
		);
		g.addColorStop(
			0.7,
			`hsla(${hue} 50% ${Math.round(15 + 30 * brightness)}% / ${0.3 + 0.4 * brightness})`
		);
		g.addColorStop(1, `hsla(${hue} 40% 10% / 0.1)`);
		ctx.fillStyle = g;
		ctx.fill();

		// Outer glow
		ctx.filter = 'blur(20px)';
		ctx.globalCompositeOperation = 'screen';
		const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.5);
		glow.addColorStop(0, `hsla(${hue} 50% 50% / ${0.2 * brightness})`);
		glow.addColorStop(1, 'transparent');
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, w, h);
		ctx.filter = 'none';
		ctx.globalCompositeOperation = 'source-over';

		// Strip chart
		const chartY = h * 0.58;
		const chartH = h * 0.32;
		const chartX = w * 0.1;
		const chartW = w * 0.8;

		// Chart background
		ctx.fillStyle = 'rgba(255,255,255,0.03)';
		ctx.fillRect(chartX, chartY, chartW, chartH);
		ctx.strokeStyle = 'rgba(255,255,255,0.1)';
		ctx.lineWidth = 1;
		ctx.strokeRect(chartX, chartY, chartW, chartH);

		// Grid lines at 25%, 50%, 75%
		ctx.strokeStyle = 'rgba(255,255,255,0.05)';
		for (const frac of [0.25, 0.5, 0.75]) {
			const y = chartY + chartH * (1 - frac);
			ctx.beginPath();
			ctx.moveTo(chartX, y);
			ctx.lineTo(chartX + chartW, y);
			ctx.stroke();
		}

		// Draw coherence history (yellow)
		if (historyCoherence.length > 1) {
			ctx.strokeStyle = 'rgba(255, 220, 100, 0.7)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			for (let i = 0; i < historyCoherence.length; i++) {
				const x = chartX + (i / (HISTORY_LEN - 1)) * chartW;
				const y = chartY + chartH * (1 - historyCoherence[i]);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.stroke();
		}

		// Draw Pearson history (cyan)
		if (historyPearson.length > 1) {
			ctx.strokeStyle = 'rgba(100, 220, 255, 0.7)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			for (let i = 0; i < historyPearson.length; i++) {
				const x = chartX + (i / (HISTORY_LEN - 1)) * chartW;
				// Pearson ranges -1 to 1, map to 0-1 for display
				const y = chartY + chartH * (1 - (historyPearson[i] + 1) / 2);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.stroke();
		}

		// Labels
		ctx.fillStyle = 'rgba(255, 220, 100, 0.8)';
		ctx.font = '12px monospace';
		ctx.fillText('coherence', chartX + 4, chartY + 14);
		ctx.fillStyle = 'rgba(100, 220, 255, 0.8)';
		ctx.fillText('pearson', chartX + 80, chartY + 14);

		// Time labels
		ctx.fillStyle = 'rgba(255,255,255,0.4)';
		ctx.font = '10px monospace';
		ctx.fillText('-3m', chartX, chartY + chartH + 12);
		ctx.fillText('-2m', chartX + chartW * 0.33, chartY + chartH + 12);
		ctx.fillText('-1m', chartX + chartW * 0.67, chartY + chartH + 12);
		ctx.fillText('now', chartX + chartW - 20, chartY + chartH + 12);

		ctx.restore();

		// Blit to main canvas
		const out = canvasEl.getContext('2d');
		if (!out) return;
		out.save();
		out.imageSmoothingEnabled = true;
		out.clearRect(0, 0, canvasEl.width, canvasEl.height);
		out.drawImage(bufCanvas, 0, 0, canvasEl.width, canvasEl.height);
		out.restore();
	}

	// === Orb Mode Render ===
	function renderOrb(raw: Record<Exclude<Channel, 'baseline'>, number>) {
		const w = bufCanvas.width;
		const h = bufCanvas.height;
		const t = performance.now() / 1000;

		const ctx = bufCtx;
		ctx.save();
		ctx.clearRect(0, 0, w, h);

		// Dark base
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
		const sig = sigEnergyRender; // sigEnergy (statistical significance) for brightness

		const cx = w * 0.5;
		const cy = h * 0.54;
		const rFull = Math.min(w, h) * 0.42;
		const rBoot = rFull * (0.06 + 0.94 * smoothstep(0, 1, bootT));
		const r = bootLock ? rBoot : rFull;

		let hue = hueSmooth;
		let sat = satSmooth;

		const polarity = Math.max(-1, Math.min(1, (zA + zB) / 6));
		hue = (hue + polarity * 10 + 6 * Math.sin(t * 0.08) + 3 * Math.sin(t * 0.13 + 1.7)) % 360;

		// Whitening based on significance energy (replaces old stage system)
		const whiten = smoothstep(0.3, 0.8, sig) * 0.5;

		// Brightness now driven by statistical significance (sigEnergy)
		// More aggressive curve: very dim at baseline, dramatic when significant
		const sigVis = Math.max(sig, 0.03); // small floor to avoid total darkness
		const brightness = (0.08 + 0.92 * Math.pow(sigVis, 1.3)) * preset.maxBrightness;
		const orbAlpha = 0.5 + 0.4 * brightness;

		// Orb with clip
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

		// Main body
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

		// Secondary layer
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

		// Stage 2/3 whitening
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

		// Significance core - enhanced when above threshold
		if (!bootLock && sigEnergyRender > 0.001) {
			const s = Math.pow(sigEnergyRender, 0.85);
			// Larger core when above threshold
			const isSignificant = sigEnergyRender >= SIG_PULSE_THRESHOLD;
			const coreR = r * (0.08 + (isSignificant ? 0.45 : 0.32) * s);
			const coreBlur = Math.max(8, 20 - 8 * s + 6 * brightness);

			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			// More prominent alpha when significant
			const baseAlpha = isSignificant ? 0.12 + 0.55 * s : 0.06 + 0.38 * s;
			ctx.globalAlpha = baseAlpha * (0.75 + 0.25 * brightness);
			ctx.filter = `blur(${coreBlur}px)`;

			const cg = ctx.createRadialGradient(cx, cy, coreR * 0.05, cx, cy, coreR);
			// Brighter, warmer core when significant
			if (isSignificant) {
				cg.addColorStop(0, 'rgba(255, 252, 245, 1.0)');
				cg.addColorStop(0.18, 'rgba(255, 248, 235, 0.85)');
				cg.addColorStop(0.45, 'rgba(255, 245, 230, 0.45)');
				cg.addColorStop(0.75, 'rgba(240, 248, 255, 0.15)');
				cg.addColorStop(1, 'rgba(255, 255, 255, 0)');
			} else {
				cg.addColorStop(0, 'rgba(255, 245, 232, 0.95)');
				cg.addColorStop(0.22, 'rgba(255, 238, 218, 0.65)');
				cg.addColorStop(0.55, 'rgba(220, 240, 255, 0.22)');
				cg.addColorStop(1, 'rgba(255, 255, 255, 0)');
			}
			ctx.fillStyle = cg;
			ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

			ctx.restore();
		}

		// Significance pulse - expanding ring on threshold crossing
		if (sigPulseStart > 0) {
			const now = performance.now();
			const elapsed = now - sigPulseStart;
			const t = Math.min(1, elapsed / SIG_PULSE_DURATION);

			// Ease out for smooth deceleration
			const easeOut = 1 - Math.pow(1 - t, 2);

			// Ring expands from center to edge
			const ringRadius = r * (0.1 + 0.9 * easeOut);
			const ringWidth = r * 0.12 * (1 - t * 0.5); // Thins slightly as it expands

			// Fade out as it expands
			const ringAlpha = (1 - t) * 0.7;

			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = ringAlpha;
			ctx.filter = `blur(${8 + 12 * t}px)`; // Gets softer as it expands

			// Draw ring as a stroked arc
			ctx.beginPath();
			ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
			ctx.strokeStyle = 'rgba(255, 252, 245, 0.9)';
			ctx.lineWidth = ringWidth;
			ctx.stroke();

			ctx.restore();
		}

		// Boot CRT effect
		if (bootLock) {
			const ignition = 1 - bootT;
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.55 * ignition;
			ctx.filter = 'blur(22px)';

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

		// Pearson swirling disc effect (replaces old ring)
		// Creates a spinning water/record effect when |pearsonR| > threshold
		{
			const PEARSON_VIS_THRESHOLD = 0.05;
			const pMag = Math.abs(pearsonSpin);

			if (!bootLock && pMag > PEARSON_VIS_THRESHOLD) {
				// Strength of swirl effect based on |r|
				const swirlStrength = smoothstep(PEARSON_VIS_THRESHOLD, 0.4, pMag);
				const swirlPhase = (pearsonPhase / 360) * Math.PI * 2;

				ctx.globalCompositeOperation = 'soft-light';
				ctx.globalAlpha = 0.25 + 0.35 * swirlStrength;
				ctx.filter = `blur(${Math.max(8, 16 - 6 * swirlStrength)}px)`;

				const maybeConic = (
					ctx as unknown as {
						createConicGradient?: (a: number, x: number, y: number) => CanvasGradient;
					}
				).createConicGradient;

				if (typeof maybeConic === 'function') {
					// Swirling water effect with light/dark bands
					const cg = maybeConic.call(ctx, swirlPhase, cx, cy);
					// Light/dark bands like swirling water or a vinyl record
					const bandCount = 4; // Number of light/dark pairs
					for (let i = 0; i <= bandCount; i++) {
						const pos = i / bandCount;
						const isLight = i % 2 === 0;
						if (isLight) {
							cg.addColorStop(pos, `rgba(255, 255, 255, ${0.3 + 0.2 * swirlStrength})`);
						} else {
							cg.addColorStop(pos, `rgba(0, 0, 0, ${0.15 + 0.1 * swirlStrength})`);
						}
					}
					ctx.fillStyle = cg;
					ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
				} else {
					// Fallback: simple rotating gradient
					const angle = swirlPhase;
					const x1 = cx + Math.cos(angle) * r;
					const y1 = cy + Math.sin(angle) * r;
					const x2 = cx - Math.cos(angle) * r;
					const y2 = cy - Math.sin(angle) * r;
					const lg = ctx.createLinearGradient(x1, y1, x2, y2);
					lg.addColorStop(0, `rgba(255, 255, 255, ${0.25 * swirlStrength})`);
					lg.addColorStop(0.5, `rgba(0, 0, 0, ${0.1 * swirlStrength})`);
					lg.addColorStop(1, `rgba(255, 255, 255, ${0.25 * swirlStrength})`);
					ctx.fillStyle = lg;
					ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
				}

				ctx.globalAlpha = 1;
				ctx.filter = 'none';
				ctx.globalCompositeOperation = 'source-over';
			}
		}

		ctx.restore();

		// Outer glow
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

		// Vignette
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

		ctx.restore();

		// Blit
		const out = canvasEl.getContext('2d');
		if (!out) return;
		out.save();
		out.imageSmoothingEnabled = true;
		out.clearRect(0, 0, canvasEl.width, canvasEl.height);
		out.drawImage(bufCanvas, 0, 0, canvasEl.width, canvasEl.height);
		out.restore();
	}

	// === Keyboard Handling ===
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
		// B = toggle render mode (boring/orb)
		if (e.key === 'b' || e.key === 'B') {
			renderMode = renderMode === 'orb' ? 'signal' : 'orb';
			return;
		}
		// M = toggle light mode (wow/mellow)
		if (e.key === 'm' || e.key === 'M') {
			lightMode = lightMode === 'wow' ? 'mellow' : 'wow';
			return;
		}
		// 1-5 = set response speed
		if (e.key >= '1' && e.key <= '5') {
			responseSpeed = parseInt(e.key) as 1 | 2 | 3 | 4 | 5;
			return;
		}
		// D = toggle demo mode (auto-cycling showcase)
		if (e.key === 'd' || e.key === 'D') {
			if (demoMode) {
				// Stop demo
				demoMode = false;
				demoBoost = 0;
				demoPearsonBoost = 0;
			} else {
				// Start demo - envelope will calculate boost values each frame
				demoMode = true;
				demoIndex = 0;
				demoChannel = DEMO_CHANNELS[0];
				demoPearsonDir = 1;
				demoBoost = 0;
				demoPearsonBoost = 0;
				demoStartTime = performance.now();
			}
			return;
		}
		if (e.key === 'Escape') {
			if (demoMode) {
				demoMode = false;
				demoBoost = 0;
				demoPearsonBoost = 0;
			} else if (showSettings) {
				showSettings = false;
			}
		}
	}

	// === Lifecycle ===
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
				<div class="hud-mode">
					{lightMode === 'wow' ? 'Wow' : 'Mellow'} | Speed {responseSpeed}
				</div>
			</div>

			<div class="hud-row">
				<span class="k">Dominant</span>
				<span class="v">{dominant === 'baseline' ? 'Baseline' : palette[dominant].name}</span>
			</div>
			<div class="hud-row">
				<span class="k">Coherence</span>
				<span class="v">{(coherence * 100).toFixed(1)}%</span>
			</div>
			<div class="hud-row">
				<span class="k">Significance</span>
				<span class="v">{(sigEnergy * 100).toFixed(1)}%</span>
			</div>
			<div class="hud-row">
				<span class="k">zA / zB</span>
				<span class="v">{zA.toFixed(2)} / {zB.toFixed(2)}</span>
			</div>
			<div class="hud-row">
				<span class="k">Pearson r</span>
				<span class="v">{pearsonR.toFixed(3)}</span>
			</div>
			<div class="hud-row">
				<span class="k">Agree z</span>
				<span class="v">{zAgree.toFixed(2)}</span>
			</div>
			<div class="hud-row">
				<span class="k">Tick</span>
				<span class="v">{tickCount}</span>
			</div>
			<div class="hud-row">
				<span class="k">FPS</span>
				<span class="v">{fps.toFixed(0)}</span>
			</div>

			{#if dominant !== 'baseline' && episodes[dominant]}
				{@const ep = episodes[dominant]}
				{@const duration = tickCount > 0 ? Math.max(0, cumSumA.length - 1 - ep.startTick) : 0}
				<div class="hud-row episode">
					<span class="k">Episode</span>
					<span class="v">{duration}s | peak z={ep.peakZ.toFixed(2)}</span>
				</div>
			{/if}

			{#if demoBoost > 0.01 && !demoMode}
				<div class="hud-row demo">
					<span class="k">Demo Boost</span>
					<span class="v">{(demoBoost * 100).toFixed(0)}%</span>
				</div>
			{/if}

			<div class="hud-actions">
				<button
					class="hud-btn"
					type="button"
					onclick={() => (lightMode = lightMode === 'wow' ? 'mellow' : 'wow')}
					title="Toggle wow/mellow (M)"
				>
					{lightMode === 'wow' ? 'Mellow' : 'Wow'}
				</button>
				<button
					class="hud-btn"
					type="button"
					onclick={() => (showLegend = !showLegend)}
					title="Toggle legend (L)"
				>
					Legend
				</button>
				<button
					class="hud-btn"
					type="button"
					onclick={() => (renderMode = renderMode === 'orb' ? 'signal' : 'orb')}
					title="Toggle render (B)"
				>
					{renderMode === 'orb' ? 'Signal' : 'Orb'}
				</button>
			</div>

			{#if showLegend}
				<div class="legend">
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.correlated_high.hue}`}></span> Cyan: Both high
						(1s)
					</div>
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.correlated_low.hue}`}></span> Blue: Both low (0s)
					</div>
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.anti_ab.hue}`}></span> Orange: A high, B low
					</div>
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.anti_ba.hue}`}></span> Coral: B high, A low
					</div>
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.stick.hue}`}></span> Green: Stick together
					</div>
					<div class="legend-row">
						<span class="swatch" style="--h:0; background: linear-gradient(90deg, #fff, #888, #fff)"
						></span> Spin: Pearson (+ clockwise, - counter)
					</div>
				</div>
			{/if}

			{#if showSettings}
				<div class="sep"></div>
				<div class="controls">
					<label>
						<span>Updates/sec</span>
						<input bind:value={updatesPerSec} type="range" min="1" max="5" step="1" />
						<span class="mono">{updatesPerSec}</span>
					</label>
				</div>
			{/if}

			<div class="hint mono">
				H: HUD &nbsp; M: mode &nbsp; 1-5: speed &nbsp; D: demo &nbsp; B: render &nbsp; R: reset
				&nbsp; F: fullscreen &nbsp; S: settings &nbsp; L: legend
			</div>
		</section>
	{/if}

	<!-- Demo mode overlay with big labels -->
	{#if demoMode}
		<div class="demo-overlay">
			<div class="demo-label-main">{DEMO_LABELS[demoChannel]}</div>
			<div class="demo-label-pearson">
				{demoPearsonDir === 1 ? 'Pearson+  (clockwise)' : 'Pearson−  (counter-clockwise)'}
			</div>
			<div class="demo-progress">
				{demoIndex + 1} / {DEMO_CHANNELS.length}
			</div>
		</div>
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
		width: min(380px, calc(100vw - 36px));
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
		gap: 8px;
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

	.hud-mode {
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

	.hud-row.demo {
		color: rgba(255, 200, 100, 0.9);
	}

	.hud-row.episode {
		color: rgba(180, 220, 255, 0.9);
	}

	/* Demo mode overlay */
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
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
	}

	.hint {
		margin-top: 6px;
		opacity: 0.65;
		font-size: 11px;
	}
</style>
