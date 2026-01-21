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

		if (Math.abs(z) > Math.abs(bestZ)) {
			bestZ = z;
			bestStart = s;
		}
	}

	return { startIdx: bestStart, z: bestZ };
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
