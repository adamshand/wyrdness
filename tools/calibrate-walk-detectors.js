#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_QUANTILES = [
	0.00001, 0.00005, 0.0001, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75,
	0.9, 0.95, 0.98, 0.99, 0.995, 0.998, 0.999, 0.9995, 0.9999, 0.99995, 0.99999
];

const MIN_SUPPORTED_TAIL = 0.0001;
const DEFAULT_TAIL_PROBABILITIES = [
	0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002, MIN_SUPPORTED_TAIL
];

function usage() {
	return (
		`Usage: node tools/calibrate-walk-detectors.js [options]\n\n` +
		`Generates synthetic independent random A/B bit streams and measures the\n` +
		`null distribution of the random-walk close/apart detector after the same\n` +
		`best-starting-point search used by the lamp.\n\n` +
		`Options:\n` +
		`  --ticks <n>             Total ticks to simulate. Default: 100000\n` +
		`  --sample-bits <n>       Bits per stream per tick. Default: 200\n` +
		`  --max-lookback <n>      Candidate start search depth in ticks. Default: 120\n` +
		`  --min-segment-len <n>   Minimum candidate segment length in ticks. Default: 3\n` +
		`  --warmup <n>            Ticks to skip before recording. Default: max-lookback\n` +
		`  --chunk-bytes <n>       Random byte buffer refill size. Default: 1048576\n` +
		`  --out <path>            Optional JSON report path\n` +
		`  --pretty                Pretty-print JSON output\n` +
		`  --help                  Show this help\n\n` +
		`Examples:\n` +
		`  node tools/calibrate-walk-detectors.js --ticks 100000\n` +
		`  node tools/calibrate-walk-detectors.js --ticks 1000000 --out tools/calibration/walk-v1.json --pretty\n`
	);
}

function parseArgs(argv) {
	const options = {
		ticks: 100_000,
		sampleBits: 200,
		maxLookback: 120,
		minSegmentLen: 3,
		warmup: null,
		chunkBytes: 1_048_576,
		out: null,
		pretty: false
	};

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			const value = argv[++i];
			if (value == null || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
			return value;
		};

		switch (arg) {
			case '--ticks':
				options.ticks = Number(next());
				break;
			case '--sample-bits':
				options.sampleBits = Number(next());
				break;
			case '--max-lookback':
				options.maxLookback = Number(next());
				break;
			case '--min-segment-len':
				options.minSegmentLen = Number(next());
				break;
			case '--warmup':
				options.warmup = Number(next());
				break;
			case '--chunk-bytes':
				options.chunkBytes = Number(next());
				break;
			case '--out':
				options.out = next();
				break;
			case '--pretty':
				options.pretty = true;
				break;
			case '--help':
				console.log(usage());
				process.exit(0);
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	options.warmup ??= options.maxLookback;

	for (const [key, value] of Object.entries(options)) {
		if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
			throw new Error(`${key} must be a non-negative finite number`);
		}
	}

	options.ticks = Math.floor(options.ticks);
	options.sampleBits = Math.floor(options.sampleBits);
	options.maxLookback = Math.floor(options.maxLookback);
	options.minSegmentLen = Math.floor(options.minSegmentLen);
	options.warmup = Math.floor(options.warmup);
	options.chunkBytes = Math.floor(options.chunkBytes);

	if (options.sampleBits < 1) throw new Error('--sample-bits must be at least 1');
	if (options.maxLookback < 1) throw new Error('--max-lookback must be at least 1');
	if (options.minSegmentLen < 1) throw new Error('--min-segment-len must be at least 1');
	if (options.minSegmentLen > options.maxLookback) {
		throw new Error('--min-segment-len must be <= --max-lookback');
	}
	if (options.ticks <= options.warmup) {
		throw new Error('--ticks must be greater than warmup so there are samples to record');
	}

	return options;
}

class RandomByteStream {
	constructor(chunkBytes) {
		this.chunkBytes = chunkBytes;
		this.buffer = randomBytes(chunkBytes);
		this.offset = 0;
	}

	ensure(byteCount) {
		if (this.buffer.length - this.offset >= byteCount) return;
		this.buffer = randomBytes(Math.max(this.chunkBytes, byteCount));
		this.offset = 0;
	}

