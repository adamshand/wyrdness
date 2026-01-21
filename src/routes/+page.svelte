<script lang="ts">
	import { onMount } from 'svelte';

	type Stage = 1 | 2 | 3;
	type Channel = 'baseline' | 'correlated' | 'anti' | 'stick' | 'pearson';
	type RenderMode = 'orb' | 'signal';

	let canvasEl: HTMLCanvasElement;

	// === UI State ===
	let showHud = $state(true);
	let showSettings = $state(false);
	let showLegend = $state(false);
	let renderMode = $state<RenderMode>('orb');

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
	let stage = $state<Stage>(1);
	let stageEnergy = $state(0);
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
	let pearsonFlip = $state(0);
	let zAgree = $state(0);

	let dominant = $state<Channel>('baseline');
	let dominance = $state(0);

	let fps = $state(0);

	// === Cheat / Debug ===
	let cheatBoost = $state(0); // injected fake coherence (0..1), decays slowly
	let cheatChannel = $state<Exclude<Channel, 'baseline'>>('correlated'); // which channel the cheat "looks like"

	// === History for strip chart (last 180 seconds at 1Hz) ===
	const HISTORY_LEN = 180;
	let historyCoherence: number[] = $state([]);
	let historyStageEnergy: number[] = $state([]);
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
	let episodes = $state<Record<Exclude<Channel, 'baseline'>, EpisodeState>>({
		correlated: { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 },
		anti: { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 },
		stick: { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 },
		pearson: { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 }
	});

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

	// Render-smoothed versions (updated every frame, not just on ticks)
	let stageEnergyRender = 0;
	let sigEnergyRender = 0;

	let bufCanvas: HTMLCanvasElement;
	let bufCtx: CanvasRenderingContext2D;
	let renderScale = 0.75;

	const palette: Record<Exclude<Channel, 'baseline'>, { hue: number; name: string }> = {
		correlated: { hue: 186, name: 'Correlated' },
		anti: { hue: 24, name: 'Anti' },
		stick: { hue: 112, name: 'Stick' },
		pearson: { hue: 252, name: 'Pearson' }
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
		pearsonFlip = 0;
		zAgree = 0;

		coherence = 0;
		stageEnergy = 0;
		sigEnergy = 0;
		stage = 1;
		tickBudget = 0;

		dominant = 'baseline';
		dominance = 0;
		hueSmooth = 205;

		cheatBoost = 0;
		bootMs = 0;

		// Reset cumulative deviation state
		cumSumA = [0]; // Start with 0 at tick 0
		cumSumB = [0];
		cumSumAgree = [0];
		cumSumXY = [0];
		tickCount = 0;

		// Reset episode states
		episodes = {
			correlated: { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 },
			anti: { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 },
			stick: { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 },
			pearson: { startTick: 0, peakZ: 0, currentZ: 0, strength: 0 }
		};

		// Clear history
		historyCoherence = [];
		historyStageEnergy = [];
		historyDominant = [];
		historyPearson = [];
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

		const switchMargin = 0.08;
		const keepBonus = 0.04;

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

	function computeStageFromEnergy(e: number, prev: Stage): Stage {
		if (prev === 1) return e > 0.42 ? 2 : 1;
		if (prev === 2) {
			if (e > 0.78) return 3;
			return e < 0.34 ? 1 : 2;
		}
		return e < 0.68 ? 2 : 3;
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

		// Correlated: both streams deviate in same direction
		// We check if the optimal segments for A and B overlap and agree in sign
		let corrZ = 0;
		let corrStart = currentIdx;
		if (spA.z * spB.z > 0) {
			// Same sign - correlated
			// Use the more recent starting point (more conservative segment)
			const commonStart = Math.max(spA.startIdx, spB.startIdx);
			const tickSpan = currentIdx - commonStart;
			if (tickSpan >= MIN_SEGMENT_LEN) {
				const bitSpan = tickSpan * N;
				const deltaA = (cumSumA[currentIdx] ?? 0) - (cumSumA[commonStart] ?? 0);
				const deltaB = (cumSumB[currentIdx] ?? 0) - (cumSumB[commonStart] ?? 0);
				const zA_seg = deltaA / Math.sqrt(bitSpan);
				const zB_seg = deltaB / Math.sqrt(bitSpan);
				// Correlated strength is the weaker of the two
				corrZ = Math.sign(zA_seg) * Math.min(Math.abs(zA_seg), Math.abs(zB_seg));
				corrStart = commonStart;
			}
		}

		// Anti-correlated: streams deviate in opposite directions
		let antiZ = 0;
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
				// Anti strength is the weaker magnitude
				antiZ = Math.min(Math.abs(zA_seg), Math.abs(zB_seg));
				antiStart = commonStart;
			}
		}

		// Stick together
		const stickZ = spAgree.z;
		const stickStart = spAgree.startIdx;

		// Pearson
		const pearsonZ_seg = spPearson.z;
		const pearsonR_seg = spPearson.r;
		const pearsonStart = spPearson.startIdx;

		// === Convert z-scores to strengths (0..1) ===
		const corrRaw = strengthFromZ(corrZ);
		const antiRaw = strengthFromZ(antiZ);
		const stickRaw = strengthFromZ(stickZ, STICK_Z_START, STICK_Z_FULL);
		const pearsonRaw = clamp01(
			(Math.abs(pearsonR_seg) - PEARSON_R_START) / (PEARSON_R_FULL - PEARSON_R_START)
		);

		// === Update episode states ===
		// Episodes have persistence: once started, they continue until z drops significantly
		const EPISODE_DECAY_THRESHOLD = 0.8; // Episode ends when z drops to this fraction of peak

		function updateEpisode(
			channel: Exclude<Channel, 'baseline'>,
			currentZ: number,
			segmentStart: number
		) {
			const ep = episodes[channel];
			const absZ = Math.abs(currentZ);

			if (absZ > EPISODE_Z_THRESHOLD) {
				// Strong signal - we're in an episode
				if (absZ > ep.peakZ) {
					// New peak - might be start of new episode or continuation
					if (ep.peakZ < EPISODE_Z_THRESHOLD) {
						// Starting fresh episode
						ep.startTick = segmentStart;
					}
					ep.peakZ = absZ;
				}
				ep.currentZ = absZ;
			} else if (ep.peakZ > EPISODE_Z_THRESHOLD && absZ < ep.peakZ * EPISODE_DECAY_THRESHOLD) {
				// Episode has decayed - reset
				ep.startTick = currentIdx;
				ep.peakZ = absZ;
				ep.currentZ = absZ;
			} else {
				// Maintain current episode state but update currentZ
				ep.currentZ = absZ;
			}

			// Compute strength: use peak z during active episode for stability
			const effectiveZ = ep.peakZ > EPISODE_Z_THRESHOLD ? Math.max(absZ, ep.peakZ * 0.7) : absZ;
			ep.strength = strengthFromZ(effectiveZ, STRENGTH_Z_START, STRENGTH_Z_FULL);
		}

		updateEpisode('correlated', corrZ, corrStart);
		updateEpisode('anti', antiZ, antiStart);
		updateEpisode('stick', stickZ, stickStart);
		updateEpisode('pearson', pearsonZ_seg, pearsonStart);

		// === Smooth stats for HUD ===
		const statsTau = 2800;
		const statsDtMs = 1000 / Math.max(0.25, updatesPerSec);
		const k = 1 - Math.exp(-statsDtMs / statsTau);
		zA = zA + (spA.z - zA) * k;
		zB = zB + (spB.z - zB) * k;
		zAgree = zAgree + (stickZ - zAgree) * k;
		pearsonR = pearsonR + (pearsonR_seg - pearsonR) * k;

		// Apply cheat boost to the selected channel so it affects dominance/color
		const raw = {
			correlated: cheatChannel === 'correlated' ? Math.min(1, corrRaw + cheatBoost) : corrRaw,
			anti: cheatChannel === 'anti' ? Math.min(1, antiRaw + cheatBoost) : antiRaw,
			stick: cheatChannel === 'stick' ? Math.min(1, stickRaw + cheatBoost) : stickRaw,
			pearson: cheatChannel === 'pearson' ? Math.min(1, pearsonRaw + cheatBoost) : pearsonRaw
		};
		rawLast = raw;

		updateDominant(raw, 1000 / Math.max(0.25, updatesPerSec));

		// Coherence = max channel strength (cheat is already folded into raw)
		const base = Math.max(raw.correlated, raw.anti, raw.stick, raw.pearson);
		coherence = base;

		// Decay cheat boost slowly (0.97 per tick at 1Hz = ~23 ticks to halve ≈ 23 seconds)
		cheatBoost *= 0.97;
		if (cheatBoost < 0.01) cheatBoost = 0;

		// Stage energy integrator (slow rise, slower fall)
		const riseMs = 2600;
		const fallMs = 4200;
		const dtMs = 1000 / Math.max(0.25, updatesPerSec);
		const tau = coherence > stageEnergy ? riseMs : fallMs;
		const ek = 1 - Math.exp(-dtMs / tau);
		stageEnergy = stageEnergy + (coherence - stageEnergy) * ek;
		stage = computeStageFromEnergy(stageEnergy, stage);

		// Significance energy (p-value based) - now using segment z-scores
		const pCorr = corrZ !== 0 ? twoSidedPFromZ(corrZ) : 1;
		const pAnti = antiZ !== 0 ? twoSidedPFromZ(antiZ) : 1;
		const pStick = stickZ !== 0 ? twoSidedPFromZ(stickZ) : 1;
		const pPearson = pearsonZ_seg !== 0 ? twoSidedPFromZ(pearsonZ_seg) : 1;

		// If cheat is active, fake a low p-value to drive sigEnergy
		const pOverallReal = Math.min(COHERENCE_FLOOR, Math.min(pCorr, pAnti, pStick, pPearson));
		const pOverall =
			cheatBoost > 0.05 ? Math.min(pOverallReal, 0.001 * (1 - cheatBoost)) : pOverallReal;
		const surprisal = Math.min(6, -Math.log10(pOverall));
		const targetSig = clamp01((surprisal - 0.8) / 4.8);

		const sigRiseMs = 1400;
		const sigFallMs = 2600;
		const sigTau = targetSig > sigEnergy ? sigRiseMs : sigFallMs;
		const sk = 1 - Math.exp(-dtMs / sigTau);
		sigEnergy = sigEnergy + (targetSig - sigEnergy) * sk;

		// Record history
		historyCoherence = [...historyCoherence.slice(-(HISTORY_LEN - 1)), coherence];
		historyStageEnergy = [...historyStageEnergy.slice(-(HISTORY_LEN - 1)), stageEnergy];
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
			stageEnergy = 0;
			sigEnergy = 0;
			stage = 1;
			rawLast = { correlated: 0, anti: 0, stick: 0, pearson: 0 };
			rawRender = { correlated: 0, anti: 0, stick: 0, pearson: 0 };
		}

		// Pearson motion
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

		// Smooth channel strengths more aggressively to eliminate flicker
		// Use asymmetric smoothing: rise can be a bit faster than fall
		{
			const riseTau = 1800; // ~1.8s to rise
			const fallTau = 4000; // ~4s to fall
			for (const ch of ['correlated', 'anti', 'stick', 'pearson'] as const) {
				const target = rawLast[ch];
				const current = rawRender[ch];
				const tau = target > current ? riseTau : fallTau;
				const k = 1 - Math.exp(-dtMs / tau);
				rawRender[ch] = current + (target - current) * k;
			}
		}

		// Per-frame smoothing of stageEnergy and sigEnergy for rendering
		// This eliminates the "stepping" when signal ticks update the values
		{
			const tau = 600; // fast follow, but still smooths out the discrete ticks
			const k = 1 - Math.exp(-dtMs / tau);
			stageEnergyRender = stageEnergyRender + (stageEnergy - stageEnergyRender) * k;
			sigEnergyRender = sigEnergyRender + (sigEnergy - sigEnergyRender) * k;
		}

		// Baseline hue wandering
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

		// Hue smoothing
		const baseHue = dominant === 'baseline' ? baselineHueTarget : palette[dominant].hue;
		const hueTau = dominant === 'baseline' ? 14000 : 9000;
		const hk = 1 - Math.exp(-dtMs / hueTau);
		hueSmooth = hueApproach(hueSmooth, baseHue, hk);

		// Saturation smoothing
		const satTarget = dominant === 'baseline' ? 52 : dominant === 'pearson' ? 72 : 80;
		const satTau = 9000;
		const sk = 1 - Math.exp(-dtMs / satTau);
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

		// Simple brightness circle based on stageEnergy
		const brightness = 0.1 + 0.9 * stageEnergyRender;
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

		// Draw stageEnergy history (cyan)
		if (historyStageEnergy.length > 1) {
			ctx.strokeStyle = 'rgba(100, 220, 255, 0.7)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			for (let i = 0; i < historyStageEnergy.length; i++) {
				const x = chartX + (i / (HISTORY_LEN - 1)) * chartW;
				const y = chartY + chartH * (1 - historyStageEnergy[i]);
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
		ctx.fillText('stageEnergy', chartX + 80, chartY + 14);

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
		const e = stageEnergyRender; // Use smoothed version for rendering

		const cx = w * 0.5;
		const cy = h * 0.54;
		const rFull = Math.min(w, h) * 0.42;
		const rBoot = rFull * (0.06 + 0.94 * smoothstep(0, 1, bootT));
		const r = bootLock ? rBoot : rFull;

		let hue = hueSmooth;
		let sat = satSmooth;

		const polarity = Math.max(-1, Math.min(1, (zA + zB) / 6));
		hue = (hue + polarity * 10 + 6 * Math.sin(t * 0.08) + 3 * Math.sin(t * 0.13 + 1.7)) % 360;

		const whitenStage2 = smoothstep(0.36, 0.78, e) * 0.62;
		const sheen = stage === 3 ? smoothstep(0.68, 0.98, e) : 0;
		const whitenStage3 = stage === 3 ? 0.62 + sheen * 0.12 : 0;
		const whiten = stage === 1 ? 0 : stage === 2 ? whitenStage2 : whitenStage3;

		const eVis = Math.max(e, 0.08);
		const brightness = 0.16 + 0.95 * Math.pow(eVis, 0.86);
		const orbAlpha = 0.6 + 0.3 * brightness;

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

		// Significance core
		if (!bootLock && sigEnergyRender > 0.001) {
			const s = Math.pow(sigEnergyRender, 0.85);
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

		// Stage 3 iridescence
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

		// Pearson ring
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
					(0.06 + 0.18 * pStrength) * (0.5 + 0.5 * stageEnergyRender) * (1 + 0.45 * pearsonFlip);
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
					const g1 = ctx.createLinearGradient(cx - outerR, cy - outerR, cx + outerR, cy + outerR);
					g1.addColorStop(0, 'rgba(255,240,250,0.55)');
					g1.addColorStop(0.5, 'rgba(200,240,255,0.35)');
					g1.addColorStop(1, 'rgba(240,255,220,0.45)');
					ctx.fillStyle = g1;
					ctx.fillRect(cx - outerR - 2, cy - outerR - 2, (outerR + 2) * 2, (outerR + 2) * 2);
				}

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
		// C = cheat: inject fake coherence spike
		if (e.key === 'c' || e.key === 'C') {
			cheatBoost = Math.min(1, cheatBoost + 0.6);
			return;
		}
		if (e.key === 'Escape' && showSettings) {
			showSettings = false;
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
				<div class="hud-mode">{renderMode === 'orb' ? 'Orb' : 'Signal'} | Stage {stage}</div>
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
				<span class="k">Stage Energy</span>
				<span class="v">{(stageEnergy * 100).toFixed(1)}%</span>
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

			{#if cheatBoost > 0.01}
				<div class="hud-row cheat">
					<span class="k">Cheat Boost</span>
					<span class="v">{(cheatBoost * 100).toFixed(0)}%</span>
				</div>
			{/if}

			<div class="hud-actions">
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
					title="Toggle mode (B)"
				>
					{renderMode === 'orb' ? 'Signal Mode' : 'Orb Mode'}
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
						<span class="swatch" style={`--h:${palette.stick.hue}`}></span> Green: "Stick together" (rarer)
					</div>
					<div class="legend-row">
						<span class="swatch" style={`--h:${palette.pearson.hue}`}></span> Pearl ring: Pearson correlation
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
				H: HUD &nbsp; B: mode &nbsp; C: cheat &nbsp; R: reset &nbsp; F: fullscreen &nbsp; S:
				settings &nbsp; L: legend
			</div>
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

	.hud-row.cheat {
		color: rgba(255, 200, 100, 0.9);
	}

	.hud-row.episode {
		color: rgba(180, 220, 255, 0.9);
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
