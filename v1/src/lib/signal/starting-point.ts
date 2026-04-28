export function findOptimalStartingPoint(
	cumSum: number[],
	currentIdx: number,
	bitsPerTick: number,
	lookback: number,
	minLen: number
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
		// For +-1 bits, variance per bit is 1, so variance over N bits is N
		const z = delta / Math.sqrt(bitSpan);

		if (Math.abs(z) > Math.abs(bestZ)) {
			bestZ = z;
			bestStart = s;
		}
	}

	return { startIdx: bestStart, z: bestZ };
}

export function findOptimalStartingPointAgreement(
	cumSum: number[],
	currentIdx: number,
	bitsPerTick: number,
	lookback: number,
	minLen: number
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

		// Only consider positive z (more agreement than chance).
		// Negative z means disagreement, which is not "stick together".
		if (z > bestZ) {
			bestZ = z;
			bestStart = s;
		}
	}

	return { startIdx: bestStart, z: bestZ };
}

/**
 * Joint search for correlated channels (both streams deviating in same direction).
 * Returns the best starting point for correlated_high (both positive) and correlated_low (both negative).
 */
export function findOptimalStartingPointCorrelated(
	cumSumA: number[],
	cumSumB: number[],
	currentIdx: number,
	bitsPerTick: number,
	lookback: number,
	minLen: number
): { highZ: number; highStart: number; lowZ: number; lowStart: number } {
	let bestHighZ = 0;
	let bestLowZ = 0;
	let bestHighStart = currentIdx;
	let bestLowStart = currentIdx;

	const searchStart = Math.max(0, currentIdx - lookback);

	for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
		const tickSpan = currentIdx - s;
		const bitSpan = tickSpan * bitsPerTick;

		const deltaA = (cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0);
		const deltaB = (cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0);
		const zA = deltaA / Math.sqrt(bitSpan);
		const zB = deltaB / Math.sqrt(bitSpan);

		// Correlated high: both positive (both streams trending toward 1s)
		if (zA > 0 && zB > 0) {
			const strength = Math.min(zA, zB);
			if (strength > bestHighZ) {
				bestHighZ = strength;
				bestHighStart = s;
			}
		}

		// Correlated low: both negative (both streams trending toward 0s)
		if (zA < 0 && zB < 0) {
			const strength = Math.min(-zA, -zB);
			if (strength > bestLowZ) {
				bestLowZ = strength;
				bestLowStart = s;
			}
		}
	}

	return { highZ: bestHighZ, highStart: bestHighStart, lowZ: bestLowZ, lowStart: bestLowStart };
}

/**
 * Joint search for anti-correlated channels (streams deviating in opposite directions).
 * Returns the best starting point for anti_ab (A high, B low) and anti_ba (B high, A low).
 */
export function findOptimalStartingPointAnti(
	cumSumA: number[],
	cumSumB: number[],
	currentIdx: number,
	bitsPerTick: number,
	lookback: number,
	minLen: number
): { abZ: number; abStart: number; baZ: number; baStart: number } {
	let bestAbZ = 0;
	let bestBaZ = 0;
	let bestAbStart = currentIdx;
	let bestBaStart = currentIdx;

	const searchStart = Math.max(0, currentIdx - lookback);

	for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
		const tickSpan = currentIdx - s;
		const bitSpan = tickSpan * bitsPerTick;

		const deltaA = (cumSumA[currentIdx] ?? 0) - (cumSumA[s] ?? 0);
		const deltaB = (cumSumB[currentIdx] ?? 0) - (cumSumB[s] ?? 0);
		const zA = deltaA / Math.sqrt(bitSpan);
		const zB = deltaB / Math.sqrt(bitSpan);

		// Anti AB: A positive (toward 1s), B negative (toward 0s)
		if (zA > 0 && zB < 0) {
			const strength = Math.min(zA, -zB);
			if (strength > bestAbZ) {
				bestAbZ = strength;
				bestAbStart = s;
			}
		}

		// Anti BA: B positive (toward 1s), A negative (toward 0s)
		if (zA < 0 && zB > 0) {
			const strength = Math.min(-zA, zB);
			if (strength > bestBaZ) {
				bestBaZ = strength;
				bestBaStart = s;
			}
		}
	}

	return { abZ: bestAbZ, abStart: bestAbStart, baZ: bestBaZ, baStart: bestBaStart };
}

export function findOptimalStartingPointPearson(
	cumSumXY: number[],
	cumSumA: number[],
	cumSumB: number[],
	currentIdx: number,
	bitsPerTick: number,
	lookback: number,
	minLen: number
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

		// Pearson correlation for +-1 variables
		const meanX = sumX / bitSpan;
		const meanY = sumY / bitSpan;
		const cov = sumXY / bitSpan - meanX * meanY;
		const varX = Math.max(1e-6, 1 - meanX * meanX);
		const varY = Math.max(1e-6, 1 - meanY * meanY);
		// Clamp r to valid [-1, 1] range (can exceed due to variance floor)
		const r = Math.max(-1, Math.min(1, cov / Math.sqrt(varX * varY)));

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