	reserve(byteCount) {
		this.ensure(byteCount);
		const start = this.offset;
		this.offset += byteCount;
		return start;
	}
}

function bitAt(buffer, bitIndex) {
	return (buffer[bitIndex >> 3] >> (bitIndex & 7)) & 1;
}

function sampleTick(byteStream, sampleBits) {
	// Two streams need 2 * sampleBits independent bits. We pack A and B as
	// adjacent bits: A_i at bit 2i, B_i at bit 2i+1.
	const byteCount = Math.ceil((2 * sampleBits) / 8);
	const baseByte = byteStream.reserve(byteCount);
	const buffer = byteStream.buffer;
	let sumX = 0;
	let sumY = 0;

	for (let i = 0; i < sampleBits; i++) {
		const pairBit = i * 2;
		const a = bitAt(buffer, baseByte * 8 + pairBit);
		const b = bitAt(buffer, baseByte * 8 + pairBit + 1);
		sumX += a === 1 ? 1 : -1;
		sumY += b === 1 ? 1 : -1;
	}

	return { sumX, sumY };
}

function walkDistanceScores(cumSumA, cumSumB, currentIdx, bitsPerTick, lookback, minLen) {
	let bestCloseRatio = Number.POSITIVE_INFINITY;
	let bestCloseStart = currentIdx;
	let bestCloseDistance = 0;
	let bestCloseExpected = 0;
	let bestCloseLegacyZ = 0;

	let bestSeparateRatio = Number.NEGATIVE_INFINITY;
	let bestSeparateStart = currentIdx;
	let bestSeparateDistance = 0;
	let bestSeparateExpected = 0;
	let bestSeparateLegacyZ = 0;

	const searchStart = Math.max(0, currentIdx - lookback);
	const expectedAbsNormalScale = Math.sqrt(2 / Math.PI);

	for (let s = searchStart; s < currentIdx - minLen + 1; s++) {
		const tickSpan = currentIdx - s;
		if (tickSpan < minLen) continue;

		let sumDistance = 0;
		let expectedSumDistance = 0;
		const a0 = cumSumA[s] ?? 0;
		const b0 = cumSumB[s] ?? 0;

		for (let i = s + 1; i <= currentIdx; i++) {
			const age = i - s;
			const walkA = (cumSumA[i] ?? 0) - a0;
			const walkB = (cumSumB[i] ?? 0) - b0;
			sumDistance += Math.abs(walkA - walkB);

			// A-B is a random walk whose per-tick variance is approximately
			// 2 * bitsPerTick. Under a normal approximation,
			// E(|N(0, sigma)|) = sigma * sqrt(2/pi).
			expectedSumDistance += Math.sqrt(2 * bitsPerTick * age) * expectedAbsNormalScale;
		}

		const meanDistance = sumDistance / tickSpan;
		const expectedMean = Math.max(1e-12, expectedSumDistance / tickSpan);
		const ratio = meanDistance / expectedMean;

		// This is the old guessed transformation. We record it only as a
		// diagnostic so we can show why it should not be treated as real z.
		const ratioSigma = Math.max(0.09, 0.34 / Math.pow(tickSpan, 0.25));
		const closeLegacyZ = (1 - ratio) / ratioSigma;
		const separateLegacyZ = (ratio - 1) / ratioSigma;

		if (ratio < bestCloseRatio) {
			bestCloseRatio = ratio;
			bestCloseStart = s;
			bestCloseDistance = meanDistance;
			bestCloseExpected = expectedMean;
			bestCloseLegacyZ = closeLegacyZ;
		}

		if (ratio > bestSeparateRatio) {
			bestSeparateRatio = ratio;
			bestSeparateStart = s;
			bestSeparateDistance = meanDistance;
			bestSeparateExpected = expectedMean;
			bestSeparateLegacyZ = separateLegacyZ;
		}
	}

	return {
		closeRatio: bestCloseRatio,
		closeLength: currentIdx - bestCloseStart,
		closeDistance: bestCloseDistance,
		closeExpected: bestCloseExpected,
		closeLegacyZ: bestCloseLegacyZ,
		separateRatio: bestSeparateRatio,
		separateLength: currentIdx - bestSeparateStart,
		separateDistance: bestSeparateDistance,
		separateExpected: bestSeparateExpected,
		separateLegacyZ: bestSeparateLegacyZ
	};
}

function quantile(sorted, q) {
	if (sorted.length === 0) return null;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
	return sorted[idx];
}

function quantileTable(sorted, probabilities = DEFAULT_QUANTILES) {
	return probabilities.map((q) => [q, quantile(sorted, q)]);
}

function conservativeDuplicateThresholds(rows) {
	const byThreshold = new Map();
	for (const [p, threshold] of rows) {
		const previous = byThreshold.get(threshold);
		byThreshold.set(threshold, previous == null ? p : Math.max(previous, p));
	}
	return [...byThreshold.entries()]
		.map(([threshold, p]) => [p, threshold])
		.sort((a, b) => b[0] - a[0]);
}

function lowerTailThresholds(sortedAscending, tailProbabilities = DEFAULT_TAIL_PROBABILITIES) {
	return conservativeDuplicateThresholds(tailProbabilities.map((p) => [p, quantile(sortedAscending, p)]));
}

function upperTailThresholds(sortedAscending, tailProbabilities = DEFAULT_TAIL_PROBABILITIES) {
	return conservativeDuplicateThresholds(tailProbabilities.map((p) => [p, quantile(sortedAscending, 1 - p)]));
}

function histogramToRows(hist) {
	const rows = [];
	for (let i = 0; i < hist.length; i++) {
		if (hist[i] > 0) rows.push([i, hist[i]]);
	}
	return rows;
}

function formatNumber(value, digits = 6) {
	return Number.isFinite(value) ? value.toFixed(digits) : String(value);
}

function printSummary(report) {
	const close = report.walkDistance.closeRatio;
	const separate = report.walkDistance.separateRatio;
	const legacyClose = report.diagnostics.legacyCloseZ;
	const legacySeparate = report.diagnostics.legacySeparateZ;

	console.log('\nWalk detector null calibration summary');
	console.log('--------------------------------------');
	console.log(`ticks:          ${report.params.ticks.toLocaleString()}`);
	console.log(`recorded:       ${report.params.recordedSamples.toLocaleString()}`);
	console.log(`sample bits:    ${report.params.sampleBits}`);
	console.log(`lookback:       ${report.params.maxLookback}`);
	console.log(`min segment:    ${report.params.minSegmentLen}`);
	console.log(`duration:       ${(report.runtime.durationMs / 1000).toFixed(2)}s`);
	console.log(
		`throughput:     ${Math.round(report.runtime.ticksPerSecond).toLocaleString()} ticks/s`
	);

	const q = (table, p) => table.find(([x]) => x === p)?.[1];
	console.log('\nBest-over-window ratio quantiles under null');
	console.log(
		`close    p01=${formatNumber(q(close.quantiles, 0.01))} p05=${formatNumber(q(close.quantiles, 0.05))} p50=${formatNumber(q(close.quantiles, 0.5))}`
	);
	console.log(
		`separate p50=${formatNumber(q(separate.quantiles, 0.5))} p95=${formatNumber(q(separate.quantiles, 0.95))} p99=${formatNumber(q(separate.quantiles, 0.99))}`
	);

	console.log('\nDiagnostic: old guessed z transform under null');
	console.log(
		`closeZ    p50=${formatNumber(q(legacyClose.quantiles, 0.5), 3)} p95=${formatNumber(q(legacyClose.quantiles, 0.95), 3)} p99=${formatNumber(q(legacyClose.quantiles, 0.99), 3)}`
	);
	console.log(
		`separateZ p50=${formatNumber(q(legacySeparate.quantiles, 0.5), 3)} p95=${formatNumber(q(legacySeparate.quantiles, 0.95), 3)} p99=${formatNumber(q(legacySeparate.quantiles, 0.99), 3)}`
	);

	console.log(
		'\nUse close.lowerTailThresholds and separate.upperTailThresholds as empirical p lookup tables.'
	);
}

function main() {
	const options = parseArgs(process.argv);
	const startMs = performance.now();
	const recordedSamples = options.ticks - options.warmup;

	const closeRatios = new Float64Array(recordedSamples);
	const separateRatios = new Float64Array(recordedSamples);
	const closeLegacyZ = new Float64Array(recordedSamples);
	const separateLegacyZ = new Float64Array(recordedSamples);
	const closeLengthHist = new Uint32Array(options.maxLookback + 1);
	const separateLengthHist = new Uint32Array(options.maxLookback + 1);

	const byteStream = new RandomByteStream(options.chunkBytes);
	let cumSumA = [0];
	let cumSumB = [0];
	const maxStoredTicks = options.maxLookback + 20;
	let recorded = 0;

	for (let tick = 1; tick <= options.ticks; tick++) {
		const sample = sampleTick(byteStream, options.sampleBits);
		cumSumA.push((cumSumA[cumSumA.length - 1] ?? 0) + sample.sumX);
		cumSumB.push((cumSumB[cumSumB.length - 1] ?? 0) + sample.sumY);

		if (cumSumA.length > maxStoredTicks) {
			cumSumA = cumSumA.slice(-maxStoredTicks);
			cumSumB = cumSumB.slice(-maxStoredTicks);
		}

		if (tick <= options.warmup) continue;

		const currentIdx = cumSumA.length - 1;
		const scores = walkDistanceScores(
			cumSumA,
			cumSumB,
			currentIdx,
			options.sampleBits,
			options.maxLookback,
			options.minSegmentLen
		);

		closeRatios[recorded] = scores.closeRatio;
		separateRatios[recorded] = scores.separateRatio;
		closeLegacyZ[recorded] = scores.closeLegacyZ;
		separateLegacyZ[recorded] = scores.separateLegacyZ;
		if (scores.closeLength >= 0 && scores.closeLength < closeLengthHist.length)
			closeLengthHist[scores.closeLength]++;
		if (scores.separateLength >= 0 && scores.separateLength < separateLengthHist.length) {
			separateLengthHist[scores.separateLength]++;
		}
		recorded++;
	}

	closeRatios.sort();
	separateRatios.sort();
	closeLegacyZ.sort();
	separateLegacyZ.sort();

	const endMs = performance.now();
	const durationMs = endMs - startMs;
	const report = {
		version: 1,
		kind: 'wyrdweb-walk-distance-null-calibration',
		createdAt: new Date().toISOString(),
		params: {
			ticks: options.ticks,
			warmupTicks: options.warmup,
			recordedSamples,
			sampleBits: options.sampleBits,
			maxLookback: options.maxLookback,
			minSegmentLen: options.minSegmentLen,
			minSupportedTail: MIN_SUPPORTED_TAIL,
			randomSource: 'node:crypto.randomBytes',
			distanceStatistic:
				'mean(abs((cumA_i-cumA_start) - (cumB_i-cumB_start))) / expectedMeanDistance',
			expectedDistance: 'sqrt(2 * sampleBits * age) * sqrt(2/pi)',
			search: 'best close=min ratio and best separate=max ratio over candidate starts'
		},
		runtime: {
			durationMs,
			ticksPerSecond: options.ticks / (durationMs / 1000),
			recordedSamplesPerSecond: recordedSamples / (durationMs / 1000)
		},
		walkDistance: {
			closeRatio: {
				meaning: 'lower is more stick-together / Channel 3min-like',
				quantiles: quantileTable(closeRatios),
				lowerTailThresholds: lowerTailThresholds(closeRatios),
				selectedLengthHistogram: histogramToRows(closeLengthHist)
			},
			separateRatio: {
				meaning: 'higher is more apart / Channel 3max-like',
				quantiles: quantileTable(separateRatios),
				upperTailThresholds: upperTailThresholds(separateRatios),
				selectedLengthHistogram: histogramToRows(separateLengthHist)
			}
		},
		diagnostics: {
			legacyCloseZ: {
				meaning: 'old guessed close z transform; diagnostic only, not calibrated',
				quantiles: quantileTable(closeLegacyZ)
			},
			legacySeparateZ: {
				meaning: 'old guessed separate z transform; diagnostic only, not calibrated',
				quantiles: quantileTable(separateLegacyZ)
			}
		}
	};

	printSummary(report);

	if (options.out) {
		const outPath = resolve(options.out);
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, JSON.stringify(report, null, options.pretty ? 2 : 0) + '\n');
		console.log(`\nWrote ${outPath}`);
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	console.error('\n' + usage());
	process.exit(1);
}
